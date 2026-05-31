const mongoose = require("mongoose");

/** Staff usher hired by an organizer — linked to a login User with role `usher`. */
const usherSchema = new mongoose.Schema(
  {
    UsherID: { type: Number, required: true, unique: true },
    Name: { type: String, required: true, trim: true },
    Email: { type: String, required: true, lowercase: true, trim: true },
    Phone: { type: String, trim: true, default: "" },
    Age: { type: Number, min: 16, max: 120 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "Usher" }
);

usherSchema.index({ organizerId: 1, Email: 1 });

module.exports = mongoose.model("Usher", usherSchema);
