const mongoose = require("mongoose");

// EventManagementDB.EventCategory
const eventCategorySchema = new mongoose.Schema(
  {
    CategoryID: {
      type: Number,
      required: true,
      unique: true,
    },
    Name: {
      type: String,
      required: true,
      trim: true,
    },
    Description: { type: String, trim: true },
  },
  { timestamps: true, collection: "EventCategory" }
);

module.exports = mongoose.model("EventCategory", eventCategorySchema);
