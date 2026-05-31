/**
 * Update imageUrl for specific events (by name, case-insensitive).
 *
 * Usage (from backend/):
 *   node scripts/fixEventImages.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
try {
  require("dns").setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1", "8.8.4.4"]);
} catch (_) {}

const mongoose = require("mongoose");
const Event = require("../models/Event");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";

/** Name substring (lowercase) → new hero image */
const UPDATES = [
  {
    match: "cairokee",
    imageUrl:
      "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1600&q=80",
  },
  {
    match: "al ahly match",
    imageUrl:
      "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1600&q=80",
  },
  {
    match: "real madrid",
    imageUrl:
      "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1600&q=80",
  },
];

async function main() {
  if (!MONGO_URI) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 15000 });
  console.log("Connected:", DB_NAME);

  for (const { match, imageUrl } of UPDATES) {
    const re = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const result = await Event.updateMany({ Name: re }, { $set: { imageUrl } });
    const sample = await Event.find({ Name: re }).select("EventID Name imageUrl").lean();
    console.log(`\n"${match}" → matched ${result.matchedCount}, modified ${result.modifiedCount}`);
    sample.forEach((e) => console.log(`  #${e.EventID} ${e.Name}`));
  }

  await mongoose.disconnect();
  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
