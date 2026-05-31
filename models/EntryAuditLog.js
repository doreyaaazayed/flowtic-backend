const mongoose = require("mongoose");

/** Immutable audit trail for crowd entry / gate operations (append-only). */
const entryAuditLogSchema = new mongoose.Schema(
  {
    EventID: { type: Number, required: true, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: {
      type: String,
      required: true,
      enum: [
        "assign",
        "regenerate",
        "jam",
        "redirect",
        "verify_manual",
        "verify_face",
        "verify_face_usher",
        "verify_manual_usher",
      ],
    },
    success: { type: Boolean, default: true },
    reason: { type: String, maxlength: 500, default: null },
    ticketId: { type: Number, default: null },
    gateIndex: { type: Number, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "EntryAuditLog" }
);

entryAuditLogSchema.index({ EventID: 1, createdAt: -1 });

module.exports = mongoose.model("EntryAuditLog", entryAuditLogSchema);
