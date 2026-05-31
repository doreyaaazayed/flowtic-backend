const mongoose = require("mongoose");

/** Links an usher login to an organizer who may assign them to events. */
const usherOrganizerLinkSchema = new mongoose.Schema(
  {
    usherUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "UsherOrganizerLink" },
);

usherOrganizerLinkSchema.index({ usherUserId: 1, organizerId: 1 }, { unique: true });

module.exports = mongoose.model("UsherOrganizerLink", usherOrganizerLinkSchema);
