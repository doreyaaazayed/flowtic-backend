const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { send } = require("../services/emailService");

const router = express.Router();

/**
 * POST /api/email/test
 * Send a test email (admin only). Body: { "to": "someone@example.com" }
 */
router.post("/test", requireAuth, requireRole("admin"), async (req, res) => {
  const to = req.body?.to?.trim();
  if (!to) {
    return res.status(400).json({ message: "Body must include 'to' (email address)" });
  }
  const result = await send({
    to,
    subject: "FlowTic – test email",
    htmlContent: "<p>This is a test email from FlowTic. Brevo is configured correctly.</p>",
    textContent: "This is a test email from FlowTic. Brevo is configured correctly.",
  });
  if (!result.success) {
    return res.status(500).json({ message: "Failed to send", error: result.error });
  }
  return res.json({ message: "Test email sent", to });
});

module.exports = router;
