const mongoose = require("mongoose");

// One record per physical seat for a seated event. Linked to a Ticket (1:1).
// SectionName + RowLabel + SeatNumber form the F&B delivery label (e.g. "Platinum - Row C - Seat 9").
const seatSchema = new mongoose.Schema(
  {
    EventID: { type: Number, required: true },
    SeatID: { type: Number, required: true }, // unique per event; stored on Ticket.SeatID
    SectionName: { type: String, required: true, trim: true },
    RowLabel: { type: String, required: true, trim: true },
    SeatNumber: { type: Number, required: true, min: 1 },
    TicketCatID: { type: Number, required: true },
    // Normalized 0–1 position on floor plan image (for interactive map UI)
    posX: { type: Number, min: 0, max: 1 },
    posY: { type: Number, min: 0, max: 1 },
  },
  // Named EventSeat to avoid clashing with any existing Atlas "Seat" collection + validators
  { timestamps: false, collection: "EventSeat" }
);

seatSchema.index({ EventID: 1, SeatID: 1 }, { unique: true });
seatSchema.index({ EventID: 1, SectionName: 1, RowLabel: 1, SeatNumber: 1 });

module.exports = mongoose.model("Seat", seatSchema);
