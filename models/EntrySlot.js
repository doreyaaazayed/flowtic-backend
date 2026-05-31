const mongoose = require("mongoose");

/** Time window for entry; capacity is per gate for this window. */
const entrySlotSchema = new mongoose.Schema(
  {
    EventID: { type: Number, required: true, index: true },
    slotIndex: { type: Number, required: true, min: 0 },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    /** Max tickets assigned to each gate in this slot. */
    maxPerGate: { type: Number, required: true, min: 1 },
  },
  { timestamps: true, collection: "EntrySlot" }
);

entrySlotSchema.index({ EventID: 1, slotIndex: 1 }, { unique: true });

module.exports = mongoose.model("EntrySlot", entrySlotSchema);
