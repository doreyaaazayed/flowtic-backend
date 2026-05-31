const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { holdSeats, releaseSeats, getHoldTtl, refreshHold, HOLD_TTL_SECONDS } = require("../services/seatHoldService");
const Event = require("../models/Event");

const router = express.Router({ mergeParams: true });

// POST /api/events/:eventId/seat-hold  { seatIds: number[] }
router.post("/", requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { seatIds } = req.body || {};
    const userId = req.user.id;

    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      return res.status(400).json({ message: "seatIds must be a non-empty array" });
    }

    const event = await Event.findById(eventId).select("EventID isSeated").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (!event.isSeated) return res.status(400).json({ message: "Event is not a seated event" });

    const ids = seatIds.map(Number).filter((n) => !Number.isNaN(n));
    const result = await holdSeats(event.EventID, ids, userId);

    if (!result.ok) {
      return res.status(409).json({
        message: "Some seats are already held by another user. Please choose different seats.",
        takenSeats: result.takenSeats,
      });
    }

    return res.json({ held: true, ttlSeconds: HOLD_TTL_SECONDS, seatIds: ids });
  } catch (err) {
    console.error("Seat hold error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/events/:eventId/seat-hold  { seatIds: number[] }
router.delete("/", requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { seatIds } = req.body || {};
    const userId = req.user.id;

    const event = await Event.findById(eventId).select("EventID").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    const ids = Array.isArray(seatIds) ? seatIds.map(Number).filter((n) => !Number.isNaN(n)) : [];
    await releaseSeats(event.EventID, ids, userId);
    return res.json({ released: true });
  } catch (err) {
    console.error("Seat release error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/events/:eventId/seat-hold?seatIds=1,2,3
router.get("/", requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const rawIds = req.query.seatIds;

    const event = await Event.findById(eventId).select("EventID").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    const ids = rawIds
      ? String(rawIds).split(",").map(Number).filter((n) => !Number.isNaN(n))
      : [];

    if (ids.length === 0) {
      return res.json({ ttlSeconds: 0 });
    }

    const ttl = await getHoldTtl(event.EventID, ids, userId);
    return res.json({ ttlSeconds: ttl });
  } catch (err) {
    console.error("Seat hold status error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// PATCH /api/events/:eventId/seat-hold  { seatIds: number[] }  — refresh TTL
router.patch("/", requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { seatIds } = req.body || {};
    const userId = req.user.id;

    const event = await Event.findById(eventId).select("EventID").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    const ids = Array.isArray(seatIds) ? seatIds.map(Number).filter((n) => !Number.isNaN(n)) : [];
    await refreshHold(event.EventID, ids, userId);
    return res.json({ refreshed: true, ttlSeconds: HOLD_TTL_SECONDS });
  } catch (err) {
    console.error("Seat hold refresh error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
