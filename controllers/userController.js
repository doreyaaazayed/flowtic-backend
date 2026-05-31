const User = require("../models/User");

const ROLE_IDS = {
  attendee: 1,
  organizer: 2,
  admin: 3,
  vendor: 4,
};

// List all users (admin only)
exports.list = async (req, res) => {
  try {
    const users = await User.find()
      .select("Username Email role RoleID Created_At faceIdReference UserID")
      .sort({ Created_At: -1 })
      .limit(2000)
      .lean();
    return res.json(
      users.map((u) => ({
        ...u,
        _id: String(u._id),
        faceIdEnrolled: Boolean(u.faceIdReference),
      })),
    );
  } catch (err) {
    console.error("List users error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one user by id (admin only)
exports.getById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-Password").lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(user);
  } catch (err) {
    console.error("Get user error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update user (admin only)
exports.update = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { username, email, role } = req.body || {};

    if (username !== undefined) {
      user.Username = String(username).trim();
      if (!user.Username) {
        return res.status(400).json({ message: "Username cannot be empty" });
      }
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
      user.Email = newEmail;
    }
    if (role !== undefined) {
      const stringRole = String(role).toLowerCase();
      if (!["attendee", "organizer", "admin", "vendor"].includes(stringRole)) {
        return res.status(400).json({ message: "Invalid role. Use: attendee, organizer, admin, vendor" });
      }
      user.role = stringRole;
      user.RoleID = ROLE_IDS[stringRole] ?? ROLE_IDS.attendee;
    }

    await user.save();
    const out = user.toObject();
    delete out.Password;
    return res.json(out);
  } catch (err) {
    console.error("Update user error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Pending organization organizers (admin)
exports.listPendingOrganizers = async (req, res) => {
  try {
    const users = await User.find({
      role: "organizer",
      organizerType: "organization",
      organizerApproved: false,
    })
      .select("-Password -commercialRegistrationDoc -taxCardDoc")
      .sort({ Created_At: -1 })
      .lean();
    return res.json(users);
  } catch (err) {
    console.error("List pending organizers error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.approveOrganizer = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (
      user.role !== "organizer" ||
      user.organizerType !== "organization" ||
      user.organizerApproved === true
    ) {
      return res.status(400).json({ message: "This account is not a pending organization organizer." });
    }
    user.organizerApproved = true;
    await user.save();
    const out = user.toObject();
    delete out.Password;
    return res.json(out);
  } catch (err) {
    console.error("Approve organizer error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.rejectOrganizer = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "organizer" || user.organizerApproved !== false) {
      return res.status(400).json({ message: "This account is not pending organizer approval." });
    }
    user.role = "attendee";
    user.RoleID = ROLE_IDS.attendee;
    user.organizerType = undefined;
    user.organizerApproved = true;
    user.organizationName = undefined;
    user.organizationLocation = undefined;
    user.commercialRegistrationDoc = undefined;
    user.taxCardDoc = undefined;
    await user.save();
    const out = user.toObject();
    delete out.Password;
    return res.json({
      message: "Application rejected. The account is now a regular attendee.",
      user: out,
    });
  } catch (err) {
    console.error("Reject organizer error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Clear Face ID templates so the user can enroll again (e.g. appearance change). */
exports.resetUserFaceId = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        $unset: { faceEmbedding: 1, faceEmbeddingGallery: 1 },
        $set: { faceIdReference: null },
      },
      { new: true }
    )
      .select("-Password")
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({
      message: "Face ID cleared. User must enroll again at Face ID registration.",
      userId: user._id,
      email: user.Email,
    });
  } catch (err) {
    console.error("Reset Face ID error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete user (admin only). Does not remove related data (bookings, tickets, etc.).
exports.remove = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(204).send();
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
