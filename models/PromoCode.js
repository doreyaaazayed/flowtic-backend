const mongoose = require("mongoose");

const promoCodeSchema = new mongoose.Schema(
  {
    PromoCodeID: { type: Number, required: true, unique: true },
    Code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    discountType: {
      type: String,
      required: true,
      enum: ["percent", "fixed"],
    },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscountAmount: { type: Number, min: 0 },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    source: { type: String, enum: ["loyalty", "admin"], default: "loyalty" },
    pointsCost: { type: Number, min: 0 },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    usedOnBookingId: { type: Number },
  },
  { timestamps: true, collection: "PromoCode" }
);

promoCodeSchema.index({ Code: 1, isActive: 1 });
promoCodeSchema.index({ userId: 1, isActive: 1, expiresAt: 1 });

module.exports = mongoose.model("PromoCode", promoCodeSchema);
