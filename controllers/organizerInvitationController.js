const {
  listInvitationsForEvent,
  createAndSendInvitation,
  resendInvitation,
  deleteInvitation,
} = require("../services/eventInvitationService");
const { assertValidEgyptPhone } = require("../utils/fieldValidation");

/** GET /api/organizer/invitations?eventMongoId= */
exports.listInvitations = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const eventMongoId = String(req.query.eventMongoId || "").trim();
    if (!eventMongoId) {
      return res.status(400).json({ message: "eventMongoId is required" });
    }

    const invitations = await listInvitationsForEvent(userId, eventMongoId);
    return res.json(invitations);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer listInvitations:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/organizer/invitations */
exports.sendInvitation = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { eventMongoId, guestName, guestEmail, guestPhone, sendEmail } = req.body || {};
    let phoneDigits;
    try {
      phoneDigits = assertValidEgyptPhone(guestPhone, { required: false });
    } catch (phoneErr) {
      return res.status(phoneErr.statusCode || 400).json({ message: phoneErr.message });
    }

    const result = await createAndSendInvitation({
      organizerId: userId,
      eventMongoId: String(eventMongoId || "").trim(),
      guestName,
      guestEmail,
      guestPhone: phoneDigits,
      sendEmail: sendEmail !== false,
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer sendInvitation:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/organizer/invitations/:invitationId/resend */
exports.resendInvitation = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const result = await resendInvitation(userId, req.params.invitationId);
    return res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer resendInvitation:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /api/organizer/invitations/:invitationId */
exports.removeInvitation = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await deleteInvitation(userId, req.params.invitationId);
    return res.json({ success: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer removeInvitation:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
