const mongoose = require("mongoose");
const Event = require("../models/Event");
const TicketCategory = require("../models/TicketCategory");
const Ticket = require("../models/Ticket");
const Seat = require("../models/Seat");
const Booking = require("../models/Booking");
const BookingDetail = require("../models/BookingDetail");
const User = require("../models/User");
const emailService = require("../services/emailService");
const { releaseSeats } = require("../services/seatHoldService");
const loyaltyService = require("../services/loyaltyService");
const entryAssignmentService = require("../services/entryAssignmentService");
const EntryGate = require("../models/EntryGate");
const { notifyUsersAfterAssignment } = require("../services/entryAssignmentNotifications");

// Create booking: reserve tickets for an event (logged-in user).
// For non-seated: { eventId, ticketCategoryId, quantity }. For seated: { eventId, seatIds: [ ... ] }.
// Response includes seats[] with section, row, seatNumber for F&B delivery when event is seated.
exports.create = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { eventId, ticketCategoryId, quantity, seatIds, promoCode, requestUpgrade } =
      req.body || {};
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    try {
      await loyaltyService.assertCanBookEvent(userId, event);
    } catch (accessErr) {
      if (accessErr.statusCode) {
        return res.status(accessErr.statusCode).json({
          message: accessErr.message,
          code: accessErr.code,
        });
      }
      throw accessErr;
    }
    try {
      const eventInvitationService = require("../services/eventInvitationService");
      await eventInvitationService.assertPrivateEventAccess(event, {
        userId,
        userRole: req.user?.role,
        userEmail: req.user?.email,
      });
    } catch (accessErr) {
      if (accessErr.statusCode) {
        return res.status(accessErr.statusCode).json({ message: accessErr.message });
      }
      throw accessErr;
    }
    const eventStatus = String(event.Status || "").toLowerCase();
    if (eventStatus === "pending") {
      return res.status(400).json({
        message: "This event is pending approval and is not available for booking yet.",
      });
    }
    if (eventStatus === "rejected") {
      return res.status(400).json({ message: "This event is not available for booking." });
    }
    const userIdObj = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    let available;
    let totalAmount;
    let category;

    if (event.isSeated && Array.isArray(seatIds) && seatIds.length > 0) {
      const ids = seatIds.map((s) => Number(s)).filter((n) => !Number.isNaN(n));
      if (ids.length === 0) {
        return res.status(400).json({ message: "seatIds must be an array of seat IDs (numbers)" });
      }
      available = await Ticket.find({
        EventID: event.EventID,
        SeatID: { $in: ids },
        IsAvailable: true,
      }).lean();
      if (available.length !== ids.length) {
        const foundIds = new Set(available.map((t) => t.SeatID));
        const missing = ids.filter((id) => !foundIds.has(id));
        return res.status(400).json({
          message: `Some seats are not available or invalid: ${missing.join(", ")}`,
        });
      }
      const categories = await TicketCategory.find({ EventID: event.EventID }).lean();
      const catMap = Object.fromEntries(categories.map((c) => [c.TicketCatID, c]));
      totalAmount = 0;
      for (const t of available) {
        const cat = catMap[t.TicketCatID];
        if (cat) totalAmount += cat.Price;
      }
      category = available.length ? catMap[available[0].TicketCatID] : null;
    } else {
      if (!eventId || !ticketCategoryId || !quantity || quantity < 1) {
        return res
          .status(400)
          .json({ message: "eventId, ticketCategoryId, and quantity (>= 1) are required; for seated events use seatIds" });
      }
      let resolvedCategoryId = ticketCategoryId;
      if (requestUpgrade) {
        const upgraded = await loyaltyService.resolveUpgradeCategory(
          event,
          ticketCategoryId,
          userId,
        );
        if (upgraded) resolvedCategoryId = upgraded._id;
      }
      category = await TicketCategory.findById(resolvedCategoryId);
      if (!category || category.EventID !== event.EventID) {
        return res.status(404).json({ message: "Ticket category not found for this event" });
      }
      available = await Ticket.find({
        EventID: event.EventID,
        TicketCatID: category.TicketCatID,
        IsAvailable: true,
      })
        .limit(quantity)
        .lean();
      if (event.isSeated) {
        return res.status(400).json({
          message: "This is a seated event. Please select seats and send seatIds in the request body.",
        });
      }
      if (available.length === 0) {
        const existingCount = await Ticket.countDocuments({
          EventID: event.EventID,
          TicketCatID: category.TicketCatID,
        });
        if (existingCount === 0 && category.TotalQuantity > 0) {
          const lastTicket = await Ticket.findOne().sort({ TicketID: -1 }).lean();
          let nextTicketId = (lastTicket?.TicketID || 0) + 1;
          const ticketsToCreate = [];
          for (let i = 0; i < category.TotalQuantity; i++) {
            ticketsToCreate.push({
              TicketID: nextTicketId + i,
              EventID: event.EventID,
              TicketCatID: category.TicketCatID,
              SeatID: 0,
              IsAvailable: true,
            });
          }
          await Ticket.insertMany(ticketsToCreate);
          available = await Ticket.find({
            EventID: event.EventID,
            TicketCatID: category.TicketCatID,
            IsAvailable: true,
          })
            .limit(quantity)
            .lean();
        }
      }
      if (available.length < quantity) {
        return res.status(400).json({
          message: `Only ${available.length} ticket(s) available for this category`,
        });
      }
      totalAmount = category.Price * quantity;
    }

    const subtotalAmount = totalAmount;
    let discountAmount = 0;
    let appliedPromo = null;
    if (promoCode) {
      try {
        const promoResult = await loyaltyService.validatePromoForUser(
          userId,
          promoCode,
          eventId,
          subtotalAmount,
        );
        appliedPromo = promoResult.promo;
        discountAmount = promoResult.discountAmount;
        totalAmount = promoResult.totalAfter;
      } catch (promoErr) {
        if (promoErr.statusCode) {
          return res.status(promoErr.statusCode).json({ message: promoErr.message });
        }
        throw promoErr;
      }
    }

    const lastBooking = await Booking.findOne().sort({ BookingID: -1 }).lean();
    const nextBookingId = (lastBooking?.BookingID || 0) + 1;
    let booking;
    try {
      booking = await Booking.create({
        BookingID: nextBookingId,
        userId: userIdObj,
        Date: new Date(),
        SubtotalAmount: subtotalAmount,
        DiscountAmount: discountAmount,
        PromoCode: appliedPromo?.Code,
        TotalAmount: totalAmount,
        Status: "Confirmed",
      });
    } catch (err) {
      const msg = err.message || (err.reason && (err.reason.message || JSON.stringify(err.reason))) || String(err);
      return res.status(500).json({ message: "Internal server error", error: `Booking: ${msg}` });
    }
    const lastDetail = await BookingDetail.findOne().sort({ DetailID: -1 }).lean();
    let nextDetailId = (lastDetail?.DetailID || 0) + 1;
    const catMapForPrice = category ? { [category.TicketCatID]: category } : {};
    if (event.isSeated && available.length > 0) {
      const cats = await TicketCategory.find({ EventID: event.EventID }).lean();
      cats.forEach((c) => { catMapForPrice[c.TicketCatID] = c; });
    }
    const details = [];
    for (const t of available) {
      const cat = catMapForPrice[t.TicketCatID];
      details.push({
        DetailID: nextDetailId++,
        BookingID: booking.BookingID,
        TicketID: t.TicketID,
        PriceAtBooking: cat ? cat.Price : 0,
      });
    }
    try {
      await BookingDetail.insertMany(details);
    } catch (err) {
      const msg = err.message || (err.reason && (err.reason.message || JSON.stringify(err.reason))) || String(err);
      return res.status(500).json({ message: "Internal server error", error: `BookingDetail: ${msg}` });
    }
    try {
      await Ticket.updateMany(
        { TicketID: { $in: available.map((t) => t.TicketID) } },
        { $set: { IsAvailable: false, OwnerUserId: userIdObj } }
      );
    } catch (err) {
      const msg = err.message || (err.reason && (err.reason.message || JSON.stringify(err.reason))) || String(err);
      return res.status(500).json({ message: "Internal server error", error: `Ticket (update): ${msg}` });
    }
    const populated = await Booking.findById(booking._id);
    const ticketIds = available.map((t) => t.TicketID);

    let seatsForFb = [];
    if (event.isSeated && available.some((t) => t.SeatID != null && t.SeatID !== 0)) {
      const seatDocs = await Seat.find({
        EventID: event.EventID,
        SeatID: { $in: available.map((t) => t.SeatID).filter(Boolean) },
      }).lean();
      const seatBySeatId = Object.fromEntries(seatDocs.map((s) => [s.SeatID, s]));
      seatsForFb = available.map((t) => {
        const s = seatBySeatId[t.SeatID];
        if (!s) return { seatId: t.SeatID, label: null, section: null, row: null, seatNumber: null };
        const label = `${s.SectionName} - Row ${s.RowLabel} - Seat ${s.SeatNumber}`;
        return { seatId: s.SeatID, label, section: s.SectionName, row: s.RowLabel, seatNumber: s.SeatNumber };
      });
    }

    // Release Redis seat holds now that the DB booking is confirmed
    if (event.isSeated && available.length > 0) {
      const heldSeatIds = available.map((t) => t.SeatID).filter(Boolean);
      if (heldSeatIds.length > 0) {
        releaseSeats(event.EventID, heldSeatIds, userId).catch((err) =>
          console.warn("Seat hold release after booking failed:", err.message)
        );
      }
    }

    let loyaltyEarned = 0;
    try {
      const userForTier = await User.findById(userId).lean();
      const tier = loyaltyService.resolveTier(userForTier?.loyaltyLifetimePoints || 0);
      loyaltyEarned = loyaltyService.pointsForBooking(totalAmount, tier);
      if (loyaltyEarned > 0) {
        await loyaltyService.earnPoints(userId, loyaltyEarned, "booking", {
          referenceType: "booking",
          referenceId: booking.BookingID,
          description: `Points for booking #${booking.BookingID}`,
        });
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { LoyaltyPointsEarned: loyaltyEarned } },
        );
      }
      if (appliedPromo?._id) {
        await loyaltyService.markPromoUsed(appliedPromo._id, booking.BookingID);
      }
    } catch (loyErr) {
      console.warn("Loyalty earn after booking:", loyErr.message);
    }

    User.findById(userId)
      .select("Email")
      .lean()
      .then((u) => {
        if (u?.Email) {
          return emailService.sendPurchaseConfirmation(u.Email, {
            bookingId: booking.BookingID,
            totalAmount,
            eventName: event.Name,
          });
        }
      })
      .catch((err) => console.error("Purchase confirmation email failed:", err));

    if (event.entryGatingEnabled) {
      const hasGates = await EntryGate.exists({ EventID: event.EventID });
      if (hasGates) {
        try {
          const assignResult = await entryAssignmentService.runAssignment(event.EventID, false, {
            onlyTicketIds: ticketIds,
          });
          if (assignResult.ticketIds?.length) {
            const eventMongoId = String(event._id);
            setImmediate(() => {
              notifyUsersAfterAssignment(eventMongoId, event.EventID, assignResult.ticketIds, {
                kind: "assigned",
              }).catch((err) => console.warn("Entry notify after booking:", err.message));
            });
          }
        } catch (assignErr) {
          console.warn("Entry assignment after booking:", assignErr.message);
        }
      }
    }

    return res.status(201).json({
      booking: populated,
      ticketCount: available.length,
      loyaltyPointsEarned: loyaltyEarned,
      discountAmount,
      subtotalAmount,
      totalAmount,
      ticketIds,
      seats: seatsForFb.length > 0 ? seatsForFb : undefined,
    });
  } catch (err) {
    console.error("Create booking error:", err);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message || (err.reason && (err.reason.message || JSON.stringify(err.reason))) || String(err);
    return res.status(500).json({ message: "Internal server error", error: message });
  }
};

// My bookings summary: id, status, totalAmount, eventName, eventStartDate (for dashboard upcoming count)
exports.myBookingsSummary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const userIdObj = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const bookings = await Booking.find({ userId: userIdObj }).sort({ Date: -1 }).lean();
    const bookingIds = bookings.map((b) => b.BookingID);
    const details = await BookingDetail.find({ BookingID: { $in: bookingIds } }).limit(bookingIds.length * 5).lean();
    const ticketIds = [...new Set(details.map((d) => d.TicketID))];
    const tickets = await Ticket.find({ TicketID: { $in: ticketIds } }).select("TicketID EventID").lean();
    const eventIds = [...new Set(tickets.map((t) => t.EventID))];
    const events = await Event.find({ EventID: { $in: eventIds } }).select("EventID Name StartDate").lean();
    const eventMap = Object.fromEntries(events.map((e) => [e.EventID, e]));
    const ticketToEvent = Object.fromEntries(tickets.map((t) => [t.TicketID, eventMap[t.EventID]]));
    const firstTicketByBooking = {};
    for (const d of details) {
      if (!firstTicketByBooking[d.BookingID]) firstTicketByBooking[d.BookingID] = d.TicketID;
    }
    const result = bookings.map((b) => {
      const tid = firstTicketByBooking[b.BookingID];
      const ev = tid ? ticketToEvent[tid] : null;
      return {
        _id: b._id,
        BookingID: b.BookingID,
        TotalAmount: b.TotalAmount,
        Status: b.Status,
        Date: b.Date,
        eventName: ev?.Name,
        eventStartDate: ev?.StartDate,
      };
    });
    return res.json(result);
  } catch (err) {
    console.error("My bookings summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// List current user's bookings (query by ObjectId so it matches stored userId)
// Attach ticketIds from BookingDetail so frontend can generate ticket QR codes
exports.myBookings = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userIdObj = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const bookings = await Booking.find({ userId: userIdObj }).sort({ Date: -1 }).lean();
    const bookingIds = bookings.map((b) => b.BookingID);
    const details = await BookingDetail.find({ BookingID: { $in: bookingIds } }).lean();
    const ticketIdsByBooking = {};
    for (const d of details) {
      if (!ticketIdsByBooking[d.BookingID]) ticketIdsByBooking[d.BookingID] = [];
      ticketIdsByBooking[d.BookingID].push(d.TicketID);
    }
    const result = bookings.map((b) => ({
      ...b,
      ticketIds: ticketIdsByBooking[b.BookingID] || [],
    }));
    return res.json(result);
  } catch (err) {
    console.error("My bookings error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one booking by id (own booking or admin)
exports.getById = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (req.user.role !== "admin" && String(booking.userId) !== String(userId)) {
      return res.status(403).json({ message: "You can only view your own bookings" });
    }
    return res.json(booking);
  } catch (err) {
    console.error("Get booking error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Cancel booking: set Status to Cancelled and release tickets (own booking only)
exports.cancel = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (String(booking.userId) !== String(userId)) {
      return res.status(403).json({ message: "You can only cancel your own bookings" });
    }
    if (booking.Status === "Cancelled") {
      return res.status(400).json({ message: "Booking is already cancelled" });
    }
    const details = await BookingDetail.find({ BookingID: booking.BookingID }).lean();
    const ticketIds = details.map((d) => d.TicketID);
    await Ticket.updateMany(
      { TicketID: { $in: ticketIds } },
      { $set: { IsAvailable: true }, $unset: { OwnerUserId: "" } }
    );
    booking.Status = "Cancelled";
    await booking.save();
    return res.json(booking);
  } catch (err) {
    console.error("Cancel booking error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update booking (admin or owner). Allowed: Status, TotalAmount.
exports.update = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (req.user.role !== "admin" && String(booking.userId) !== String(userId)) {
      return res.status(403).json({ message: "You can only update your own bookings" });
    }
    const { Status, TotalAmount } = req.body || {};
    if (Status !== undefined) {
      if (!["Pending", "Confirmed", "Cancelled"].includes(Status)) {
        return res.status(400).json({ message: "Status must be Pending, Confirmed, or Cancelled" });
      }
      if (Status === "Cancelled" && booking.Status !== "Cancelled") {
        const details = await BookingDetail.find({ BookingID: booking.BookingID }).lean();
        const ticketIds = details.map((d) => d.TicketID);
        await Ticket.updateMany(
          { TicketID: { $in: ticketIds } },
          { $set: { IsAvailable: true }, $unset: { OwnerUserId: "" } }
        );
      }
      booking.Status = Status;
    }
    if (TotalAmount !== undefined) booking.TotalAmount = Number(TotalAmount);
    await booking.save();
    return res.json(booking);
  } catch (err) {
    console.error("Update booking error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete booking (admin only). Releases tickets, deletes details, then booking.
exports.remove = async (req, res) => {
  try {
    if (req.user?.role !== "admin") return res.status(403).json({ message: "Forbidden: admin only" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const details = await BookingDetail.find({ BookingID: booking.BookingID }).lean();
    const ticketIds = details.map((d) => d.TicketID);
    await Ticket.updateMany(
      { TicketID: { $in: ticketIds } },
      { $set: { IsAvailable: true }, $unset: { OwnerUserId: "" } }
    );
    await BookingDetail.deleteMany({ BookingID: booking.BookingID });
    await Booking.findByIdAndDelete(req.params.id);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete booking error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// List details for a booking (owner or admin). Includes seat label for F&B when ticket has SeatID.
exports.listDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (req.user.role !== "admin" && String(booking.userId) !== String(userId)) {
      return res.status(403).json({ message: "You can only view your own booking details" });
    }
    const details = await BookingDetail.find({ BookingID: booking.BookingID }).lean();
    const ticketIds = details.map((d) => d.TicketID);
    const tickets = await Ticket.find({ TicketID: { $in: ticketIds } }).select("TicketID EventID SeatID").lean();
    const seatIds = tickets.filter((t) => t.SeatID != null && t.SeatID !== 0).map((t) => t.SeatID);
    let seatLabelsByTicketId = {};
    if (seatIds.length > 0 && tickets.length > 0) {
      const eventId = tickets[0].EventID;
      const seats = await Seat.find({ EventID: eventId, SeatID: { $in: seatIds } }).lean();
      const seatBySeatId = Object.fromEntries(seats.map((s) => [s.SeatID, s]));
      for (const t of tickets) {
        const s = seatBySeatId[t.SeatID];
        if (s) {
          seatLabelsByTicketId[t.TicketID] = `${s.SectionName} - Row ${s.RowLabel} - Seat ${s.SeatNumber}`;
        }
      }
    }
    const result = details.map((d) => ({
      ...d,
      seatLabel: seatLabelsByTicketId[d.TicketID] || null,
    }));
    return res.json(result);
  } catch (err) {
    console.error("List booking details error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one booking detail by id (owner or admin)
exports.getDetailById = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (req.user.role !== "admin" && String(booking.userId) !== String(userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const detail = await BookingDetail.findOne({
      _id: req.params.detailId,
      BookingID: booking.BookingID,
    }).lean();
    if (!detail) return res.status(404).json({ message: "Booking detail not found" });
    return res.json(detail);
  } catch (err) {
    console.error("Get booking detail error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update booking detail (admin or owner). Allowed: PriceAtBooking.
exports.updateDetail = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (req.user.role !== "admin" && String(booking.userId) !== String(userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const detail = await BookingDetail.findOne({
      _id: req.params.detailId,
      BookingID: booking.BookingID,
    });
    if (!detail) return res.status(404).json({ message: "Booking detail not found" });
    const { PriceAtBooking } = req.body || {};
    if (PriceAtBooking !== undefined) {
      detail.PriceAtBooking = Number(PriceAtBooking);
      await detail.save();
      const sum = await BookingDetail.aggregate([
        { $match: { BookingID: booking.BookingID } },
        { $group: { _id: null, total: { $sum: "$PriceAtBooking" } } },
      ]);
      booking.TotalAmount = sum[0]?.total ?? 0;
      await booking.save();
    }
    return res.json(detail);
  } catch (err) {
    console.error("Update booking detail error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete one booking detail (admin only). Releases ticket and updates booking total.
exports.removeDetail = async (req, res) => {
  try {
    if (req.user?.role !== "admin") return res.status(403).json({ message: "Forbidden: admin only" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const detail = await BookingDetail.findOne({
      _id: req.params.detailId,
      BookingID: booking.BookingID,
    });
    if (!detail) return res.status(404).json({ message: "Booking detail not found" });
    await Ticket.updateOne(
      { TicketID: detail.TicketID },
      { $set: { IsAvailable: true }, $unset: { OwnerUserId: "" } }
    );
    await BookingDetail.findByIdAndDelete(req.params.detailId);
    const sum = await BookingDetail.aggregate([
      { $match: { BookingID: booking.BookingID } },
      { $group: { _id: null, total: { $sum: "$PriceAtBooking" } } },
    ]);
    booking.TotalAmount = sum[0]?.total ?? 0;
    await booking.save();
    return res.status(204).send();
  } catch (err) {
    console.error("Delete booking detail error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Validate ticket QR code (public, for door/staff scanning). Code format: FLOWTIC-B-{BookingID}
exports.validateTicketCode = async (req, res) => {
  try {
    const code = (req.query.code || req.body?.code || "").trim();
    if (!code) {
      return res.status(400).json({ valid: false, message: "Missing code (query or body)" });
    }
    const match = code.match(/^FLOWTIC-B-(\d+)$/);
    if (!match) {
      return res.status(400).json({ valid: false, message: "Invalid code format. Expected FLOWTIC-B-{BookingID}" });
    }
    const bookingId = parseInt(match[1], 10);
    const booking = await Booking.findOne({ BookingID: bookingId }).lean();
    if (!booking) {
      return res.json({ valid: false, message: "Booking not found" });
    }
    if (booking.Status !== "Confirmed") {
      return res.json({
        valid: false,
        message: `Booking is ${booking.Status}`,
        status: booking.Status,
      });
    }
    const details = await BookingDetail.find({ BookingID: booking.BookingID }).lean();
    const ticketIds = details.map((d) => d.TicketID);
    let eventName = null;
    let eventId = null;
    if (ticketIds.length > 0) {
      const ticket = await Ticket.findOne({ TicketID: ticketIds[0] }).lean();
      if (ticket) {
        const event = await Event.findOne({ EventID: ticket.EventID }).lean();
        if (event) {
          eventName = event.Name;
          eventId = event._id;
        }
      }
    }
    return res.json({
      valid: true,
      bookingID: booking.BookingID,
      ticketCount: details.length,
      eventName,
      eventId,
      totalAmount: booking.TotalAmount,
    });
  } catch (err) {
    console.error("Validate ticket code error:", err);
    return res.status(500).json({ valid: false, message: "Internal server error" });
  }
};
