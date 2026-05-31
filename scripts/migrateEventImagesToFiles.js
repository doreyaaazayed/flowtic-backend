/**
 * One-time: persist base64 event.imageUrl values to backend/uploads/events/.
 *
 * Usage (from backend/):
 *   node scripts/migrateEventImagesToFiles.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
try {
  require("dns").setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1", "8.8.4.4"]);
} catch (_) {}

const mongoose = require("mongoose");
const Event = require("../models/Event");
const eventImage = require("../services/eventImageService");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";

async function main() {
  if (!MONGO_URI) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 15000 });
  console.log("Connected:", DB_NAME);

  const events = await Event.find({ imageUrl: /^data:/ }).select("_id EventID Name imageUrl").lean();
  console.log(`Found ${events.length} events with base64 images`);

  let ok = 0;
  for (const ev of events) {
    try {
      const path = await eventImage.migrateDataUrlToFile(ev);
      console.log(`  #${ev.EventID} ${ev.Name} → ${path || "(failed)"}`);
      if (path) ok += 1;
    } catch (e) {
      console.warn(`  #${ev.EventID} ${ev.Name} error:`, e.message);
    }
  }

  console.log(`\nMigrated ${ok} / ${events.length}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
