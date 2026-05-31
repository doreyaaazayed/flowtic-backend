/**
 * Create entry-gating collections in MongoDB (EventManagementDB) with JSON Schema
 * validation where the collection does not exist yet, then sync Mongoose indexes.
 *
 * Run from backend folder:
 *   node scripts/mongoEnsureEntryGating.js
 *
 * Optional: apply validators to existing empty collections
 *   node scripts/mongoEnsureEntryGating.js --coll-mod-validators
 *
 * Requires: MONGO_URI in .env
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const DB_NAME = "EventManagementDB";
const MONGO_URI = process.env.MONGO_URI;

const EntryGate = require("../models/EntryGate");
const EntrySlot = require("../models/EntrySlot");
const EntryAssignment = require("../models/EntryAssignment");
const TicketFriendLink = require("../models/TicketFriendLink");

const COLLECTIONS = [
  { model: EntryGate, name: "EntryGate", validatorFile: "EntryGate.json" },
  { model: EntrySlot, name: "EntrySlot", validatorFile: "EntrySlot.json" },
  { model: EntryAssignment, name: "EntryAssignment", validatorFile: "EntryAssignment.json" },
  { model: TicketFriendLink, name: "TicketFriendLink", validatorFile: "TicketFriendLink.json" },
];

function loadValidator(fileName) {
  const p = path.join(__dirname, "..", "mongo", "validators", fileName);
  if (!fs.existsSync(p)) {
    console.warn("Validator file missing:", p);
    return null;
  }
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  if (doc.$jsonSchema) return doc;
  return { $jsonSchema: doc };
}

async function collectionExists(db, name) {
  const cols = await db.listCollections({ name }).toArray();
  return cols.length > 0;
}

async function countDocuments(db, name) {
  return db.collection(name).estimatedDocumentCount();
}

async function main() {
  const applyCollMod = process.argv.includes("--coll-mod-validators");

  if (!MONGO_URI) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;
  console.log("Connected:", DB_NAME);

  for (const { name, validatorFile } of COLLECTIONS) {
    const validatorWrapper = loadValidator(validatorFile);
    const exists = await collectionExists(db, name);

    if (!exists) {
      const opts = validatorWrapper
        ? {
            validator: validatorWrapper,
            validationLevel: "strict",
            validationAction: "error",
          }
        : {};
      await db.createCollection(name, opts);
      console.log("Created collection:", name, validatorWrapper ? "(with $jsonSchema)" : "");
      continue;
    }

    console.log("Collection already exists:", name);
    const n = await countDocuments(db, name);
    if (applyCollMod && validatorWrapper && n === 0) {
      await db.command({
        collMod: name,
        validator: validatorWrapper,
        validationLevel: "strict",
        validationAction: "error",
      });
      console.log("  Applied collMod validator (collection was empty).");
    } else if (applyCollMod && n > 0) {
      console.log("  Skipped collMod: collection has documents (avoid breaking legacy data).");
    }
  }

  await Promise.all(COLLECTIONS.map(({ model }) => model.syncIndexes()));
  console.log("Mongoose indexes synced for:", COLLECTIONS.map((c) => c.name).join(", "));
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
