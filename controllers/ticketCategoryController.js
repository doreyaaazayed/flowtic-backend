const Event = require("../models/Event");
const TicketCategory = require("../models/TicketCategory");
const Ticket = require("../models/Ticket");
const { filterCategoriesForEvent } = require("../services/eventCleanupService");

// List ticket categories for an event (by event Mongo _id)
exports.listByEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId).select("EventID createdAt").lean();
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    const categories = await TicketCategory.find({ EventID: event.EventID })
      .sort({ TicketCatID: 1 })
      .lean();
    return res.json(filterCategoriesForEvent(eventId, event.createdAt, categories));
  } catch (err) {
    console.error("List ticket categories error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one ticket category by id (Mongo _id); must belong to the event
exports.getById = async (req, res) => {
  try {
    const { eventId, ticketCategoryId } = req.params;
    const event = await Event.findById(eventId).select("EventID").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    const category = await TicketCategory.findOne({
      _id: ticketCategoryId,
      EventID: event.EventID,
    }).lean();
    if (!category) return res.status(404).json({ message: "Ticket category not found" });
    return res.json(category);
  } catch (err) {
    console.error("Get ticket category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update ticket category (Name, Price, Description only; TotalQuantity change would affect tickets)
exports.update = async (req, res) => {
  try {
    const { eventId, ticketCategoryId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const category = await TicketCategory.findOne({
      _id: ticketCategoryId,
      EventID: event.EventID,
    });
    if (!category) return res.status(404).json({ message: "Ticket category not found" });
    const { Name, Price, Description } = req.body || {};
    if (Name !== undefined) category.Name = Name;
    if (Price !== undefined) category.Price = Number(Price);
    if (Description !== undefined) category.Description = Description;
    await category.save();
    return res.json(category);
  } catch (err) {
    console.error("Update ticket category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete ticket category only if no tickets are sold (all available); then delete category and those tickets
exports.remove = async (req, res) => {
  try {
    const { eventId, ticketCategoryId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const category = await TicketCategory.findOne({
      _id: ticketCategoryId,
      EventID: event.EventID,
    });
    if (!category) return res.status(404).json({ message: "Ticket category not found" });
    const soldCount = await Ticket.countDocuments({
      EventID: event.EventID,
      TicketCatID: category.TicketCatID,
      IsAvailable: false,
    });
    if (soldCount > 0) {
      return res.status(400).json({
        message: "Cannot delete category: some tickets are already sold",
      });
    }
    await Ticket.deleteMany({
      EventID: event.EventID,
      TicketCatID: category.TicketCatID,
    });
    await TicketCategory.findByIdAndDelete(ticketCategoryId);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete ticket category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Create ticket category for event + create that many tickets (organizer).
// For seated events (event.isSeated), TotalQuantity may be 0; tickets are created when seat map is created.
exports.create = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { Name, Price, TotalQuantity, Description } = req.body || {};
    if (!Name || Price == null || TotalQuantity == null || TotalQuantity < 0) {
      return res
        .status(400)
        .json({ message: "Name, Price, and TotalQuantity (>= 0) are required" });
    }
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    const qty = Number(TotalQuantity);
    if (!event.isSeated && qty < 1) {
      return res.status(400).json({ message: "TotalQuantity must be >= 1 for non-seated events" });
    }
    const nameKey = String(Name).trim().toLowerCase();
    const existingForEvent = await TicketCategory.find({ EventID: event.EventID }).lean();
    const visible = filterCategoriesForEvent(eventId, event.createdAt, existingForEvent);
    if (visible.some((c) => String(c.Name).trim().toLowerCase() === nameKey)) {
      return res.status(409).json({ message: "A ticket type with this name already exists for this event" });
    }
    const lastCat = await TicketCategory.findOne().sort({ TicketCatID: -1 }).lean();
    const nextCatId = (lastCat?.TicketCatID || 0) + 1;
    let category;
    try {
      category = await TicketCategory.create({
        TicketCatID: nextCatId,
        EventID: event.EventID,
        eventRef: event._id,
        Name,
        Price: Number(Price),
        TotalQuantity: qty,
        Description: Description != null ? String(Description) : "",
      });
    } catch (err) {
      console.error("Create ticket category (TicketCategory) error:", err);
      const msg = err.message || (err.reason && (err.reason.message || JSON.stringify(err.reason))) || String(err);
      return res.status(500).json({
        message: "Internal server error",
        error: `TicketCategory: ${msg}`,
      });
    }
    if (qty > 0) {
      const lastTicket = await Ticket.findOne().sort({ TicketID: -1 }).lean();
      let nextTicketId = (lastTicket?.TicketID || 0) + 1;
      const tickets = [];
      for (let i = 0; i < qty; i++) {
        tickets.push({
          TicketID: nextTicketId + i,
          EventID: event.EventID,
          TicketCatID: category.TicketCatID,
          SeatID: 0,
          IsAvailable: true,
        });
      }
      try {
        await Ticket.insertMany(tickets);
      } catch (err) {
        console.error("Create ticket category (Ticket insertMany) error:", err);
        const msg = err.message || (err.reason && (err.reason.message || JSON.stringify(err.reason))) || String(err);
        return res.status(500).json({
          message: "Internal server error",
          error: `Ticket: ${msg}`,
        });
      }
    }
    return res.status(201).json(category);
  } catch (err) {
    console.error("Create ticket category error:", err);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message || (err.reason && (err.reason.message || JSON.stringify(err.reason))) || String(err);
    return res.status(500).json({ message: "Internal server error", error: message });
  }
};

// Get one ticket category by id (Mongo _id); must belong to the given event
exports.getById = async (req, res) => {
  try {
    const { eventId, ticketCategoryId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const category = await TicketCategory.findOne({
      _id: ticketCategoryId,
      EventID: event.EventID,
    });
    if (!category) return res.status(404).json({ message: "Ticket category not found" });
    return res.json(category);
  } catch (err) {
    console.error("Get ticket category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update ticket category (Name, Price, Description only; TotalQuantity change would affect tickets)
exports.update = async (req, res) => {
  try {
    const { eventId, ticketCategoryId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const category = await TicketCategory.findOne({
      _id: ticketCategoryId,
      EventID: event.EventID,
    });
    if (!category) return res.status(404).json({ message: "Ticket category not found" });
    const { Name, Price, Description } = req.body || {};
    if (Name !== undefined) category.Name = Name;
    if (Price !== undefined) category.Price = Number(Price);
    if (Description !== undefined) category.Description = Description;
    await category.save();
    return res.json(category);
  } catch (err) {
    console.error("Update ticket category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete ticket category only if no tickets have been sold (all still available)
exports.remove = async (req, res) => {
  try {
    const { eventId, ticketCategoryId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const category = await TicketCategory.findOne({
      _id: ticketCategoryId,
      EventID: event.EventID,
    });
    if (!category) return res.status(404).json({ message: "Ticket category not found" });
    const soldCount = await Ticket.countDocuments({
      EventID: event.EventID,
      TicketCatID: category.TicketCatID,
      IsAvailable: false,
    });
    if (soldCount > 0) {
      return res.status(400).json({
        message: "Cannot delete category: some tickets have already been sold",
      });
    }
    await Ticket.deleteMany({
      EventID: event.EventID,
      TicketCatID: category.TicketCatID,
    });
    await TicketCategory.findByIdAndDelete(ticketCategoryId);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete ticket category error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
