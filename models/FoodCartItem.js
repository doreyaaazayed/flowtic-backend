const mongoose = require("mongoose");

const foodCartItemSchema = new mongoose.Schema(
  {
    cartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FoodCart",
      required: true,
      index: true,
    },
    FoodItemID: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    name: { type: String, trim: true },
  },
  { timestamps: true, collection: "FoodCartItem" },
);

foodCartItemSchema.index({ cartId: 1, FoodItemID: 1 }, { unique: true });

module.exports = mongoose.model("FoodCartItem", foodCartItemSchema);
