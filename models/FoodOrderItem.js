const mongoose = require("mongoose");

const foodOrderItemSchema = new mongoose.Schema(
  {
    DetailID: { type: Number, required: true, unique: true },
    OrderID: { type: Number, required: true, index: true },
    FoodItemID: { type: Number, required: true },
    RestaurantID: { type: Number, default: null, index: true },
    Name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { timestamps: false, collection: "FoodOrderItem" },
);

module.exports = mongoose.model("FoodOrderItem", foodOrderItemSchema);
