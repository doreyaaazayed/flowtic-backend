const crypto = require("crypto");
const EntryGate = require("../models/EntryGate");
const EntrySlot = require("../models/EntrySlot");
const EntryAssignment = require("../models/EntryAssignment");
const TicketFriendLink = require("../models/TicketFriendLink");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const { parseEmbedding, matchProbeToGallery, getTemplateGallery } = require("../utils/faceMatch");

const GRACE_MS = 20 * 60 * 1000;

function uuid() {
  return crypto.randomUUID();
}

function buildTicketGroups(ticketIds, links) {
  const parent = new Map();
  for (const t of ticketIds) parent.set(t, t);
  function find(x) {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const [a, b] of links) {
    if (parent.has(a) && parent.has(b)) union(a, b);
  }
  const buckets = new Map();
  for (const t of ticketIds) {
    const r = find(t);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(t);
  }
  return Array.from(buckets.values()).sort((a, b) => b.length - a.length);
}

/**
 * Setup gates + slots. Wipes previous entry config for this EventID.
 */
async function setupInfrastructure(eventId, startDate, options) {
  const gateCount = Math.min(100, Math.max(1, Number(options.gateCount) || 20));
  const slotMinutes = Math.min(180, Math.max(5, Number(options.slotMinutes) || 15));
  const slotCount = Math.min(500, Math.max(1, Number(options.slotCount) || 40));
  const hoursBeforeStart = Math.min(72, Math.max(1, Number(options.hoursBeforeStart) || 8));

  await EntryAssignment.deleteMany({ EventID: eventId });
  await EntryGate.deleteMany({ EventID: eventId });
  await EntrySlot.deleteMany({ EventID: eventId });

  const gates = [];
  for (let g = 1; g <= gateCount; g++) {
    gates.push({
      EventID: eventId,
      gateIndex: g,
      label: `Gate ${g}`,
      jamScore: 0,
      scansLast15m: 0,
    });
  }
  await EntryGate.insertMany(gates);

  const start = new Date(startDate);
  const firstWindow = new Date(start.getTime() - hoursBeforeStart * 60 * 60 * 1000);
  const sold = await Ticket.countDocuments({
    EventID: eventId,
    IsAvailable: false,
    OwnerUserId: { $exists: true, $ne: null },
  });
  const denom = Math.max(1, gateCount * slotCount);
  const maxPerGate = Math.max(1, Math.ceil(sold / denom) + 2);

  const slots = [];
  for (let s = 0; s < slotCount; s++) {
    const ws = new Date(firstWindow.getTime() + s * slotMinutes * 60 * 1000);
    const we = new Date(ws.getTime() + slotMinutes * 60 * 1000);
    slots.push({
      EventID: eventId,
      slotIndex: s,
      windowStart: ws,
      windowEnd: we,
      maxPerGate,
    });
  }
  await EntrySlot.insertMany(slots);

  return { gateCount, slotCount, slotMinutes, maxPerGate, hoursBeforeStart, soldEstimate: sold };
}

async function loadLinks(eventId) {
  const docs = await TicketFriendLink.find({ EventID: eventId }).lean();
  return docs.map((d) =>
    d.ticketLow < d.ticketHigh ? [d.ticketLow, d.ticketHigh] : [d.ticketHigh, d.ticketLow]
  );
}

/** All ticket IDs in the same friend-link connected component as seedTicketId. */
async function getLinkedComponentTicketIds(eventId, seedTicketId) {
  const links = await loadLinks(eventId);
  const adj = new Map();
  const addEdge = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (const [a, b] of links) addEdge(a, b);
  const start = Number(seedTicketId);
  if (!adj.has(start)) return [start];

  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of adj.get(cur) || []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return [...seen];
}

/**
 * Place a sold-ticket cluster on the least-loaded (gate, slot) with capacity.
 * Voids any existing active assignments for tickets in the cluster first.
 */
/**
 * @param {{ excludeGateSlot?: { gateIndex: number, slotIndex: number } }} options
 *   When set (regenerate), prefer a different gate/slot than the excluded pair.
 */
async function placeClusterAtBestSlot(eventId, cluster, options = {}) {
  const uniq = [...new Set(cluster.map(Number).filter((n) => n > 0))];
  if (uniq.length === 0) return { placed: 0, ticketIds: [] };
  const exclude = options.excludeGateSlot;

  const sold = await Ticket.find({
    EventID: eventId,
    TicketID: { $in: uniq },
    IsAvailable: false,
    OwnerUserId: { $exists: true, $ne: null },
  })
    .select("TicketID OwnerUserId")
    .lean();
  if (sold.length < uniq.length) {
    throw new Error("All linked tickets must be sold and owned before aligning gate times");
  }
  const ownerByTicket = Object.fromEntries(sold.map((t) => [t.TicketID, t.OwnerUserId]));
  const clusterIds = sold.map((t) => t.TicketID);
  const size = clusterIds.length;

  const slots = await EntrySlot.find({ EventID: eventId }).sort({ slotIndex: 1 }).lean();
  const gates = await EntryGate.find({ EventID: eventId }).sort({ gateIndex: 1 }).lean();
  if (!slots.length || !gates.length) {
    throw new Error("Entry gates/slots not configured. Organizer must run setup first.");
  }

  // Remove prior rows (TicketID is globally unique on this collection — cannot void + re-insert).
  await EntryAssignment.deleteMany({ EventID: eventId, TicketID: { $in: clusterIds } });

  const now = Date.now();
  const candidates = [];
  for (const s of slots) {
    if (new Date(s.windowEnd).getTime() < now - GRACE_MS) continue;
    for (const g of gates) {
      const usedExcl = await EntryAssignment.countDocuments({
        EventID: eventId,
        slotIndex: s.slotIndex,
        gateIndex: g.gateIndex,
        status: { $ne: "void" },
        TicketID: { $nin: clusterIds },
      });
      const room = s.maxPerGate - usedExcl;
      if (room < size) continue;
      const score = usedExcl + (g.jamScore || 0) * 0.01;
      const isExcluded =
        exclude != null &&
        Number(exclude.gateIndex) === Number(g.gateIndex) &&
        Number(exclude.slotIndex) === Number(s.slotIndex);
      candidates.push({ s, g, score, isExcluded });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  let best = exclude ? candidates.find((c) => !c.isExcluded) : candidates[0];
  if (!best) best = candidates[0];
  if (!best) {
    throw new Error("No gate/slot has room for your group. Ask the organizer to add capacity or lower jam.");
  }
  if (exclude && best.isExcluded) {
    throw new Error(
      "No other gate or time slot is available right now. Try again later or ask the organizer to add capacity."
    );
  }

  const clusterRows = await EntryAssignment.find({
    EventID: eventId,
    TicketID: { $in: clusterIds },
  }).lean();
  const nextVer = Math.max(0, ...clusterRows.map((r) => r.version || 1)) + 1;
  const gid = size > 1 ? uuid() : null;
  const inserts = clusterIds.map((tid) => ({
    EventID: eventId,
    TicketID: tid,
    userId: ownerByTicket[tid],
    gateIndex: best.g.gateIndex,
    slotIndex: best.s.slotIndex,
    windowStart: best.s.windowStart,
    windowEnd: best.s.windowEnd,
    friendGroupId: gid,
    version: nextVer,
    status: "active",
  }));
  await EntryAssignment.insertMany(inserts);
  return {
    placed: inserts.length,
    ticketIds: clusterIds,
    gateIndex: best.g.gateIndex,
    slotIndex: best.s.slotIndex,
    windowStart: best.s.windowStart,
    windowEnd: best.s.windowEnd,
  };
}

/**
 * After linking two tickets, align the whole friend component to the same gate + window.
 */
/**
 * Link one or more friend tickets to the attendee's ticket, then align the whole group.
 */
async function linkFriendsToCluster(eventId, myTicketId, friendTicketIds, userIdObj) {
  const mine = Number(myTicketId);
  if (!mine) throw new Error("myTicketId required");

  const tMine = await Ticket.findOne({ TicketID: mine }).lean();
  if (!tMine) throw new Error("Ticket not found");
  if (String(tMine.OwnerUserId) !== String(userIdObj)) {
    throw new Error("You must own the ticket you are linking from");
  }

  const friends = [
    ...new Set(
      (Array.isArray(friendTicketIds) ? friendTicketIds : [friendTicketIds])
        .map(Number)
        .filter((n) => n > 0 && n !== mine)
    ),
  ];
  if (friends.length === 0) {
    throw new Error("Provide at least one friend's ticket ID (different from yours)");
  }

  const linked = [];
  for (const fid of friends) {
    const tFriend = await Ticket.findOne({ TicketID: fid }).lean();
    if (!tFriend) throw new Error(`Ticket #${fid} not found`);
    if (tFriend.EventID !== tMine.EventID) {
      throw new Error(`Ticket #${fid} is not for the same event`);
    }
    if (tFriend.IsAvailable) {
      throw new Error(`Ticket #${fid} must be sold (owned) before friendly entry`);
    }
    const low = Math.min(mine, fid);
    const high = Math.max(mine, fid);
    await TicketFriendLink.findOneAndUpdate(
      { EventID: tMine.EventID, ticketLow: low, ticketHigh: high },
      {
        $setOnInsert: {
          EventID: tMine.EventID,
          ticketLow: low,
          ticketHigh: high,
          createdBy: userIdObj,
        },
      },
      { upsert: true, new: true }
    );
    linked.push(fid);
  }

  const cluster = await getLinkedComponentTicketIds(eventId, mine);
  const soldTickets = await Ticket.find({
    EventID: eventId,
    TicketID: { $in: cluster },
    IsAvailable: false,
    OwnerUserId: { $exists: true, $ne: null },
  })
    .select("TicketID")
    .lean();
  if (soldTickets.length < 2) {
    return {
      ok: true,
      linked,
      cluster,
      realigned: 0,
      message:
        "Friends linked. Everyone in the group needs a sold ticket before we can assign the same gate and time.",
    };
  }

  const out = await placeClusterAtBestSlot(eventId, soldTickets.map((t) => t.TicketID));
  return {
    ok: true,
    linked,
    cluster: out.ticketIds,
    realigned: out.placed,
    gateIndex: out.gateIndex,
    slotIndex: out.slotIndex,
    windowStart: out.windowStart,
    windowEnd: out.windowEnd,
    message: `Friendly group (${out.placed} tickets) aligned to Gate ${out.gateIndex}, slot ${out.slotIndex}.`,
  };
}

async function realignLinkedCluster(eventId, ticketLow, ticketHigh) {
  const component = await getLinkedComponentTicketIds(eventId, ticketLow);
  if (!component.includes(ticketHigh)) component.push(ticketHigh);
  const soldTickets = await Ticket.find({
    EventID: eventId,
    TicketID: { $in: component },
    IsAvailable: false,
    OwnerUserId: { $exists: true, $ne: null },
  })
    .select("TicketID")
    .lean();
  const cluster = soldTickets.map((t) => t.TicketID);
  if (cluster.length < 2) {
    return {
      realigned: 0,
      ticketIds: cluster,
      message: "Link saved. Both friends need sold tickets before gate times can align.",
    };
  }
  const out = await placeClusterAtBestSlot(eventId, cluster);
  return {
    realigned: out.placed,
    ticketIds: out.ticketIds,
    gateIndex: out.gateIndex,
    slotIndex: out.slotIndex,
    windowStart: out.windowStart,
    windowEnd: out.windowEnd,
    message: `Group aligned to Gate ${out.gateIndex}, slot ${out.slotIndex}.`,
  };
}

/**
 * Greedy assign friend clusters to (slot, gate) with capacity.
 * @param {boolean} replaceAll - delete existing assignments first
 */
async function runAssignment(eventId, replaceAll, options = {}) {
  if (replaceAll) await EntryAssignment.deleteMany({ EventID: eventId });

  const onlySet =
    Array.isArray(options.onlyTicketIds) && options.onlyTicketIds.length
      ? new Set(options.onlyTicketIds.map((id) => Number(id)))
      : null;

  const soldTickets = await Ticket.find({
    EventID: eventId,
    IsAvailable: false,
    OwnerUserId: { $exists: true, $ne: null },
    ...(onlySet ? { TicketID: { $in: [...onlySet] } } : {}),
  })
    .select("TicketID OwnerUserId")
    .lean();

  const ticketIds = soldTickets.map((t) => t.TicketID);
  const ownerByTicket = Object.fromEntries(soldTickets.map((t) => [t.TicketID, t.OwnerUserId]));

  const existing = await EntryAssignment.find({ EventID: eventId }).select("TicketID").lean();
  const existingSet = new Set(existing.map((e) => e.TicketID));
  let toAssign = replaceAll ? ticketIds : ticketIds.filter((id) => !existingSet.has(id));
  if (onlySet) toAssign = toAssign.filter((id) => onlySet.has(id));
  if (toAssign.length === 0) return { assigned: 0, message: "Nothing to assign", ticketIds: [] };

  const links = await loadLinks(eventId);
  const toSet = new Set(toAssign);
  const filteredLinks = links.filter(([a, b]) => toSet.has(a) && toSet.has(b));
  const groups = buildTicketGroups(toAssign, filteredLinks);

  const slots = await EntrySlot.find({ EventID: eventId }).sort({ slotIndex: 1 }).lean();
  const gates = await EntryGate.find({ EventID: eventId }).sort({ gateIndex: 1 }).lean();
  if (!slots.length || !gates.length) {
    throw new Error("Entry gates/slots not configured. Run setup first.");
  }

  const remaining = new Map();
  for (const s of slots) {
    for (const g of gates) {
      const used = await EntryAssignment.countDocuments({
        EventID: eventId,
        slotIndex: s.slotIndex,
        gateIndex: g.gateIndex,
        status: { $ne: "void" },
      });
      const cap = Math.max(0, s.maxPerGate - used);
      remaining.set(`${s.slotIndex}:${g.gateIndex}`, cap);
    }
  }

  const docs = [];
  for (const group of groups) {
    const gid = uuid();
    let placed = false;
    for (const s of slots) {
      for (const g of gates) {
        const key = `${s.slotIndex}:${g.gateIndex}`;
        if ((remaining.get(key) || 0) >= group.length) {
          remaining.set(key, remaining.get(key) - group.length);
          for (const tid of group) {
            docs.push({
              EventID: eventId,
              TicketID: tid,
              userId: ownerByTicket[tid],
              gateIndex: g.gateIndex,
              slotIndex: s.slotIndex,
              windowStart: s.windowStart,
              windowEnd: s.windowEnd,
              friendGroupId: group.length > 1 ? gid : null,
              version: 1,
              status: "active",
            });
          }
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      throw new Error(
        `Could not place a friend group of size ${group.length}. Increase slots, gates, or maxPerGate (re-run setup with more capacity).`
      );
    }
  }

  if (docs.length) await EntryAssignment.insertMany(docs);
  const assignedTicketIds = docs.map((d) => d.TicketID);
  return { assigned: docs.length, groups: groups.length, ticketIds: assignedTicketIds };
}

/**
 * Regenerate assignment for a cluster (friend group) containing ticketId.
 */
async function regenerateCluster(eventId, ticketId, userIdObj) {
  const base = await EntryAssignment.findOne({ EventID: eventId, TicketID: ticketId, status: { $ne: "void" } });
  if (!base) throw new Error("No assignment for this ticket");
  if (base.status === "used") {
    throw new Error("This ticket was already used for entry and cannot be rescheduled");
  }

  const cluster = await getLinkedComponentTicketIds(eventId, ticketId);

  const clusterTickets = await Ticket.find({ TicketID: { $in: cluster } }).select("OwnerUserId").lean();
  const allowed = clusterTickets.some((t) => String(t.OwnerUserId) === String(userIdObj));
  if (!allowed) throw new Error("You must own at least one ticket in this entry group");

  const previousGateIndex = base.gateIndex;
  const previousSlotIndex = base.slotIndex;

  const out = await placeClusterAtBestSlot(eventId, cluster, {
    excludeGateSlot: { gateIndex: previousGateIndex, slotIndex: previousSlotIndex },
  });

  const changed =
    Number(out.gateIndex) !== Number(previousGateIndex) ||
    Number(out.slotIndex) !== Number(previousSlotIndex);

  return {
    cluster: out.ticketIds,
    gateIndex: out.gateIndex,
    slotIndex: out.slotIndex,
    windowStart: out.windowStart,
    windowEnd: out.windowEnd,
    previousGateIndex,
    previousSlotIndex,
    changed,
  };
}

async function organizerRedirect(eventId, ticketIds, toGateIndex, toSlotIndex) {
  const slot =
    toSlotIndex != null
      ? await EntrySlot.findOne({ EventID: eventId, slotIndex: toSlotIndex }).lean()
      : null;
  if (toSlotIndex != null && !slot) throw new Error("Invalid slot index");
  const gate = await EntryGate.findOne({ EventID: eventId, gateIndex: toGateIndex }).lean();
  if (!gate) throw new Error("Invalid gate");

  let updated = 0;
  for (const tid of ticketIds) {
    const a = await EntryAssignment.findOne({ EventID: eventId, TicketID: tid, status: { $ne: "void" } });
    if (!a) continue;
    a.gateIndex = toGateIndex;
    if (slot) {
      a.slotIndex = slot.slotIndex;
      a.windowStart = slot.windowStart;
      a.windowEnd = slot.windowEnd;
    }
    a.version = (a.version || 1) + 1;
    await a.save();
    updated++;
  }
  return { updated };
}

async function assertEntryEligibility(eventId, gateIndex, ticketId) {
  const gate = await EntryGate.findOne({ EventID: eventId, gateIndex }).lean();
  if (!gate) throw new Error("Unknown gate");

  const ticket = await Ticket.findOne({ TicketID: ticketId, EventID: eventId }).lean();
  if (!ticket || ticket.IsAvailable) throw new Error("Invalid or unassigned ticket");

  const a = await EntryAssignment.findOne({ EventID: eventId, TicketID: ticketId, status: "active" });
  if (!a) {
    const used = await EntryAssignment.findOne({ EventID: eventId, TicketID: ticketId, status: "used" }).lean();
    if (used) {
      const err = new Error("ENTRY_ALREADY_USED");
      err.usedAt = used.usedAt;
      err.gateIndex = used.gateIndex;
      err.ticketId = ticketId;
      throw err;
    }
    throw new Error("No active entry assignment");
  }

  const now = Date.now();
  const startMs = new Date(a.windowStart).getTime() - GRACE_MS;
  const endMs = new Date(a.windowEnd).getTime() + GRACE_MS;
  if (a.gateIndex !== gateIndex) {
    throw new Error(`Wrong gate: assigned Gate ${a.gateIndex}, this is Gate ${gateIndex}`);
  }
  if (now < startMs || now > endMs) {
    throw new Error("Outside allowed entry window (including grace). Use regenerate in the app.");
  }

  return { a, gate, ticket };
}

async function verifyAtGate(eventId, gateIndex, ticketId) {
  const { a } = await assertEntryEligibility(eventId, gateIndex, ticketId);

  a.status = "used";
  a.usedAt = new Date();
  await a.save();

  await EntryGate.updateOne(
    { EventID: eventId, gateIndex },
    { $inc: { scansLast15m: 1 }, $set: { lastScanAt: new Date() } }
  );

  return { ok: true, ticketId, gateIndex, usedAt: a.usedAt };
}

/**
 * Same as verifyAtGate but requires live face probe to match stored template (cosine ≥ threshold).
 */
async function verifyAtGateWithFace(eventId, gateIndex, ticketId, bodyForEmbedding) {
  const { a, ticket } = await assertEntryEligibility(eventId, gateIndex, ticketId);

  const embedding = parseEmbedding(bodyForEmbedding);
  if (!embedding) {
    throw new Error("Invalid face embedding: send embedding array from gate camera");
  }

  const owner = await User.findById(ticket.OwnerUserId)
    .select("+faceEmbedding +faceEmbeddingGallery faceIdReference")
    .lean();
  const gallery = getTemplateGallery(owner);
  if (!gallery.length) {
    throw new Error("Holder has no Face ID on file; enroll in the app or use manual verification.");
  }

  const faceResult = matchProbeToGallery(embedding, gallery);
  if (faceResult.dimensionMismatch) {
    const err = new Error(
      "Face template dimension mismatch; holder should re-enroll Face ID at /face-id-registration"
    );
    err.code = "FACE_DIMENSION_MISMATCH";
    err.storedDim = gallery[0]?.length;
    err.probeDim = embedding.length;
    throw err;
  }
  if (!faceResult.match) {
    const err = new Error("FACE_MISMATCH");
    err.similarity = faceResult.similarity;
    err.threshold = faceResult.threshold;
    throw err;
  }

  const similarity = faceResult.similarity;
  const threshold = faceResult.threshold;

  a.status = "used";
  a.usedAt = new Date();
  await a.save();

  await EntryGate.updateOne(
    { EventID: eventId, gateIndex },
    { $inc: { scansLast15m: 1 }, $set: { lastScanAt: new Date() } }
  );

  return { ok: true, ticketId, gateIndex, usedAt: a.usedAt, faceMatch: true, similarity, threshold };
}

module.exports = {
  GRACE_MS,
  setupInfrastructure,
  runAssignment,
  regenerateCluster,
  linkFriendsToCluster,
  getLinkedComponentTicketIds,
  realignLinkedCluster,
  organizerRedirect,
  verifyAtGate,
  verifyAtGateWithFace,
  buildTicketGroups,
  placeClusterAtBestSlot,
};
