const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const usherController = require("../controllers/usherController");
const { usherRateLimit } = require("../middleware/usherRateLimit");

const router = express.Router();

router.use(requireAuth, requireRole("usher"));

router.get("/assignments", usherController.myAssignments);
router.get("/events/:eventId/entry/gates/:gateIndex/board", usherController.gateBoard);
router.post(
  "/events/:eventId/entry/gates/:gateIndex/lookup-attendee",
  usherRateLimit("lookup", 90, 60_000),
  usherController.lookupAttendee,
);
router.post(
  "/events/:eventId/entry/gates/:gateIndex/verify-with-face",
  usherRateLimit("verify-face", 45, 60_000),
  usherController.verifyWithFace,
);
router.post(
  "/events/:eventId/entry/gates/:gateIndex/verify-manual",
  usherRateLimit("verify-manual", 30, 60_000),
  usherController.verifyManual,
);

module.exports = router;
