const mongoose = require("mongoose");

const foodCategorySchema = new mongoose.Schema(
  {
    CategoryID: { type: Number, required: true, unique: true },
    VenueID: { type: Number, default: null, index: true },
    RestaurantID: { type: Number, default: null, index: true },
    EventID: { type: Number, default: null, index: true },
    Name: { type: String, required: true, trim: true },
    Description: { type: String, trim: true, default: "" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "FoodCategory" },
);

foodCategorySchema.index({ VenueID: 1, RestaurantID: 1, Name: 1 });
foodCategorySchema.index({ EventID: 1, Name: 1 });

module.exports = mongoose.model("FoodCategory", foodCategorySchema);
