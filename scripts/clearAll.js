/**
 * Delete ALL records from every collection in the database.
 * Run from backend folder: node scripts/clearAll.js
 * Requires: MONGO_URI in .env
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";

const COLLECTIONS = [
  "BookingDetail",
  "Booking",
  "Ticket",
  "TicketCategory",
  "ResaleRequest",
  "TicketTransferHistory",
  "TicketFriendLink",
  "EntryAssignment",
  "EntryAuditLog",
  "EntryGate",
  "EntrySlot",
  "UserNotification",
  "ResaleListing",
  "Review",
  "EventSeat",
  "Event",
  "UserPaymentCard",
  "UserProfile",
  "User",
  "Venue",
  "EventCategory",
];

if (!MONGO_URI) {
  console.error("MONGO_URI is not set in .env");
  process.exit(1);
}

async function clearAll() {
  try {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log("Connected to MongoDB:", DB_NAME);

    const results = {};
    for (const name of COLLECTIONS) {
      try {
        const col = mongoose.connection.collection(name);
        const r = await col.deleteMany({});
        results[name] = r.deletedCount;
      } catch (err) {
        if (err.codeName === "NamespaceNotFound" || err.message?.includes("not found")) {
          results[name] = 0;
        } else {
          throw err;
        }
      }
    }

    console.log("\nDeleted:");
    for (const [coll, count] of Object.entries(results)) {
      console.log("  ", coll + ":", count);
    }
    console.log("\nDone. All records have been removed.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

clearAll();
