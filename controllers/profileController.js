const User = require("../models/User");
const UserProfile = require("../models/UserProfile");
const multer = require("multer");
const {
  saveProfilePhoto,
  resolveProfilePhotoUrl,
  deleteProfilePhoto,
} = require("../services/profilePhotoService");
const {
  parseEmbedding,
  parseSampleList,
  matchThreshold,
  buildEnrollmentGallery,
  getTemplateGallery,
  matchProbeToGallery,
  FACE_EMBED_MIN_LEN,
  FACE_EMBED_MAX_LEN,
} = require("../utils/faceMatch");
const { assertValidEgyptPhone } = require("../utils/fieldValidation");

const FACE_MISMATCH_MSG =
  "This face does not match your enrolled identity. You cannot change Face ID to a different person. Contact support if you need a reset.";

const uploadPhotoMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, WebP or GIF images are allowed"));
  },
}).single("photo");

exports.uploadPhotoMiddleware = uploadPhotoMiddleware;

async function buildProfileResponse(userId) {
  const user = await User.findById(userId)
    .select(
      "Username FirstName LastName Email Phone NationalID dateOfBirth role emailVerified organizerType organizerApproved organizationName organizationLocation Created_At loyaltyPointsBalance loyaltyLifetimePoints loyaltyTier profilePhotoUrl faceIdReference"
    )
    .lean();
  if (!user) return null;

  let profile = await UserProfile.findOne({ userId });
  if (!profile) {
    const last = await UserProfile.findOne().sort({ ProfileID: -1 }).lean();
    const nextId = (last?.ProfileID || 0) + 1;
    const userNumericId = user.UserID ?? (await ensureUserID(userId));
    profile = await UserProfile.create({
      ProfileID: nextId,
      UserID: userNumericId,
      userId,
      FirstName: user.FirstName ?? user.Username?.split(" ")[0] ?? "",
      LastName: user.LastName ?? user.Username?.split(" ").slice(1).join(" ") ?? "",
      Phone: user.Phone ?? "",
    });
  }

  const faceUser = await User.findById(userId).select("faceEmbedding faceIdReference").lean();
  const faceEnrolled = Boolean(faceUser?.faceEmbedding?.length && faceUser.faceIdReference);
  const profileObj = typeof profile.toObject === "function" ? profile.toObject() : { ...profile };

  return {
    ...profileObj,
    username: user.Username,
    email: user.Email,
    nationalId: user.NationalID,
    dateOfBirth: user.dateOfBirth,
    role: user.role,
    emailVerified: user.emailVerified !== false,
    organizerType: user.organizerType,
    organizerApproved: user.organizerApproved !== false,
    organizationName: user.organizationName,
    organizationLocation: user.organizationLocation,
    loyaltyPointsBalance: user.loyaltyPointsBalance ?? 0,
    loyaltyLifetimePoints: user.loyaltyLifetimePoints ?? 0,
    loyaltyTier: user.loyaltyTier || "bronze",
    profilePhotoUrl: resolveProfilePhotoUrl(user),
    memberSince: user.Created_At,
    faceEnrolled,
    FirstName: profileObj.FirstName || user.FirstName || "",
    LastName: profileObj.LastName || user.LastName || "",
    Phone: profileObj.Phone || user.Phone || "",
  };
}

function resolveEnrollmentPayload(body) {
  const samples = parseSampleList(body);
  if (samples) {
    const built = buildEnrollmentGallery(samples);
    if (!built) return null;
    return built;
  }
  const embedding = parseEmbedding(body || {});
  if (!embedding) return null;
  return { centroid: embedding, gallery: [embedding] };
}

function assertMatchesStoredGallery(user, probe) {
  const gallery = getTemplateGallery(user);
  if (!gallery.length) return { ok: true };
  const result = matchProbeToGallery(probe, gallery);
  if (result.dimensionMismatch) {
    return {
      ok: false,
      status: 400,
      body: { message: "Embedding dimension mismatch; contact support to reset Face ID." },
    };
  }
  if (!result.match) {
    return {
      ok: false,
      status: 403,
      body: {
        message: FACE_MISMATCH_MSG,
        match: false,
        similarity: result.similarity,
        threshold: result.threshold,
        gallerySize: result.gallerySize,
      },
    };
  }
  return { ok: true, similarity: result.similarity, threshold: result.threshold };
}

// Get current user's profile (create with defaults if missing)
exports.get = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const payload = await buildProfileResponse(userId);
    if (!payload) return res.status(401).json({ message: "User not found" });
    return res.json(payload);
  } catch (err) {
    console.error("Get profile error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update current user's profile
exports.update = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const {
      username,
      email,
      FirstName,
      LastName,
      Phone,
      Address,
      City,
      OrgName,
      ContactInfo,
      Description,
    } = req.body || {};

    let phoneNorm;
    if (Phone !== undefined && String(Phone).trim() !== "") {
      try {
        phoneNorm = assertValidEgyptPhone(Phone, { required: true });
      } catch (e) {
        return res.status(e.statusCode || 400).json({ message: e.message });
      }
    }

    let profile = await UserProfile.findOne({ userId });
    if (!profile) {
      const user = await User.findById(userId).lean();
      if (!user) return res.status(401).json({ message: "User not found" });
      const last = await UserProfile.findOne().sort({ ProfileID: -1 }).lean();
      const nextId = (last?.ProfileID || 0) + 1;
      const userNumericId = user.UserID ?? await ensureUserID(userId);
      profile = await UserProfile.create({
        ProfileID: nextId,
        UserID: userNumericId,
        userId,
        FirstName: FirstName ?? "",
        LastName: LastName ?? "",
        Phone: phoneNorm ?? Phone ?? "",
        Address: Address ?? "",
        City: City ?? "",
        OrgName: OrgName ?? "",
        ContactInfo: ContactInfo ?? "",
        Description: Description ?? "",
      });
      const account = await User.findById(userId);
      if (account) {
        if (username !== undefined) {
          const nextUsername = String(username).trim();
          if (!nextUsername) {
            return res.status(400).json({ message: "Username cannot be empty" });
          }
          account.Username = nextUsername;
        }
        if (email !== undefined) {
          const newEmail = String(email).toLowerCase().trim();
          if (!newEmail) {
            return res.status(400).json({ message: "Email cannot be empty" });
          }
          const existing = await User.findOne({ Email: newEmail, _id: { $ne: account._id } });
          if (existing) {
            return res.status(409).json({ message: "Email is already in use" });
          }
          if (account.Email !== newEmail) {
            account.Email = newEmail;
            account.emailVerified = false;
          }
        }
        if (FirstName !== undefined) account.FirstName = FirstName;
        if (LastName !== undefined) account.LastName = LastName;
        if (Phone !== undefined) account.Phone = phoneNorm ?? Phone;
        await account.save();
      }
      const created = await buildProfileResponse(userId);
      return res.status(201).json(created);
    }

    if (FirstName !== undefined) profile.FirstName = FirstName;
    if (LastName !== undefined) profile.LastName = LastName;
    if (Phone !== undefined) profile.Phone = phoneNorm ?? Phone;
    if (Address !== undefined) profile.Address = Address;
    if (City !== undefined) profile.City = City;
    if (OrgName !== undefined) profile.OrgName = OrgName;
    if (ContactInfo !== undefined) profile.ContactInfo = ContactInfo;
    if (Description !== undefined) profile.Description = Description;
    await profile.save();

    const user = await User.findById(userId);
    if (user) {
      if (username !== undefined) {
        const nextUsername = String(username).trim();
        if (!nextUsername) {
          return res.status(400).json({ message: "Username cannot be empty" });
        }
        user.Username = nextUsername;
      }
      if (email !== undefined) {
        const newEmail = String(email).toLowerCase().trim();
        if (!newEmail) {
          return res.status(400).json({ message: "Email cannot be empty" });
        }
        const existing = await User.findOne({ Email: newEmail, _id: { $ne: user._id } });
        if (existing) {
          return res.status(409).json({ message: "Email is already in use" });
        }
        if (user.Email !== newEmail) {
          user.Email = newEmail;
          user.emailVerified = false;
        }
      }
      if (FirstName !== undefined) user.FirstName = FirstName;
      if (LastName !== undefined) user.LastName = LastName;
      if (Phone !== undefined) user.Phone = phoneNorm ?? Phone;
      await user.save();
    }

    const payload = await buildProfileResponse(userId);
    return res.json(payload);
  } catch (err) {
    console.error("Update profile error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.uploadPhoto = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ message: "Photo file is required (field name: photo)" });
    }

    const publicPath = await saveProfilePhoto(userId, req.file.buffer, req.file.mimetype);
    if (!publicPath) return res.status(400).json({ message: "Could not save photo" });

    await User.findByIdAndUpdate(userId, { $set: { profilePhotoUrl: publicPath } });
    const payload = await buildProfileResponse(userId);
    return res.json({ message: "Profile photo updated", profilePhotoUrl: publicPath, profile: payload });
  } catch (err) {
    console.error("Upload profile photo error:", err);
    return res.status(500).json({ message: err.message || "Internal server error" });
  }
};

exports.removePhoto = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await deleteProfilePhoto(userId);
    await User.findByIdAndUpdate(userId, { $set: { profilePhotoUrl: "" } });
    const payload = await buildProfileResponse(userId);
    return res.json({ message: "Profile photo removed", profile: payload });
  } catch (err) {
    console.error("Remove profile photo error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

async function ensureUserID(mongoUserId) {
  const user = await User.findById(mongoUserId);
  if (!user) throw new Error("User not found");
  if (user.UserID) return user.UserID;
  const last = await User.findOne().sort({ UserID: -1 }).select("UserID").lean();
  const nextId = (last?.UserID ?? 0) + 1;
  user.UserID = nextId;
  await user.save();
  return nextId;
}

/** Whether the current user has enrolled a face template */
exports.faceStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await User.findById(userId).select("faceEmbedding faceIdReference").lean();
    const enrolled = Boolean(user?.faceEmbedding?.length && user.faceIdReference);
    return res.json({
      enrolled,
      embeddingDim: user?.faceEmbedding?.length ?? null,
      faceIdReference: user?.faceIdReference ?? null,
    });
  } catch (err) {
    console.error("Face status error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Store L2-normalized embedding from browser Human.js */
exports.enrollFace = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const enrollment = resolveEnrollmentPayload(req.body || {});
    if (!enrollment) {
      return res.status(400).json({
        message: `Invalid enrollment: send samples (2+ face scans) or embedding (${FACE_EMBED_MIN_LEN}–${FACE_EMBED_MAX_LEN} numbers)`,
      });
    }
    const { centroid, gallery } = enrollment;
    const existing = await User.findById(userId)
      .select("faceEmbedding faceEmbeddingGallery")
      .lean();
    const check = assertMatchesStoredGallery(existing, centroid);
    if (!check.ok) {
      return res.status(check.status).json(check.body);
    }
    await User.findByIdAndUpdate(userId, {
      $set: {
        faceEmbedding: centroid,
        faceEmbeddingGallery: gallery,
        faceIdReference: `human-faceres-v1:${centroid.length}`,
      },
    });
    return res.json({
      message: "Face enrolled",
      enrolled: true,
      embeddingDim: centroid.length,
      gallerySize: gallery.length,
      threshold: matchThreshold(),
    });
  } catch (err) {
    console.error("Enroll face error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Compare probe embedding to stored template (same user) */
exports.verifyFace = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await User.findById(userId).select("faceEmbedding faceEmbeddingGallery").lean();
    const gallery = getTemplateGallery(user);
    if (!gallery.length) {
      return res.status(400).json({ message: "No face enrolled for this account" });
    }
    const embedding = parseEmbedding(req.body || {});
    if (!embedding) {
      return res.status(400).json({ message: "Invalid embedding" });
    }
    const result = matchProbeToGallery(embedding, gallery);
    if (result.dimensionMismatch) {
      return res.status(400).json({ message: "Embedding dimension mismatch; re-enroll your face" });
    }
    return res.json({
      match: result.match,
      similarity: result.similarity,
      threshold: result.threshold,
      gallerySize: result.gallerySize,
    });
  } catch (err) {
    console.error("Verify face error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Remove stored face template — requires a live scan that matches the enrolled face */
exports.deleteFace = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await User.findById(userId).select("faceEmbedding faceEmbeddingGallery").lean();
    if (!getTemplateGallery(user).length) {
      return res.status(400).json({ message: "No face enrolled for this account" });
    }
    const embedding = parseEmbedding(req.body || {});
    if (!embedding) {
      return res.status(400).json({
        message: "Verify your current face before removing Face ID (send embedding in request body).",
      });
    }
    const check = assertMatchesStoredGallery(user, embedding);
    if (!check.ok) {
      return res.status(check.status).json(check.body);
    }
    await User.findByIdAndUpdate(userId, {
      $unset: { faceEmbedding: 1, faceEmbeddingGallery: 1 },
      $set: { faceIdReference: null },
    });
    return res.json({ message: "Face ID removed", enrolled: false });
  } catch (err) {
    console.error("Delete face error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
