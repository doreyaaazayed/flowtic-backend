const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const Booking = require("../models/Booking");
const BookingDetail = require("../models/BookingDetail");
const ResaleListing = require("../models/ResaleListing");
const ResaleRequest = require("../models/ResaleRequest");
const TicketTransferHistory = require("../models/TicketTransferHistory");
const User = require("../models/User");
const emailService = require("../services/emailService");
const resalePrice = require("../services/resalePriceService");
const resaleFeatured = require("../services/resaleFeaturedService");

const PLATFORM_FEE = 50;

/**
 * Persist resale transfer + move ticket (shared by admin confirm and buyer self-confirm).
 * @param {import("mongoose").Document} request — ResaleRequest with populated listingId (sellerId, price, TicketID, eventId)
 */
async function runResalePaymentTransfer(request) {
  const listing = request.listingId;
  if (!listing) throw new Error("Listing not loaded");
  const ticket = await Ticket.findOne({ TicketID: listing.TicketID });
  if (!ticket) throw new Error("Ticket not found");
  const lastBooking = await Booking.findOne().sort({ BookingID: -1 }).lean();
  const nextBookingId = (lastBooking?.BookingID || 0) + 1;
  const lastDetail = await BookingDetail.findOne().sort({ DetailID: -1 }).lean();
  const nextDetailId = (lastDetail?.DetailID || 0) + 1;
  const booking = await Booking.create({
    BookingID: nextBookingId,
    userId: request.buyerId,
    Date: new Date(),
    TotalAmount: request.totalAmount,
    Status: "Confirmed",
  });
  await BookingDetail.create({
    DetailID: nextDetailId,
    BookingID: booking.BookingID,
    TicketID: ticket.TicketID,
    PriceAtBooking: request.totalAmount,
  });
  ticket.OwnerUserId = request.buyerId;
  await ticket.save();
  listing.status = "Sold";
  await listing.save();
  request.status = "Approved";
  request.paymentStatus = "Paid";
  await request.save();
  await TicketTransferHistory.create({
    ticketId: ticket.TicketID,
    eventId: ticket.EventID,
    fromUserId: listing.sellerId,
    toUserId: request.buyerId,
    ticketPrice: Number(listing.price),
    platformFee: Number(request.platformFee) || 0,
    totalPaidByBuyer: Number(request.totalAmount),
    resaleRequestId: request._id,
  });
  return { booking };
}

// List tickets the current user can list for resale (owned, not already listed)
exports.eligibleTickets = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const myTickets = await Ticket.find({ OwnerUserId: userId }).lean();
    if (myTickets.length === 0) return res.json([]);
    const ticketIds = myTickets.map((t) => t.TicketID);
    const alreadyListed = await ResaleListing.find({
      TicketID: { $in: ticketIds },
      status: { $in: ["PendingApproval", "Listed", "Pending"] },
    })
      .lean()
      .then((list) => list.map((l) => l.TicketID));
    const listedSet = new Set(alreadyListed);
    const eligible = myTickets.filter((t) => !listedSet.has(t.TicketID));
    const eventIds = [...new Set(eligible.map((t) => t.EventID))];
    const events = await Event.find({ EventID: { $in: eventIds } }).lean();
    const eventByEid = {};
    events.forEach((e) => { eventByEid[e.EventID] = e; });
    const result = await Promise.all(
      eligible.map(async (t) => {
        const ev = eventByEid[t.EventID];
        const maxResalePrice = await resalePrice.getOriginalPurchasePrice(t.TicketID);
        return {
          ticketId: t.TicketID,
          eventId: ev?._id,
          eventName: ev?.Name ?? `Event #${t.EventID}`,
          eventStartDate: ev?.StartDate,
          maxResalePrice,
          originalPurchasePrice: maxResalePrice,
        };
      }),
    );
    return res.json(result);
  } catch (err) {
    console.error("Eligible tickets error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// List all active resale listings (public)
exports.listListings = async (req, res) => {
  try {
    const listings = await ResaleListing.find({ status: "Listed" })
      .populate("eventId", "Name StartDate EndDate")
      .populate("sellerId", "Username Email")
      .lean();
    return res.json(listings);
  } catch (err) {
    console.error("List resale listings error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Featured listing for marketing (landing): nearest upcoming event or best savings. */
exports.getFeaturedListing = async (req, res) => {
  try {
    const mode = req.query.mode === "best" ? "best" : "nearest";
    const listing = await resaleFeatured.getFeaturedListing(mode);
    return res.json({ listing, mode });
  } catch (err) {
    console.error("Featured resale listing error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one resale listing by id (public or auth)
exports.getListingById = async (req, res) => {
  try {
    const listing = await ResaleListing.findById(req.params.id)
      .populate("eventId", "Name StartDate EndDate")
      .populate("sellerId", "Username Email")
      .lean();
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    return res.json(listing);
  } catch (err) {
    console.error("Get listing error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update resale listing (seller or admin): price, status
exports.updateListing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const listing = await ResaleListing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (req.user.role !== "admin" && listing.sellerId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "You can only update your own listing" });
    }
    const { price, status } = req.body || {};
    if (price !== undefined) {
      const nextPrice = Number(price);
      if (req.user.role !== "admin") {
        const check = await resalePrice.validateResalePrice(listing.TicketID, nextPrice);
        if (!check.ok) {
          return res.status(400).json({ message: check.message, maxResalePrice: check.maxPrice });
        }
      }
      listing.price = nextPrice;
    }
    if (status !== undefined) {
      if (!["PendingApproval", "Listed", "Pending", "Sold", "Cancelled"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      listing.status = status;
    }
    await listing.save();
    return res.json(listing);
  } catch (err) {
    console.error("Update listing error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete resale listing (seller or admin). Only if status is Listed or Cancelled.
exports.removeListing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const listing = await ResaleListing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (req.user.role !== "admin" && listing.sellerId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "You can only delete your own listing" });
    }
    if (listing.status === "Pending") {
      return res.status(400).json({ message: "Cannot delete listing with pending buy request. Reject the request first." });
    }
    if (listing.status === "Sold") {
      return res.status(400).json({ message: "Cannot delete a sold listing" });
    }
    await ResaleListing.findByIdAndDelete(req.params.id);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete listing error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: list listings pending approval to go live (status PendingApproval)
exports.listPendingListings = async (req, res) => {
  try {
    const listings = await ResaleListing.find({ status: "PendingApproval" })
      .populate("eventId", "Name StartDate EndDate")
      .populate("sellerId", "Username Email")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(listings);
  } catch (err) {
    console.error("List pending listings error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Seller: list my resale listings (where I am the seller)
exports.listMyListings = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const listings = await ResaleListing.find({ sellerId: userId })
      .populate("eventId", "Name StartDate")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(listings);
  } catch (err) {
    console.error("List my listings error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: approve a listing so it goes live (status → Listed)
exports.approveListing = async (req, res) => {
  try {
    const listing = await ResaleListing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.status !== "PendingApproval") {
      return res.status(400).json({ message: "Listing is not pending approval" });
    }
    listing.status = "Listed";
    await listing.save();

    Promise.all([
      User.findById(listing.sellerId).select("Email").lean(),
      Event.findById(listing.eventId).select("Name").lean(),
    ])
      .then(([seller, ev]) => {
        if (seller?.Email) {
          return emailService.sendResaleListingApproved(seller.Email, {
            eventName: ev?.Name || "Event",
          });
        }
      })
      .catch((err) => console.error("Resale listing approved email failed:", err));

    return res.json(listing);
  } catch (err) {
    console.error("Approve listing error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: reject a pending listing (optional: remove or set Cancelled)
exports.rejectListing = async (req, res) => {
  try {
    const listing = await ResaleListing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.status !== "PendingApproval") {
      return res.status(400).json({ message: "Listing is not pending approval" });
    }
    listing.status = "Cancelled";
    await listing.save();
    return res.json(listing);
  } catch (err) {
    console.error("Reject listing error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Seller lists a ticket for resale
exports.createListing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { ticketId, price } = req.body || {};
    if (ticketId == null || price == null || price < 0) {
      return res.status(400).json({ message: "ticketId and price (>= 0) are required" });
    }
    const ticket = await Ticket.findOne({ TicketID: ticketId }).lean();
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    if (!ticket.OwnerUserId || ticket.OwnerUserId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "You do not own this ticket" });
    }
    const existing = await ResaleListing.findOne({
      TicketID: ticketId,
      status: { $in: ["PendingApproval", "Listed", "Pending"] },
    });
    if (existing) {
      return res.status(400).json({ message: "This ticket is already listed for resale" });
    }
    const priceCheck = await resalePrice.validateResalePrice(ticketId, price);
    if (!priceCheck.ok) {
      return res.status(400).json({
        message: priceCheck.message,
        maxResalePrice: priceCheck.maxPrice,
      });
    }
    const event = await Event.findOne({ EventID: ticket.EventID });
    if (!event) return res.status(404).json({ message: "Event not found" });
    const listing = await ResaleListing.create({
      sellerId: userId,
      TicketID: ticket.TicketID,
      EventID: ticket.EventID,
      eventId: event._id,
      price: Number(price),
      status: "Listed",
    });

    User.findById(userId)
      .select("Email")
      .lean()
      .then((u) => {
        if (u?.Email) {
          return emailService.sendResaleListingApproved(u.Email, {
            eventName: event.Name,
          });
        }
      })
      .catch((err) => console.error("Resale listing live email failed:", err));

    return res.status(201).json(listing);
  } catch (err) {
    console.error("Create resale listing error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Buyer requests to purchase a listing (no admin step: immediately awaiting payment)
exports.createRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { listingId } = req.body || {};
    if (!listingId) return res.status(400).json({ message: "listingId is required" });
    const listing = await ResaleListing.findById(listingId);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.status !== "Listed") {
      return res.status(400).json({ message: "Listing is no longer available" });
    }
    if (listing.sellerId.toString() === userId.toString()) {
      return res.status(400).json({ message: "You cannot request your own listing" });
    }
    const existing = await ResaleRequest.findOne({
      listingId,
      status: { $in: ["Pending", "PaymentPending"] },
    });
    if (existing) {
      return res.status(400).json({ message: "A request for this listing is already in progress" });
    }
    const totalAmount = Number(listing.price) + PLATFORM_FEE;
    listing.status = "Pending";
    await listing.save();
    const request = await ResaleRequest.create({
      listingId,
      buyerId: userId,
      status: "PaymentPending",
      platformFee: PLATFORM_FEE,
      totalAmount,
    });

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const paymentUrl = `${baseUrl}/resale/payment/${request._id}`;
    Promise.all([
      User.findById(userId).select("Email").lean(),
      Event.findById(listing.eventId).select("Name").lean(),
    ])
      .then(([buyer, ev]) => {
        if (buyer?.Email) {
          return emailService.sendResalePaymentRequired(buyer.Email, {
            eventName: ev?.Name || "Event",
            totalAmount,
            paymentUrl,
          });
        }
      })
      .catch((err) => console.error("Resale payment required email failed:", err));

    return res.status(201).json(request);
  } catch (err) {
    console.error("Create resale request error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: list pending requests (buyer requested; admin must approve for payment)
exports.listPendingRequests = async (req, res) => {
  try {
    const requests = await ResaleRequest.find({ status: "Pending" })
      .populate({ path: "listingId", populate: { path: "eventId", select: "Name" } })
      .populate("buyerId", "Username Email")
      .lean();
    return res.json(requests);
  } catch (err) {
    console.error("List pending requests error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: list requests awaiting payment confirmation (admin approved for payment; buyer pays then admin confirms)
exports.listPaymentPendingRequests = async (req, res) => {
  try {
    const requests = await ResaleRequest.find({ status: "PaymentPending" })
      .populate({ path: "listingId", populate: { path: "eventId", select: "Name" } })
      .populate("buyerId", "Username Email")
      .lean();
    return res.json(requests);
  } catch (err) {
    console.error("List payment-pending requests error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: approve transaction → set PaymentPending, totalAmount = price + $50 platform fee (buyer pays this; no transfer yet)
exports.approveRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const request = await ResaleRequest.findById(requestId).populate("listingId");
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "Pending") {
      return res.status(400).json({ message: "Request is no longer pending" });
    }
    const listing = request.listingId;
    const totalAmount = Number(listing.price) + PLATFORM_FEE;
    request.status = "PaymentPending";
    request.platformFee = PLATFORM_FEE;
    request.totalAmount = totalAmount;
    await request.save();

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const paymentUrl = `${baseUrl}/resale/payment/${request._id}`;
    Promise.all([
      User.findById(request.buyerId).select("Email").lean(),
      Event.findById(listing.eventId).select("Name").lean(),
    ])
      .then(([buyer, ev]) => {
        if (buyer?.Email) {
          return emailService.sendResalePaymentRequired(buyer.Email, {
            eventName: ev?.Name || "Event",
            totalAmount,
            paymentUrl,
          });
        }
      })
      .catch((err) => console.error("Resale payment required email failed:", err));

    return res.json({
      message: "Transaction approved for payment. Buyer must pay total amount; then admin confirms payment & transfer.",
      request: {
        _id: request._id,
        totalAmount,
        platformFee: PLATFORM_FEE,
        ticketPrice: listing.price,
      },
    });
  } catch (err) {
    console.error("Approve resale for payment error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: confirm payment received & transfer ticket to buyer (after buyer pays totalAmount)
exports.confirmPaymentAndTransfer = async (req, res) => {
  try {
    const { requestId } = req.params;
    const request = await ResaleRequest.findById(requestId).populate("listingId");
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "PaymentPending") {
      return res.status(400).json({ message: "Request is not awaiting payment confirmation" });
    }
    const booking = (await runResalePaymentTransfer(request)).booking;
    return res.json({ message: "Payment confirmed; ticket transferred to buyer.", booking });
  } catch (err) {
    console.error("Confirm payment and transfer error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Buyer: confirm they paid — transfers ticket (same server logic as admin confirm; no admin required)
exports.buyerConfirmPaymentAndTransfer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { requestId } = req.params;
    const request = await ResaleRequest.findById(requestId).populate("listingId");
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (String(request.buyerId) !== String(userId)) {
      return res.status(403).json({ message: "Only the buyer can complete this purchase" });
    }
    if (request.status !== "PaymentPending") {
      return res.status(400).json({ message: "Request is not awaiting payment confirmation" });
    }
    const booking = (await runResalePaymentTransfer(request)).booking;
    return res.json({ message: "Purchase complete; ticket transferred to your account.", booking });
  } catch (err) {
    console.error("Buyer confirm payment error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: full ownership trail for a ticket (primary purchase from bookings + white-market transfers)
exports.adminTicketTransferHistory = async (req, res) => {
  try {
    const ticketId = Number(req.params.ticketId);
    if (!Number.isFinite(ticketId)) {
      return res.status(400).json({ message: "Invalid ticket id" });
    }
    const ticket = await Ticket.findOne({ TicketID: ticketId })
      .populate("OwnerUserId", "Username Email")
      .lean();
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const firstDetail = await BookingDetail.findOne({ TicketID: ticketId }).sort({ DetailID: 1 }).lean();
    let primaryPurchase = null;
    if (firstDetail) {
      const booking = await Booking.findOne({ BookingID: firstDetail.BookingID })
        .populate("userId", "Username Email")
        .lean();
      if (booking) {
        primaryPurchase = {
          kind: "primary_purchase",
          bookingId: booking.BookingID,
          purchasedAt: booking.Date,
          pricePaid: firstDetail.PriceAtBooking,
          owner: booking.userId,
        };
      }
    }

    const resaleTransfers = await TicketTransferHistory.find({ ticketId })
      .sort({ occurredAt: 1 })
      .populate("fromUserId", "Username Email")
      .populate("toUserId", "Username Email")
      .lean();

    return res.json({
      ticketId,
      eventId: ticket.EventID,
      currentOwner: ticket.OwnerUserId,
      primaryPurchase,
      resaleTransfers,
    });
  } catch (err) {
    console.error("Admin ticket history error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Admin: reject a resale request (Pending or PaymentPending → listing back to Listed)
exports.rejectRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const request = await ResaleRequest.findById(requestId).populate("listingId");
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.status !== "Pending" && request.status !== "PaymentPending") {
      return res.status(400).json({ message: "Request cannot be rejected in current state" });
    }
    request.status = "Rejected";
    await request.save();
    request.listingId.status = "Listed";
    await request.listingId.save();
    return res.json({ message: "Resale request rejected" });
  } catch (err) {
    console.error("Reject resale error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get one resale request by id (admin only)
exports.getRequestById = async (req, res) => {
  try {
    const request = await ResaleRequest.findById(req.params.requestId)
      .populate({ path: "listingId", populate: { path: "eventId", select: "Name" } })
      .populate("buyerId", "Username Email")
      .lean();
    if (!request) return res.status(404).json({ message: "Request not found" });
    return res.json(request);
  } catch (err) {
    console.error("Get resale request error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Buyer: list all own resale requests (where I am the buyer)
exports.listMyRequests = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const requests = await ResaleRequest.find({ buyerId: userId })
      .populate({ path: "listingId", populate: { path: "eventId", select: "Name StartDate" } })
      .sort({ createdAt: -1 })
      .lean();
    return res.json(requests);
  } catch (err) {
    console.error("List my resale requests error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Buyer: get own request by id (for payment page: totalAmount, platformFee, status)
exports.getMyRequest = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?._id;
    const request = await ResaleRequest.findOne({
      _id: req.params.requestId,
      buyerId: userId,
    })
      .populate({ path: "listingId", populate: { path: "eventId", select: "Name" } })
      .lean();
    if (!request) return res.status(404).json({ message: "Request not found" });
    return res.json(request);
  } catch (err) {
    console.error("Get my resale request error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete resale request (admin only). Sets listing back to Listed if it was Pending.
exports.removeRequest = async (req, res) => {
  try {
    const request = await ResaleRequest.findById(req.params.requestId).populate("listingId");
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.listingId && request.listingId.status === "Pending") {
      request.listingId.status = "Listed";
      await request.listingId.save();
    }
    await ResaleRequest.findByIdAndDelete(req.params.requestId);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete resale request error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
