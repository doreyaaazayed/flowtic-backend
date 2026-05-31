const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

/** Sets req.user when a valid Bearer token is sent; does not fail if missing/invalid. */
exports.optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.userId,
      role: payload.role,
    };
  } catch {
    /* treat as anonymous */
  }
  next();
};

exports.requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token missing" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.userId,
      role: payload.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden: insufficient permissions" });
  }
  next();
};

/** After requireAuth. Admins pass. Organizers must be approved (organization signups pending until admin). */
exports.requireOrganizerOrAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authorization token missing" });
  }
  if (req.user.role === "admin") {
    return next();
  }
  if (req.user.role !== "organizer") {
    return res.status(403).json({ message: "Forbidden: insufficient permissions" });
  }
  try {
    const u = await User.findById(req.user.id).select("organizerApproved").lean();
    if (!u) {
      return res.status(401).json({ message: "User not found" });
    }
    if (u.organizerApproved === false) {
      return res.status(403).json({
        message:
          "Your organization organizer account is pending admin approval. You can use the main site; creator tools unlock after approval.",
        code: "ORGANIZER_PENDING_APPROVAL",
      });
    }
    next();
  } catch (err) {
    console.error("requireOrganizerOrAdmin:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

