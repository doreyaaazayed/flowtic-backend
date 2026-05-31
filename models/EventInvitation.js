const mongoose = require("mongoose");

const eventInvitationSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    eventEventId: { type: Number, required: true, index: true },
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    guestName: { type: String, required: true, trim: true },
    guestEmail: { type: String, required: true, trim: true, lowercase: true },
    guestPhone: { type: String, trim: true },
    token: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    sentAt: { type: Date },
    emailError: { type: String, trim: true },
    openedAt: { type: Date },
  },
  { timestamps: true, collection: "EventInvitation" },
);

eventInvitationSchema.index({ eventId: 1, guestEmail: 1 });

module.exports = mongoose.model("EventInvitation", eventInvitationSchema);
