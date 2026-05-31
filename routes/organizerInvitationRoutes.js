const express = require("express");
const { requireAuth, requireOrganizerOrAdmin } = require("../middleware/auth");
const organizerInvitationController = require("../controllers/organizerInvitationController");

const router = express.Router();

router.use(requireAuth, requireOrganizerOrAdmin);

router.get("/", organizerInvitationController.listInvitations);
router.post("/", organizerInvitationController.sendInvitation);
router.post("/:invitationId/resend", organizerInvitationController.resendInvitation);
router.delete("/:invitationId", organizerInvitationController.removeInvitation);

module.exports = router;
