const mongoose = require("mongoose");

// White Market: seller lists a ticket for resale
const resaleListingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    TicketID: { type: Number, required: true },
    EventID: { type: Number, required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    price: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["PendingApproval", "Listed", "Pending", "Sold", "Cancelled"],
      default: "PendingApproval",
    },
  },
  { timestamps: true, collection: "ResaleListing" }
);

resaleListingSchema.index({ status: 1 });
resaleListingSchema.index({ TicketID: 1, status: 1 });

module.exports = mongoose.model("ResaleListing", resaleListingSchema);
