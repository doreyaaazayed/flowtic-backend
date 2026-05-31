/**
 * Delete all events (and related event data) from the database.
 * Run: node scripts/clearEvents.js
 * Requires: MONGO_URI in .env (same as server)
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";

if (!MONGO_URI) {
  console.error("MONGO_URI is not set in .env");
  process.exit(1);
}

async function clearEvents() {
  try {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log("Connected to MongoDB");

    const Event = mongoose.connection.collection("Event");
    const TicketCategory = mongoose.connection.collection("TicketCategory");
    const Ticket = mongoose.connection.collection("Ticket");
    const BookingDetail = mongoose.connection.collection("BookingDetail");
    const Booking = mongoose.connection.collection("Booking");
    const ResaleListing = mongoose.connection.collection("ResaleListing");
    const ResaleRequest = mongoose.connection.collection("ResaleRequest");
    const Review = mongoose.connection.collection("Review");

    const dr = await Event.deleteMany({});
    const dtc = await TicketCategory.deleteMany({});
    const dt = await Ticket.deleteMany({});
    const dbd = await BookingDetail.deleteMany({});
    const db_ = await Booking.deleteMany({});
    const drl = await ResaleListing.deleteMany({});
    const drr = await ResaleRequest.deleteMany({});
    const rev = await Review.deleteMany({});

    console.log("Deleted:");
    console.log("  Events:", dr.deletedCount);
    console.log("  TicketCategories:", dtc.deletedCount);
    console.log("  Tickets:", dt.deletedCount);
    console.log("  BookingDetails:", dbd.deletedCount);
    console.log("  Bookings:", db_.deletedCount);
    console.log("  ResaleListings:", drl.deletedCount);
    console.log("  ResaleRequests:", drr.deletedCount);
    console.log("  Reviews:", rev.deletedCount);
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

clearEvents();
