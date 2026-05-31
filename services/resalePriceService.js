const Booking = require("../models/Booking");
const BookingDetail = require("../models/BookingDetail");

/**
 * First primary purchase row for this ticket (ignores later resale bookings).
 */
async function getPrimaryBookingDetail(ticketId) {
  const tid = Number(ticketId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  return BookingDetail.findOne({ TicketID: tid }).sort({ DetailID: 1 }).lean();
}

/**
 * Amount the original buyer actually paid for this ticket (line price, with promo
 * discount pro-rated across tickets in the same booking when applicable).
 * @returns {Promise<number|null>}
 */
async function getOriginalPurchasePrice(ticketId) {
  const firstDetail = await getPrimaryBookingDetail(ticketId);
  if (!firstDetail || firstDetail.PriceAtBooking == null) return null;

  const linePrice = Number(firstDetail.PriceAtBooking);
  if (!Number.isFinite(linePrice) || linePrice < 0) return null;

  const booking = await Booking.findOne({ BookingID: firstDetail.BookingID })
    .select("SubtotalAmount TotalAmount DiscountAmount")
    .lean();
  if (!booking) return roundMoney(linePrice);

  const subtotal = Number(booking.SubtotalAmount ?? booking.TotalAmount ?? linePrice);
  const totalPaid = Number(booking.TotalAmount ?? subtotal);
  if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(totalPaid)) {
    return roundMoney(linePrice);
  }

  if (totalPaid >= subtotal - 1e-6) {
    return roundMoney(linePrice);
  }

  const siblings = await BookingDetail.find({ BookingID: firstDetail.BookingID })
    .select("PriceAtBooking")
    .lean();
  const lineSum = siblings.reduce((s, d) => s + Number(d.PriceAtBooking || 0), 0);
  if (lineSum <= 0) {
    return roundMoney(totalPaid / Math.max(1, siblings.length));
  }

  const share = (linePrice / lineSum) * totalPaid;
  return roundMoney(share);
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * @param {number} ticketId
 * @param {number} resalePrice
 * @returns {Promise<{ ok: true, maxPrice: number } | { ok: false, message: string, maxPrice?: number }>}
 */
async function validateResalePrice(ticketId, resalePrice) {
  const price = Number(resalePrice);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, message: "Resale price must be a number ≥ 0" };
  }

  const maxPrice = await getOriginalPurchasePrice(ticketId);
  if (maxPrice == null) {
    return {
      ok: false,
      message: "Original purchase price not found for this ticket. Contact support to list it.",
    };
  }

  if (price > maxPrice + 1e-6) {
    return {
      ok: false,
      message: `Resale price cannot exceed what you paid for this ticket (EGP ${maxPrice.toFixed(2)})`,
      maxPrice,
    };
  }

  return { ok: true, maxPrice };
}

module.exports = {
  getPrimaryBookingDetail,
  getOriginalPurchasePrice,
  validateResalePrice,
};
