const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Usher = require("../models/Usher");
const UsherOrganizerLink = require("../models/UsherOrganizerLink");
const UsherGateAssignment = require("../models/UsherGateAssignment");
const EntryGate = require("../models/EntryGate");
const EntryAuditLog = require("../models/EntryAuditLog");
const Event = require("../models/Event");
const UserNotification = require("../models/UserNotification");
const emailService = require("./emailService");
const { getEventForOrganizerAccess } = require("./vendorProvisionService");
const { ensureOrganizerLink, organizerOwnsUsher } = require("./usherService");
const { assertValidEgyptPhone } = require("../utils/fieldValidation");

const ROLE_USHER = 5;

async function nextId(Model, field) {
  const last = await Model.findOne().sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64url").slice(0, 12);
}

function slugUsername(email, name) {
  const base =
    String(email || "")
      .split("@")[0]
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .slice(0, 24) ||
    String(name || "usher")
      .replace(/\s+/g, "_")
      .slice(0, 24);
  return `${base}_${Math.floor(1000 + Math.random() * 9000)}`;
}

async function syncLegacyOrganizerLinks() {
  const ushers = await Usher.find({ userId: { $exists: true, $ne: null } }).select("userId organizerId").lean();
  for (const u of ushers) {
    if (u.organizerId && u.userId) {
      await UsherOrganizerLink.updateOne(
        { usherUserId: u.userId, organizerId: u.organizerId },
        { $setOnInsert: { active: true } },
        { upsert: true },
      );
    }
  }
}

async function getUsherDocForUser(usherUserId) {
  return Usher.findOne({ userId: usherUserId, active: { $ne: false } }).lean();
}

async function notifyUsherAssignment(usherUserId, event, gateIndexes, shiftInfo = null) {
  const gates = gateIndexes.map((g) => `Gate ${g}`).join(", ");
  let body = `You are assigned to ${gates} at ${event.Name}. Open the usher portal to start scanning.`;
  if (shiftInfo) body += ` Shift: ${shiftInfo}`;

  await UserNotification.create({
    userId: usherUserId,
    type: "usher_assignment",
    title: "Gate assignment updated",
    body,
    meta: { eventId: event.EventID, eventMongoId: String(event._id), gateIndexes },
  });

  const usher = await Usher.findOne({ userId: usherUserId }).select("Email Name").lean();
  if (usher?.Email && emailService.isEmailConfigured()) {
    await emailService.send({
      to: usher.Email,
      subject: `Gate assignment — ${event.Name}`,
      htmlContent: `<p>Hi ${usher.Name || "there"},</p><p>${body}</p><p>Sign in at the usher portal on FlowTic.</p>`,
      textContent: body,
    });
  }
}

async function provisionUsherAccount({
  Name,
  Email,
  Phone,
  Age,
  organizerUserId,
  sendCredentialsEmail = true,
}) {
  if (!Name?.trim()) {
    const err = new Error("Name is required");
    err.statusCode = 400;
    throw err;
  }
  if (!Email?.trim()) {
    const err = new Error("Email is required");
    err.statusCode = 400;
    throw err;
  }
  const ageNum = Age != null && Age !== "" ? Number(Age) : null;
  if (ageNum != null && (!Number.isFinite(ageNum) || ageNum < 16 || ageNum > 120)) {
    const err = new Error("Age must be between 16 and 120");
    err.statusCode = 400;
    throw err;
  }

  let phoneNorm = Phone?.trim() || "";
  if (phoneNorm) {
    try {
      phoneNorm = assertValidEgyptPhone(phoneNorm, { required: true });
    } catch (e) {
      e.statusCode = 400;
      throw e;
    }
  }

  const emailNorm = Email.toLowerCase().trim();
  const existingUser = await User.findOne({ Email: emailNorm });
  let user;
  let usher;
  let tempPassword = null;
  let createdNewAccount = false;

  if (existingUser) {
    if (existingUser.role !== "usher") {
      const err = new Error("Email already registered to a non-usher account");
      err.statusCode = 400;
      throw err;
    }
    user = existingUser;
    usher = await Usher.findOne({ userId: user._id, active: { $ne: false } });
    if (!usher) {
      usher = await Usher.create({
        UsherID: await nextId(Usher, "UsherID"),
        Name: Name.trim(),
        Email: emailNorm,
        Phone: phoneNorm || "",
        Age: ageNum ?? undefined,
        userId: user._id,
        organizerId: organizerUserId,
        active: true,
      });
    } else {
      await Usher.updateOne(
        { _id: usher._id },
        {
          $set: {
            Name: Name.trim(),
            Phone: phoneNorm || usher.Phone || "",
            ...(ageNum != null ? { Age: ageNum } : {}),
          },
        },
      );
      usher = await Usher.findById(usher._id).lean();
    }
    await ensureOrganizerLink(user._id, organizerUserId);
  } else {
    tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const username = slugUsername(emailNorm, Name);
    const lastUser = await User.findOne().sort({ UserID: -1 }).select("UserID").lean();
    const nextUserID = (lastUser?.UserID ?? 0) + 1;

    user = await User.create({
      UserID: nextUserID,
      Username: username,
      Email: emailNorm,
      Password: hashedPassword,
      RoleID: ROLE_USHER,
      role: "usher",
      emailVerified: true,
      mustChangePassword: true,
      FirstName: Name.trim(),
      Phone: phoneNorm || undefined,
    });

    usher = await Usher.create({
      UsherID: await nextId(Usher, "UsherID"),
      Name: Name.trim(),
      Email: emailNorm,
      Phone: phoneNorm || "",
      Age: ageNum ?? undefined,
      userId: user._id,
      organizerId: organizerUserId,
      active: true,
    });
    await ensureOrganizerLink(user._id, organizerUserId);
    createdNewAccount = true;
  }

  let emailSent = false;
  if (createdNewAccount && tempPassword && sendCredentialsEmail) {
    const mail = await emailService.sendUsherCredentials(emailNorm, {
      name: Name.trim(),
      email: emailNorm,
      temporaryPassword: tempPassword,
    });
    emailSent = mail.success === true;
  }

  return {
    usher,
    user: {
      id: String(user._id),
      username: user.Username,
      email: user.Email,
      role: user.role,
    },
    credentials: tempPassword
      ? { email: emailNorm, username: user.Username, temporaryPassword: tempPassword }
      : null,
    createdNewAccount,
    emailSent,
    linkedExisting: !createdNewAccount,
  };
}

function parseGateAssignments(raw) {
  if (Array.isArray(raw?.gateAssignments) && raw.gateAssignments.length) {
    return raw.gateAssignments.map((g) => ({
      gateIndex: Number(g.gateIndex),
      shiftStart: g.shiftStart ? new Date(g.shiftStart) : null,
      shiftEnd: g.shiftEnd ? new Date(g.shiftEnd) : null,
    }));
  }
  const indexes = [...new Set((raw?.gateIndexes || []).map((g) => Number(g)).filter((g) => Number.isFinite(g) && g >= 1))];
  const shiftStart = raw?.shiftStart ? new Date(raw.shiftStart) : null;
  const shiftEnd = raw?.shiftEnd ? new Date(raw.shiftEnd) : null;
  return indexes.map((gateIndex) => ({ gateIndex, shiftStart, shiftEnd }));
}

async function setUsherGateAssignments(organizerUserId, role, usherUserId, eventIdNum, body) {
  const event = await getEventForOrganizerAccess(organizerUserId, role, eventIdNum);
  const owns = await organizerOwnsUsher(organizerUserId, usherUserId);
  if (!owns) {
    const usher = await Usher.findOne({ userId: usherUserId, organizerId: organizerUserId, active: { $ne: false } }).lean();
    if (!usher) {
      const err = new Error("Usher not found");
      err.statusCode = 404;
      throw err;
    }
    await ensureOrganizerLink(usherUserId, organizerUserId);
  }

  const assignments = parseGateAssignments(body);
  if (!assignments.length) {
    const err = new Error("Select at least one gate");
    err.statusCode = 400;
    throw err;
  }

  const gates = await EntryGate.find({ EventID: event.EventID }).select("gateIndex").lean();
  const valid = new Set(gates.map((g) => g.gateIndex));
  if (!valid.size) {
    const err = new Error("Entry gates are not set up for this event yet. Use Gate tools to configure gates first.");
    err.statusCode = 400;
    throw err;
  }
  for (const a of assignments) {
    if (!valid.has(a.gateIndex)) {
      const err = new Error(`Gate ${a.gateIndex} does not exist for this event`);
      err.statusCode = 400;
      throw err;
    }
  }

  await UsherGateAssignment.deleteMany({ EventID: event.EventID, usherUserId });
  await UsherGateAssignment.insertMany(
    assignments.map((a) => ({
      EventID: event.EventID,
      usherUserId,
      gateIndex: a.gateIndex,
      shiftStart: a.shiftStart,
      shiftEnd: a.shiftEnd,
    })),
  );

  const gateIndexes = assignments.map((a) => a.gateIndex);
  const shiftInfo = assignments
    .filter((a) => a.shiftStart || a.shiftEnd)
    .map((a) => {
      const s = a.shiftStart ? new Date(a.shiftStart).toLocaleString() : "—";
      const e = a.shiftEnd ? new Date(a.shiftEnd).toLocaleString() : "—";
      return `Gate ${a.gateIndex}: ${s} – ${e}`;
    })
    .join("; ");
  await notifyUsherAssignment(usherUserId, event, gateIndexes, shiftInfo || null);

  return { EventID: event.EventID, usherUserId, gateIndexes, assignments };
}

async function deactivateUsherForOrganizer(organizerUserId, usherUserId) {
  const owns = await organizerOwnsUsher(organizerUserId, usherUserId);
  if (!owns) {
    const err = new Error("Usher not found");
    err.statusCode = 404;
    throw err;
  }

  await UsherOrganizerLink.updateOne(
    { usherUserId, organizerId: organizerUserId },
    { $set: { active: false } },
  );

  const events = await Event.find({ organizer: organizerUserId }).select("EventID").lean();
  const eventIds = events.map((e) => e.EventID);
  if (eventIds.length) {
    await UsherGateAssignment.deleteMany({ usherUserId, EventID: { $in: eventIds } });
  }

  return { ok: true, usherUserId };
}

async function listOrganizerUshers(organizerUserId) {
  await syncLegacyOrganizerLinks();
  const links = await UsherOrganizerLink.find({ organizerId: organizerUserId, active: { $ne: false } }).lean();
  const userIds = links.map((l) => l.usherUserId);
  if (!userIds.length) return [];

  const ushers = await Usher.find({ userId: { $in: userIds }, active: { $ne: false } })
    .sort({ createdAt: -1 })
    .lean();

  const assignments = await UsherGateAssignment.find({ usherUserId: { $in: userIds } }).lean();
  const eventIds = [...new Set(assignments.map((a) => a.EventID))];
  const events = eventIds.length
    ? await Event.find({ EventID: { $in: eventIds } })
        .select("EventID Name _id entryGatingEnabled Status")
        .lean()
    : [];
  const eventMap = Object.fromEntries(events.map((e) => [e.EventID, e]));

  return ushers.map((u) => {
    const mine = assignments.filter((a) => String(a.usherUserId) === String(u.userId));
    const byEvent = {};
    for (const a of mine) {
      if (!byEvent[a.EventID]) byEvent[a.EventID] = [];
      byEvent[a.EventID].push(a);
    }
    const assignmentDetails = Object.entries(byEvent).map(([eid, rows]) => {
      const ev = eventMap[Number(eid)];
      return {
        EventID: Number(eid),
        eventMongoId: ev?._id ? String(ev._id) : null,
        eventName: ev?.Name ?? null,
        gateIndexes: rows.map((r) => r.gateIndex).sort((x, y) => x - y),
        shifts: rows.map((r) => ({
          gateIndex: r.gateIndex,
          shiftStart: r.shiftStart ?? null,
          shiftEnd: r.shiftEnd ?? null,
        })),
      };
    });
    return {
      UsherID: u.UsherID,
      Name: u.Name,
      Email: u.Email,
      Phone: u.Phone || "",
      Age: u.Age ?? null,
      userId: String(u.userId),
      assignments: assignmentDetails,
    };
  });
}

function activeEventFilter(ev) {
  return String(ev?.Status || "") === "Active" && Boolean(ev?.entryGatingEnabled);
}

async function listUsherAssignments(usherUserId) {
  const usher = await getUsherDocForUser(usherUserId);
  if (!usher) {
    const err = new Error("Usher profile not found");
    err.statusCode = 404;
    throw err;
  }

  const user = await User.findById(usherUserId).select("mustChangePassword").lean();
  const rows = await UsherGateAssignment.find({ usherUserId }).lean();
  if (!rows.length) {
    return {
      usher: { Name: usher.Name, Email: usher.Email },
      mustChangePassword: Boolean(user?.mustChangePassword),
      assignments: [],
    };
  }

  const eventIds = [...new Set(rows.map((r) => r.EventID))];
  const [events, gates] = await Promise.all([
    Event.find({ EventID: { $in: eventIds } })
      .select("EventID Name _id entryGatingEnabled Status usherManualFallbackEnabled StartDate EndDate")
      .lean(),
    EntryGate.find({ EventID: { $in: eventIds } }).lean(),
  ]);
  const eventMap = Object.fromEntries(events.map((e) => [e.EventID, e]));
  const gateLabels = Object.fromEntries(
    gates.map((g) => [`${g.EventID}:${g.gateIndex}`, g.label || `Gate ${g.gateIndex}`]),
  );

  const assignments = rows
    .map((r) => {
      const ev = eventMap[r.EventID];
      if (!ev || !activeEventFilter(ev)) return null;
      return {
        EventID: r.EventID,
        eventMongoId: ev?._id ? String(ev._id) : null,
        eventName: ev?.Name ?? "Event",
        gateIndex: r.gateIndex,
        gateLabel: gateLabels[`${r.EventID}:${r.gateIndex}`] || `Gate ${r.gateIndex}`,
        entryGatingEnabled: Boolean(ev?.entryGatingEnabled),
        manualFallbackEnabled: Boolean(ev?.usherManualFallbackEnabled),
        shiftStart: r.shiftStart ?? null,
        shiftEnd: r.shiftEnd ?? null,
      };
    })
    .filter(Boolean);

  return {
    usher: { Name: usher.Name, Email: usher.Email },
    mustChangePassword: Boolean(user?.mustChangePassword),
    assignments,
  };
}

async function listUsherActivity(organizerUserId, { eventIdNum, limit = 50 }) {
  const events = await Event.find({ organizer: organizerUserId }).select("EventID Name _id").lean();
  let eventIds = events.map((e) => e.EventID);
  if (eventIdNum != null && Number.isFinite(Number(eventIdNum))) {
    eventIds = eventIds.filter((id) => id === Number(eventIdNum));
  }
  if (!eventIds.length) return { items: [] };

  const links = await UsherOrganizerLink.find({ organizerId: organizerUserId }).select("usherUserId").lean();
  const usherIds = links.map((l) => l.usherUserId);

  const items = await EntryAuditLog.find({
    EventID: { $in: eventIds },
    action: { $in: ["verify_face_usher", "verify_manual_usher"] },
    ...(usherIds.length ? { actorUserId: { $in: usherIds } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();

  const usherUsers = usherIds.length
    ? await Usher.find({ userId: { $in: usherIds } }).select("userId Name Email").lean()
    : [];
  const usherMap = Object.fromEntries(usherUsers.map((u) => [String(u.userId), u]));
  const eventMap = Object.fromEntries(events.map((e) => [e.EventID, e]));

  return {
    items: items.map((row) => ({
      id: String(row._id),
      EventID: row.EventID,
      eventName: eventMap[row.EventID]?.Name ?? null,
      usherName: usherMap[String(row.actorUserId)]?.Name ?? null,
      usherEmail: usherMap[String(row.actorUserId)]?.Email ?? null,
      action: row.action,
      success: row.success,
      reason: row.reason,
      ticketId: row.ticketId,
      gateIndex: row.gateIndex,
      createdAt: row.createdAt,
    })),
  };
}

async function bulkProvisionUshers(organizerUserId, rows, sendCredentialsEmail = true) {
  const results = [];
  for (const row of rows) {
    try {
      const eventIdNum = Number(row.EventID || row.eventId);
      const provision = await provisionUsherAccount({
        Name: row.Name || row.name,
        Email: row.Email || row.email,
        Phone: row.Phone || row.phone,
        Age: row.Age ?? row.age,
        organizerUserId,
        sendCredentialsEmail,
      });
      const gateIndexes =
        row.gateIndexes ||
        String(row.gates || "")
          .split(/[;,]/)
          .map((g) => Number(g.trim()))
          .filter((g) => g >= 1);
      if (Number.isFinite(eventIdNum) && gateIndexes.length) {
        await setUsherGateAssignments(organizerUserId, "organizer", provision.user.id, eventIdNum, {
          gateIndexes,
          shiftStart: row.shiftStart,
          shiftEnd: row.shiftEnd,
        });
      }
      results.push({ ok: true, email: provision.user.email, createdNewAccount: provision.createdNewAccount });
    } catch (e) {
      results.push({ ok: false, email: row.Email || row.email, error: e.message });
    }
  }
  return { results, created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

async function resendUsherCredentials(organizerUserId, usherUserId) {
  const owns = await organizerOwnsUsher(organizerUserId, usherUserId);
  if (!owns) {
    const err = new Error("Usher not found");
    err.statusCode = 404;
    throw err;
  }

  const user = await User.findById(usherUserId);
  if (!user || user.role !== "usher") {
    const err = new Error("Usher account not found");
    err.statusCode = 404;
    throw err;
  }

  const usher = await Usher.findOne({ userId: usherUserId }).lean();
  const tempPassword = generateTempPassword();
  user.Password = await bcrypt.hash(tempPassword, 10);
  user.mustChangePassword = true;
  await user.save();

  let emailSent = false;
  if (emailService.isEmailConfigured()) {
    const mail = await emailService.sendUsherCredentials(user.Email, {
      name: usher?.Name || user.FirstName || "Usher",
      email: user.Email,
      temporaryPassword: tempPassword,
    });
    emailSent = mail.success === true;
  }

  return {
    credentials: { email: user.Email, username: user.Username, temporaryPassword: tempPassword },
    emailSent,
  };
}

function parseBulkCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const gatesRaw = cols[idx("gates")] || cols[idx("gateindexes")] || "";
    return {
      Name: cols[idx("name")] || cols[0],
      Email: cols[idx("email")] || cols[1],
      Phone: cols[idx("phone")] || cols[2] || "",
      Age: cols[idx("age")] ? Number(cols[idx("age")]) : undefined,
      EventID: Number(cols[idx("eventid")] || cols[idx("event_id")] || cols[4]),
      gateIndexes: gatesRaw
        ? gatesRaw.split(/[|;]/).map((g) => Number(g.trim())).filter((g) => g >= 1)
        : [],
      shiftStart: cols[idx("shiftstart")] || cols[idx("shift_start")] || null,
      shiftEnd: cols[idx("shiftend")] || cols[idx("shift_end")] || null,
    };
  });
}

module.exports = {
  provisionUsherAccount,
  setUsherGateAssignments,
  deactivateUsherForOrganizer,
  listOrganizerUshers,
  listUsherAssignments,
  listUsherActivity,
  bulkProvisionUshers,
  parseBulkCsv,
  resendUsherCredentials,
  getUsherDocForUser,
};
