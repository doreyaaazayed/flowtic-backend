/**
 * Seat Hold Service — Redis TTL-based seat locking with in-memory fallback.
 *
 * Each seat is locked with key:  hold:{eventId}:{seatId}  → userId
 * TTL: HOLD_TTL_SECONDS (default 10 min). Uses SET NX so only the first
 * caller wins; concurrent requests for the same seat are rejected atomically.
 *
 * When Redis is unavailable, an in-memory Map is used as fallback so the
 * full purchase flow still works on a single-process dev server.
 */

const Redis = require("ioredis");

const HOLD_TTL_SECONDS = parseInt(
  process.env.SEAT_HOLD_TTL_SECONDS || "600",
  10,
);

// ── In-memory fallback ──────────────────────────────────────────────────────
// { key → { userId: string, expiresAt: number } }
const memStore = new Map();

function memSet(key, userId) {
  memStore.set(key, { userId: String(userId), expiresAt: Date.now() + HOLD_TTL_SECONDS * 1000 });
}
function memGet(key) {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memStore.delete(key); return null; }
  return entry.userId;
}
function memTtl(key) {
  const entry = memStore.get(key);
  if (!entry) return -2;
  const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
  if (remaining <= 0) { memStore.delete(key); return -2; }
  return remaining;
}
function memDel(key, userId) {
  const entry = memStore.get(key);
  if (entry && entry.userId === String(userId)) memStore.delete(key);
}
function memRefresh(key, userId) {
  const entry = memStore.get(key);
  if (entry && entry.userId === String(userId)) {
    entry.expiresAt = Date.now() + HOLD_TTL_SECONDS * 1000;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

let redis = null;
let redisDown = false;

function getRedis() {
  if (redis) return redis;
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  redis.on("error", (err) => {
    if (!redisDown) {
      console.warn("[SeatHold] Redis unavailable — using in-memory fallback:", err.message);
      redisDown = true;
    }
  });
  redis.on("connect", () => {
    if (redisDown) {
      console.info("[SeatHold] Redis reconnected — resuming Redis-backed holds.");
      redisDown = false;
    }
  });
  return redis;
}

function holdKey(eventId, seatId) {
  return `hold:${eventId}:${seatId}`;
}

/**
 * Attempt to hold all seatIds for a user atomically.
 * Returns { ok: true } or { ok: false, takenSeats: number[] }.
 */
async function holdSeats(eventId, seatIds, userId) {
  // ── In-memory path ──
  if (redisDown || process.env.REDIS_URL === "disabled") {
    const failed = [];
    const acquired = [];
    for (const sid of seatIds) {
      const key = holdKey(eventId, sid);
      const existing = memGet(key);
      if (existing && existing !== String(userId)) {
        failed.push(sid);
      } else {
        memSet(key, userId);
        acquired.push(sid);
      }
    }
    if (failed.length > 0) {
      for (const sid of acquired) memDel(holdKey(eventId, sid), userId);
      return { ok: false, takenSeats: failed };
    }
    return { ok: true };
  }

  // ── Redis path ──
  const client = getRedis();
  try {
    const pipeline = client.pipeline();
    for (const sid of seatIds) {
      pipeline.set(holdKey(eventId, sid), String(userId), "NX", "EX", HOLD_TTL_SECONDS);
    }
    const results = await pipeline.exec();
    const failed = [];
    for (let i = 0; i < results.length; i++) {
      const [err, reply] = results[i];
      if (err || reply !== "OK") failed.push(seatIds[i]);
    }
    if (failed.length > 0) {
      const ours = seatIds.filter((_, i) => results[i][1] === "OK");
      await releaseSeats(eventId, ours, userId);
      return { ok: false, takenSeats: failed };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[SeatHold] Redis error in holdSeats, falling back to memory:", err.message);
    redisDown = true;
    return holdSeats(eventId, seatIds, userId);
  }
}

/**
 * Release holds that belong to userId (won't release other users' holds).
 */
async function releaseSeats(eventId, seatIds, userId) {
  if (redisDown || process.env.REDIS_URL === "disabled") {
    for (const sid of seatIds) memDel(holdKey(eventId, sid), userId);
    return;
  }
  const client = getRedis();
  try {
    const pipeline = client.pipeline();
    for (const sid of seatIds) {
      const key = holdKey(eventId, sid);
      pipeline.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1, key, String(userId),
      );
    }
    await pipeline.exec();
  } catch (err) {
    console.warn("[SeatHold] Redis error in releaseSeats:", err.message);
    for (const sid of seatIds) memDel(holdKey(eventId, sid), userId);
  }
}

/**
 * Get remaining TTL (seconds) for a user's hold on a set of seats.
 * Returns the minimum TTL across all seats, or 0 if any hold is gone.
 */
async function getHoldTtl(eventId, seatIds, userId) {
  if (redisDown || process.env.REDIS_URL === "disabled") {
    let min = HOLD_TTL_SECONDS;
    for (const sid of seatIds) {
      const key = holdKey(eventId, sid);
      if (memGet(key) !== String(userId)) return 0;
      const t = memTtl(key);
      if (t <= 0) return 0;
      if (t < min) min = t;
    }
    return min;
  }
  const client = getRedis();
  try {
    const pipeline = client.pipeline();
    for (const sid of seatIds) pipeline.get(holdKey(eventId, sid));
    const gets = await pipeline.exec();

    const pipeline2 = client.pipeline();
    for (const sid of seatIds) pipeline2.ttl(holdKey(eventId, sid));
    const ttls = await pipeline2.exec();

    let min = HOLD_TTL_SECONDS;
    for (let i = 0; i < seatIds.length; i++) {
      const owner = gets[i][1];
      if (owner !== String(userId)) return 0;
      const t = ttls[i][1];
      if (t < 0) return 0;
      if (t < min) min = t;
    }
    return min;
  } catch {
    return HOLD_TTL_SECONDS;
  }
}

/**
 * Refresh TTL on already-held seats (extend while user is on payment step).
 */
async function refreshHold(eventId, seatIds, userId) {
  if (redisDown || process.env.REDIS_URL === "disabled") {
    for (const sid of seatIds) memRefresh(holdKey(eventId, sid), userId);
    return;
  }
  const client = getRedis();
  try {
    const pipeline = client.pipeline();
    for (const sid of seatIds) {
      const key = holdKey(eventId, sid);
      pipeline.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`,
        1, key, String(userId), String(HOLD_TTL_SECONDS),
      );
    }
    await pipeline.exec();
  } catch (err) {
    console.warn("[SeatHold] Redis error in refreshHold:", err.message);
    for (const sid of seatIds) memRefresh(holdKey(eventId, sid), userId);
  }
}

module.exports = {
  holdSeats,
  releaseSeats,
  getHoldTtl,
  refreshHold,
  HOLD_TTL_SECONDS,
};
