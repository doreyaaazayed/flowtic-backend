const mongoose = require("mongoose");

const foodCartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    EventID: { type: Number, required: true, index: true },
    eventMongoId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  },
  { timestamps: true, collection: "FoodCart" },
);

foodCartSchema.index({ userId: 1, EventID: 1 }, { unique: true });

module.exports = mongoose.model("FoodCart", foodCartSchema);
