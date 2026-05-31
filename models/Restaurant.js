const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema(
  {
    RestaurantID: { type: Number, required: true, unique: true },
    VenueID: { type: Number, required: true, index: true },
    VendorID: { type: Number, default: null, index: true },
    Name: { type: String, required: true, trim: true },
    Description: { type: String, trim: true, default: "" },
    imageUrl: { type: String, trim: true, default: "" },
    categoryType: { type: String, trim: true, default: "" },
    cuisineType: { type: String, trim: true, default: "" },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "Restaurant" },
);

restaurantSchema.index({ VenueID: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model("Restaurant", restaurantSchema);
