const mongoose = require("mongoose");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const PromoCode = require("../models/PromoCode");
const Event = require("../models/Event");
const TicketCategory = require("../models/TicketCategory");

/** Lifetime points thresholds → tier perks */
const TIERS = [
  {
    id: "bronze",
    name: "Bronze",
    minLifetime: 0,
    earnRate: 0.1,
    earnMultiplier: 1,
    earlyAccessHours: 0,
    ticketUpgrade: false,
    prioritySupport: false,
  },
  {
    id: "silver",
    name: "Silver",
    minLifetime: 500,
    earnRate: 0.1,
    earnMultiplier: 1.15,
    earlyAccessHours: 0,
    ticketUpgrade: false,
    prioritySupport: false,
  },
  {
    id: "gold",
    name: "Gold",
    minLifetime: 2000,
    earnRate: 0.12,
    earnMultiplier: 1.25,
    earlyAccessHours: 24,
    ticketUpgrade: true,
    prioritySupport: true,
  },
  {
    id: "platinum",
    name: "Platinum",
    minLifetime: 10000,
    earnRate: 0.15,
    earnMultiplier: 1.5,
    earlyAccessHours: 48,
    ticketUpgrade: true,
    prioritySupport: true,
  },
];

const WELCOME_POINTS = 100;
const ORGANIZER_EVENT_CREATED_POINTS = 150;
const REDEEM_OPTIONS = [
  {
    id: "promo_5",
    label: "5% off next booking",
    pointsCost: 500,
    discountType: "percent",
    discountValue: 5,
    maxDiscountAmount: 75,
    minOrderAmount: 50,
  },
  {
    id: "promo_10",
    label: "10% off next booking",
    pointsCost: 1000,
    discountType: "percent",
    discountValue: 10,
    maxDiscountAmount: 150,
    minOrderAmount: 75,
  },
  {
    id: "promo_15",
    label: "15% off next booking",
    pointsCost: 2000,
    discountType: "percent",
    discountValue: 15,
    maxDiscountAmount: 250,
    minOrderAmount: 100,
  },
  {
    id: "promo_20",
    label: "20% off next booking",
    pointsCost: 3500,
    discountType: "percent",
    discountValue: 20,
    maxDiscountAmount: 400,
    minOrderAmount: 150,
  },
  {
    id: "fixed_50",
    label: "50 EGP off next booking",
    pointsCost: 800,
    discountType: "fixed",
    discountValue: 50,
    maxDiscountAmount: 50,
    minOrderAmount: 100,
  },
];

function resolveTier(lifetimePoints) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (lifetimePoints >= t.minLifetime) tier = t;
  }
  return tier;
}

function tierBenefits(tier, lifetimePoints = 0) {
  return {
    tierId: tier.id,
    tierName: tier.name,
    earnMultiplier: tier.earnMultiplier,
    earlyAccessHours: tier.earlyAccessHours,
    ticketUpgrade: tier.ticketUpgrade,
    prioritySupport: tier.prioritySupport,
    nextTier: (() => {
      const idx = TIERS.findIndex((t) => t.id === tier.id);
      const next = TIERS[idx + 1];
      if (!next) return null;
      return {
        id: next.id,
        name: next.name,
        pointsNeeded: Math.max(0, next.minLifetime - lifetimePoints),
      };
    })(),
  };
}

async function nextTransactionId() {
  const last = await LoyaltyTransaction.findOne().sort({ TransactionID: -1 }).lean();
  return (last?.TransactionID || 0) + 1;
}

async function nextPromoId() {
  const last = await PromoCode.findOne().sort({ PromoCodeID: -1 }).lean();
  return (last?.PromoCodeID || 0) + 1;
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "FLOW-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Credit points and update user balance + lifetime + tier.
 */
async function earnPoints(userId, points, type, meta = {}) {
  const pts = Math.max(0, Math.floor(Number(points) || 0));
  if (pts <= 0) return null;

  const user = await User.findById(userId);
  if (!user) return null;

  const balance = (user.loyaltyPointsBalance || 0) + pts;
  const lifetime = (user.loyaltyLifetimePoints || 0) + pts;
  const tier = resolveTier(lifetime);

  user.loyaltyPointsBalance = balance;
  user.loyaltyLifetimePoints = lifetime;
  user.loyaltyTier = tier.id;
  await user.save();

  const tx = await LoyaltyTransaction.create({
    TransactionID: await nextTransactionId(),
    userId,
    type,
    points: pts,
    balanceAfter: balance,
    referenceType: meta.referenceType,
    referenceId: meta.referenceId != null ? String(meta.referenceId) : undefined,
    description: meta.description,
  });

  return { user, transaction: tx, tier };
}

/**
 * Deduct points (redemption). Throws if insufficient balance.
 */
async function spendPoints(userId, points, type, meta = {}) {
  const pts = Math.max(0, Math.floor(Number(points) || 0));
  if (pts <= 0) return null;

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }
  const current = user.loyaltyPointsBalance || 0;
  if (current < pts) {
    const err = new Error(`Not enough loyalty points (have ${current}, need ${pts})`);
    err.statusCode = 400;
    err.code = "INSUFFICIENT_POINTS";
    throw err;
  }

  const balance = current - pts;
  const lifetime = user.loyaltyLifetimePoints || 0;
  const tier = resolveTier(lifetime);

  user.loyaltyPointsBalance = balance;
  user.loyaltyTier = tier.id;
  await user.save();

  const tx = await LoyaltyTransaction.create({
    TransactionID: await nextTransactionId(),
    userId,
    type,
    points: -pts,
    balanceAfter: balance,
    referenceType: meta.referenceType,
    referenceId: meta.referenceId != null ? String(meta.referenceId) : undefined,
    description: meta.description,
  });

  return { user, transaction: tx, tier };
}

function pointsForBooking(amountPaid, tier) {
  const base = Math.max(0, Number(amountPaid) || 0);
  return Math.floor(base * (tier?.earnRate ?? 0.1) * (tier?.earnMultiplier ?? 1));
}

function pointsForFood(amountPaid) {
  return Math.floor(Math.max(0, Number(amountPaid) || 0) * 0.05);
}

async function getLoyaltySummary(userId) {
  const user = await User.findById(userId).lean();
  if (!user) return null;
  const lifetime = user.loyaltyLifetimePoints || 0;
  const tier = resolveTier(lifetime);
  const recent = await LoyaltyTransaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  const promos = await PromoCode.find({
    userId,
    isActive: true,
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();

  return {
    balance: user.loyaltyPointsBalance || 0,
    lifetimePoints: lifetime,
    ...tierBenefits(tier, lifetime),
    tiers: TIERS.map((t) => ({
      id: t.id,
      name: t.name,
      minLifetime: t.minLifetime,
      earlyAccessHours: t.earlyAccessHours,
      ticketUpgrade: t.ticketUpgrade,
      prioritySupport: t.prioritySupport,
    })),
    redeemOptions: REDEEM_OPTIONS,
    recentTransactions: recent,
    activePromoCodes: promos.map((p) => ({
      code: p.Code,
      discountType: p.discountType,
      discountValue: p.discountValue,
      maxDiscountAmount: p.maxDiscountAmount,
      minOrderAmount: p.minOrderAmount,
      expiresAt: p.expiresAt,
    })),
  };
}

async function redeemPromoOption(userId, optionId) {
  const option = REDEEM_OPTIONS.find((o) => o.id === optionId);
  if (!option) {
    const err = new Error("Invalid redemption option");
    err.statusCode = 400;
    throw err;
  }

  await spendPoints(userId, option.pointsCost, "redeem_promo", {
    description: `Redeemed: ${option.label}`,
    referenceType: "redeem_option",
    referenceId: optionId,
  });

  let code;
  for (let attempt = 0; attempt < 8; attempt++) {
    code = randomCode();
    const exists = await PromoCode.findOne({ Code: code }).lean();
    if (!exists) break;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  const promo = await PromoCode.create({
    PromoCodeID: await nextPromoId(),
    Code: code,
    userId,
    discountType: option.discountType,
    discountValue: option.discountValue,
    maxDiscountAmount: option.maxDiscountAmount,
    minOrderAmount: option.minOrderAmount,
    source: "loyalty",
    pointsCost: option.pointsCost,
    isActive: true,
    expiresAt,
  });

  return promo;
}

function computeDiscount(subtotal, promo) {
  const sub = Math.max(0, Number(subtotal) || 0);
  if (sub < (promo.minOrderAmount || 0)) {
    const err = new Error(
      `Minimum order amount is ${promo.minOrderAmount} for this promo`,
    );
    err.statusCode = 400;
    throw err;
  }
  let discount = 0;
  if (promo.discountType === "percent") {
    discount = (sub * promo.discountValue) / 100;
    if (promo.maxDiscountAmount != null) {
      discount = Math.min(discount, promo.maxDiscountAmount);
    }
  } else {
    discount = promo.discountValue;
  }
  discount = Math.min(discount, sub);
  return Math.round(discount * 100) / 100;
}

async function validatePromoForUser(userId, code, eventId, subtotal) {
  const promo = await PromoCode.findOne({
    Code: String(code || "").trim().toUpperCase(),
    userId,
    isActive: true,
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!promo) {
    const err = new Error("Invalid or expired promo code");
    err.statusCode = 400;
    throw err;
  }

  if (promo.eventId && eventId) {
    const ev = await Event.findById(eventId).lean();
    if (ev && String(promo.eventId) !== String(ev._id)) {
      const err = new Error("This promo code is not valid for this event");
      err.statusCode = 400;
      throw err;
    }
  }

  const discountAmount = computeDiscount(subtotal, promo);
  const totalAfter = Math.max(0, subtotal - discountAmount);

  return { promo, discountAmount, totalAfter };
}

async function markPromoUsed(promoId, bookingId) {
  await PromoCode.updateOne(
    { _id: promoId },
    { $set: { usedAt: new Date(), usedOnBookingId: bookingId, isActive: false } },
  );
}

/**
 * Can this user book now? (early access window)
 */
async function assertCanBookEvent(userId, event) {
  const opensAt = event.ticketSalesOpensAt
    ? new Date(event.ticketSalesOpensAt)
    : null;
  if (!opensAt || Number.isNaN(opensAt.getTime())) return true;

  const now = new Date();
  if (now >= opensAt) return true;

  const user = await User.findById(userId).lean();
  const tier = resolveTier(user?.loyaltyLifetimePoints || 0);
  const hours = tier.earlyAccessHours || 0;
  if (hours <= 0) {
    const err = new Error(
      `Ticket sales open on ${opensAt.toLocaleString()}. Upgrade your loyalty tier for early access.`,
    );
    err.statusCode = 403;
    err.code = "EARLY_ACCESS_DENIED";
    throw err;
  }

  const earlyStart = new Date(opensAt.getTime() - hours * 60 * 60 * 1000);
  if (now < earlyStart) {
    const err = new Error(
      `Early access for your tier starts ${earlyStart.toLocaleString()}. Public sales open ${opensAt.toLocaleString()}.`,
    );
    err.statusCode = 403;
    err.code = "EARLY_ACCESS_DENIED";
    throw err;
  }
  return true;
}

/**
 * Suggest upgraded ticket category (one step up by price) if tier allows.
 */
async function resolveUpgradeCategory(event, ticketCategoryId, userId) {
  const user = await User.findById(userId).lean();
  const tier = resolveTier(user?.loyaltyLifetimePoints || 0);
  if (!tier.ticketUpgrade) return null;

  const categories = await TicketCategory.find({ EventID: event.EventID })
    .sort({ Price: 1 })
    .lean();
  const current = categories.find(
    (c) => String(c._id) === String(ticketCategoryId) || c.TicketCatID === Number(ticketCategoryId),
  );
  if (!current) return null;

  const idx = categories.findIndex((c) => c.TicketCatID === current.TicketCatID);
  if (idx < 0 || idx >= categories.length - 1) return null;
  return categories[idx + 1];
}

module.exports = {
  TIERS,
  REDEEM_OPTIONS,
  WELCOME_POINTS,
  ORGANIZER_EVENT_CREATED_POINTS,
  resolveTier,
  tierBenefits,
  earnPoints,
  spendPoints,
  pointsForBooking,
  pointsForFood,
  getLoyaltySummary,
  redeemPromoOption,
  validatePromoForUser,
  computeDiscount,
  markPromoUsed,
  assertCanBookEvent,
  resolveUpgradeCategory,
};
