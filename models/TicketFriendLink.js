const mongoose = require("mongoose");

/** Undirected link between two sold tickets (same EventID) for friendly entrance. */
const ticketFriendLinkSchema = new mongoose.Schema(
  {
    EventID: { type: Number, required: true, index: true },
    ticketLow: { type: Number, required: true },
    ticketHigh: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "TicketFriendLink" }
);

ticketFriendLinkSchema.index({ EventID: 1, ticketLow: 1, ticketHigh: 1 }, { unique: true });

module.exports = mongoose.model("TicketFriendLink", ticketFriendLinkSchema);
