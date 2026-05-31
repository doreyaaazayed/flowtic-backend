const express = require("express");
const { requireAuth, requireOrganizerOrAdmin } = require("../middleware/auth");
const entry = require("../controllers/entryGateController");

const router = express.Router();

router.get("/my-assignments", requireAuth, entry.myAssignmentsAll);
router.get("/my-entry-pending", requireAuth, entry.myGatingPending);
router.post("/events/:eventId/entry/sync-my", requireAuth, entry.syncMyEntry);

router.get("/events/:eventId/entry/board", requireAuth, requireOrganizerOrAdmin, entry.getOrganizerBoard);
router.get("/events/:eventId/entry/audit", requireAuth, requireOrganizerOrAdmin, entry.listEntryAudit);
router.post("/events/:eventId/entry/setup", requireAuth, requireOrganizerOrAdmin, entry.setup);
router.post("/events/:eventId/entry/assign", requireAuth, requireOrganizerOrAdmin, entry.assignRun);
router.post("/events/:eventId/entry/lookup-attendee", requireAuth, requireOrganizerOrAdmin, entry.lookupAttendee);
router.post("/events/:eventId/entry/link-friend", requireAuth, entry.linkFriend);
router.post("/events/:eventId/entry/regenerate", requireAuth, entry.regenerate);
router.post("/events/:eventId/entry/organizer-redirect", requireAuth, requireOrganizerOrAdmin, entry.organizerRedirect);
router.post("/events/:eventId/entry/gates/:gateIndex/jam", requireAuth, requireOrganizerOrAdmin, entry.setGateJam);
router.post(
  "/events/:eventId/entry/gates/:gateIndex/verify",
  requireAuth,
  requireOrganizerOrAdmin,
  entry.verifyGate
);
router.post(
  "/events/:eventId/entry/gates/:gateIndex/verify-with-face",
  requireAuth,
  requireOrganizerOrAdmin,
  entry.verifyWithFace
);

module.exports = router;
