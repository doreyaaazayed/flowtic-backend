const mongoose = require("mongoose");

/** Links a vendor to one or more events (multi-event F&B). */
const vendorEventLinkSchema = new mongoose.Schema(
  {
    VendorID: { type: Number, required: true, index: true },
    EventID: { type: Number, required: true, index: true },
  },
  { timestamps: true, collection: "VendorEventLink" },
);

vendorEventLinkSchema.index({ VendorID: 1, EventID: 1 }, { unique: true });

module.exports = mongoose.model("VendorEventLink", vendorEventLinkSchema);
