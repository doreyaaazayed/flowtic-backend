const mongoose = require("mongoose");

/** Physical gate for an event (numeric EventID matches Event.EventID). */
const entryGateSchema = new mongoose.Schema(
  {
    EventID: { type: Number, required: true, index: true },
    gateIndex: { type: Number, required: true, min: 1 },
    label: { type: String, trim: true, default: "" },
    /** Organizer-tunable congestion hint (0–100). */
    jamScore: { type: Number, default: 0, min: 0, max: 100 },
    scansLast15m: { type: Number, default: 0, min: 0 },
    lastScanAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "EntryGate" }
);

entryGateSchema.index({ EventID: 1, gateIndex: 1 }, { unique: true });

module.exports = mongoose.model("EntryGate", entryGateSchema);
