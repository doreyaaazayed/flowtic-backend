const mongoose = require("mongoose");

const ORDER_STATUSES = ["Pending", "Confirmed", "Preparing", "Ready", "Completed", "Cancelled"];
const EDITABLE_STATUSES = ["Pending", "Confirmed"];
const PAYMENT_STATUSES = ["Pending", "Paid", "Failed"];
const PAYMENT_METHODS = ["card", "cod", "apple_pay", "google_pay"];
const PAYMENT_BRANDS = ["visa", "mastercard", "amex", "apple_pay", "google_pay", "cod", "other"];

const foodOrderSchema = new mongoose.Schema(
  {
    OrderID: { type: Number, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    EventID: { type: Number, required: true, index: true },
    eventMongoId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    Status: {
      type: String,
      required: true,
      enum: ORDER_STATUSES,
      default: "Pending",
    },
    // Legacy enum kept for backwards compatibility; dynamic methods stored in deliveryMethodCode.
    deliveryMethod: {
      type: String,
      default: "pickup",
    },
    deliveryMethodCode: { type: String, trim: true, default: "pickup" },
    deliveryMethodName: { type: String, trim: true, default: "" },
    deliveryFee: { type: Number, min: 0, default: 0 },
    estimatedDeliveryMinutes: { type: Number, min: 0, default: 0 },
    seatLabel: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    subtotal: { type: Number, required: true, min: 0 },
    serviceFee: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "card" },
    paymentBrand: { type: String, enum: PAYMENT_BRANDS, default: "other" },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "Pending",
    },
    paymentCardId: { type: mongoose.Schema.Types.ObjectId, ref: "UserPaymentCard" },
    idempotencyKey: { type: String, trim: true, sparse: true },
    estimatedReadyAt: { type: Date },
    editCount: { type: Number, default: 0 },
    lastEditedAt: { type: Date },
    /** attendee (default) | vendor_pos — walk-in / counter orders from vendor portal */
    orderSource: {
      type: String,
      enum: ["attendee", "vendor_pos"],
      default: "attendee",
    },
    vendorPlacedBy: { type: Number, default: null },
    posCustomerLabel: { type: String, trim: true, default: "" },
  },
  { timestamps: true, collection: "FoodOrder" },
);

foodOrderSchema.index({ userId: 1, createdAt: -1 });
foodOrderSchema.index({ EventID: 1, Status: 1 });
foodOrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("FoodOrder", foodOrderSchema);
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.EDITABLE_STATUSES = EDITABLE_STATUSES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.PAYMENT_BRANDS = PAYMENT_BRANDS;
