const mongoose = require("mongoose");

const deliveryMethodSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    price: { type: Number, required: true, min: 0, default: 0 },
    estimatedDeliveryMinutes: { type: Number, required: true, min: 1, default: 15 },
    tier: {
      type: String,
      enum: ["standard", "premium", "express", "pickup"],
      default: "standard",
    },
    icon: { type: String, trim: true, default: "" },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    EventID: { type: Number, default: null, index: true },
  },
  { timestamps: true, collection: "DeliveryMethod" },
);

deliveryMethodSchema.index({ EventID: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model("DeliveryMethod", deliveryMethodSchema);
