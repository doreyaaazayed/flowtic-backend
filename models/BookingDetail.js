const mongoose = require("mongoose");

// EventManagementDB.BookingDetail
const bookingDetailSchema = new mongoose.Schema(
  {
    DetailID: { type: Number, required: true, unique: true },
    BookingID: { type: Number, required: true },
    TicketID: { type: Number, required: true },
    PriceAtBooking: { type: Number, required: true, min: 0 },
  },
  { timestamps: false, collection: "BookingDetail" }
);

bookingDetailSchema.index({ BookingID: 1 });
bookingDetailSchema.index({ TicketID: 1 });

module.exports = mongoose.model("BookingDetail", bookingDetailSchema);
