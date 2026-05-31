const mongoose = require("mongoose");

// EventManagementDB.Ticket
const ticketSchema = new mongoose.Schema(
  {
    TicketID: { type: Number, required: true, unique: true },
    EventID: { type: Number, required: true },
    TicketCatID: { type: Number, required: true },
    SeatID: { type: Number, default: null },
    IsAvailable: { type: Boolean, required: true, default: true },
    OwnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: false, collection: "Ticket" }
);

ticketSchema.index({ EventID: 1, TicketCatID: 1, IsAvailable: 1 });
ticketSchema.index({ EventID: 1, OwnerUserId: 1 });
ticketSchema.index({ OwnerUserId: 1 });

module.exports = mongoose.model("Ticket", ticketSchema);
