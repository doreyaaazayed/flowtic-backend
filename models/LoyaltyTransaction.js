const mongoose = require("mongoose");

const loyaltyTransactionSchema = new mongoose.Schema(
  {
    TransactionID: { type: Number, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "welcome",
        "booking",
        "food_order",
        "event_created",
        "redeem_promo",
        "admin_adjust",
      ],
    },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    referenceType: { type: String, trim: true },
    referenceId: { type: String, trim: true },
    description: { type: String, trim: true },
  },
  { timestamps: true, collection: "LoyaltyTransaction" }
);

loyaltyTransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("LoyaltyTransaction", loyaltyTransactionSchema);
