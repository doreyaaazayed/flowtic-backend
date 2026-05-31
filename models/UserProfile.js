const mongoose = require("mongoose");

// EventManagementDB.UserProfile — one profile per user (Organizer/Attendee contact & org info)
const userProfileSchema = new mongoose.Schema(
  {
    ProfileID: { type: Number, required: true, unique: true },
    UserID: { type: Number, required: true }, // FK (int) for MongoDB validator
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    FirstName: { type: String, trim: true, default: "" },
    LastName: { type: String, trim: true, default: "" },
    Phone: { type: String, trim: true, default: "" },
    Address: { type: String, trim: true, default: "" },
    City: { type: String, trim: true, default: "" },
    // Organizer-specific (ERD: OrgName, ContactInfo, Description)
    OrgName: { type: String, trim: true, default: "" },
    ContactInfo: { type: String, trim: true, default: "" },
    Description: { type: String, trim: true, default: "" },
  },
  { timestamps: false, collection: "UserProfile" }
);

module.exports = mongoose.model("UserProfile", userProfileSchema);
