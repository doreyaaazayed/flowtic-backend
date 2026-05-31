const Event = require("../models/Event");
const TicketCategory = require("../models/TicketCategory");
const Ticket = require("../models/Ticket");
const Seat = require("../models/Seat");
const EntryAssignment = require("../models/EntryAssignment");
const EntryGate = require("../models/EntryGate");
const EntrySlot = require("../models/EntrySlot");
const ResaleListing = require("../models/ResaleListing");
const Review = require("../models/Review");

/** Remove ticket/seat/entry data keyed by numeric EventID (no Event document required). */
async function purgeOrphanedDataForEventId(eventID) {
  const existing = await Event.findOne({ EventID: eventID }).select("_id").lean();
  if (existing) return;

  await Promise.all([
    TicketCategory.deleteMany({ EventID: eventID }),
    Ticket.deleteMany({ EventID: eventID }),
    Seat.deleteMany({ EventID: eventID }),
    EntryAssignment.deleteMany({ EventID: eventID }),
    EntryGate.deleteMany({ EventID: eventID }),
    EntrySlot.deleteMany({ EventID: eventID }),
    ResaleListing.deleteMany({ EventID: eventID }),
  ]);
}

/** Delete all data scoped to an event document (call before removing the Event row). */
async function purgeEventDocumentData(eventDoc) {
  const eventID = eventDoc.EventID;
  const mongoId = eventDoc._id;

  await Promise.all([
    TicketCategory.deleteMany({
      $or: [{ eventRef: mongoId }, { EventID: eventID }],
    }),
    Ticket.deleteMany({ EventID: eventID }),
    Seat.deleteMany({ EventID: eventID }),
    EntryAssignment.deleteMany({ EventID: eventID }),
    EntryGate.deleteMany({ EventID: eventID }),
    EntrySlot.deleteMany({ EventID: eventID }),
    ResaleListing.deleteMany({ EventID: eventID }),
    Review.deleteMany({ eventId: mongoId }),
  ]);
}

/**
 * Ticket categories that belong to this event document — not leftovers from a
 * deleted event that reused the same numeric EventID.
 */
function filterCategoriesForEvent(eventId, eventCreatedAt, categories) {
  const created = eventCreatedAt ? new Date(eventCreatedAt) : null;
  return categories.filter((cat) => {
    if (cat.eventRef) return String(cat.eventRef) === String(eventId);
    if (created) return cat._id.getTimestamp() >= created;
    return true;
  });
}

module.exports = {
  purgeOrphanedDataForEventId,
  purgeEventDocumentData,
  filterCategoriesForEvent,
};
