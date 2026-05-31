const mongoose = require("mongoose");

const userFoodFavoriteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    FoodItemID: { type: Number, required: true, index: true },
    EventID: { type: Number, required: true },
  },
  { timestamps: true, collection: "UserFoodFavorite" },
);

userFoodFavoriteSchema.index({ userId: 1, FoodItemID: 1 }, { unique: true });

module.exports = mongoose.model("UserFoodFavorite", userFoodFavoriteSchema);
