/**
 * Insert dummy users for testing (default: 100).
 *
 * Usage (from backend folder):
 *   node scripts/seedDummyUsers.js
 *   node scripts/seedDummyUsers.js --clean     # remove prior seed users, then insert
 *   DUMMY_USER_COUNT=50 node scripts/seedDummyUsers.js
 *
 * Env:
 *   MONGO_URI     — required (same as server)
 *   SEED_PASSWORD — optional, default: DummyTest123!
 *
 * All seed emails match: seed.user.00001@flowtic.test … seed.user.00100@flowtic.test
 * --clean deletes users whose Email matches /^seed\.user\.\d{5}@flowtic\.test$/i
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";
const ROLE_IDS = { attendee: 1, organizer: 2, admin: 3, vendor: 4 };

const EMAIL_DOMAIN = "flowtic.test";
const EMAIL_RE = /^seed\.user\.\d{5}@flowtic\.test$/i;

function parseArgs() {
  const clean = process.argv.includes("--clean");
  let count = parseInt(process.env.DUMMY_USER_COUNT || "100", 10);
  if (Number.isNaN(count) || count < 1) count = 100;
  if (count > 5000) count = 5000;
  return { clean, count };
}

function nationalIdForIndex(i) {
  // 14 digits, synthetic test range (schema: /^\d{14}$/)
  return String(29900101000000 + i);
}

function phoneForIndex(i) {
  // 11-digit style 01xxxxxxxxx
  const tail = String(10000000 + i).slice(-8);
  return `01${tail}`;
}

async function main() {
  const { clean, count } = parseArgs();
  const passwordPlain = process.env.SEED_PASSWORD || "DummyTest123!";

  if (!MONGO_URI) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 15000 });
  console.log("Connected:", DB_NAME);

  if (clean) {
    const del = await User.deleteMany({ Email: EMAIL_RE });
    console.log(`--clean: removed ${del.deletedCount} existing seed user(s).`);
  }

  const lastUser = await User.findOne().sort({ UserID: -1 }).select("UserID").lean();
  let nextUserID = (lastUser?.UserID ?? 0) + 1;

  const hashedPassword = await bcrypt.hash(passwordPlain, 10);
  const dob = new Date("2000-06-15");

  let inserted = 0;
  let skipped = 0;

  for (let i = 1; i <= count; i++) {
    const email = `seed.user.${String(i).padStart(5, "0")}@${EMAIL_DOMAIN}`;
    const exists = await User.findOne({ Email: email }).select("_id").lean();
    if (exists) {
      skipped++;
      continue;
    }

    const nationalId = nationalIdForIndex(i);
    const phone = phoneForIndex(i);
    const first = "Seed";
    const last = `User${i}`;
    const username = `${first} ${last}`;

    try {
      await User.create({
        UserID: nextUserID,
        Username: username,
        FirstName: first,
        LastName: last,
        Phone: phone,
        NationalID: nationalId,
        dateOfBirth: dob,
        Email: email.toLowerCase(),
        Password: hashedPassword,
        RoleID: ROLE_IDS.attendee,
        role: "attendee",
        emailVerified: true,
        organizerApproved: true,
      });
      inserted++;
      nextUserID++;
    } catch (e) {
      console.error(`Failed row ${i} (${email}):`, e.message);
    }
  }

  console.log(`Done. Inserted: ${inserted}, skipped (already existed): ${skipped}`);
  console.log(`Login hint — email: seed.user.00001@${EMAIL_DOMAIN} … up to ${count}`);
  console.log(`Password (all): ${passwordPlain}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
