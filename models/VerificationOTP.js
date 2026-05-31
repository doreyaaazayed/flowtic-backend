const mongoose = require("mongoose");

const verificationOTPSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "VerificationOTP" }
);

verificationOTPSchema.index({ email: 1 });
verificationOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL: auto-delete when expired

module.exports = mongoose.model("VerificationOTP", verificationOTPSchema);
