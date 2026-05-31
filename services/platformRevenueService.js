const Booking = require("../models/Booking");
const Event = require("../models/Event");
const FoodOrder = require("../models/FoodOrder");
const ResaleRequest = require("../models/ResaleRequest");

const TICKET_PLATFORM_FEE_PERCENT = Number(process.env.TICKET_PLATFORM_FEE_PERCENT || 5);
const GENERAL_PLATFORM_FEE_PERCENT = Number(process.env.GENERAL_PLATFORM_FEE_PERCENT || 10);

function roundEgp(n) {
  return Math.round(Number(n) || 0);
}

function feeFromGmv(gmv, percent) {
  return roundEgp(((Number(gmv) || 0) * percent) / 100);
}

async function sumTicketGmv(match = {}) {
  const [result] = await Booking.aggregate([
    { $match: { Status: "Confirmed", ...match } },
    {
      $lookup: {
        from: "BookingDetail",
        localField: "BookingID",
        foreignField: "BookingID",
        as: "details",
      },
    },
    { $unwind: "$details" },
    { $group: { _id: null, total: { $sum: "$details.PriceAtBooking" } } },
  ]);
  return result?.total ?? 0;
}

async function sumSetupDepositFees(match = {}) {
  const [result] = await Event.aggregate([
    { $match: { "setupDeposit.paymentStatus": "paid", ...match } },
    { $group: { _id: null, total: { $sum: "$setupDeposit.platformFeeEgp" } } },
  ]);
  return result?.total ?? 0;
}

async function sumFoodGmv(match = {}) {
  const [result] = await FoodOrder.aggregate([
    {
      $match: {
        paymentStatus: "Paid",
        Status: { $ne: "Cancelled" },
        ...match,
      },
    },
    { $group: { _id: null, total: { $sum: "$subtotal" } } },
  ]);
  return result?.total ?? 0;
}

async function sumResaleFees(match = {}) {
  const [result] = await ResaleRequest.aggregate([
    { $match: { status: "Approved", platformFee: { $gt: 0 }, ...match } },
    { $group: { _id: null, total: { $sum: "$platformFee" } } },
  ]);
  return result?.total ?? 0;
}

async function computePlatformRevenue({ dateFieldMatch = {} } = {}) {
  const ticketMatch = dateFieldMatch.tickets ?? {};
  const depositMatch = dateFieldMatch.deposits ?? {};
  const foodMatch = dateFieldMatch.food ?? {};
  const resaleMatch = dateFieldMatch.resale ?? {};

  const [ticketGmv, depositFees, foodGmv, resaleFees] = await Promise.all([
    sumTicketGmv(ticketMatch),
    sumSetupDepositFees(depositMatch),
    sumFoodGmv(foodMatch),
    sumResaleFees(resaleMatch),
  ]);

  const ticketFees = feeFromGmv(ticketGmv, TICKET_PLATFORM_FEE_PERCENT);
  const foodFees = feeFromGmv(foodGmv, GENERAL_PLATFORM_FEE_PERCENT);

  return roundEgp(ticketFees + depositFees + foodFees + resaleFees);
}

async function getTotalPlatformRevenue() {
  return computePlatformRevenue();
}

async function getMonthlyPlatformRevenue(monthBuckets) {
  return Promise.all(
    monthBuckets.map(async (bucket) => {
      const revenue = await computePlatformRevenue({
        dateFieldMatch: {
          tickets: { Date: { $gte: bucket.start, $lte: bucket.end } },
          deposits: { "setupDeposit.paidAt": { $gte: bucket.start, $lte: bucket.end } },
          food: { createdAt: { $gte: bucket.start, $lte: bucket.end } },
          resale: { updatedAt: { $gte: bucket.start, $lte: bucket.end } },
        },
      });
      return { month: bucket.month, revenue };
    }),
  );
}

module.exports = {
  TICKET_PLATFORM_FEE_PERCENT,
  GENERAL_PLATFORM_FEE_PERCENT,
  getTotalPlatformRevenue,
  getMonthlyPlatformRevenue,
  computePlatformRevenue,
};
