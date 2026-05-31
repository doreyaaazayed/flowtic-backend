const mongoose = require("mongoose");

const foodItemSchema = new mongoose.Schema(
  {
    FoodItemID: { type: Number, required: true, unique: true },
    VenueID: { type: Number, default: null, index: true },
    RestaurantID: { type: Number, default: null, index: true },
    EventID: { type: Number, default: null, index: true },
    CategoryID: { type: Number, required: true, index: true },
    Name: { type: String, required: true, trim: true },
    Description: { type: String, trim: true, default: "" },
    Price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, trim: true, default: "" },
    stockQuantity: { type: Number, required: true, min: 0, default: 100 },
    availability: { type: Boolean, default: true },
    preparationTimeMinutes: { type: Number, default: 15, min: 1 },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    popularityScore: { type: Number, default: 0, min: 0 },
    isPopular: { type: Boolean, default: false },
    isVenueExclusive: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "FoodItem" },
);

foodItemSchema.index({ VenueID: 1, RestaurantID: 1, CategoryID: 1 });
foodItemSchema.index({ VenueID: 1, isPopular: -1 });
foodItemSchema.index({ EventID: 1, CategoryID: 1 });
foodItemSchema.index({ EventID: 1, isPopular: -1 });

module.exports = mongoose.model("FoodItem", foodItemSchema);
