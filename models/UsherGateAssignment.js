const mongoose = require("mongoose");

/** Maps an usher login to a gate at an event (numeric EventID). */
const usherGateAssignmentSchema = new mongoose.Schema(
  {
    EventID: { type: Number, required: true, index: true },
    usherUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    gateIndex: { type: Number, required: true, min: 1 },
    /** Optional shift window — usher can only scan during this period */
    shiftStart: { type: Date, default: null },
    shiftEnd: { type: Date, default: null },
  },
  { timestamps: true, collection: "UsherGateAssignment" }
);

usherGateAssignmentSchema.index({ EventID: 1, usherUserId: 1, gateIndex: 1 }, { unique: true });

module.exports = mongoose.model("UsherGateAssignment", usherGateAssignmentSchema);
