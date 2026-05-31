const DeliveryMethod = require("../models/DeliveryMethod");

const SERVICE_FEE_RATE = parseFloat(process.env.FOOD_SERVICE_FEE_RATE || "0.05");
const TAX_RATE = parseFloat(process.env.FOOD_TAX_RATE || "0.14");
const LEGACY_DELIVERY_FEE = parseFloat(process.env.FOOD_DELIVERY_FEE || "25");

const LEGACY_FEE_FALLBACK = {
  pickup: 0,
  counter: 0,
  seat_delivery: LEGACY_DELIVERY_FEE,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function feeFromCode(code) {
  return LEGACY_FEE_FALLBACK[code] != null ? LEGACY_FEE_FALLBACK[code] : 0;
}

/**
 * Compute totals from a subtotal and a delivery descriptor.
 * @param {number} subtotal
 * @param {string|object} delivery  Either a delivery-method code (legacy) or a
 *                                  DeliveryMethod-shaped object with at least
 *                                  `{ code, price, estimatedDeliveryMinutes }`.
 */
function computeTotals(subtotal, delivery = "pickup") {
  const sub = round2(Math.max(0, subtotal));
  const serviceFee = round2(sub * SERVICE_FEE_RATE);

  let deliveryFee = 0;
  let code = "pickup";
  let estimatedDeliveryMinutes = 0;
  if (typeof delivery === "string") {
    code = delivery;
    deliveryFee = round2(feeFromCode(code));
  } else if (delivery && typeof delivery === "object") {
    code = delivery.code || "pickup";
    deliveryFee = round2(Number(delivery.price) || 0);
    estimatedDeliveryMinutes = Number(delivery.estimatedDeliveryMinutes) || 0;
  }

  const taxable = sub + serviceFee + deliveryFee;
  const taxAmount = round2(taxable * TAX_RATE);
  const totalAmount = round2(taxable + taxAmount);
  return {
    subtotal: sub,
    serviceFee,
    deliveryFee,
    taxAmount,
    totalAmount,
    deliveryMethodCode: code,
    estimatedDeliveryMinutes,
  };
}

async function resolveDeliveryMethod(codeOrId, eventNumericId) {
  if (!codeOrId) return null;
  const code = String(codeOrId).trim().toLowerCase();
  const eventFilter = eventNumericId
    ? { $or: [{ EventID: eventNumericId }, { EventID: null }] }
    : { EventID: null };
  return DeliveryMethod.findOne({
    code,
    active: true,
    ...eventFilter,
  }).lean();
}

function maxPrepMinutes(items) {
  if (!items?.length) return 15;
  return Math.max(...items.map((i) => i.preparationTimeMinutes || 15));
}

module.exports = {
  computeTotals,
  resolveDeliveryMethod,
  maxPrepMinutes,
  SERVICE_FEE_RATE,
  TAX_RATE,
};
