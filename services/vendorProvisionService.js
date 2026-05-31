const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const Restaurant = require("../models/Restaurant");
const FoodOrder = require("../models/FoodOrder");
const FoodOrderItem = require("../models/FoodOrderItem");
const Event = require("../models/Event");
const emailService = require("./emailService");
const {
  getRestaurantIdsForVendor,
  getVendorEventIds,
  ensureVendorEventLink,
} = require("./vendorService");
const { assertValidEgyptPhone } = require("../utils/fieldValidation");

const ROLE_VENDOR = 4;

async function nextId(Model, field) {
  const last = await Model.findOne().sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64url").slice(0, 12);
}

function slugUsername(email, name) {
  const base =
    String(email || "")
      .split("@")[0]
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .slice(0, 24) ||
    String(name || "vendor")
      .replace(/\s+/g, "_")
      .slice(0, 24);
  return `${base}_${Math.floor(1000 + Math.random() * 9000)}`;
}

async function getOrganizerEventIds(userId) {
  const events = await Event.find({ organizer: userId }).select("EventID").lean();
  return events.map((e) => e.EventID);
}

async function getEventForOrganizerAccess(userId, role, eventIdNum) {
  if (!Number.isFinite(eventIdNum)) {
    const err = new Error("Invalid event ID");
    err.statusCode = 400;
    throw err;
  }
  const event = await Event.findOne({ EventID: eventIdNum }).lean();
  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    throw err;
  }
  if (role !== "admin" && String(event.organizer) !== String(userId)) {
    const err = new Error("You can only manage vendors for your own events");
    err.statusCode = 403;
    throw err;
  }
  return event;
}

async function getVendorEarningsSummary(vendor, eventIdFilter = null) {
  const eventIds = await getVendorEventIds(vendor.VendorID);
  const scopedEvents =
    eventIdFilter != null && Number.isFinite(Number(eventIdFilter))
      ? eventIds.filter((id) => id === Number(eventIdFilter))
      : eventIds;

  if (!scopedEvents.length) {
    return { eventId: eventIdFilter ?? null, orderCount: 0, activeOrders: 0, itemCount: 0, grossRevenue: 0 };
  }

  const restIds = await getRestaurantIdsForVendor(vendor.VendorID);
  if (!restIds.length) {
    return {
      eventId: eventIdFilter ?? null,
      orderCount: 0,
      activeOrders: 0,
      itemCount: 0,
      grossRevenue: 0,
    };
  }

  const orderIds = await FoodOrderItem.distinct("OrderID", {
    RestaurantID: { $in: restIds },
  });
  if (!orderIds.length) {
    return {
      eventId: eventIdFilter ?? null,
      orderCount: 0,
      activeOrders: 0,
      itemCount: 0,
      grossRevenue: 0,
    };
  }

  const completedOrders = await FoodOrder.find({
    OrderID: { $in: orderIds },
    EventID: { $in: scopedEvents },
    Status: "Completed",
    paymentStatus: { $in: ["Paid", "Pending"] },
  })
    .select("OrderID")
    .lean();
  const completedIds = new Set(completedOrders.map((o) => o.OrderID));
  const items = await FoodOrderItem.find({
    OrderID: { $in: [...completedIds] },
    RestaurantID: { $in: restIds },
  }).lean();
  const grossRevenue = items.reduce((s, i) => s + i.lineTotal, 0);
  const activeOrders = await FoodOrder.countDocuments({
    OrderID: { $in: orderIds },
    EventID: { $in: scopedEvents },
    Status: { $in: ["Confirmed", "Preparing", "Ready"] },
  });

  return {
    eventId: eventIdFilter ?? null,
    orderCount: completedIds.size,
    activeOrders,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    grossRevenue,
  };
}

/**
 * Create vendor user + Vendor row + Restaurant at event venue.
 * If email exists for a vendor user, link another event instead of failing.
 */
async function provisionVendorAccount({
  Name,
  Email,
  Phone,
  event,
  restaurantName,
  sendCredentialsEmail = true,
}) {
  if (!Name?.trim()) {
    const err = new Error("Name is required");
    err.statusCode = 400;
    throw err;
  }
  if (!Email?.trim()) {
    const err = new Error("Email is required");
    err.statusCode = 400;
    throw err;
  }
  if (!event?.EventID) {
    const err = new Error("Event is required");
    err.statusCode = 400;
    throw err;
  }
  if (event.VenueID == null || event.VenueID === "") {
    const err = new Error("Event must be linked to a venue before assigning an F&B vendor");
    err.statusCode = 400;
    throw err;
  }

  let phoneNorm = Phone?.trim() || "";
  if (phoneNorm) {
    try {
      phoneNorm = assertValidEgyptPhone(phoneNorm, { required: true });
    } catch (e) {
      e.statusCode = 400;
      throw e;
    }
  }

  const emailNorm = Email.toLowerCase().trim();
  const existingUser = await User.findOne({ Email: emailNorm });
  let user;
  let vendor;
  let tempPassword = null;
  let createdNewAccount = false;

  if (existingUser) {
    if (existingUser.role !== "vendor") {
      const err = new Error("Email already registered to a non-vendor account");
      err.statusCode = 400;
      throw err;
    }
    user = existingUser;
    vendor = await Vendor.findOne({ userId: user._id, active: { $ne: false } });
    if (!vendor) {
      const err = new Error("Vendor profile not found for this email");
      err.statusCode = 400;
      throw err;
    }
    const eventIds = await getVendorEventIds(vendor.VendorID);
    if (eventIds.includes(event.EventID)) {
      const err = new Error("This vendor is already assigned to this event");
      err.statusCode = 400;
      throw err;
    }
    const existingRest = await Restaurant.findOne({
      VendorID: vendor.VendorID,
      VenueID: event.VenueID,
      active: true,
    }).lean();
    if (existingRest) {
      const err = new Error("Vendor already has a stand at this event venue");
      err.statusCode = 400;
      throw err;
    }
    await ensureVendorEventLink(vendor.VendorID, event.EventID);
    if (vendor.EventID == null) {
      await Vendor.updateOne({ VendorID: vendor.VendorID }, { $set: { EventID: event.EventID } });
      vendor.EventID = event.EventID;
    }
  } else {
    tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const username = slugUsername(emailNorm, Name);

    const lastUser = await User.findOne().sort({ UserID: -1 }).select("UserID").lean();
    const nextUserID = (lastUser?.UserID ?? 0) + 1;

    user = await User.create({
      UserID: nextUserID,
      Username: username,
      Email: emailNorm,
      Password: hashedPassword,
      RoleID: ROLE_VENDOR,
      role: "vendor",
      emailVerified: true,
      FirstName: Name.trim(),
      Phone: phoneNorm || undefined,
    });

    vendor = await Vendor.create({
      VendorID: await nextId(Vendor, "VendorID"),
      Name: Name.trim(),
      Email: emailNorm,
      Phone: phoneNorm || "",
      userId: user._id,
      EventID: event.EventID,
      active: true,
    });

    await ensureVendorEventLink(vendor.VendorID, event.EventID);
    createdNewAccount = true;
  }

  const restaurant = await Restaurant.create({
    RestaurantID: await nextId(Restaurant, "RestaurantID"),
    VenueID: event.VenueID,
    VendorID: vendor.VendorID,
    Name: (restaurantName || Name).trim(),
    Description: `F&B vendor for ${event.Name}`,
    active: true,
  });

  let emailSent = false;
  if (createdNewAccount && tempPassword && sendCredentialsEmail) {
    const mail = await emailService.sendVendorCredentials(emailNorm, {
      name: Name.trim(),
      email: emailNorm,
      temporaryPassword: tempPassword,
      eventName: event.Name,
    });
    emailSent = mail.success === true;
  }

  return {
    vendor,
    restaurant,
    user: {
      id: String(user._id),
      username: user.Username,
      email: user.Email,
      role: user.role,
    },
    credentials: tempPassword
      ? {
          email: emailNorm,
          username: user.Username,
          temporaryPassword: tempPassword,
        }
      : null,
    createdNewAccount,
    emailSent,
    event: {
      EventID: event.EventID,
      Name: event.Name,
      VenueID: event.VenueID,
    },
  };
}

module.exports = {
  getOrganizerEventIds,
  getEventForOrganizerAccess,
  getVendorEarningsSummary,
  provisionVendorAccount,
};
