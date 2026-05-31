const mongoose = require("mongoose");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const FoodCategory = require("../models/FoodCategory");
const FoodItem = require("../models/FoodItem");
const FoodCart = require("../models/FoodCart");
const FoodCartItem = require("../models/FoodCartItem");
const FoodOrder = require("../models/FoodOrder");
const FoodOrderItem = require("../models/FoodOrderItem");
const FoodReview = require("../models/FoodReview");
const UserFoodFavorite = require("../models/UserFoodFavorite");
const UserPaymentCard = require("../models/UserPaymentCard");
const UserNotification = require("../models/UserNotification");
const DeliveryMethod = require("../models/DeliveryMethod");
const loyaltyService = require("../services/loyaltyService");
const {
  resolveEvent,
  userHasTicketForEvent,
  assertFoodAccess,
  getUserBookingContext,
  getSeatDeliveryContext,
  filterDeliveryMethodsForSeat,
  toObjectId,
  ACCESS_DENIED,
} = require("../services/foodAccessService");
const {
  computeTotals,
  resolveDeliveryMethod,
  maxPrepMinutes,
} = require("../services/foodPricingService");
const { fetchMenuForEvent, findFoodItemForEvent } = require("../services/foodMenuService");
const { getVendorForUser, assertVendorOrderAccess, vendorCanSetStatus } = require("../services/vendorService");

const EDITABLE_STATUSES = FoodOrder.EDITABLE_STATUSES || ["Pending", "Confirmed"];
const PAYMENT_METHODS = FoodOrder.PAYMENT_METHODS || ["card", "cod", "apple_pay", "google_pay"];
const PAYMENT_BRANDS = FoodOrder.PAYMENT_BRANDS || [
  "visa",
  "mastercard",
  "amex",
  "apple_pay",
  "google_pay",
  "cod",
  "other",
];

function brandFromInput(paymentMethod, paymentBrand) {
  if (paymentBrand && PAYMENT_BRANDS.includes(String(paymentBrand))) return paymentBrand;
  if (paymentMethod === "apple_pay") return "apple_pay";
  if (paymentMethod === "google_pay") return "google_pay";
  if (paymentMethod === "cod") return "cod";
  return "other";
}

function uid(req) {
  return toObjectId(req.user?.id);
}

async function nextId(Model, field) {
  const last = await Model.findOne().sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

async function getOrCreateCartForUser(userIdObj, event) {
  let cart = await FoodCart.findOne({ userId: userIdObj, EventID: event.EventID });
  if (!cart) {
    cart = await FoodCart.create({
      userId: userIdObj,
      EventID: event.EventID,
      eventMongoId: event._id,
    });
  }
  return cart;
}

async function loadCartPayload(cart) {
  const items = await FoodCartItem.find({ cartId: cart._id }).lean();
  const foodIds = items.map((i) => i.FoodItemID);
  const foods = await FoodItem.find({ FoodItemID: { $in: foodIds } }).lean();
  const foodMap = Object.fromEntries(foods.map((f) => [f.FoodItemID, f]));

  const lines = items
    .map((line) => {
      const food = foodMap[line.FoodItemID];
      if (!food) return null;
      return {
        foodItemId: food.FoodItemID,
        foodMongoId: food._id,
        name: food.Name,
        imageUrl: food.imageUrl,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: round2(line.unitPrice * line.quantity),
        availability: food.availability,
        stockQuantity: food.stockQuantity,
        preparationTimeMinutes: food.preparationTimeMinutes,
        categoryId: food.CategoryID,
      };
    })
    .filter(Boolean);

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return { cart, items: lines, subtotal: round2(subtotal) };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** GET /api/food/event/:eventId/access */
exports.checkAccess = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const hasTicket = await userHasTicketForEvent(userIdObj, event);
    return res.json({
      hasAccess: hasTicket,
      message: hasTicket ? null : ACCESS_DENIED,
      eventId: event._id,
      eventNumericId: event.EventID,
    });
  } catch (err) {
    console.error("food checkAccess:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/food/event/:eventId — menu (requires ticket) */
exports.getEventMenu = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const event = await resolveEvent(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const hasTicket = await userHasTicketForEvent(userIdObj, event);
    if (!hasTicket) {
      return res.status(403).json({ message: ACCESS_DENIED, hasAccess: false });
    }

    const menu = await fetchMenuForEvent(event, req.query, userIdObj);

    const cart = await getOrCreateCartForUser(userIdObj, event);
    const cartPayload = await loadCartPayload(cart);

    return res.json({
      hasAccess: true,
      event: {
        _id: event._id,
        EventID: event.EventID,
        Name: event.Name,
        VenueID: event.VenueID ?? null,
      },
      venue: menu.venue,
      restaurants: menu.restaurants,
      categories: menu.categories,
      items: menu.items,
      popular: menu.popular,
      featured: menu.featured,
      venueExclusive: menu.venueExclusive,
      byCategory: menu.byCategory,
      byRestaurant: menu.byRestaurant,
      cart: cartPayload,
    });
  } catch (err) {
    console.error("food getEventMenu:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/food/:foodItemId */
exports.getFoodItem = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const id = Number(req.params.id || req.params.foodItemId);
    const item = await FoodItem.findOne(
      mongoose.Types.ObjectId.isValid(req.params.id)
        ? { _id: req.params.id }
        : { FoodItemID: id },
    ).lean();
    if (!item) return res.status(404).json({ message: "Food item not found" });

    const event = await Event.findOne({ EventID: item.EventID }).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    await assertFoodAccess(userIdObj, event);

    const reviews = await FoodReview.find({ FoodItemID: item.FoodItemID })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    const isFavorite = !!(await UserFoodFavorite.findOne({
      userId: userIdObj,
      FoodItemID: item.FoodItemID,
    }));

    return res.json({ item: { ...item, id: item.FoodItemID, isFavorite }, reviews });
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food getFoodItem:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/food/cart?eventId= */
exports.getCart = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const event = await resolveEvent(req.query.eventId);
    if (!event) return res.status(400).json({ message: "eventId query is required" });

    await assertFoodAccess(userIdObj, event);

    const cart = await getOrCreateCartForUser(userIdObj, event);
    const payload = await loadCartPayload(cart);

    const code = String(req.query.deliveryMethod || "pickup").toLowerCase();
    if (code === "seat_delivery") {
      const seatCtx = await getSeatDeliveryContext(userIdObj, event);
      if (!seatCtx.canDeliverToSeat) {
        return res.status(400).json({
          message:
            "Deliver to seat is only available for seated events when your ticket includes an assigned seat.",
        });
      }
    }
    const deliveryMethod = await resolveDeliveryMethod(code, event.EventID);
    const totals = computeTotals(payload.subtotal, deliveryMethod || code);

    return res.json({ ...payload, totals, deliveryMethod });
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food getCart:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/food/delivery-methods?eventId=... */
exports.listDeliveryMethods = async (req, res) => {
  try {
    const event = req.query.eventId ? await resolveEvent(req.query.eventId) : null;
    const filter = { active: true };
    if (event?.EventID) {
      filter.$or = [{ EventID: event.EventID }, { EventID: null }];
    } else {
      filter.EventID = null;
    }
    let methods = await DeliveryMethod.find(filter)
      .sort({ sortOrder: 1, price: 1 })
      .lean();

    let seatDelivery = {
      eventIsSeated: false,
      canDeliverToSeat: false,
      seatLabel: null,
    };
    if (event) {
      const userIdObj = uid(req);
      seatDelivery = await getSeatDeliveryContext(userIdObj, event);
      methods = filterDeliveryMethodsForSeat(methods, seatDelivery.canDeliverToSeat);
    }

    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return res.json({ methods, seatDelivery });
  } catch (err) {
    console.error("food listDeliveryMethods:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/food/cart/add */
exports.addToCart = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const { eventId, foodItemId, quantity = 1 } = req.body || {};
    const event = await resolveEvent(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    await assertFoodAccess(userIdObj, event);

    const food = await findFoodItemForEvent(event, foodItemId);
    if (!food) return res.status(404).json({ message: "Food item not available for this venue" });

    const qty = Math.max(1, Math.min(20, Number(quantity) || 1));
    if (food.stockQuantity < qty) {
      return res.status(400).json({ message: `Only ${food.stockQuantity} left in stock` });
    }

    const cart = await getOrCreateCartForUser(userIdObj, event);
    const existing = await FoodCartItem.findOne({ cartId: cart._id, FoodItemID: food.FoodItemID });
    const newQty = (existing?.quantity || 0) + qty;
    if (newQty > food.stockQuantity) {
      return res.status(400).json({ message: `Cannot exceed stock (${food.stockQuantity})` });
    }

    if (existing) {
      existing.quantity = newQty;
      await existing.save();
    } else {
      await FoodCartItem.create({
        cartId: cart._id,
        FoodItemID: food.FoodItemID,
        quantity: newQty,
        unitPrice: food.Price,
        name: food.Name,
      });
    }

    const payload = await loadCartPayload(cart);
    return res.json(payload);
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food addToCart:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/food/cart/update */
exports.updateCart = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const { eventId, foodItemId, quantity } = req.body || {};
    const event = await resolveEvent(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    await assertFoodAccess(userIdObj, event);

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      return res.status(400).json({ message: "quantity must be >= 0" });
    }

    const cart = await getOrCreateCartForUser(userIdObj, event);
    if (qty === 0) {
      await FoodCartItem.deleteOne({ cartId: cart._id, FoodItemID: Number(foodItemId) });
    } else {
      const food = await findFoodItemForEvent(event, foodItemId);
      if (!food) return res.status(404).json({ message: "Food item not found" });
      if (qty > food.stockQuantity) {
        return res.status(400).json({ message: `Only ${food.stockQuantity} in stock` });
      }
      await FoodCartItem.findOneAndUpdate(
        { cartId: cart._id, FoodItemID: Number(foodItemId) },
        { quantity: qty, unitPrice: food.Price, name: food.Name },
        { upsert: true, new: true },
      );
    }

    const payload = await loadCartPayload(cart);
    return res.json(payload);
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food updateCart:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /api/food/cart/remove */
exports.removeFromCart = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const eventId = req.body?.eventId || req.query?.eventId;
    const foodItemId = req.body?.foodItemId || req.query?.foodItemId;
    const event = await resolveEvent(eventId);
    if (!event) return res.status(400).json({ message: "eventId required" });

    await assertFoodAccess(userIdObj, event);

    const cart = await FoodCart.findOne({ userId: userIdObj, EventID: event.EventID });
    if (cart) {
      await FoodCartItem.deleteOne({ cartId: cart._id, FoodItemID: Number(foodItemId) });
    }

    const payload = cart ? await loadCartPayload(cart) : { cart: null, items: [], subtotal: 0 };
    return res.json(payload);
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food removeFromCart:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /api/food/cart/clear */
exports.clearCart = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const event = await resolveEvent(req.body?.eventId || req.query?.eventId);
    if (!event) return res.status(400).json({ message: "eventId required" });

    const cart = await FoodCart.findOne({ userId: userIdObj, EventID: event.EventID });
    if (cart) await FoodCartItem.deleteMany({ cartId: cart._id });

    return res.json({ cart: null, items: [], subtotal: 0 });
  } catch (err) {
    console.error("food clearCart:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/food/checkout — place order */
exports.checkout = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const {
      eventId,
      deliveryMethod: legacyDeliveryMethod,
      deliveryMethodCode,
      paymentMethod = "card",
      paymentBrand,
      paymentCardId,
      seatLabel,
      notes,
      idempotencyKey,
    } = req.body || {};

    const event = await resolveEvent(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    await assertFoodAccess(userIdObj, event);

    if (idempotencyKey) {
      const dup = await FoodOrder.findOne({ userId: userIdObj, idempotencyKey }).lean();
      if (dup) return res.status(200).json({ order: dup, duplicate: true });
    }

    const cart = await FoodCart.findOne({ userId: userIdObj, EventID: event.EventID });
    if (!cart) return res.status(400).json({ message: "Cart is empty" });

    const payload = await loadCartPayload(cart);
    if (!payload.items.length) return res.status(400).json({ message: "Cart is empty" });

    const foodIds = payload.items.map((line) => line.foodItemId);
    const foodRows = await FoodItem.find({ FoodItemID: { $in: foodIds } }).lean();
    const foodMap = Object.fromEntries(foodRows.map((f) => [f.FoodItemID, f]));

    for (const line of payload.items) {
      const food = foodMap[line.foodItemId];
      if (!food || !food.availability || food.stockQuantity < line.quantity) {
        return res.status(400).json({
          message: `${line.name} is no longer available in the requested quantity`,
        });
      }
      if (event.VenueID != null && event.VenueID !== "") {
        if (Number(food.VenueID) !== Number(event.VenueID)) {
          return res.status(400).json({ message: "Cart contains items from another venue" });
        }
        if (food.EventID != null && food.EventID !== event.EventID) {
          return res.status(400).json({ message: "Cart contains items not valid for this event" });
        }
      } else if (food.EventID != null && food.EventID !== event.EventID) {
        return res.status(400).json({ message: "Cart contains items from another event" });
      }
    }

    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      return res
        .status(400)
        .json({ message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}` });
    }

    if (paymentMethod === "card" && paymentCardId) {
      const card = await UserPaymentCard.findOne({ _id: paymentCardId, userId: userIdObj });
      if (!card) return res.status(400).json({ message: "Payment card not found" });
    }

    const code = String(deliveryMethodCode || legacyDeliveryMethod || "pickup").toLowerCase();
    const seatCtx = await getSeatDeliveryContext(userIdObj, event);
    if (code === "seat_delivery" && !seatCtx.canDeliverToSeat) {
      return res.status(400).json({
        message:
          "Deliver to seat is only available for seated events when your ticket includes an assigned seat.",
      });
    }
    const delivery = await resolveDeliveryMethod(code, event.EventID);
    const totals = computeTotals(payload.subtotal, delivery || code);
    const prepMin = maxPrepMinutes(foodRows);
    const estimatedReadyAt = new Date(
      Date.now() + (prepMin + (totals.estimatedDeliveryMinutes || 0)) * 60 * 1000,
    );
    const resolvedSeatLabel =
      code === "seat_delivery"
        ? String(seatLabel || seatCtx.seatLabel || "").trim()
        : String(seatLabel || "").trim();

    /** Group cart lines by restaurant — one order per vendor stand. */
    const groups = new Map();
    for (const line of payload.items) {
      const foodRow = foodMap[line.foodItemId];
      const key = foodRow?.RestaurantID ?? 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ line, foodRow });
    }

    const groupList = [...groups.values()];
    const fullTotals = totals;
    const createdOrders = [];
    let detailId = await nextId(FoodOrderItem, "DetailID");
    let nextOrderId = await nextId(FoodOrder, "OrderID");

    for (let gi = 0; gi < groupList.length; gi++) {
      const group = groupList[gi];
      const groupSubtotal = round2(group.reduce((s, g) => s + g.line.lineTotal, 0));
      const share = payload.subtotal > 0 ? groupSubtotal / payload.subtotal : 1;
      const groupTotals = {
        subtotal: groupSubtotal,
        serviceFee: round2(fullTotals.serviceFee * share),
        taxAmount: round2(fullTotals.taxAmount * share),
        deliveryFee: round2(fullTotals.deliveryFee * share),
        estimatedDeliveryMinutes: fullTotals.estimatedDeliveryMinutes || 0,
      };
      groupTotals.totalAmount = round2(
        groupTotals.subtotal +
          groupTotals.serviceFee +
          groupTotals.taxAmount +
          groupTotals.deliveryFee,
      );

      const orderId = nextOrderId++;
      const order = await FoodOrder.create({
        OrderID: orderId,
        userId: userIdObj,
        EventID: event.EventID,
        eventMongoId: event._id,
        Status: "Confirmed",
        deliveryMethod: ["pickup", "counter", "seat_delivery"].includes(code) ? code : "pickup",
        deliveryMethodCode: code,
        deliveryMethodName: delivery?.name || code,
        deliveryFee: groupTotals.deliveryFee || 0,
        estimatedDeliveryMinutes: groupTotals.estimatedDeliveryMinutes || 0,
        seatLabel: resolvedSeatLabel,
        notes: notes || "",
        subtotal: groupTotals.subtotal,
        serviceFee: groupTotals.serviceFee,
        taxAmount: groupTotals.taxAmount,
        totalAmount: groupTotals.totalAmount,
        paymentMethod,
        paymentBrand: brandFromInput(paymentMethod, paymentBrand),
        paymentStatus: paymentMethod === "cod" ? "Pending" : "Paid",
        paymentCardId: paymentCardId || undefined,
        idempotencyKey: gi === 0 ? idempotencyKey || undefined : undefined,
        estimatedReadyAt,
      });

      const orderItems = [];
      for (const { line, foodRow } of group) {
        const row = await FoodOrderItem.create({
          DetailID: detailId++,
          OrderID: orderId,
          FoodItemID: line.foodItemId,
          RestaurantID: foodRow?.RestaurantID ?? null,
          Name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
        });
        orderItems.push(row);
        await FoodItem.updateOne(
          { FoodItemID: line.foodItemId },
          { $inc: { stockQuantity: -line.quantity, popularityScore: line.quantity } },
        );
      }
      createdOrders.push({ order, items: orderItems });
    }

    await FoodCartItem.deleteMany({ cartId: cart._id });

    const orderNums = createdOrders.map((o) => o.order.OrderID);
    const notifyBody =
      orderNums.length > 1
        ? `Your food orders #${orderNums.join(", #")} for ${event.Name} are confirmed (one per vendor).`
        : `Your food order #${orderNums[0]} for ${event.Name} is confirmed.`;

    await UserNotification.create({
      userId: userIdObj,
      type: "food_order",
      title: "Order confirmed",
      body: notifyBody,
      meta: { orderId: orderNums[0], orderIds: orderNums, eventId: event._id },
    });

    const combinedTotal = createdOrders.reduce((s, o) => s + o.order.totalAmount, 0);
    try {
      const foodPts = loyaltyService.pointsForFood(combinedTotal);
      if (foodPts > 0) {
        await loyaltyService.earnPoints(userIdObj, foodPts, "food_order", {
          referenceType: "food_order",
          referenceId: orderNums[0],
          description: `Points for food order #${orderNums.join(", #")}`,
        });
      }
    } catch (loyErr) {
      console.warn("Loyalty earn after food order:", loyErr.message);
    }

    const primary = createdOrders[0];
    return res.status(201).json({
      order: primary.order,
      items: primary.items,
      orders: createdOrders.map((o) => ({ order: o.order, items: o.items })),
      splitOrders: createdOrders.length > 1,
      totals: fullTotals,
    });
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    if (err.code === 11000) {
      return res.status(200).json({ message: "Duplicate request ignored" });
    }
    console.error("food checkout:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/food/my-events — events the user holds tickets for, with F&B vendor summary */
exports.myTicketEvents = async (req, res) => {
  try {
    const userIdObj = uid(req);
    if (!userIdObj) return res.status(401).json({ message: "Unauthorized" });

    const tickets = await Ticket.find({ OwnerUserId: userIdObj }).select("EventID").lean();
    const eventIds = [...new Set(tickets.map((t) => t.EventID).filter((id) => id != null))];
    if (!eventIds.length) {
      return res.json({ events: [] });
    }

    const events = await Event.find({
      EventID: { $in: eventIds },
      Status: { $in: ["Active", "Completed"] },
    })
      .select("_id EventID Name StartDate EndDate VenueID imageUrl Status")
      .sort({ StartDate: -1 })
      .lean();

    const enriched = await Promise.all(
      events.map(async (ev) => {
        const menu = await fetchMenuForEvent(ev, {}, userIdObj);
        const restaurants = menu.restaurants.map((r) => ({
          RestaurantID: r.RestaurantID,
          Name: r.Name,
          Description: r.Description || "",
          imageUrl: r.imageUrl || "",
          itemCount: menu.byRestaurant[r.RestaurantID]?.items?.length ?? 0,
        }));
        const itemCount = menu.items.length;
        return {
          _id: String(ev._id),
          EventID: ev.EventID,
          Name: ev.Name,
          StartDate: ev.StartDate,
          EndDate: ev.EndDate,
          Status: ev.Status,
          VenueID: ev.VenueID ?? null,
          imageUrl: ev.imageUrl || "",
          hasFood: restaurants.length > 0 || itemCount > 0,
          restaurantCount: restaurants.length,
          itemCount,
          restaurants,
        };
      }),
    );

    res.set("Cache-Control", "private, max-age=15");
    return res.json({ events: enriched });
  } catch (err) {
    console.error("food myTicketEvents:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/food/orders/my */
exports.myOrders = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const filter = { userId: userIdObj };
    if (req.query.eventId) {
      const event = await resolveEvent(req.query.eventId);
      if (event) filter.EventID = event.EventID;
    }
    const orders = await FoodOrder.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const eventIds = [...new Set(orders.map((o) => o.EventID))];
    const events = await Event.find({ EventID: { $in: eventIds } })
      .select("EventID Name imageUrl")
      .lean();
    const eventMap = Object.fromEntries(events.map((e) => [e.EventID, e]));

    const orderIds = orders.map((o) => o.OrderID);
    const allItems =
      orderIds.length > 0
        ? await FoodOrderItem.find({ OrderID: { $in: orderIds } }).lean()
        : [];
    const qtyByOrder = {};
    for (const item of allItems) {
      qtyByOrder[item.OrderID] = (qtyByOrder[item.OrderID] || 0) + item.quantity;
    }

    const enriched = orders.map((o) => ({
      ...o,
      eventName: eventMap[o.EventID]?.Name,
      eventImage: eventMap[o.EventID]?.imageUrl,
      itemCount: qtyByOrder[o.OrderID] || 0,
    }));

    return res.json(enriched);
  } catch (err) {
    console.error("food myOrders:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/food/orders/:orderId */
exports.getOrder = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const orderId = Number(req.params.orderId);
    const order = await FoodOrder.findOne({ OrderID: orderId }).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });

    const isOwner = String(order.userId) === String(userIdObj);
    const isAdmin = req.user?.role === "admin";
    if (!isOwner && !isAdmin) {
      const event = await Event.findOne({ EventID: order.EventID }).lean();
      const isOrganizer =
        event && String(event.organizer) === String(userIdObj);
      if (!isOrganizer) return res.status(403).json({ message: "Forbidden" });
    }

    const items = await FoodOrderItem.find({ OrderID: order.OrderID }).lean();
    const event = await Event.findOne({ EventID: order.EventID })
      .select("Name imageUrl EventID")
      .lean();

    return res.json({ order, items, event });
  } catch (err) {
    console.error("food getOrder:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/food/orders/:orderId/status */
exports.updateOrderStatus = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const { status } = req.body || {};
    const allowed = FoodOrder.schema.path("Status").enumValues;
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${allowed.join(", ")}` });
    }

    const order = await FoodOrder.findOne({ OrderID: Number(req.params.orderId) });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const event = await Event.findOne({ EventID: order.EventID });
    const isAdmin = req.user?.role === "admin";
    const isOrganizer = event && String(event.organizer) === String(userIdObj);
    let isVendor = false;
    if (req.user?.role === "vendor") {
      const vendor = await getVendorForUser(userIdObj);
      if (vendor) {
        try {
          await assertVendorOrderAccess(vendor, order.OrderID);
          if (vendorCanSetStatus(order.Status, status)) isVendor = true;
        } catch {
          isVendor = false;
        }
      }
    }
    if (!isAdmin && !isOrganizer && !isVendor) {
      return res.status(403).json({ message: "Not allowed to update this order status" });
    }

    order.Status = status;
    if (status === "Ready") {
      const readyBody =
        order.deliveryMethodCode === "seat_delivery"
          ? `Your food order #${order.OrderID} is on the way to your seat.`
          : `Your food order #${order.OrderID} is ready for pickup.`;
      await UserNotification.create({
        userId: order.userId,
        type: "food_order",
        title: "Order ready",
        body: readyBody,
        meta: { orderId: order.OrderID },
      });
    }
    await order.save();

    return res.json(order);
  } catch (err) {
    console.error("food updateOrderStatus:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/food/favorites/toggle */
exports.toggleFavorite = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const { foodItemId } = req.body || {};
    const food = await FoodItem.findOne({ FoodItemID: Number(foodItemId) });
    if (!food) return res.status(404).json({ message: "Food item not found" });

    const event = await Event.findOne({ EventID: food.EventID });
    await assertFoodAccess(userIdObj, event);

    const existing = await UserFoodFavorite.findOne({
      userId: userIdObj,
      FoodItemID: food.FoodItemID,
    });
    if (existing) {
      await existing.deleteOne();
      return res.json({ isFavorite: false });
    }
    await UserFoodFavorite.create({
      userId: userIdObj,
      FoodItemID: food.FoodItemID,
      EventID: food.EventID,
    });
    return res.json({ isFavorite: true });
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food toggleFavorite:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/food/reviews */
exports.addReview = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const { foodItemId, rating, comment } = req.body || {};
    const r = Number(rating);
    if (!r || r < 1 || r > 5) return res.status(400).json({ message: "rating 1-5 required" });

    const food = await FoodItem.findOne({ FoodItemID: Number(foodItemId) });
    if (!food) return res.status(404).json({ message: "Food item not found" });

    const event = await Event.findOne({ EventID: food.EventID });
    await assertFoodAccess(userIdObj, event);

    await FoodReview.findOneAndUpdate(
      { userId: userIdObj, FoodItemID: food.FoodItemID },
      { rating: r, comment: comment || "", EventID: food.EventID },
      { upsert: true, new: true },
    );

    const agg = await FoodReview.aggregate([
      { $match: { FoodItemID: food.FoodItemID } },
      { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    if (agg[0]) {
      await FoodItem.updateOne(
        { FoodItemID: food.FoodItemID },
        { ratingAvg: Math.round(agg[0].avg * 10) / 10, ratingCount: agg[0].count },
      );
    }

    return res.status(201).json({ message: "Review saved" });
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food addReview:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/food/orders/:orderId/reorder */
exports.reorder = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const order = await FoodOrder.findOne({ OrderID: Number(req.params.orderId) }).lean();
    if (!order || String(order.userId) !== String(userIdObj)) {
      return res.status(404).json({ message: "Order not found" });
    }

    const event = await Event.findOne({ EventID: order.EventID }).lean();
    await assertFoodAccess(userIdObj, event);

    const lines = await FoodOrderItem.find({ OrderID: order.OrderID }).lean();
    const cart = await getOrCreateCartForUser(userIdObj, event);

    const foodIds = lines.map((line) => line.FoodItemID);
    const foodRows =
      foodIds.length > 0
        ? await FoodItem.find({
            FoodItemID: { $in: foodIds },
            availability: true,
          }).lean()
        : [];
    const foodMap = Object.fromEntries(foodRows.map((f) => [f.FoodItemID, f]));

    for (const line of lines) {
      const food = foodMap[line.FoodItemID];
      if (!food || food.stockQuantity < line.quantity) continue;

      await FoodCartItem.findOneAndUpdate(
        { cartId: cart._id, FoodItemID: line.FoodItemID },
        {
          quantity: line.quantity,
          unitPrice: food.Price,
          name: food.Name,
        },
        { upsert: true },
      );
    }

    const payload = await loadCartPayload(cart);
    return res.json(payload);
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food reorder:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * PUT /api/food/orders/:orderId/edit
 * Allowed only while order is in EDITABLE_STATUSES (Pending, Confirmed).
 * Body: {
 *   items: [{ foodItemId, quantity }],
 *   deliveryMethodCode?, paymentMethod?, paymentBrand?, paymentCardId?,
 *   seatLabel?, notes?
 * }
 */
exports.editOrder = async (req, res) => {
  try {
    const userIdObj = uid(req);
    const orderId = Number(req.params.orderId);
    const order = await FoodOrder.findOne({ OrderID: orderId });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (String(order.userId) !== String(userIdObj)) {
      return res.status(403).json({ message: "You can only edit your own orders" });
    }

    if (!EDITABLE_STATUSES.includes(order.Status)) {
      return res.status(409).json({
        message:
          "This order can no longer be edited because preparation already started.",
        currentStatus: order.Status,
      });
    }

    const {
      items,
      deliveryMethodCode,
      paymentMethod,
      paymentBrand,
      paymentCardId,
      seatLabel,
      notes,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items must be a non-empty array" });
    }

    const event = await Event.findOne({ EventID: order.EventID }).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    await assertFoodAccess(userIdObj, event);

    const requestedIds = [
      ...new Set(
        items
          .map((line) => Number(line.foodItemId))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    const foodRows =
      requestedIds.length > 0
        ? await FoodItem.find({
            EventID: order.EventID,
            FoodItemID: { $in: requestedIds },
            availability: true,
          }).lean()
        : [];
    const foodMap = Object.fromEntries(foodRows.map((f) => [f.FoodItemID, f]));

    const normalised = [];
    for (const line of items) {
      const foodItemId = Number(line.foodItemId);
      const qty = Math.max(1, Math.min(20, Number(line.quantity) || 0));
      if (!foodItemId || qty < 1) continue;
      const food = foodMap[foodItemId];
      if (!food) {
        return res.status(400).json({ message: `Food item ${foodItemId} no longer available` });
      }
      if (qty > food.stockQuantity) {
        return res.status(400).json({
          message: `Only ${food.stockQuantity} of ${food.Name} left in stock`,
        });
      }
      normalised.push({
        foodItemId,
        quantity: qty,
        unitPrice: food.Price,
        name: food.Name,
        prepMin: food.preparationTimeMinutes || 15,
        food,
      });
    }
    if (!normalised.length) {
      return res.status(400).json({ message: "At least one valid item is required" });
    }

    if (paymentMethod && !PAYMENT_METHODS.includes(paymentMethod)) {
      return res
        .status(400)
        .json({ message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}` });
    }
    if (paymentMethod === "card" && paymentCardId) {
      const card = await UserPaymentCard.findOne({ _id: paymentCardId, userId: userIdObj });
      if (!card) return res.status(400).json({ message: "Payment card not found" });
    }

    const subtotal = round2(
      normalised.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    );

    const code = String(
      deliveryMethodCode || order.deliveryMethodCode || order.deliveryMethod || "pickup",
    ).toLowerCase();
    const seatCtx = await getSeatDeliveryContext(userIdObj, event);
    if (code === "seat_delivery" && !seatCtx.canDeliverToSeat) {
      return res.status(400).json({
        message:
          "Deliver to seat is only available for seated events when your ticket includes an assigned seat.",
      });
    }
    const delivery = await resolveDeliveryMethod(code, order.EventID);
    const totals = computeTotals(subtotal, delivery || code);

    const prevLines = await FoodOrderItem.find({ OrderID: order.OrderID }).lean();
    const prevMap = new Map(prevLines.map((l) => [l.FoodItemID, l.quantity]));

    for (const line of normalised) {
      const prevQty = prevMap.get(line.foodItemId) || 0;
      const diff = line.quantity - prevQty;
      if (diff !== 0) {
        await FoodItem.updateOne(
          { FoodItemID: line.foodItemId },
          { $inc: { stockQuantity: -diff } },
        );
      }
      prevMap.delete(line.foodItemId);
    }
    for (const [foodItemId, qty] of prevMap) {
      await FoodItem.updateOne(
        { FoodItemID: foodItemId },
        { $inc: { stockQuantity: qty } },
      );
    }

    await FoodOrderItem.deleteMany({ OrderID: order.OrderID });
    let detailId = await nextId(FoodOrderItem, "DetailID");
    for (const line of normalised) {
      await FoodOrderItem.create({
        DetailID: detailId++,
        OrderID: order.OrderID,
        FoodItemID: line.foodItemId,
        RestaurantID: line.food?.RestaurantID ?? null,
        Name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: round2(line.unitPrice * line.quantity),
      });
    }

    const prepMin = maxPrepMinutes(normalised.map((l) => l.food));
    order.subtotal = totals.subtotal;
    order.serviceFee = totals.serviceFee;
    order.deliveryFee = totals.deliveryFee || 0;
    order.taxAmount = totals.taxAmount;
    order.totalAmount = totals.totalAmount;
    order.deliveryMethodCode = code;
    order.deliveryMethodName = delivery?.name || code;
    order.estimatedDeliveryMinutes = totals.estimatedDeliveryMinutes || 0;
    if (["pickup", "counter", "seat_delivery"].includes(code)) order.deliveryMethod = code;
    if (paymentMethod) {
      order.paymentMethod = paymentMethod;
      order.paymentBrand = brandFromInput(paymentMethod, paymentBrand);
      if (paymentMethod === "card") {
        order.paymentCardId = paymentCardId || order.paymentCardId;
      } else {
        order.paymentCardId = undefined;
      }
      order.paymentStatus = paymentMethod === "cod" ? "Pending" : "Paid";
    }
    if (seatLabel !== undefined) {
      order.seatLabel =
        code === "seat_delivery"
          ? String(seatLabel || seatCtx.seatLabel || "").trim()
          : String(seatLabel || "").trim();
    } else if (code === "seat_delivery" && seatCtx.seatLabel) {
      order.seatLabel = seatCtx.seatLabel;
    }
    if (notes !== undefined) order.notes = String(notes || "");
    order.estimatedReadyAt = new Date(
      Date.now() + (prepMin + (totals.estimatedDeliveryMinutes || 0)) * 60 * 1000,
    );
    order.editCount = (order.editCount || 0) + 1;
    order.lastEditedAt = new Date();
    await order.save();

    await UserNotification.create({
      userId: userIdObj,
      type: "food_order",
      title: "Order updated",
      body: `Your food order #${order.OrderID} was updated successfully.`,
      meta: { orderId: order.OrderID },
    });

    const updatedItems = await FoodOrderItem.find({ OrderID: order.OrderID }).lean();
    return res.json({ order, items: updatedItems, totals });
  } catch (err) {
    if (err.statusCode === 403) return res.status(403).json({ message: err.message });
    console.error("food editOrder:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
