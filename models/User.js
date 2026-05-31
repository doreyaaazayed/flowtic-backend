const mongoose = require("mongoose");

// EventManagementDB.User — _id for app/JWT; UserID (int) for ERD/validators (e.g. UserProfile)
const userSchema = new mongoose.Schema(
  {
    UserID: {
      type: Number,
      required: false, // set on first use for backward compatibility
      unique: true,
      sparse: true,
    },
    Username: {
      type: String,
      required: true,
      trim: true,
    },
    FirstName: { type: String, trim: true },
    LastName: { type: String, trim: true },
    Phone: { type: String, trim: true },
    NationalID: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      match: /^\d{14}$/,
    },
    dateOfBirth: { type: Date },
    Email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Hashed password (OAuth-only accounts get a random hash)
    Password: {
      type: String,
      required: true,
    },
    googleId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    appleId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    // Numeric role id (FK to Role collection)
    RoleID: {
      type: Number,
      required: true,
    },
    // Convenience string role used by the app (attendee, organizer, admin, vendor, usher)
    role: {
      type: String,
      enum: ["attendee", "organizer", "admin", "vendor", "usher"],
      default: "attendee",
    },
    Created_At: {
      type: Date,
      default: Date.now,
    },
    // Face enrollment marker (e.g. human-v1) — embedding stored separately
    faceIdReference: {
      type: String,
      default: null,
    },
    /** L2-normalized face descriptor from @vladmandic/human (faceres); never returned in public APIs */
    faceEmbedding: {
      type: [Number],
      default: undefined,
      select: false,
    },
    /** Multiple L2-normalized templates (lighting/pose) — match uses best cosine across gallery */
    faceEmbeddingGallery: {
      type: [[Number]],
      default: undefined,
      select: false,
    },
    // Email verified via OTP (sign-up verification)
    emailVerified: {
      type: Boolean,
      default: false,
    },
    /** Force password change on next login (provisioned vendor/usher accounts) */
    mustChangePassword: { type: Boolean, default: false },
    /** Spendable loyalty points (redeem for promo codes) */
    loyaltyPointsBalance: { type: Number, default: 0, min: 0 },
    /** Lifetime earned points — determines tier (never reduced on redeem) */
    loyaltyLifetimePoints: { type: Number, default: 0, min: 0 },
    loyaltyTier: {
      type: String,
      enum: ["bronze", "silver", "gold", "platinum"],
      default: "bronze",
    },
    // Organizer signup: individual = active immediately after email verify; organization = needs admin approval
    organizerType: {
      type: String,
      enum: ["individual", "organization"],
      required: false,
    },
    organizerApproved: {
      type: Boolean,
      default: true,
    },
    organizationName: { type: String, trim: true },
    organizationLocation: { type: String, trim: true },
    commercialRegistrationDoc: { type: String },
    taxCardDoc: { type: String },
    /** Public path e.g. /api/uploads/profiles/{userId}.jpg */
    profilePhotoUrl: { type: String, trim: true, default: "" },
  },
  {
    timestamps: true,
    collection: "User",
  }
);

userSchema.index({ Created_At: -1 });

module.exports = mongoose.model("User", userSchema);

