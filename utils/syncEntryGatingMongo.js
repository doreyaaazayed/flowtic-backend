/**
 * Ensures MongoDB indexes for entry-gating collections match Mongoose models.
 * Safe to run on every server start (idempotent).
 */
const EntryGate = require("../models/EntryGate");
const EntrySlot = require("../models/EntrySlot");
const EntryAssignment = require("../models/EntryAssignment");
const TicketFriendLink = require("../models/TicketFriendLink");
const UserNotification = require("../models/UserNotification");
const EntryAuditLog = require("../models/EntryAuditLog");

async function syncEntryGatingMongoIndexes() {
  await Promise.all([
    EntryGate.syncIndexes(),
    EntrySlot.syncIndexes(),
    EntryAssignment.syncIndexes(),
    TicketFriendLink.syncIndexes(),
    UserNotification.syncIndexes(),
    EntryAuditLog.syncIndexes(),
  ]);
}

module.exports = { syncEntryGatingMongoIndexes };
