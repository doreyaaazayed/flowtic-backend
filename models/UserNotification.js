const mongoose = require("mongoose");

const userNotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true, default: "entry_assignment" },
    title: { type: String, required: true },
    body: { type: String, required: true },
    read: { type: Boolean, default: false, index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "UserNotification" }
);

userNotificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("UserNotification", userNotificationSchema);
