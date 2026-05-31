const mongoose = require("mongoose");

// EventManagementDB.TicketCategory
const ticketCategorySchema = new mongoose.Schema(
  {
    TicketCatID: { type: Number, required: true, unique: true },
    EventID: { type: Number, required: true },
    Name: { type: String, required: true, trim: true },
    Price: { type: Number, required: true, min: 0 },
    TotalQuantity: { type: Number, required: true, min: 0 },
    Description: { type: String, trim: true, default: "" },
    /** Links category to a specific Event document (avoids reuse of numeric EventID). */
    eventRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
    },
  },
  { timestamps: false, collection: "TicketCategory" }
);

ticketCategorySchema.index({ EventID: 1 });
ticketCategorySchema.index({ eventRef: 1 });

module.exports = mongoose.model("TicketCategory", ticketCategorySchema);
