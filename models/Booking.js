const mongoose = require("mongoose");

// EventManagementDB.Booking — userId = User._id (ObjectId)
const bookingSchema = new mongoose.Schema(
  {
    BookingID: { type: Number, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    Date: { type: Date, required: true, default: Date.now },
    TotalAmount: { type: Number, required: true, min: 0 },
    SubtotalAmount: { type: Number, min: 0 },
    DiscountAmount: { type: Number, default: 0, min: 0 },
    PromoCode: { type: String, trim: true },
    LoyaltyPointsEarned: { type: Number, default: 0, min: 0 },
    Status: {
      type: String,
      required: true,
      enum: ["Pending", "Confirmed", "Cancelled"],
      default: "Pending",
    },
  },
  { timestamps: false, collection: "Booking" }
);

bookingSchema.index({ userId: 1, Date: -1 });

module.exports = mongoose.model("Booking", bookingSchema);
