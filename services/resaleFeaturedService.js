const ResaleListing = require("../models/ResaleListing");
const ResaleRequest = require("../models/ResaleRequest");
const Ticket = require("../models/Ticket");
const TicketCategory = require("../models/TicketCategory");
const Seat = require("../models/Seat");
const resalePrice = require("./resalePriceService");

async function enrichListing(listing) {
  const ticket = await Ticket.findOne({ TicketID: listing.TicketID }).lean();
  let categoryName = null;
  let seatLabel = null;

  if (ticket) {
    const cat = await TicketCategory.findOne({
      TicketCatID: ticket.TicketCatID,
      EventID: ticket.EventID,
    })
      .select("Name")
      .lean();
    categoryName = cat?.Name ?? null;

    if (ticket.SeatID != null && ticket.SeatID !== 0) {
      const seat = await Seat.findOne({
        EventID: ticket.EventID,
        SeatID: ticket.SeatID,
      })
        .select("SectionName RowLabel SeatNumber")
        .lean();
      if (seat) {
        seatLabel = `${seat.SectionName} · Row ${seat.RowLabel} · Seat ${seat.SeatNumber}`;
      }
    }
  }

  const originalPurchasePrice = await resalePrice.getOriginalPurchasePrice(listing.TicketID);
  const interestCount = await ResaleRequest.countDocuments({
    listingId: listing._id,
    status: { $in: ["Pending", "PaymentPending"] },
  });

  const orig = originalPurchasePrice != null ? Number(originalPurchasePrice) : null;
  const resale = Number(listing.price);
  let savingsPercent = 0;
  if (orig != null && orig > 0 && resale < orig) {
    savingsPercent = Math.round(((orig - resale) / orig) * 100);
  }

  return {
    ...listing,
    originalPurchasePrice: orig,
    categoryName,
    seatLabel,
    savingsPercent,
    interestCount,
  };
}

function eventStartMs(listing) {
  const d = listing.eventId?.StartDate;
  if (!d) return null;
  const ms = new Date(d).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {Array<Record<string, unknown>>} listings enriched
 * @param {'nearest'|'best'} mode
 */
function pickFeatured(listings, mode) {
  if (!listings.length) return null;

  if (mode === "best") {
    const withSavings = listings.filter(
      (l) =>
        l.originalPurchasePrice != null &&
        Number(l.originalPurchasePrice) > Number(l.price),
    );
    const pool = withSavings.length ? withSavings : listings;
    return [...pool].sort((a, b) => {
      const saveA = Number(a.savingsPercent) || 0;
      const saveB = Number(b.savingsPercent) || 0;
      if (saveB !== saveA) return saveB - saveA;
      const diffA = Number(a.originalPurchasePrice) - Number(a.price);
      const diffB = Number(b.originalPurchasePrice) - Number(b.price);
      return diffB - diffA;
    })[0];
  }

  const now = Date.now();
  const upcoming = listings.filter((l) => {
    const ms = eventStartMs(l);
    return ms != null && ms >= now;
  });
  const pool = upcoming.length ? upcoming : listings;

  return [...pool].sort((a, b) => {
    const msA = eventStartMs(a);
    const msB = eventStartMs(b);
    if (msA == null && msB == null) return 0;
    if (msA == null) return 1;
    if (msB == null) return -1;
    if (upcoming.length) return msA - msB;
    return Math.abs(msA - now) - Math.abs(msB - now);
  })[0];
}

/**
 * @param {'nearest'|'best'} mode
 */
async function getFeaturedListing(mode = "nearest") {
  const safeMode = mode === "best" ? "best" : "nearest";
  const rows = await ResaleListing.find({ status: "Listed" })
    .populate("eventId", "Name StartDate EndDate")
    .populate("sellerId", "Username Email")
    .lean();

  if (!rows.length) return null;

  const enriched = await Promise.all(rows.map((r) => enrichListing(r)));
  return pickFeatured(enriched, safeMode);
}

module.exports = { getFeaturedListing, enrichListing, pickFeatured };
