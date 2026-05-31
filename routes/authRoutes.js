const express = require("express");
const User = require("../models/User");
const {
  register,
  login,
  loginWithFace,
  verifyEmail,
  resendOtp,
  changePassword,
  authUserPayload,
} = require("../controllers/authController");
const oauth = require("../controllers/oauthController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/providers", oauth.providers);
router.get("/google", oauth.googleStart);
router.get("/google/callback", oauth.googleCallback);
router.get("/apple", oauth.appleStart);
router.post("/apple/callback", express.urlencoded({ extended: true }), oauth.appleCallback);
router.get("/apple/callback", oauth.appleCallback);

router.post("/register", register);
router.post("/login", login);
router.post("/login-face", loginWithFace);
router.post("/verify-email", verifyEmail);
router.post("/resend-otp", resendOtp);
router.patch("/change-password", requireAuth, changePassword);

// Current user (includes emailVerified for verification banner)
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select(
        "Username FirstName LastName Email Phone NationalID dateOfBirth role emailVerified organizerType organizerApproved organizationName organizationLocation RoleID loyaltyPointsBalance loyaltyLifetimePoints loyaltyTier profilePhotoUrl"
      )
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const payload = authUserPayload(user);
    res.json({
      userId: req.user.id,
      role: req.user.role,
      username: payload.username,
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone,
      nationalId: payload.nationalId,
      dateOfBirth: payload.dateOfBirth,
      emailVerified: payload.emailVerified,
      organizerType: payload.organizerType,
      organizerApproved: payload.organizerApproved,
      organizationName: payload.organizationName,
      organizationLocation: payload.organizationLocation,
      loyaltyPointsBalance: payload.loyaltyPointsBalance ?? 0,
      loyaltyLifetimePoints: payload.loyaltyLifetimePoints ?? 0,
      loyaltyTier: payload.loyaltyTier || "bronze",
      profilePhotoUrl: payload.profilePhotoUrl,
    });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;

