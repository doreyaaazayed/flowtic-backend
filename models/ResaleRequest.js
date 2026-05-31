const mongoose = require("mongoose");

// Buyer requests to purchase a listed ticket; admin approves/rejects
const resaleRequestSchema = new mongoose.Schema(
  {
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: "ResaleListing", required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["Pending", "PaymentPending", "Approved", "Rejected"],
      default: "Pending",
    },
    platformFee: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ["Pending", "Paid"], default: "Pending" },
  },
  { timestamps: true, collection: "ResaleRequest" }
);

resaleRequestSchema.index({ status: 1 });

module.exports = mongoose.model("ResaleRequest", resaleRequestSchema);
