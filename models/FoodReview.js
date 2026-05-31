const mongoose = require("mongoose");

const foodReviewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    FoodItemID: { type: Number, required: true, index: true },
    EventID: { type: Number, required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: "", maxlength: 500 },
  },
  { timestamps: true, collection: "FoodReview" },
);

foodReviewSchema.index({ userId: 1, FoodItemID: 1 }, { unique: true });

module.exports = mongoose.model("FoodReview", foodReviewSchema);
