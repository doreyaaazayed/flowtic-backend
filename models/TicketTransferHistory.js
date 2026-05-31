const mongoose = require("mongoose");

/** Audit trail for white-market resale: each completed transfer (admin-only read). */
const ticketTransferHistorySchema = new mongoose.Schema(
  {
    ticketId: { type: Number, required: true, index: true },
    eventId: { type: Number, required: true },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ticketPrice: { type: Number, required: true },
    platformFee: { type: Number, default: 0 },
    totalPaidByBuyer: { type: Number, required: true },
    resaleRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "ResaleRequest" },
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: "TicketTransferHistory" }
);

ticketTransferHistorySchema.index({ ticketId: 1, occurredAt: 1 });

module.exports = mongoose.model("TicketTransferHistory", ticketTransferHistorySchema);
