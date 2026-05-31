const mongoose = require("mongoose");

/**
 * Grad-project / demo: full PAN encrypted at rest (AES-256-GCM); APIs never return ciphertext.
 * No CVV stored. Production apps typically use a payment vault (Stripe, etc.) instead of holding PANs.
 */
const userPaymentCardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    lastFour: { type: String, required: true, match: /^\d{4}$/ },
    brand: { type: String, trim: true, default: "unknown" },
    expiryMonth: { type: Number, required: true, min: 1, max: 12 },
    expiryYear: { type: Number, required: true, min: 2000, max: 2100 },
    cardholderName: { type: String, trim: true, default: "" },
    label: { type: String, trim: true, default: "" },
    /** Base64(iv + authTag + ciphertext) — full card number never stored in plaintext */
    encryptedPan: { type: String, required: true, select: false },
    /** HMAC fingerprint — globally unique (one account per card number) */
    panFingerprint: { type: String, select: false },
  },
  { timestamps: true, collection: "UserPaymentCard" }
);

userPaymentCardSchema.index({ userId: 1, createdAt: -1 });
userPaymentCardSchema.index({ panFingerprint: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("UserPaymentCard", userPaymentCardSchema);
