const express = require("express");
const { validateInviteToken } = require("../services/eventInvitationService");

const router = express.Router();

/** GET /api/invitations/validate/:token */
router.get("/validate/:token", async (req, res) => {
  try {
    const data = await validateInviteToken(req.params.token);
    return res.json(data);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("validate invitation:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
