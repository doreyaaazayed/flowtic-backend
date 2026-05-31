const mongoose = require("mongoose");

/**
 * One row per sold ticket for an event with entry gating.
 * Friendly groups share the same friendGroupId (UUID string).
 */
const entryAssignmentSchema = new mongoose.Schema(
  {
    EventID: { type: Number, required: true, index: true },
    TicketID: { type: Number, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gateIndex: { type: Number, required: true, min: 1 },
    slotIndex: { type: Number, required: true, min: 0 },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    friendGroupId: { type: String, default: null, index: true },
    version: { type: Number, default: 1, min: 1 },
    usedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["active", "used", "void"],
      default: "active",
    },
  },
  { timestamps: true, collection: "EntryAssignment" }
);

entryAssignmentSchema.index({ EventID: 1, gateIndex: 1, slotIndex: 1 });
entryAssignmentSchema.index({ EventID: 1, userId: 1 });

module.exports = mongoose.model("EntryAssignment", entryAssignmentSchema);
