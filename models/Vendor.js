const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema(
  {
    VendorID: { type: Number, required: true, unique: true },
    Name: { type: String, required: true, trim: true },
    Email: { type: String, trim: true, default: "" },
    Phone: { type: String, trim: true, default: "" },
    /** Login account for this vendor (User.role === vendor) */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
      sparse: true,
    },
    /** Event this vendor is assigned to for F&B operations */
    EventID: { type: Number, default: null, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "Vendor" },
);

module.exports = mongoose.model("Vendor", vendorSchema);
