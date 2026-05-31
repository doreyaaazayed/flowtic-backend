const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const Booking = require("../models/Booking");
const BookingDetail = require("../models/BookingDetail");
const EntryAssignment = require("../models/EntryAssignment");
const svc = require("../services/entryAssignmentService");
const audit = require("../services/entryAuditService");
const { listUsherAssignments } = require("../services/usherProvisionService");
const {
  assertUsherGateAccess,
  assertEventOpenForUsher,
  getGateBoard,
} = require("../services/usherService");

async function resolveEvent(mongoId) {
  return Event.findById(mongoId).lean();
}

async function lookupAttendeesForEvent(event, body) {
  const eid = event.EventID;
  const { bookingCode, ticketId, phone, firstName, lastName } = body || {};

  let eventTicketIds = [];

  if (ticketId) {
    const t = await Ticket.findOne({ TicketID: Number(ticketId), EventID: eid }).lean();
    if (!t?.OwnerUserId) {
      const err = new Error("Ticket not found for this event");
      err.statusCode = 404;
      throw err;
    }
    eventTicketIds = [t.TicketID];
  } else if (bookingCode && String(bookingCode).trim()) {
    const m = String(bookingCode).trim().match(/^FLOWTIC-B-(\d+)$/i);
    if (!m) {
      const err = new Error("Invalid booking QR. Expected FLOWTIC-B-{BookingID}");
      err.statusCode = 400;
      throw err;
    }
    const bookingId = parseInt(m[1], 10);
    const booking = await Booking.findOne({ BookingID: bookingId }).lean();
    if (!booking) {
      const err = new Error("Booking not found");
      err.statusCode = 404;
      throw err;
    }
    if (booking.Status !== "Confirmed") {
      const err = new Error(`Booking is ${booking.Status}`);
      err.statusCode = 400;
      throw err;
    }
    const details = await BookingDetail.find({ BookingID: bookingId }).lean();
    const tids = details.map((d) => d.TicketID);
    const tickets = await Ticket.find({
      TicketID: { $in: tids },
      EventID: eid,
      IsAvailable: false,
      OwnerUserId: { $exists: true, $ne: null },
    })
      .select("TicketID OwnerUserId")
      .lean();
    if (!tickets.length) {
      const err = new Error("No tickets for this event on this booking");
      err.statusCode = 404;
      throw err;
    }
    eventTicketIds = tickets.map((x) => x.TicketID);
  } else if (phone && String(phone).trim()) {
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length < 8) {
      const err = new Error("Enter a valid phone number (at least 8 digits)");
      err.statusCode = 400;
      throw err;
    }
    const tail = digits.slice(-10);
    const users = await User.find({
      Phone: { $exists: true, $nin: [null, ""] },
      $or: [
        { Phone: { $regex: tail, $options: "i" } },
        { Phone: { $regex: digits, $options: "i" } },
      ],
    })
      .select("_id FirstName LastName Username Phone Email faceIdReference")
      .lean();

    let filtered = users;
    if (firstName || lastName) {
      const fnq = String(firstName || "").toLowerCase().trim();
      const lnq = String(lastName || "").toLowerCase().trim();
      filtered = users.filter((u) => {
        const fn = (u.FirstName || "").toLowerCase();
        const ln = (u.LastName || "").toLowerCase();
        if (fnq && !fn.includes(fnq)) return false;
        if (lnq && !ln.includes(lnq)) return false;
        return true;
      });
    }
    if (!filtered.length) {
      const err = new Error("No account matches that phone (and name filter if provided)");
      err.statusCode = 404;
      throw err;
    }
    const ownerIds = filtered.map((u) => u._id);
    const tickets = await Ticket.find({
      EventID: eid,
      OwnerUserId: { $in: ownerIds },
      IsAvailable: false,
    })
      .select("TicketID OwnerUserId")
      .lean();
    if (!tickets.length) {
      const err = new Error("No ticket for this event on matching account(s)");
      err.statusCode = 404;
      throw err;
    }
    const uniqueOwners = new Set(tickets.map((t) => String(t.OwnerUserId)));
    if (uniqueOwners.size > 1 && !firstName && !lastName) {
      const err = new Error(
        "Multiple accounts match. Add first name and/or last name, or scan booking QR / ticket ID.",
      );
      err.statusCode = 400;
      throw err;
    }
    eventTicketIds = tickets.map((x) => x.TicketID);
  } else {
    const err = new Error(
      "Provide ticketId, bookingCode (FLOWTIC-B-…), or phone (optional firstName, lastName)",
    );
    err.statusCode = 400;
    throw err;
  }

  const uniqTids = [...new Set(eventTicketIds)];
  const byOwner = new Map();
  for (const tid of uniqTids) {
    const t = await Ticket.findOne({ TicketID: tid, EventID: eid }).lean();
    if (!t?.OwnerUserId) continue;
    const oid = String(t.OwnerUserId);
    if (!byOwner.has(oid)) byOwner.set(oid, []);
    byOwner.get(oid).push(tid);
  }

  const holders = [];
  for (const [ownerId, tids] of byOwner) {
    const user = await User.findById(ownerId)
      .select("FirstName LastName Username Phone Email faceIdReference")
      .lean();
    if (!user) continue;
    const ticketsOut = [];
    for (const tid of tids) {
      const assign = await EntryAssignment.findOne({ EventID: eid, TicketID: tid, status: { $ne: "void" } }).lean();
      ticketsOut.push({
        ticketId: tid,
        gateIndex: assign?.gateIndex ?? null,
        slotIndex: assign?.slotIndex ?? null,
        windowStart: assign?.windowStart ?? null,
        windowEnd: assign?.windowEnd ?? null,
        status: assign?.status ?? "unassigned",
      });
    }
    holders.push({
      userId: ownerId,
      firstName: user.FirstName,
      lastName: user.LastName,
      username: user.Username,
      phone: user.Phone,
      email: user.Email,
      faceEnrolled: Boolean(user.faceIdReference),
      tickets: ticketsOut,
    });
  }

  return { holders, eventName: event.Name };
}

/** GET /api/usher/assignments */
exports.myAssignments = async (req, res) => {
  try {
    const data = await listUsherAssignments(req.user.id);
    return res.json(data);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("usher myAssignments:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/usher/events/:eventId/entry/gates/:gateIndex/board */
exports.gateBoard = async (req, res) => {
  try {
    const gateIndex = Number(req.params.gateIndex);
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    assertEventOpenForUsher(event);
    await assertUsherGateAccess(req.user.id, event.EventID, gateIndex);

    const board = await getGateBoard(event, gateIndex, req.user.id);
    return res.json(board);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message, code: err.code });
    console.error("usher gateBoard:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/usher/events/:eventId/entry/gates/:gateIndex/lookup-attendee */
exports.lookupAttendee = async (req, res) => {
  try {
    const gateIndex = Number(req.params.gateIndex);
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    assertEventOpenForUsher(event);
    await assertUsherGateAccess(req.user.id, event.EventID, gateIndex);

    const result = await lookupAttendeesForEvent(event, req.body);
    return res.json({ ...result, gateIndex });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message, code: err.code });
    console.error("usher lookupAttendee:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/usher/events/:eventId/entry/gates/:gateIndex/verify-with-face */
exports.verifyWithFace = async (req, res) => {
  const gateIndex = Number(req.params.gateIndex);
  let eventIdForAudit = null;
  let ticketIdNum = null;
  try {
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    assertEventOpenForUsher(event);
    await assertUsherGateAccess(req.user.id, event.EventID, gateIndex);

    eventIdForAudit = event.EventID;
    ticketIdNum = Number(req.body?.ticketId);
    if (!ticketIdNum) {
      return res.status(400).json({ message: "ticketId required" });
    }

    const ticket = await Ticket.findOne({ TicketID: ticketIdNum, EventID: event.EventID }).lean();
    if (!ticket || !ticket.OwnerUserId) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const result = await svc.verifyAtGateWithFace(event.EventID, gateIndex, ticketIdNum, req.body);
    await audit.log({
      req,
      eventId: eventIdForAudit,
      action: "verify_face_usher",
      success: true,
      ticketId: ticketIdNum,
      gateIndex,
      meta: { usedAt: result.usedAt, similarity: result.similarity, threshold: result.threshold, usherId: req.user.id },
    });
    return res.json({ ...result, admitted: true });
  } catch (e) {
    if (e.message === "ENTRY_ALREADY_USED") {
      return res.json({
        ok: true,
        ticketId: e.ticketId ?? ticketIdNum,
        gateIndex: e.gateIndex ?? gateIndex,
        alreadyEntered: true,
        usedAt: e.usedAt,
        admitted: false,
      });
    }
    if (e.message === "FACE_MISMATCH") {
      return res.status(403).json({
        message: "Face does not match ticket holder",
        code: "FACE_MISMATCH",
        similarity: e.similarity,
        threshold: e.threshold,
        admitted: false,
      });
    }
    const isWrongGate = String(e.message || "").startsWith("Wrong gate:");
    if (eventIdForAudit != null) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_face_usher",
        success: false,
        reason: e.message || "Verify failed",
        ticketId: ticketIdNum,
        gateIndex,
      });
    }
    return res.status(isWrongGate ? 403 : e.statusCode || 400).json({
      message: e.message || "Verify failed",
      admitted: false,
      wrongGate: isWrongGate,
      code: e.code,
    });
  }
};

/** POST /api/usher/events/:eventId/entry/gates/:gateIndex/verify-manual */
exports.verifyManual = async (req, res) => {
  const gateIndex = Number(req.params.gateIndex);
  let eventIdForAudit = null;
  let ticketIdNum = null;
  try {
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    assertEventOpenForUsher(event);
    await assertUsherGateAccess(req.user.id, event.EventID, gateIndex);

    if (!event.usherManualFallbackEnabled) {
      return res.status(403).json({ message: "Manual admit is not enabled for this event", code: "MANUAL_DISABLED" });
    }

    eventIdForAudit = event.EventID;
    ticketIdNum = Number(req.body?.ticketId);
    const reason = String(req.body?.reason || "").trim();
    const pin = String(req.body?.pin || "").trim();

    if (!ticketIdNum) {
      return res.status(400).json({ message: "ticketId required" });
    }
    if (!reason || reason.length < 3) {
      return res.status(400).json({ message: "A reason is required for manual admit (min 3 characters)" });
    }

    const expectedPin = String(event.usherGateOverridePin || "").trim();
    if (expectedPin && pin !== expectedPin) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual_usher",
        success: false,
        reason: "Invalid override PIN",
        ticketId: ticketIdNum,
        gateIndex,
      });
      return res.status(403).json({ message: "Invalid override PIN", code: "INVALID_PIN" });
    }

    const ticket = await Ticket.findOne({ TicketID: ticketIdNum, EventID: event.EventID }).lean();
    if (!ticket || !ticket.OwnerUserId) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual_usher",
        success: false,
        reason: "Ticket not found",
        ticketId: ticketIdNum,
        gateIndex,
      });
      return res.status(404).json({ message: "Ticket not found" });
    }

    const result = await svc.verifyAtGate(event.EventID, gateIndex, ticketIdNum);
    await audit.log({
      req,
      eventId: eventIdForAudit,
      action: "verify_manual_usher",
      success: true,
      ticketId: ticketIdNum,
      gateIndex,
      meta: { usedAt: result.usedAt, reason, usherId: req.user.id, manual: true },
    });
    return res.json({ ...result, admitted: true, manual: true });
  } catch (e) {
    if (e.message === "ENTRY_ALREADY_USED") {
      return res.json({
        ok: true,
        ticketId: e.ticketId ?? ticketIdNum,
        gateIndex: e.gateIndex ?? gateIndex,
        alreadyEntered: true,
        usedAt: e.usedAt,
        admitted: false,
      });
    }
    const isWrongGate = String(e.message || "").startsWith("Wrong gate:");
    if (eventIdForAudit != null) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual_usher",
        success: false,
        reason: e.message || "Manual verify failed",
        ticketId: ticketIdNum,
        gateIndex,
        meta: { reason: req.body?.reason },
      });
    }
    return res.status(isWrongGate ? 403 : e.statusCode || 400).json({
      message: e.message || "Manual verify failed",
      admitted: false,
      wrongGate: isWrongGate,
      code: e.code,
    });
  }
};
