const mongoose = require("mongoose");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const Seat = require("../models/Seat");
const Booking = require("../models/Booking");
const BookingDetail = require("../models/BookingDetail");

const ACCESS_DENIED =
  "You need a ticket before ordering food or beverages.";

function toObjectId(id) {
  if (!id) return null;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
}

async function resolveEvent(eventIdParam) {
  if (!eventIdParam) return null;
  const byMongo = await Event.findById(eventIdParam).lean();
  if (byMongo) return byMongo;
  const num = Number(eventIdParam);
  if (!Number.isNaN(num)) {
    return Event.findOne({ EventID: num }).lean();
  }
  return null;
}

/**
 * User owns at least one sold ticket for this event (same rule as ticket-gated F&B).
 */
async function userHasTicketForEvent(userId, event) {
  const userIdObj = toObjectId(userId);
  const owned = await Ticket.countDocuments({
    EventID: event.EventID,
    OwnerUserId: userIdObj,
    IsAvailable: false,
  });
  return owned > 0;
}

async function assertFoodAccess(userId, event) {
  const hasTicket = await userHasTicketForEvent(userId, event);
  if (!hasTicket) {
    const err = new Error(ACCESS_DENIED);
    err.statusCode = 403;
    err.code = "FOOD_ACCESS_DENIED";
    throw err;
  }
  return true;
}

/** Latest confirmed booking for event (for seat label on delivery). */
async function getUserBookingContext(userId, event) {
  const userIdObj = toObjectId(userId);
  const tickets = await Ticket.find({
    EventID: event.EventID,
    OwnerUserId: userIdObj,
    IsAvailable: false,
  })
    .limit(1)
    .lean();
  if (!tickets.length) return { hasTicket: false };

  const detail = await BookingDetail.findOne({ TicketID: tickets[0].TicketID }).lean();
  if (!detail) return { hasTicket: true, bookingId: null };

  const booking = await Booking.findOne({
    BookingID: detail.BookingID,
    userId: userIdObj,
    Status: { $in: ["Confirmed", "Pending"] },
  }).lean();

  return {
    hasTicket: true,
    bookingId: booking?.BookingID ?? null,
    bookingMongoId: booking?._id?.toString(),
  };
}

/**
 * Seat delivery is only available when the event is seated and the user's ticket
 * is tied to a real seat (SeatID on ticket + seat map row).
 */
async function getSeatDeliveryContext(userId, event) {
  const base = {
    eventIsSeated: Boolean(event?.isSeated),
    canDeliverToSeat: false,
    seatLabel: null,
    seatId: null,
  };
  if (!event?.isSeated) return base;

  const userIdObj = toObjectId(userId);
  const tickets = await Ticket.find({
    EventID: event.EventID,
    OwnerUserId: userIdObj,
    IsAvailable: false,
    SeatID: { $ne: null, $gt: 0 },
  })
    .limit(20)
    .lean();

  if (!tickets.length) return { ...base, eventIsSeated: true };

  const seatIds = [...new Set(tickets.map((t) => t.SeatID).filter(Boolean))];
  const seatDocs = await Seat.find({
    EventID: event.EventID,
    SeatID: { $in: seatIds },
  }).lean();
  const seatById = Object.fromEntries(seatDocs.map((s) => [s.SeatID, s]));

  for (const t of tickets) {
    const s = seatById[t.SeatID];
    if (s) {
      return {
        eventIsSeated: true,
        canDeliverToSeat: true,
        seatLabel: `${s.SectionName} - Row ${s.RowLabel} - Seat ${s.SeatNumber}`,
        seatId: s.SeatID,
      };
    }
  }

  return { ...base, eventIsSeated: true };
}

function filterDeliveryMethodsForSeat(methods, canDeliverToSeat) {
  if (canDeliverToSeat) return methods;
  return methods.filter((m) => String(m.code).toLowerCase() !== "seat_delivery");
}

module.exports = {
  ACCESS_DENIED,
  resolveEvent,
  userHasTicketForEvent,
  assertFoodAccess,
  getUserBookingContext,
  getSeatDeliveryContext,
  filterDeliveryMethodsForSeat,
  toObjectId,
};
