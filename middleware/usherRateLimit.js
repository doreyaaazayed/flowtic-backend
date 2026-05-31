/** Simple in-memory rate limiter for usher gate endpoints. */

const buckets = new Map();

function hit(key, limit, windowMs) {
  const now = Date.now();
  let row = buckets.get(key);
  if (!row || now - row.start > windowMs) {
    row = { start: now, count: 0 };
    buckets.set(key, row);
  }
  row.count += 1;
  if (row.count > limit) {
    const err = new Error("Too many requests — slow down and try again");
    err.statusCode = 429;
    throw err;
  }
}

function usherRateLimit(action, limit = 60, windowMs = 60_000) {
  return (req, res, next) => {
    try {
      const uid = req.user?.id || "anon";
      hit(`${action}:${uid}`, limit, windowMs);
      next();
    } catch (err) {
      return res.status(err.statusCode || 429).json({ message: err.message });
    }
  };
}

module.exports = { usherRateLimit };
