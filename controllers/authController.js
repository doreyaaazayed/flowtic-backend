const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const VerificationOTP = require("../models/VerificationOTP");
const emailService = require("../services/emailService");
const {
  parseEmbedding,
  matchProbeToGallery,
  getTemplateGallery,
  matchThreshold,
  FACE_EMBED_MIN_LEN,
  FACE_EMBED_MAX_LEN,
} = require("../utils/faceMatch");
const loyaltyService = require("../services/loyaltyService");
const {
  isValidPassword,
  assertValidPassword,
  assertValidEgyptPhone,
  normalizeEgyptPhone,
} = require("../utils/fieldValidation");

/** Min gap between best and second-best match (1:N) to avoid wrong account. */
const FACE_LOGIN_IDENTIFY_GAP = Number(process.env.FACE_LOGIN_IDENTIFY_GAP || 0.04);

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRES_IN = "7d";
const OTP_EXPIRY_MINUTES = 10;

const ROLE_IDS = {
  attendee: 1,
  organizer: 2,
  admin: 3,
  vendor: 4,
  usher: 5,
};

const MIN_AGE = 16;
const MAX_ORG_DOC_BYTES = 3 * 1024 * 1024; // per image (base64 data URL)

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getAge(dateOfBirth) {
  const today = new Date();
  const birth = new Date(dateOfBirth);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function isDataImageUrl(s) {
  const t = String(s || "").trim();
  return t.startsWith("data:image/") && t.includes("base64,") && t.length > 80;
}

function authUserPayload(user) {
  const u = user.toObject ? user.toObject() : user;
  return {
    id: u._id,
    username: u.Username,
    firstName: u.FirstName,
    lastName: u.LastName,
    email: u.Email,
    phone: u.Phone,
    nationalId: u.NationalID,
    dateOfBirth: u.dateOfBirth,
    role: u.role,
    roleId: u.RoleID,
    emailVerified: u.emailVerified !== false,
    organizerType: u.organizerType || undefined,
    organizerApproved: u.organizerApproved !== false,
    organizationName: u.organizationName || undefined,
    organizationLocation: u.organizationLocation || undefined,
    loyaltyPointsBalance: u.loyaltyPointsBalance ?? 0,
    loyaltyLifetimePoints: u.loyaltyLifetimePoints ?? 0,
    loyaltyTier: u.loyaltyTier || "bronze",
    profilePhotoUrl: u.profilePhotoUrl || undefined,
    mustChangePassword: Boolean(u.mustChangePassword),
  };
}
exports.authUserPayload = authUserPayload;

exports.register = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      nationalId,
      dateOfBirth,
      role,
      organizerType: organizerTypeBody,
      organizationName,
      organizationLocation,
      commercialRegistrationDoc,
      taxCardDoc,
    } = req.body || {};

    if (!firstName || !lastName || !email || !password) {
      return res
        .status(400)
        .json({ message: "First name, last name, email, and password are required" });
    }
    if (!phone || String(phone).trim() === "") {
      return res.status(400).json({ message: "Phone number is required" });
    }
    let phoneNorm;
    try {
      phoneNorm = assertValidEgyptPhone(phone, { required: true });
    } catch (e) {
      return res.status(e.statusCode || 400).json({ message: e.message });
    }
    try {
      assertValidPassword(password);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ message: e.message });
    }
    if (!nationalId || String(nationalId).trim() === "") {
      return res.status(400).json({ message: "National ID is required" });
    }
    const nationalIdStr = String(nationalId).trim().replace(/\s/g, "");
    if (!/^\d{14}$/.test(nationalIdStr)) {
      return res.status(400).json({ message: "National ID must be exactly 14 digits" });
    }
    if (!dateOfBirth) {
      return res.status(400).json({ message: "Date of birth is required" });
    }
    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      return res.status(400).json({ message: "Invalid date of birth" });
    }
    const age = getAge(dob);
    if (age < MIN_AGE) {
      return res.status(400).json({
        message: `You must be at least ${MIN_AGE} years old to create an account.`,
      });
    }

    const existingEmail = await User.findOne({ Email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(409).json({ message: "Email is already registered" });
    }
    const existingNationalId = await User.findOne({ NationalID: nationalIdStr });
    if (existingNationalId) {
      return res.status(409).json({ message: "This National ID is already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const stringRole = role || "attendee";
    const roleId = ROLE_IDS[stringRole] || ROLE_IDS.attendee;

    let organizerTypeVal;
    let organizerApprovedVal = true;
    let orgNameVal;
    let orgLocVal;
    let commercialVal;
    let taxVal;

    if (stringRole === "organizer") {
      const ot = String(organizerTypeBody || "")
        .toLowerCase()
        .trim();
      if (ot !== "individual" && ot !== "organization") {
        return res.status(400).json({
          message: "Organizers must choose Individual or Organization.",
        });
      }
      organizerTypeVal = ot;
      if (ot === "individual") {
        organizerApprovedVal = true;
      } else {
        organizerApprovedVal = false;
        const on = String(organizationName || "").trim();
        const ol = String(organizationLocation || "").trim();
        if (!on || on.length < 2) {
          return res.status(400).json({ message: "Organization name is required." });
        }
        if (!ol || ol.length < 2) {
          return res.status(400).json({ message: "Organization location is required." });
        }
        if (!isDataImageUrl(commercialRegistrationDoc)) {
          return res.status(400).json({
            message: "Commercial registration document image is required (upload a clear photo or scan).",
          });
        }
        if (!isDataImageUrl(taxCardDoc)) {
          return res.status(400).json({
            message: "Tax card document image is required (upload a clear photo or scan).",
          });
        }
        const c1 = String(commercialRegistrationDoc).length;
        const c2 = String(taxCardDoc).length;
        if (c1 > MAX_ORG_DOC_BYTES || c2 > MAX_ORG_DOC_BYTES) {
          return res.status(400).json({
            message: "Each document image must be under about 3 MB after encoding.",
          });
        }
        orgNameVal = on;
        orgLocVal = ol;
        commercialVal = String(commercialRegistrationDoc).trim();
        taxVal = String(taxCardDoc).trim();
      }
    }

    const lastUser = await User.findOne().sort({ UserID: -1 }).select("UserID").lean();
    const nextUserID = (lastUser?.UserID ?? 0) + 1;

    const username = `${String(firstName).trim()} ${String(lastName).trim()}`.trim() || "User";

    const createDoc = {
      UserID: nextUserID,
      Username: username,
      FirstName: String(firstName).trim(),
      LastName: String(lastName).trim(),
      Phone: phoneNorm,
      NationalID: nationalIdStr,
      dateOfBirth: dob,
      Email: email.toLowerCase().trim(),
      Password: hashedPassword,
      RoleID: roleId,
      role: stringRole,
      emailVerified: false,
      organizerApproved: organizerApprovedVal,
    };
    if (organizerTypeVal) {
      createDoc.organizerType = organizerTypeVal;
      if (organizerTypeVal === "organization") {
        createDoc.organizationName = orgNameVal;
        createDoc.organizationLocation = orgLocVal;
        createDoc.commercialRegistrationDoc = commercialVal;
        createDoc.taxCardDoc = taxVal;
      }
    }

    const user = await User.create(createDoc);

    loyaltyService
      .earnPoints(user._id, loyaltyService.WELCOME_POINTS, "welcome", {
        description: "Welcome bonus",
      })
      .catch((err) => console.warn("Welcome loyalty points:", err.message));

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await VerificationOTP.findOneAndUpdate(
      { email: email.toLowerCase() },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    emailService
      .sendOTP(user.Email, { otp, username: user.Username })
      .catch((err) => console.error("OTP email failed:", err));

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      token,
      user: { ...authUserPayload(user), emailVerified: false },
    });
  } catch (err) {
    console.error("Register error:", err);
    let message = err.message || String(err);
    if (err.reason) {
      message += " | " + (err.reason.message || JSON.stringify(err.reason));
    }
    if (process.env.NODE_ENV === "production") message = "Internal server error";
    return res.status(500).json({ message: "Internal server error", error: message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ Email: email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.Password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      token,
      user: authUserPayload(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Sign in with a live face scan (1:N against enrolled templates).
 * Optional `email` narrows search to one account (recommended when email field is filled).
 */
exports.loginWithFace = async (req, res) => {
  try {
    const embedding = parseEmbedding(req.body || {});
    if (!embedding) {
      return res.status(400).json({
        message: `Invalid face scan: send embedding array (${FACE_EMBED_MIN_LEN}–${FACE_EMBED_MAX_LEN} numbers)`,
      });
    }

    const emailHint = String(req.body?.email || "").trim();
    if (!emailHint) {
      return res.status(400).json({
        message: "Enter your account email on the sign-in form, then scan your face.",
        requireEmail: true,
      });
    }

    const filter = {
      faceIdReference: { $ne: null, $exists: true },
      "faceEmbedding.0": { $exists: true },
    };
    if (emailHint) {
      const escaped = emailHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.Email = { $regex: new RegExp(`^${escaped}$`, "i") };
    }

    const candidates = await User.find(filter)
      .select(
        "+faceEmbedding +faceEmbeddingGallery Username FirstName LastName Email Phone NationalID dateOfBirth role RoleID emailVerified organizerType organizerApproved organizationName organizationLocation faceIdReference"
      )
      .lean();

    if (!candidates.length) {
      return res.status(401).json({
        message: emailHint
          ? "No Face ID on this account. Sign in with password and enroll at Face ID registration."
          : "No enrolled Face ID accounts found. Use email/password or enroll Face ID first.",
      });
    }

    const threshold = matchThreshold();
    let bestUser = null;
    let bestSim = -1;
    let secondSim = -1;

    for (const u of candidates) {
      const gallery = getTemplateGallery(u);
      if (!gallery.length) continue;
      const { similarity: sim, dimensionMismatch } = matchProbeToGallery(embedding, gallery);
      if (dimensionMismatch) continue;
      if (sim > bestSim) {
        secondSim = bestSim;
        bestSim = sim;
        bestUser = u;
      } else if (sim > secondSim) {
        secondSim = sim;
      }
    }

    if (!bestUser || bestSim < threshold) {
      return res.status(401).json({
        message: emailHint
          ? "Face does not match this account. Use your password or re-enroll Face ID."
          : "No matching Face ID. Try again with better lighting or sign in with email and password.",
        match: false,
        similarity: bestSim >= 0 ? bestSim : undefined,
        threshold,
      });
    }

    if (!emailHint && secondSim >= 0 && bestSim - secondSim < FACE_LOGIN_IDENTIFY_GAP) {
      return res.status(401).json({
        message:
          "Face match is ambiguous between multiple accounts. Enter your email above, or sign in with password.",
        ambiguous: true,
        similarity: bestSim,
        threshold,
      });
    }

    const token = jwt.sign(
      { userId: bestUser._id, role: bestUser.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      token,
      user: authUserPayload(bestUser),
      faceMatch: { similarity: bestSim, threshold },
    });
  } catch (err) {
    console.error("Face login error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Verify email with OTP (sent after sign-up). */
exports.verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const record = await VerificationOTP.findOne({ email: email.toLowerCase().trim() });
    if (!record) {
      return res.status(400).json({ message: "No verification pending for this email. You can request a new code." });
    }
    if (new Date() > record.expiresAt) {
      await VerificationOTP.deleteOne({ _id: record._id });
      return res.status(400).json({ message: "Verification code has expired. Please request a new one." });
    }
    if (record.otp !== String(otp).trim()) {
      return res.status(400).json({ message: "Invalid verification code." });
    }

    const user = await User.findOneAndUpdate(
      { Email: email.toLowerCase().trim() },
      { $set: { emailVerified: true } },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await VerificationOTP.deleteOne({ _id: record._id });

    emailService
      .sendSignupConfirmation(user.Email, { username: user.Username })
      .catch((err) => console.error("Welcome email after verify failed:", err));

    return res.json({
      message: "Email verified successfully.",
      user: { ...authUserPayload(user), emailVerified: true },
    });
  } catch (err) {
    console.error("Verify email error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Resend OTP for email verification (e.g. user didn't receive or code expired). */
exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ Email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ message: "No account found with this email." });
    }
    if (user.emailVerified) {
      return res.status(400).json({ message: "This email is already verified. You can sign in." });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await VerificationOTP.findOneAndUpdate(
      { email: user.Email },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    emailService
      .sendOTP(user.Email, { otp, username: user.Username })
      .catch((err) => console.error("Resend OTP email failed:", err));

    return res.json({ message: "A new verification code has been sent to your email." });
  } catch (err) {
    console.error("Resend OTP error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PATCH /api/auth/change-password — authenticated users (including vendors). */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required" });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters and include both letters and numbers",
      });
    }

    const user = await User.findById(req.user.id).select("Password Email");
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(String(currentPassword), user.Password);
    if (!isMatch) {
      return res.status(403).json({ message: "Current password is incorrect" });
    }

    user.Password = await bcrypt.hash(String(newPassword), 10);
    user.mustChangePassword = false;
    await user.save();

    return res.json({ ok: true, message: "Password updated successfully", mustChangePassword: false });
  } catch (err) {
    console.error("changePassword error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
