const mongoose = require("mongoose");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const EntryGate = require("../models/EntryGate");
const EntrySlot = require("../models/EntrySlot");
const EntryAssignment = require("../models/EntryAssignment");
const TicketFriendLink = require("../models/TicketFriendLink");
const Booking = require("../models/Booking");
const BookingDetail = require("../models/BookingDetail");
const svc = require("../services/entryAssignmentService");
const { notifyUsersAfterAssignment } = require("../services/entryAssignmentNotifications");
const audit = require("../services/entryAuditService");
const EntryAuditLog = require("../models/EntryAuditLog");

async function resolveEvent(mongoId) {
  const event = await Event.findById(mongoId).lean();
  if (!event) return null;
  return event;
}

function uid(req) {
  const id = req.user?.id;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
}

/** All entry assignments for the logged-in user (across events). */
exports.myAssignmentsAll = async (req, res) => {
  try {
    const userId = uid(req);
    const rows = await EntryAssignment.find({ userId, status: { $ne: "void" } })
      .sort({ windowStart: 1 })
      .lean();
    const eventIds = [...new Set(rows.map((r) => r.EventID))];
    const events = await Event.find({ EventID: { $in: eventIds } })
      .select("EventID Name StartDate EndDate Status")
      .lean();
    const evMap = Object.fromEntries(events.map((e) => [e.EventID, e]));
    const out = await Promise.all(
      rows.map(async (r) => {
        const groupTicketIds = await svc.getLinkedComponentTicketIds(r.EventID, r.TicketID);
        return {
          ...r,
          event: evMap[r.EventID] || null,
          eventMongoId: events.find((e) => e.EventID === r.EventID)?._id?.toString(),
          groupTicketIds,
          linkedTicketIds: groupTicketIds.filter((id) => id !== r.TicketID),
        };
      })
    );
    return res.json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Tickets the user owns for entry-gated events but has no gate assignment yet. */
exports.myGatingPending = async (req, res) => {
  try {
    const userId = uid(req);
    const tickets = await Ticket.find({ OwnerUserId: userId, IsAvailable: false })
      .select("TicketID EventID")
      .lean();
    if (!tickets.length) return res.json({ pending: [] });

    const eventIds = [...new Set(tickets.map((t) => t.EventID))];
    const events = await Event.find({ EventID: { $in: eventIds } })
      .select("EventID Name entryGatingEnabled")
      .lean();

    const myTicketIds = tickets.map((t) => t.TicketID);
    const assigned = await EntryAssignment.find({
      userId,
      TicketID: { $in: myTicketIds },
      status: { $ne: "void" },
    })
      .select("TicketID")
      .lean();
    const assignedSet = new Set(assigned.map((a) => a.TicketID));

    const pending = [];
    for (const ev of events) {
      const unassigned = tickets.filter((t) => t.EventID === ev.EventID && !assignedSet.has(t.TicketID));
      if (!unassigned.length) continue;

      const hasInfra = await EntryGate.exists({ EventID: ev.EventID });
      if (!ev.entryGatingEnabled && !hasInfra) continue;

      const full = await Event.findOne({ EventID: ev.EventID }).select("_id").lean();
      pending.push({
        eventMongoId: full?._id?.toString() || null,
        eventName: ev.Name,
        eventId: ev.EventID,
        ticketIds: unassigned.map((t) => t.TicketID),
        reason: hasInfra ? "awaiting_assignment" : "not_configured",
      });
    }
    return res.json({ pending });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Assign gate/slot for the caller's unassigned tickets on one event (after purchase or if assign was missed). */
exports.syncMyEntry = async (req, res) => {
  try {
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const userId = uid(req);
    const myTickets = await Ticket.find({
      EventID: event.EventID,
      OwnerUserId: userId,
      IsAvailable: false,
    })
      .select("TicketID")
      .lean();
    const ticketIds = myTickets.map((t) => t.TicketID);
    if (!ticketIds.length) {
      return res.json({ assigned: 0, message: "No tickets for this event", ticketIds: [] });
    }

    const hasInfra = await EntryGate.exists({ EventID: event.EventID });
    if (!hasInfra) {
      return res.status(400).json({
        message: "Entry gates are not set up for this event yet. Ask the organizer to run crowd entry setup.",
        code: "NOT_CONFIGURED",
      });
    }

    const result = await svc.runAssignment(event.EventID, false, { onlyTicketIds: ticketIds });
    if (result.ticketIds?.length) {
      setImmediate(() => {
        notifyUsersAfterAssignment(String(event._id), event.EventID, result.ticketIds, {
          kind: "assigned",
        }).catch((err) => console.warn("Entry notify after sync:", err.message));
      });
    }
    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(400).json({ message: e.message || "Could not assign entry slot" });
  }
};

/** Gates + slots + per-gate assignment counts (organizer/admin). */
exports.getOrganizerBoard = async (req, res) => {
  try {
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const eid = event.EventID;
    const [gates, slots, agg] = await Promise.all([
      EntryGate.find({ EventID: eid }).sort({ gateIndex: 1 }).lean(),
      EntrySlot.find({ EventID: eid }).sort({ slotIndex: 1 }).lean(),
      EntryAssignment.aggregate([
        { $match: { EventID: eid, status: { $ne: "void" } } },
        { $group: { _id: "$gateIndex", assigned: { $sum: 1 }, used: { $sum: { $cond: [{ $eq: ["$status", "used"] }, 1, 0] } } } },
      ]),
    ]);
    const byGate = Object.fromEntries(agg.map((a) => [a._id, { assigned: a.assigned, used: a.used || 0 }]));
    return res.json({ gates, slots, perGate: byGate, eventId: eid });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.setup = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const meta = await svc.setupInfrastructure(event.EventID, event.StartDate, req.body || {});
    event.entryGatingEnabled = true;
    await event.save();
    return res.json({ ok: true, meta });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: e.message || "Internal server error" });
  }
};

exports.assignRun = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const replaceAll = Boolean(req.body?.replaceAll);
    const result = await svc.runAssignment(event.EventID, replaceAll);
    await audit.log({
      req,
      eventId: event.EventID,
      action: "assign",
      success: true,
      meta: {
        assigned: result.assigned,
        groups: result.groups,
        replaceAll,
        ticketIds: result.ticketIds || [],
      },
    });
    if (result.ticketIds?.length) {
      setImmediate(() =>
        notifyUsersAfterAssignment(String(event._id), event.EventID, result.ticketIds, { kind: "assigned" })
      );
    }
    return res.json(result);
  } catch (e) {
    console.error(e);
    try {
      const ev = await Event.findById(req.params.eventId).lean();
      if (ev) {
        await audit.log({
          req,
          eventId: ev.EventID,
          action: "assign",
          success: false,
          reason: e.message || "Assign failed",
          meta: { replaceAll: Boolean(req.body?.replaceAll) },
        });
      }
    } catch (_) {}
    return res.status(400).json({ message: e.message || "Assign failed" });
  }
};

exports.linkFriend = async (req, res) => {
  try {
    const userId = uid(req);
    const { myTicketId, friendTicketId, friendTicketIds } = req.body || {};
    const a = Number(myTicketId);
    if (!a) return res.status(400).json({ message: "myTicketId required" });
    const ids = Array.isArray(friendTicketIds)
      ? friendTicketIds
      : friendTicketId != null
        ? [friendTicketId]
        : [];
    if (!ids.length) {
      return res.status(400).json({ message: "friendTicketId or friendTicketIds required" });
    }

    const tMine = await Ticket.findOne({ TicketID: a }).lean();
    if (!tMine) return res.status(404).json({ message: "Ticket not found" });
    const event = await Event.findOne({ EventID: tMine.EventID }).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    const out = await svc.linkFriendsToCluster(event.EventID, a, ids, userId);

    if (out.cluster?.length && event._id) {
      setImmediate(() =>
        notifyUsersAfterAssignment(String(event._id), event.EventID, out.cluster, { kind: "assigned" })
      );
    }

    return res.json({
      ok: true,
      message: out.message,
      linked: out.linked,
      realign: {
        realigned: out.realigned,
        gateIndex: out.gateIndex,
        slotIndex: out.slotIndex,
        windowStart: out.windowStart,
        windowEnd: out.windowEnd,
        message: out.message,
      },
      gateIndex: out.gateIndex,
      slotIndex: out.slotIndex,
      windowStart: out.windowStart,
      windowEnd: out.windowEnd,
      cluster: out.cluster,
    });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ message: e.message || "Could not link friends" });
  }
};

exports.regenerate = async (req, res) => {
  try {
    const userId = uid(req);
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const ticketId = Number(req.body?.ticketId);
    if (!ticketId) return res.status(400).json({ message: "ticketId required" });
    const out = await svc.regenerateCluster(event.EventID, ticketId, userId);
    await audit.log({
      req,
      eventId: event.EventID,
      action: "regenerate",
      success: true,
      ticketId,
      meta: {
        cluster: out.cluster,
        gateIndex: out.gateIndex,
        slotIndex: out.slotIndex,
        previousGateIndex: out.previousGateIndex,
        previousSlotIndex: out.previousSlotIndex,
        changed: out.changed,
      },
    });
    if (out.cluster?.length && event._id) {
      setImmediate(() =>
        notifyUsersAfterAssignment(String(event._id), event.EventID, out.cluster, { kind: "regenerated" })
      );
    }
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error(e);
    try {
      const ev = await resolveEvent(req.params.eventId);
      if (ev) {
        await audit.log({
          req,
          eventId: ev.EventID,
          action: "regenerate",
          success: false,
          ticketId: Number(req.body?.ticketId) || null,
          reason: e.message || "Regenerate failed",
        });
      }
    } catch (_) {}
    return res.status(400).json({ message: e.message || "Regenerate failed" });
  }
};

exports.organizerRedirect = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { ticketIds, toGateIndex, toSlotIndex } = req.body || {};
    if (!Array.isArray(ticketIds) || !ticketIds.length || !Number(toGateIndex)) {
      return res.status(400).json({ message: "ticketIds (array) and toGateIndex required" });
    }
    const out = await svc.organizerRedirect(
      event.EventID,
      ticketIds.map(Number),
      Number(toGateIndex),
      toSlotIndex != null ? Number(toSlotIndex) : null
    );
    await audit.log({
      req,
      eventId: event.EventID,
      action: "redirect",
      success: true,
      gateIndex: Number(toGateIndex),
      meta: {
        ticketIds: ticketIds.map(Number),
        toSlotIndex: toSlotIndex != null ? Number(toSlotIndex) : null,
        updated: out.updated,
      },
    });
    return res.json(out);
  } catch (e) {
    console.error(e);
    try {
      const ev = await Event.findById(req.params.eventId).lean();
      if (ev) {
        await audit.log({
          req,
          eventId: ev.EventID,
          action: "redirect",
          success: false,
          gateIndex: req.body?.toGateIndex != null ? Number(req.body.toGateIndex) : null,
          reason: e.message || "Redirect failed",
        });
      }
    } catch (_) {}
    return res.status(400).json({ message: e.message || "Redirect failed" });
  }
};

exports.setGateJam = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const gateIndex = Number(req.params.gateIndex);
    const jamScore = Math.min(100, Math.max(0, Number(req.body?.jamScore)));
    if (Number.isNaN(jamScore)) return res.status(400).json({ message: "jamScore 0-100" });
    await EntryGate.updateOne({ EventID: event.EventID, gateIndex }, { $set: { jamScore } });
    await audit.log({
      req,
      eventId: event.EventID,
      action: "jam",
      success: true,
      gateIndex,
      meta: { jamScore },
    });
    return res.json({ ok: true, gateIndex, jamScore });
  } catch (e) {
    console.error(e);
    try {
      const ev = await Event.findById(req.params.eventId).lean();
      if (ev) {
        await audit.log({
          req,
          eventId: ev.EventID,
          action: "jam",
          success: false,
          gateIndex: Number(req.params.gateIndex),
          reason: e.message || "Jam update failed",
        });
      }
    } catch (_) {}
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.verifyGate = async (req, res) => {
  const gateIndex = Number(req.params.gateIndex);
  let eventIdForAudit = null;
  let ticketIdNum = null;
  try {
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    eventIdForAudit = event.EventID;
    ticketIdNum = Number(req.body?.ticketId);
    if (!ticketIdNum) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual",
        success: false,
        reason: "ticketId required",
        gateIndex,
        meta: { strictFace: Boolean(req.body?.strictFace) },
      });
      return res.status(400).json({ message: "ticketId required" });
    }

    const strictFace = Boolean(req.body?.strictFace);
    const ticket = await Ticket.findOne({ TicketID: ticketIdNum, EventID: event.EventID }).lean();
    if (!ticket || !ticket.OwnerUserId) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual",
        success: false,
        reason: "Ticket not found",
        ticketId: ticketIdNum,
        gateIndex,
      });
      return res.status(404).json({ message: "Ticket not found" });
    }
    const owner = await User.findById(ticket.OwnerUserId).select("faceIdReference NationalID").lean();
    if (strictFace && !owner?.faceIdReference) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual",
        success: false,
        reason: "Attendee has not completed Face ID enrollment",
        ticketId: ticketIdNum,
        gateIndex,
        meta: { strictFace: true },
      });
      return res.status(403).json({ message: "Attendee has not completed Face ID enrollment" });
    }
    if (req.body?.nationalId && owner?.NationalID && String(req.body.nationalId).replace(/\s/g, "") !== owner.NationalID) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual",
        success: false,
        reason: "National ID does not match ticket holder",
        ticketId: ticketIdNum,
        gateIndex,
      });
      return res.status(403).json({ message: "National ID does not match ticket holder" });
    }

    const result = await svc.verifyAtGate(event.EventID, gateIndex, ticketIdNum);
    await audit.log({
      req,
      eventId: eventIdForAudit,
      action: "verify_manual",
      success: true,
      ticketId: ticketIdNum,
      gateIndex,
      meta: { usedAt: result.usedAt },
    });
    return res.json({ ...result, holderNationalIdSuffix: owner?.NationalID ? String(owner.NationalID).slice(-4) : undefined });
  } catch (e) {
    if (e.message === "ENTRY_ALREADY_USED") {
      if (eventIdForAudit != null) {
        await audit.log({
          req,
          eventId: eventIdForAudit,
          action: "verify_manual",
          success: false,
          reason: "ENTRY_ALREADY_USED",
          ticketId: e.ticketId ?? ticketIdNum,
          gateIndex: e.gateIndex ?? gateIndex,
          meta: { usedAt: e.usedAt },
        });
      }
      return res.json({
        ok: true,
        ticketId: e.ticketId,
        gateIndex: e.gateIndex,
        alreadyEntered: true,
        usedAt: e.usedAt,
      });
    }
    console.error(e);
    if (eventIdForAudit != null) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_manual",
        success: false,
        reason: e.message || "Verify failed",
        ticketId: ticketIdNum,
        gateIndex,
      });
    }
    return res.status(400).json({ message: e.message || "Verify failed" });
  }
};

/** Organizer: find attendee by ticket ID, booking QR, or phone (+ optional name) for gate check-in. */
exports.lookupAttendee = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const eid = event.EventID;
    const { bookingCode, ticketId, phone, firstName, lastName } = req.body || {};

    let eventTicketIds = [];

    if (ticketId) {
      const t = await Ticket.findOne({ TicketID: Number(ticketId), EventID: eid }).lean();
      if (!t?.OwnerUserId) return res.status(404).json({ message: "Ticket not found for this event" });
      eventTicketIds = [t.TicketID];
    } else if (bookingCode && String(bookingCode).trim()) {
      const m = String(bookingCode).trim().match(/^FLOWTIC-B-(\d+)$/i);
      if (!m) {
        return res.status(400).json({ message: "Invalid booking QR. Expected FLOWTIC-B-{BookingID}" });
      }
      const bookingId = parseInt(m[1], 10);
      const booking = await Booking.findOne({ BookingID: bookingId }).lean();
      if (!booking) return res.status(404).json({ message: "Booking not found" });
      if (booking.Status !== "Confirmed") {
        return res.status(400).json({ message: `Booking is ${booking.Status}` });
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
        return res.status(404).json({ message: "No tickets for this event on this booking" });
      }
      eventTicketIds = tickets.map((x) => x.TicketID);
    } else if (phone && String(phone).trim()) {
      const digits = String(phone).replace(/\D/g, "");
      if (digits.length < 8) {
        return res.status(400).json({ message: "Enter a valid phone number (at least 8 digits)" });
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
        return res.status(404).json({ message: "No account matches that phone (and name filter if provided)" });
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
        return res.status(404).json({ message: "No ticket for this event on matching account(s)" });
      }
      const uniqueOwners = new Set(tickets.map((t) => String(t.OwnerUserId)));
      if (uniqueOwners.size > 1 && !firstName && !lastName) {
        return res.status(400).json({
          message: "Multiple accounts match. Add first name and/or last name, or scan booking QR / ticket ID.",
        });
      }
      eventTicketIds = tickets.map((x) => x.TicketID);
    } else {
      return res.status(400).json({
        message: "Provide ticketId, bookingCode (FLOWTIC-B-…), or phone (optional firstName, lastName)",
      });
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

    return res.json({ holders, eventName: event.Name });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Organizer: mark entry after live face matches stored template (same gate/window rules as verify). */
exports.verifyWithFace = async (req, res) => {
  const gateIndex = Number(req.params.gateIndex);
  let eventIdForAudit = null;
  let ticketIdNum = null;
  try {
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    eventIdForAudit = event.EventID;
    ticketIdNum = Number(req.body?.ticketId);
    if (!ticketIdNum) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_face",
        success: false,
        reason: "ticketId required",
        gateIndex,
      });
      return res.status(400).json({ message: "ticketId required" });
    }

    const ticket = await Ticket.findOne({ TicketID: ticketIdNum, EventID: event.EventID }).lean();
    if (!ticket || !ticket.OwnerUserId) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_face",
        success: false,
        reason: "Ticket not found",
        ticketId: ticketIdNum,
        gateIndex,
      });
      return res.status(404).json({ message: "Ticket not found" });
    }
    const owner = await User.findById(ticket.OwnerUserId).select("NationalID").lean();
    if (req.body?.nationalId && owner?.NationalID && String(req.body.nationalId).replace(/\s/g, "") !== owner.NationalID) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_face",
        success: false,
        reason: "National ID does not match ticket holder",
        ticketId: ticketIdNum,
        gateIndex,
      });
      return res.status(403).json({ message: "National ID does not match ticket holder" });
    }

    const result = await svc.verifyAtGateWithFace(event.EventID, gateIndex, ticketIdNum, req.body);
    await audit.log({
      req,
      eventId: eventIdForAudit,
      action: "verify_face",
      success: true,
      ticketId: ticketIdNum,
      gateIndex,
      meta: { usedAt: result.usedAt, similarity: result.similarity, threshold: result.threshold },
    });
    return res.json({
      ...result,
      holderNationalIdSuffix: owner?.NationalID ? String(owner.NationalID).slice(-4) : undefined,
    });
  } catch (e) {
    if (e.message === "ENTRY_ALREADY_USED") {
      if (eventIdForAudit != null) {
        await audit.log({
          req,
          eventId: eventIdForAudit,
          action: "verify_face",
          success: false,
          reason: "ENTRY_ALREADY_USED",
          ticketId: e.ticketId ?? ticketIdNum,
          gateIndex: e.gateIndex ?? gateIndex,
          meta: { usedAt: e.usedAt },
        });
      }
      return res.json({
        ok: true,
        ticketId: e.ticketId,
        gateIndex: e.gateIndex,
        alreadyEntered: true,
        usedAt: e.usedAt,
        faceMatch: false,
      });
    }
    if (e.message === "FACE_MISMATCH") {
      if (eventIdForAudit != null) {
        await audit.log({
          req,
          eventId: eventIdForAudit,
          action: "verify_face",
          success: false,
          reason: "FACE_MISMATCH",
          ticketId: ticketIdNum,
          gateIndex,
          meta: { similarity: e.similarity, threshold: e.threshold },
        });
      }
      return res.status(403).json({
        message: "Face does not match enrolled template. Entry denied.",
        similarity: e.similarity,
        threshold: e.threshold,
      });
    }
    console.error(e);
    if (eventIdForAudit != null) {
      await audit.log({
        req,
        eventId: eventIdForAudit,
        action: "verify_face",
        success: false,
        reason: e.message || "Verify failed",
        ticketId: ticketIdNum,
        gateIndex,
      });
    }
    if (e.code === "FACE_DIMENSION_MISMATCH") {
      return res.status(400).json({
        message: e.message,
        code: e.code,
        storedDim: e.storedDim,
        probeDim: e.probeDim,
      });
    }
    return res.status(400).json({ message: e.message || "Verify failed" });
  }
};

/** Organizer/admin: recent immutable audit rows for this event (append-only log). */
exports.listEntryAudit = async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const items = await EntryAuditLog.find({ EventID: event.EventID })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ items, eventId: event.EventID });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error" });
  }
};
