const EntryGate = require("../models/EntryGate");
const EntryAuditLog = require("../models/EntryAuditLog");
const UsherGateAssignment = require("../models/UsherGateAssignment");
const UsherOrganizerLink = require("../models/UsherOrganizerLink");
const Event = require("../models/Event");

const ACTIVE_EVENT_STATUSES = new Set(["Active"]);

function assertShiftActive(assignment) {
  if (!assignment) return;
  const now = Date.now();
  if (assignment.shiftStart && now < new Date(assignment.shiftStart).getTime()) {
    const err = new Error("Your shift has not started yet");
    err.statusCode = 403;
    err.code = "SHIFT_NOT_STARTED";
    throw err;
  }
  if (assignment.shiftEnd && now > new Date(assignment.shiftEnd).getTime()) {
    const err = new Error("Your shift has ended");
    err.statusCode = 403;
    err.code = "SHIFT_ENDED";
    throw err;
  }
}

function assertEventOpenForUsher(event) {
  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    throw err;
  }
  if (!event.entryGatingEnabled) {
    const err = new Error("Entry gating is not enabled for this event");
    err.statusCode = 403;
    err.code = "GATING_DISABLED";
    throw err;
  }
  if (!ACTIVE_EVENT_STATUSES.has(String(event.Status || ""))) {
    const err = new Error(`Event is ${event.Status || "unavailable"} — gate check-in is closed`);
    err.statusCode = 403;
    err.code = "EVENT_NOT_ACTIVE";
    throw err;
  }
  const now = Date.now();
  const endMs = event.EndDate ? new Date(event.EndDate).getTime() + 6 * 60 * 60 * 1000 : null;
  if (endMs != null && now > endMs) {
    const err = new Error("Event has ended — gate check-in is closed");
    err.statusCode = 403;
    err.code = "EVENT_ENDED";
    throw err;
  }
}

async function getUsherAssignment(usherUserId, eventIdNum, gateIndex) {
  const row = await UsherGateAssignment.findOne({
    EventID: eventIdNum,
    usherUserId,
    gateIndex,
  }).lean();
  if (!row) {
    const err = new Error("You are not assigned to this gate for this event");
    err.statusCode = 403;
    throw err;
  }
  assertShiftActive(row);
  return row;
}

async function assertUsherGateAccess(usherUserId, eventIdNum, gateIndex) {
  return getUsherAssignment(usherUserId, eventIdNum, gateIndex);
}

async function ensureOrganizerLink(usherUserId, organizerId) {
  let link = await UsherOrganizerLink.findOne({ usherUserId, organizerId }).lean();
  if (!link) {
    link = await UsherOrganizerLink.create({ usherUserId, organizerId, active: true });
  } else if (link.active === false) {
    await UsherOrganizerLink.updateOne({ _id: link._id }, { $set: { active: true } });
    link = { ...link, active: true };
  }
  return link;
}

async function organizerOwnsUsher(organizerId, usherUserId) {
  const link = await UsherOrganizerLink.findOne({ usherUserId, organizerId, active: { $ne: false } }).lean();
  return Boolean(link);
}

async function getGateBoard(event, gateIndex, usherUserId) {
  const gate = await EntryGate.findOne({ EventID: event.EventID, gateIndex }).lean();
  const assignment = await UsherGateAssignment.findOne({
    EventID: event.EventID,
    usherUserId,
    gateIndex,
  }).lean();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [myScansToday, recentActivity] = await Promise.all([
    EntryAuditLog.countDocuments({
      EventID: event.EventID,
      actorUserId: usherUserId,
      gateIndex,
      action: { $in: ["verify_face_usher", "verify_manual_usher"] },
      success: true,
      createdAt: { $gte: startOfDay },
    }),
    EntryAuditLog.find({
      EventID: event.EventID,
      gateIndex,
      action: { $in: ["verify_face_usher", "verify_manual_usher"] },
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("success ticketId reason createdAt action")
      .lean(),
  ]);

  return {
    eventName: event.Name,
    eventStatus: event.Status,
    entryGatingEnabled: Boolean(event.entryGatingEnabled),
    gateIndex,
    gateLabel: gate?.label || `Gate ${gateIndex}`,
    jamScore: gate?.jamScore ?? 0,
    scansLast15m: gate?.scansLast15m ?? 0,
    shiftStart: assignment?.shiftStart ?? null,
    shiftEnd: assignment?.shiftEnd ?? null,
    manualFallbackEnabled: Boolean(event.usherManualFallbackEnabled),
    myScansToday,
    recentActivity,
  };
}

module.exports = {
  assertShiftActive,
  assertEventOpenForUsher,
  getUsherAssignment,
  assertUsherGateAccess,
  ensureOrganizerLink,
  organizerOwnsUsher,
  getGateBoard,
  ACTIVE_EVENT_STATUSES,
};
