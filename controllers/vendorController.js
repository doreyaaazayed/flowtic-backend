const Vendor = require("../models/Vendor");
const Restaurant = require("../models/Restaurant");
const FoodItem = require("../models/FoodItem");
const FoodCategory = require("../models/FoodCategory");
const FoodOrder = require("../models/FoodOrder");
const FoodOrderItem = require("../models/FoodOrderItem");
const Event = require("../models/Event");
const UserNotification = require("../models/UserNotification");
const {
  getVendorDashboardContext,
  getRestaurantIdsForVendor,
  getRestaurantIdsForVendorAtEvent,
  getVendorEventIds,
  vendorHasEvent,
  assertVendorOrderAccess,
  vendorCanSetStatus,
} = require("../services/vendorService");
const {
  computeTotals,
  resolveDeliveryMethod,
  maxPrepMinutes,
} = require("../services/foodPricingService");
const {
  getVendorEarningsSummary,
  provisionVendorAccount,
} = require("../services/vendorProvisionService");

async function nextId(Model, field) {
  const last = await Model.findOne().sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

/** POST /api/admin/food/vendors/provision — admin only */
exports.provisionVendor = async (req, res) => {
  try {
    const { Name, Email, Phone, EventID, restaurantName, sendCredentialsEmail } = req.body || {};
    const eventIdNum = Number(EventID);
    if (!Number.isFinite(eventIdNum)) {
      return res.status(400).json({ message: "EventID is required" });
    }
    const event = await Event.findOne({ EventID: eventIdNum }).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

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
    console.error("provisionVendor:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/admin/food/vendors */
exports.listVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find().sort({ createdAt: -1 }).lean();
    const eventIds = [...new Set(vendors.map((v) => v.EventID).filter((id) => id != null))];
    const events = await Event.find({ EventID: { $in: eventIds } })
      .select("EventID Name")
      .lean();
    const eventMap = Object.fromEntries(events.map((e) => [e.EventID, e.Name]));
    return res.json({
      vendors: vendors.map((v) => ({
        ...v,
        eventName: v.EventID != null ? eventMap[v.EventID] : null,
      })),
    });
  } catch (err) {
    console.error("listVendors:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/vendor/me */
exports.getMe = async (req, res) => {
  try {
    const ctx = await getVendorDashboardContext(req.vendor);
    return res.json(ctx);
  } catch (err) {
    console.error("vendor getMe:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/vendor/orders?eventId=&status= */
exports.listOrders = async (req, res) => {
  try {
    const vendor = req.vendor;
    const eventIds = await getVendorEventIds(vendor.VendorID);
    if (!eventIds.length) return res.json({ orders: [] });

    const eventIdFilter = req.query.eventId != null ? Number(req.query.eventId) : null;
    const scopedEventIds =
      eventIdFilter != null && Number.isFinite(eventIdFilter)
        ? eventIds.filter((id) => id === eventIdFilter)
        : eventIds;
    if (!scopedEventIds.length) return res.json({ orders: [] });

    const restIds = await getRestaurantIdsForVendor(vendor.VendorID);
    if (!restIds.length) return res.json({ orders: [] });

    const orderIds = await FoodOrderItem.distinct("OrderID", {
      RestaurantID: { $in: restIds },
    });
    if (!orderIds.length) return res.json({ orders: [] });

    const statusFilter = req.query.status ? String(req.query.status) : null;
    const filter = {
      OrderID: { $in: orderIds },
      EventID: { $in: scopedEventIds },
    };
    if (statusFilter) filter.Status = statusFilter;

    const orders = await FoodOrder.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const ids = orders.map((o) => o.OrderID);
    const allItems =
      ids.length > 0 ? await FoodOrderItem.find({ OrderID: { $in: ids } }).lean() : [];
    const itemsByOrder = {};
    for (const item of allItems) {
      if (!itemsByOrder[item.OrderID]) itemsByOrder[item.OrderID] = [];
      itemsByOrder[item.OrderID].push(item);
    }

    const enriched = orders.map((o) => {
      const vendorLines = (itemsByOrder[o.OrderID] || []).filter((l) =>
        restIds.includes(l.RestaurantID),
      );
      const vendorSubtotal = vendorLines.reduce((s, l) => s + l.lineTotal, 0);
      return {
        ...o,
        items: vendorLines,
        vendorItems: vendorLines,
        vendorSubtotal,
        isSeatDelivery: o.deliveryMethodCode === "seat_delivery",
        isPickup:
          o.deliveryMethodCode === "pickup" ||
          o.deliveryMethodCode === "counter" ||
          !o.deliveryMethodCode,
        isPosOrder: o.orderSource === "vendor_pos",
      };
    });

    return res.json({ orders: enriched });
  } catch (err) {
    console.error("vendor listOrders:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/vendor/earnings?eventId= */
exports.getEarnings = async (req, res) => {
  try {
    const eventIdFilter =
      req.query.eventId != null && Number.isFinite(Number(req.query.eventId))
        ? Number(req.query.eventId)
        : null;
    const summary = await getVendorEarningsSummary(req.vendor, eventIdFilter);
    return res.json(summary);
  } catch (err) {
    console.error("vendor getEarnings:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PATCH /api/vendor/orders/:orderId/status */
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = FoodOrder.schema.path("Status").enumValues;
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${allowed.join(", ")}` });
    }

    const { order } = await assertVendorOrderAccess(req.vendor, req.params.orderId);
    const doc = await FoodOrder.findOne({ OrderID: order.OrderID });
    if (!doc) return res.status(404).json({ message: "Order not found" });

    if (!vendorCanSetStatus(doc.Status, status)) {
      return res.status(400).json({
        message: `Cannot change status from ${doc.Status} to ${status}`,
      });
    }

    doc.Status = status;
    await doc.save();

    let body = `Your food order #${doc.OrderID} status is now ${status}.`;
    if (status === "Preparing") body = `Order #${doc.OrderID} is being prepared.`;
    if (status === "Ready") {
      body =
        doc.deliveryMethodCode === "seat_delivery"
          ? `Order #${doc.OrderID} is on the way to your seat.`
          : `Order #${doc.OrderID} is ready — please pick it up at the vendor.`;
    }
    if (status === "Completed") {
      body =
        doc.deliveryMethodCode === "seat_delivery"
          ? `Order #${doc.OrderID} has been delivered. Enjoy!`
          : `Order #${doc.OrderID} is complete. Thank you!`;
    }

    if (doc.orderSource !== "vendor_pos") {
      await UserNotification.create({
        userId: doc.userId,
        type: "food_order",
        title: "Food order update",
        body,
        meta: { orderId: doc.OrderID, status },
      });
    }

    const restIds = await getRestaurantIdsForVendor(req.vendor.VendorID);
    const items = await FoodOrderItem.find({ OrderID: doc.OrderID }).lean();
    const vendorLines = items.filter((l) => restIds.includes(l.RestaurantID));
    return res.json({ order: doc.toObject(), items: vendorLines });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("vendor updateOrderStatus:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/vendor/menu/items */
exports.listMenuItems = async (req, res) => {
  try {
    const restIds = await getRestaurantIdsForVendor(req.vendor.VendorID);
    if (!restIds.length) return res.json({ items: [] });
    const items = await FoodItem.find({ RestaurantID: { $in: restIds } })
      .sort({ Name: 1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    console.error("vendor listMenuItems:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/vendor/orders — POS / walk-in order */
exports.createPosOrder = async (req, res) => {
  try {
    const vendor = req.vendor;
    const {
      EventID,
      items: lineItems,
      deliveryMethodCode = "pickup",
      seatLabel,
      notes,
      customerLabel,
      paymentMethod = "cod",
    } = req.body || {};

    const eventIdNum = Number(EventID);
    if (!Number.isFinite(eventIdNum)) {
      return res.status(400).json({ message: "EventID is required" });
    }
    if (!(await vendorHasEvent(vendor.VendorID, eventIdNum))) {
      return res.status(403).json({ message: "You are not assigned to this event" });
    }

    const event = await Event.findOne({ EventID: eventIdNum }).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    const restIds = await getRestaurantIdsForVendorAtEvent(vendor.VendorID, eventIdNum);
    if (!restIds.length) {
      return res.status(400).json({ message: "No stand at this event" });
    }

    const lines = Array.isArray(lineItems) ? lineItems : [];
    if (!lines.length) {
      return res.status(400).json({ message: "Add at least one menu item" });
    }

    const foodIds = lines.map((l) => Number(l.foodItemId));
    const foods = await FoodItem.find({
      FoodItemID: { $in: foodIds },
      RestaurantID: { $in: restIds },
    }).lean();
    const foodMap = Object.fromEntries(foods.map((f) => [f.FoodItemID, f]));

    let subtotal = 0;
    const resolved = [];
    for (const line of lines) {
      const qty = Math.max(1, Number(line.quantity) || 1);
      const food = foodMap[Number(line.foodItemId)];
      if (!food || !food.availability || food.stockQuantity < qty) {
        return res.status(400).json({
          message: `Item ${line.foodItemId} is unavailable`,
        });
      }
      const lineTotal = Math.round(food.Price * qty * 100) / 100;
      subtotal += lineTotal;
      resolved.push({ food, qty, lineTotal });
    }

    const code = String(deliveryMethodCode || "pickup").toLowerCase();
    const delivery = await resolveDeliveryMethod(code, event.EventID);
    const totals = computeTotals(subtotal, delivery || code);
    const prepMin = maxPrepMinutes(foods);
    const estimatedReadyAt = new Date(Date.now() + prepMin * 60 * 1000);

    const orderId = await nextId(FoodOrder, "OrderID");
    const order = await FoodOrder.create({
      OrderID: orderId,
      userId: vendor.userId,
      EventID: event.EventID,
      eventMongoId: event._id,
      Status: "Confirmed",
      orderSource: "vendor_pos",
      vendorPlacedBy: vendor.VendorID,
      posCustomerLabel: String(customerLabel || "").trim(),
      deliveryMethod: ["pickup", "counter", "seat_delivery"].includes(code) ? code : "pickup",
      deliveryMethodCode: code,
      deliveryMethodName: delivery?.name || code,
      deliveryFee: totals.deliveryFee || 0,
      estimatedDeliveryMinutes: totals.estimatedDeliveryMinutes || 0,
      seatLabel: String(seatLabel || "").trim(),
      notes: notes ? String(notes) : "",
      subtotal: totals.subtotal,
      serviceFee: totals.serviceFee,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      paymentMethod: paymentMethod === "card" ? "card" : "cod",
      paymentBrand: "cod",
      paymentStatus: "Paid",
      estimatedReadyAt,
    });

    let detailId = await nextId(FoodOrderItem, "DetailID");
    const createdItems = [];
    for (const { food, qty, lineTotal } of resolved) {
      const row = await FoodOrderItem.create({
        DetailID: detailId++,
        OrderID: orderId,
        FoodItemID: food.FoodItemID,
        RestaurantID: food.RestaurantID,
        Name: food.Name,
        quantity: qty,
        unitPrice: food.Price,
        lineTotal,
      });
      createdItems.push(row);
      await FoodItem.updateOne(
        { FoodItemID: food.FoodItemID },
        { $inc: { stockQuantity: -qty, popularityScore: qty } },
      );
    }

    return res.status(201).json({ order: order.toObject(), items: createdItems });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("vendor createPosOrder:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/vendor/menu/items */
exports.createMenuItem = async (req, res) => {
  try {
    const eventIdNum =
      req.body?.EventID != null
        ? Number(req.body.EventID)
        : req.query.eventId != null
          ? Number(req.query.eventId)
          : req.vendor.EventID;

    const restaurants = await Restaurant.find({
      VendorID: req.vendor.VendorID,
      active: true,
    }).lean();
    if (!restaurants.length) {
      return res.status(400).json({ message: "No restaurant linked to your vendor account" });
    }

    let rest = restaurants[0];
    if (eventIdNum != null && Number.isFinite(eventIdNum)) {
      const event = await Event.findOne({ EventID: eventIdNum }).select("VenueID").lean();
      if (event?.VenueID) {
        const match = restaurants.find((r) => Number(r.VenueID) === Number(event.VenueID));
        if (match) rest = match;
      }
    }
    const {
      Name,
      Description,
      Price,
      imageUrl,
      CategoryID,
      categoryName,
      stockQuantity,
      availability,
      isPopular,
    } = req.body || {};
    if (!Name || Price == null) {
      return res.status(400).json({ message: "Name and Price are required" });
    }

    let catId = CategoryID ? Number(CategoryID) : null;
    if (!catId && categoryName) {
      let cat = await FoodCategory.findOne({
        VenueID: rest.VenueID,
        RestaurantID: rest.RestaurantID,
        Name: categoryName,
      });
      if (!cat) {
        cat = await FoodCategory.create({
          CategoryID: await nextId(FoodCategory, "CategoryID"),
          VenueID: rest.VenueID,
          RestaurantID: rest.RestaurantID,
          Name: categoryName,
          sortOrder: 0,
        });
      }
      catId = cat.CategoryID;
    }
    if (!catId) {
      let defaultCat = await FoodCategory.findOne({
        VenueID: rest.VenueID,
        RestaurantID: rest.RestaurantID,
      });
      if (!defaultCat) {
        defaultCat = await FoodCategory.create({
          CategoryID: await nextId(FoodCategory, "CategoryID"),
          VenueID: rest.VenueID,
          RestaurantID: rest.RestaurantID,
          Name: "Menu",
          sortOrder: 0,
        });
      }
      catId = defaultCat.CategoryID;
    }

    const item = await FoodItem.create({
      FoodItemID: await nextId(FoodItem, "FoodItemID"),
      VenueID: rest.VenueID,
      RestaurantID: rest.RestaurantID,
      EventID: eventIdNum || req.vendor.EventID || null,
      CategoryID: catId,
      Name,
      Description: Description || "",
      Price: Number(Price),
      imageUrl: imageUrl || "",
      stockQuantity: stockQuantity ?? 100,
      availability: availability !== false,
      isPopular: !!isPopular,
    });

    return res.status(201).json(item);
  } catch (err) {
    console.error("vendor createMenuItem:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/vendor/menu/items/:foodItemId */
exports.updateMenuItem = async (req, res) => {
  try {
    const restIds = await getRestaurantIdsForVendor(req.vendor.VendorID);
    const item = await FoodItem.findOne({
      FoodItemID: Number(req.params.foodItemId),
      RestaurantID: { $in: restIds },
    });
    if (!item) return res.status(404).json({ message: "Item not found" });

    const fields = [
      "Name",
      "Description",
      "Price",
      "imageUrl",
      "stockQuantity",
      "availability",
      "isPopular",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) item[f] = req.body[f];
    }
    await item.save();
    return res.json(item);
  } catch (err) {
    console.error("vendor updateMenuItem:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
