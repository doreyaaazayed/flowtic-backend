const Vendor = require("../models/Vendor");
const VendorEventLink = require("../models/VendorEventLink");
const Event = require("../models/Event");
const { getVendorEventIds } = require("../services/vendorService");
const {
  getOrganizerEventIds,
  getEventForOrganizerAccess,
  getVendorEarningsSummary,
  provisionVendorAccount,
} = require("../services/vendorProvisionService");

const PROVISIONABLE_STATUSES = new Set(["Active", "Completed"]);

async function enrichVendorRow(vendor, eventMap) {
  const summary = await getVendorEarningsSummary(vendor);
  const eventIds = await getVendorEventIds(vendor.VendorID);
  const eventNames = eventIds.map((id) => eventMap[id]?.Name).filter(Boolean);
  const ev = vendor.EventID != null ? eventMap[vendor.EventID] : null;
  return {
    VendorID: vendor.VendorID,
    Name: vendor.Name,
    Email: vendor.Email,
    Phone: vendor.Phone || "",
    EventID: vendor.EventID,
    eventIds,
    active: vendor.active !== false,
    eventName: ev?.Name ?? eventNames[0] ?? null,
    eventNames,
    eventStatus: ev?.Status ?? null,
    grossRevenue: summary.grossRevenue,
    orderCount: summary.orderCount,
    activeOrders: summary.activeOrders,
    createdAt: vendor.createdAt,
  };
}

/** GET /api/organizer/vendors */
exports.listVendors = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const eventIds = await getOrganizerEventIds(userId);
    if (!eventIds.length) {
      return res.json({ vendors: [] });
    }

    const links = await VendorEventLink.find({ EventID: { $in: eventIds } })
      .select("VendorID EventID")
      .lean();
    const linkedVendorIds = [...new Set(links.map((l) => l.VendorID))];

    const [vendorsByEvent, vendorsByLink, events] = await Promise.all([
      Vendor.find({ EventID: { $in: eventIds } }).lean(),
      linkedVendorIds.length
        ? Vendor.find({ VendorID: { $in: linkedVendorIds } }).lean()
        : [],
      Event.find({ EventID: { $in: eventIds } })
        .select("EventID Name Status")
        .lean(),
    ]);
    const vendorMap = new Map();
    for (const v of [...vendorsByEvent, ...vendorsByLink]) {
      vendorMap.set(v.VendorID, v);
    }
    const vendors = [...vendorMap.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
    const eventMap = Object.fromEntries(events.map((e) => [e.EventID, e]));
    const enriched = await Promise.all(vendors.map((v) => enrichVendorRow(v, eventMap)));

    res.set("Cache-Control", "private, max-age=15");
    return res.json({ vendors: enriched });
  } catch (err) {
    console.error("organizer listVendors:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/organizer/vendors/provision */
exports.provisionVendor = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { Name, Email, Phone, EventID, restaurantName, sendCredentialsEmail } = req.body || {};
    const eventIdNum = Number(EventID);
    const event = await getEventForOrganizerAccess(userId, req.user.role, eventIdNum);

    if (!PROVISIONABLE_STATUSES.has(String(event.Status || ""))) {
      return res.status(400).json({
        message: "Vendors can only be added to Active or Completed events",
      });
    }

    const result = await provisionVendorAccount({
      Name,
      Email,
      Phone,
      event,
      restaurantName,
      sendCredentialsEmail: sendCredentialsEmail !== false,
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer provisionVendor:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/organizer/vendors/:vendorId/summary */
exports.getVendorSummary = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const vendorId = Number(req.params.vendorId);
    if (!Number.isFinite(vendorId)) {
      return res.status(400).json({ message: "Invalid vendor ID" });
    }

    const vendor = await Vendor.findOne({ VendorID: vendorId }).lean();
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (vendor.EventID == null) {
      return res.status(400).json({ message: "Vendor is not linked to an event" });
    }

    await getEventForOrganizerAccess(userId, req.user.role, vendor.EventID);
    const summary = await getVendorEarningsSummary(vendor);
    const event = await Event.findOne({ EventID: vendor.EventID })
      .select("EventID Name Status")
      .lean();

    res.set("Cache-Control", "private, max-age=15");
    return res.json({
      vendor: {
        VendorID: vendor.VendorID,
        Name: vendor.Name,
        Email: vendor.Email,
        EventID: vendor.EventID,
        active: vendor.active !== false,
        eventName: event?.Name ?? null,
        eventStatus: event?.Status ?? null,
      },
      summary,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer getVendorSummary:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
