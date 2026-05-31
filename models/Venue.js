const mongoose = require("mongoose");

// EventManagementDB.Venue
const venueSchema = new mongoose.Schema(
  {
    VenueID: {
      type: Number,
      required: true,
      unique: true,
    },
    Name: {
      type: String,
      required: true,
      trim: true,
    },
    Location: {
      type: String,
      required: true,
      trim: true,
    },
    Capacity: { type: Number, default: null },
    Type: { type: String, trim: true },
    Description: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
  },
  { timestamps: true, collection: "Venue" }
);

module.exports = mongoose.model("Venue", venueSchema);
