const mongoose = require("mongoose");
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");

// List tickets (auth). Query: eventId (Mongo _id), eventID (number), isAvailable, ticketCatId
exports.list = async (req, res) => {
  try {
    const { eventId, eventID, isAvailable, ticketCatId } = req.query;
    const filter = {};
    const eid = eventId || eventID;
    if (eid) {
      const num = Number(eid);
      if (Number.isInteger(num) && !Number.isNaN(num)) {
        filter.EventID = num;
      } else if (mongoose.Types.ObjectId.isValid(eid) && String(eid).length === 24) {
        const event = await Event.findById(eid).select("EventID").lean();
        if (event) filter.EventID = event.EventID;
      }
    }
    if (isAvailable !== undefined) filter.IsAvailable = isAvailable === "true" || isAvailable === true;
    if (ticketCatId !== undefined) filter.TicketCatID = Number(ticketCatId);
    const tickets = await Ticket.find(filter).sort({ TicketID: 1 }).lean();
    return res.json(tickets);
  } catch (err) {
    console.error("List tickets error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one ticket by Mongo _id (auth)
exports.getById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id).lean();
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    return res.json(ticket);
  } catch (err) {
    console.error("Get ticket error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Create one ticket (admin/organizer). Body: EventID, TicketCatID, SeatID (optional)
exports.create = async (req, res) => {
  try {
    const { EventID, TicketCatID, SeatID } = req.body || {};
    const eventIdNum = Number(EventID);
    const catIdNum = Number(TicketCatID);
    if (
      EventID == null ||
      TicketCatID == null ||
      !Number.isInteger(eventIdNum) ||
      eventIdNum < 0 ||
      !Number.isInteger(catIdNum) ||
      catIdNum < 0
    ) {
      return res.status(400).json({ message: "EventID and TicketCatID are required positive integers" });
    }
    const last = await Ticket.findOne().sort({ TicketID: -1 }).lean();
    const nextId = Number(last?.TicketID ?? 0) + 1;
    if (!Number.isInteger(nextId) || nextId < 1) {
      return res.status(500).json({ message: "Failed to generate ticket ID" });
    }
    const doc = {
      TicketID: nextId,
      EventID: eventIdNum,
      TicketCatID: catIdNum,
      IsAvailable: true,
    };
    if (SeatID != null && SeatID !== "") doc.SeatID = Number(SeatID);
    const ticket = await Ticket.create(doc);
    return res.status(201).json(ticket);
  } catch (err) {
    console.error("Create ticket error:", err);
    if (err.name === "ValidationError") {
      const details = err.errors ? Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v?.message])) : {};
      return res.status(400).json({
        message: err.message || "Validation failed",
        ...(process.env.NODE_ENV !== "production" && { details }),
      });
    }
    if (err.code === 11000) {
      return res.status(409).json({ message: "Duplicate ticket ID" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update ticket (admin only). Allowed: IsAvailable, OwnerUserId, SeatID
exports.update = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    const { IsAvailable, OwnerUserId, SeatID } = req.body || {};
    if (IsAvailable !== undefined) ticket.IsAvailable = Boolean(IsAvailable);
    if (OwnerUserId !== undefined) ticket.OwnerUserId = OwnerUserId || null;
    if (SeatID !== undefined) ticket.SeatID = SeatID === null || SeatID === "" ? null : Number(SeatID);
    await ticket.save();
    return res.json(ticket);
  } catch (err) {
    console.error("Update ticket error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete ticket (admin only). Allowed only when IsAvailable (no owner). Removes any Listed resale listing for this ticket.
exports.remove = async (req, res) => {
  try {
    const ResaleListing = require("../models/ResaleListing");
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    if (!ticket.IsAvailable || ticket.OwnerUserId) {
      return res.status(400).json({ message: "Cannot delete ticket that is owned. Ticket must be available." });
    }
    await ResaleListing.deleteMany({ TicketID: ticket.TicketID, status: "Listed" });
    await Ticket.findByIdAndDelete(req.params.id);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete ticket error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
