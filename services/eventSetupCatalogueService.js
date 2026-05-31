/**
 * Catalogue item prices (EGP) — keep in sync with frontend/src/app/data/eventSetupCatalogue.ts
 */
const PRICES = {
  "wedding-center-piece-1": 950,
  "wedding-center-piece-2": 1200,
  "wedding-center-piece-3": 1450,
  "wedding-center-piece-4": 1750,
  "wedding-center-piece-5": 2100,
  "wedding-center-piece-6": 2600,
  "wedding-center-piece-7": 3250,
  "wedding-flower-bouqet-1": 2500,
  "wedding-flower-bouqet-2": 3800,
  "wedding-flower-bouqet-3": 5500,
  "wedding-flower-bouqet-4": 8500,
  "wedding-buffet-set-classic": 52000,
  "wedding-buffet-set-premium": 78000,
  "wedding-buffet-set-signature": 105000,
  "wedding-buffet-open-standard": 62000,
  "wedding-buffet-open-premium": 88000,
  "wedding-buffet-open-grand": 128000,
  "wedding-wedding-dance-floor-1": 18000,
  "wedding-wedding-dance-floor-2": 32000,
  "wedding-hall-decoration-1": 35000,
  "wedding-hall-decoration-2": 55000,
  "wedding-hall-decoration-3": 78000,
  "wedding-hall-decoration-4": 120000,
  "wedding-open-air-hall-decoration-1": 45000,
  "wedding-open-air-hall-decoration-2": 62000,
  "wedding-open-air-hall-decoration-3": 85000,
  "wedding-open-air-hall-decoration-4": 110000,
  "wedding-open-air-hall-decoration-5": 145000,
  "wedding-open-air-hall-decoration-6": 195000,
  "wedding-wedding-stage-1": 28000,
  "wedding-wedding-stage-2": 48000,
  "wedding-wedding-stage-3": 72000,
  "wedding-dj-mixer-1": 4500,
  "wedding-dj-mixer-2": 6500,
  "wedding-drums-1": 3500,
  "wedding-mic-package-1": 4200,
  "concert-stage-1": 85000,
  "concert-stage-2": 125000,
  "concert-stage-3": 180000,
  "concert-stage-4": 260000,
  "concert-stage-5": 350000,
  "concert-lighting-rig-1": 55000,
  "concert-screen-1": 95000,
  "concert-dj-mixer-1": 7500,
  "concert-dj-mixer-2": 11000,
  "concert-mic-package-1": 8500,
  "concert-drums-1": 6500,
};

function getPriceEgp(itemId) {
  return PRICES[String(itemId || "").trim()] ?? null;
}

function sanitizeSelection(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id || "").trim();
    if (!id || getPriceEgp(id) == null) continue;
    let quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
    quantity = Math.min(999, Math.floor(quantity));
    out.push({ id, quantity });
  }
  const seen = new Set();
  return out.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** Quantity does not multiply price (center pieces are planning only). */
function equipmentSubtotalFromSelection(selection) {
  let sum = 0;
  for (const { id } of selection) {
    sum += getPriceEgp(id) || 0;
  }
  return sum;
}

module.exports = {
  getPriceEgp,
  sanitizeSelection,
  equipmentSubtotalFromSelection,
};
