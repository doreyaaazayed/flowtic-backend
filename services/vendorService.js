const Vendor = require("../models/Vendor");
const VendorEventLink = require("../models/VendorEventLink");
const Restaurant = require("../models/Restaurant");
const FoodOrder = require("../models/FoodOrder");
const FoodOrderItem = require("../models/FoodOrderItem");
const Event = require("../models/Event");

async function getVendorEventIds(vendorId) {
  const vendor = await Vendor.findOne({ VendorID: vendorId }).select("EventID").lean();
  const links = await VendorEventLink.find({ VendorID: vendorId }).select("EventID").lean();
  const ids = new Set();
  if (vendor?.EventID != null) ids.add(vendor.EventID);
  for (const l of links) ids.add(l.EventID);
  return [...ids];
}

async function ensureVendorEventLink(vendorId, eventId) {
  const existing = await VendorEventLink.findOne({ VendorID: vendorId, EventID: eventId }).lean();
  if (existing) return existing;
  return VendorEventLink.create({ VendorID: vendorId, EventID: eventId });
}

async function getVendorForUser(userId) {
  if (!userId) return null;
  return Vendor.findOne({ userId, active: true }).lean();
}

async function getRestaurantIdsForVendor(vendorId) {
  const rows = await Restaurant.find({ VendorID: vendorId, active: true })
    .select("RestaurantID VenueID")
    .lean();
  return rows.map((r) => r.RestaurantID);
}

async function getRestaurantIdsForVendorAtEvent(vendorId, eventId) {
  const event = await Event.findOne({ EventID: eventId }).select("VenueID").lean();
  if (!event?.VenueID) return [];
  const rows = await Restaurant.find({
    VendorID: vendorId,
    VenueID: event.VenueID,
    active: true,
  })
    .select("RestaurantID")
    .lean();
  return rows.map((r) => r.RestaurantID);
}

async function vendorHasEvent(vendorId, eventId) {
  const ids = await getVendorEventIds(vendorId);
  return ids.includes(Number(eventId));
}

async function getOrderIdsForVendorAtEvent(vendorId, eventId) {
  const restIds = await getRestaurantIdsForVendorAtEvent(vendorId, eventId);
  if (!restIds.length) return [];
  const orderIds = await FoodOrderItem.distinct("OrderID", {
    RestaurantID: { $in: restIds },
  });
  if (!orderIds.length) return [];
  const orders = await FoodOrder.find({
    OrderID: { $in: orderIds },
    EventID: eventId,
    Status: { $ne: "Cancelled" },
  })
    .select("OrderID")
    .lean();
  return orders.map((o) => o.OrderID);
}

/**
 * Load order if it belongs to vendor's restaurant(s) at an assigned event.
 */
async function assertVendorOrderAccess(vendor, orderId, eventIdFilter = null) {
  const order = await FoodOrder.findOne({ OrderID: Number(orderId) }).lean();
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  const eventIds = await getVendorEventIds(vendor.VendorID);
  if (!eventIds.includes(order.EventID)) {
    const err = new Error("Order is not for your assigned event");
    err.statusCode = 403;
    throw err;
  }
  if (eventIdFilter != null && order.EventID !== Number(eventIdFilter)) {
    const err = new Error("Order is not for the selected event");
    err.statusCode = 403;
    throw err;
  }

  const restIds = await getRestaurantIdsForVendorAtEvent(vendor.VendorID, order.EventID);
  const items = await FoodOrderItem.find({
    OrderID: order.OrderID,
    RestaurantID: { $in: restIds },
  }).lean();
  if (!items.length) {
    const err = new Error("Order does not include items from your stand");
    err.statusCode = 403;
    throw err;
  }
  return { order, items, restaurantIds: restIds };
}

async function getVendorDashboardContext(vendor) {
  const eventIds = await getVendorEventIds(vendor.VendorID);
  const [events, restaurants] = await Promise.all([
    eventIds.length
      ? Event.find({ EventID: { $in: eventIds } })
          .select("EventID Name VenueID Status StartDate EndDate imageUrl")
          .lean()
      : [],
    Restaurant.find({ VendorID: vendor.VendorID }).sort({ sortOrder: 1 }).lean(),
  ]);

  const primary =
    events.find((e) => e.EventID === vendor.EventID) || events[0] || null;

  return {
    vendor,
    event: primary,
    events,
    restaurants,
    eventIds,
  };
}

const VENDOR_STATUS_FLOW = {
  Confirmed: ["Preparing", "Cancelled"],
  Preparing: ["Ready", "Cancelled"],
  Ready: ["Completed", "Cancelled"],
  Pending: ["Confirmed", "Cancelled"],
};

function vendorCanSetStatus(from, to) {
  const allowed = VENDOR_STATUS_FLOW[from];
  return allowed ? allowed.includes(to) : false;
}

module.exports = {
  getVendorForUser,
  getVendorEventIds,
  ensureVendorEventLink,
  getRestaurantIdsForVendor,
  getRestaurantIdsForVendorAtEvent,
  getOrderIdsForVendorAtEvent,
  assertVendorOrderAccess,
  getVendorDashboardContext,
  vendorCanSetStatus,
  vendorHasEvent,
  VENDOR_STATUS_FLOW,
};
