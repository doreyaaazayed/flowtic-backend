/**
 * Validates optional mega-star booking — ids/prices mirror megaStarCatalogue.ts
 * Sources: Egyptian wedding/private event fee reports (2024), see docs/MEGA_STAR_PRICING.md
 */
const CATALOGUE = [
  { id: "amr-diab", durations: [{ id: "60-90", priceEgp: 5000000 }, { id: "90-120", priceEgp: 5800000 }, { id: "120-150", priceEgp: 6500000 }] },
  { id: "tamer-hosny", durations: [{ id: "60-90", priceEgp: 4000000 }, { id: "90-120", priceEgp: 4600000 }, { id: "120-150", priceEgp: 5300000 }] },
  { id: "mohamed-hamaki", durations: [{ id: "60-90", priceEgp: 3000000 }, { id: "90-120", priceEgp: 3500000 }, { id: "120-150", priceEgp: 4000000 }] },
  { id: "sherine", durations: [{ id: "60-90", priceEgp: 4500000 }, { id: "90-120", priceEgp: 5200000 }, { id: "120-150", priceEgp: 6000000 }] },
  { id: "ahmed-saad", durations: [{ id: "60-90", priceEgp: 3000000 }, { id: "90-120", priceEgp: 3500000 }, { id: "120-150", priceEgp: 4000000 }] },
  { id: "angham", durations: [{ id: "60-90", priceEgp: 2000000 }, { id: "90-120", priceEgp: 2400000 }, { id: "120-150", priceEgp: 2900000 }] },
  { id: "wegz", durations: [{ id: "45-60", priceEgp: 550000 }, { id: "60-90", priceEgp: 700000 }, { id: "90-120", priceEgp: 850000 }] },
  { id: "ruby", durations: [{ id: "60-90", priceEgp: 700000 }, { id: "90-120", priceEgp: 900000 }, { id: "120-150", priceEgp: 1100000 }] },
  { id: "mahmoud-el-esseily", durations: [{ id: "60-90", priceEgp: 250000 }, { id: "90-120", priceEgp: 320000 }, { id: "120-150", priceEgp: 400000 }] },
  { id: "pousy", durations: [{ id: "45-60", priceEgp: 300000 }, { id: "60-90", priceEgp: 380000 }, { id: "90-120", priceEgp: 480000 }] },
  { id: "reda-el-bahrawy", durations: [{ id: "45-60", priceEgp: 90000 }, { id: "60-90", priceEgp: 100000 }, { id: "90-120", priceEgp: 130000 }] },
  { id: "cairokee", durations: [{ id: "60-90", priceEgp: 800000 }, { id: "90-120", priceEgp: 1000000 }, { id: "120-150", priceEgp: 1250000 }] },
  { id: "sharmoofers", durations: [{ id: "60-90", priceEgp: 550000 }, { id: "90-120", priceEgp: 700000 }, { id: "120-150", priceEgp: 850000 }] },
  { id: "disco-misr", durations: [{ id: "60-90", priceEgp: 450000 }, { id: "90-120", priceEgp: 580000 }, { id: "120-150", priceEgp: 720000 }] },
  { id: "massar-egbari", durations: [{ id: "60-90", priceEgp: 500000 }, { id: "90-120", priceEgp: 650000 }, { id: "120-150", priceEgp: 800000 }] },
];

function lookupDuration(starId, durationId) {
  const star = CATALOGUE.find((s) => s.id === starId);
  if (!star) return null;
  const dur = star.durations.find((d) => d.id === durationId);
  if (!dur) return null;
  return { starId: star.id, durationId: dur.id, priceEgp: dur.priceEgp };
}

function sanitizeMegaStar(body) {
  if (body == null || body === false) {
    return { ok: true, value: undefined };
  }
  if (typeof body !== "object") {
    return { ok: false, message: "Invalid mega star booking" };
  }

  const starId = String(body.starId || "").trim();
  const durationId = String(body.durationId || "").trim();
  const starName = String(body.starName || "").trim().slice(0, 120);
  const durationLabel = String(body.durationLabel || "").trim().slice(0, 80);
  const displayLabel = String(body.displayLabel || "").trim().slice(0, 200);

  if (!starId || !durationId) {
    return {
      ok: false,
      message: "Select a mega star and performance duration",
    };
  }

  const catalog = lookupDuration(starId, durationId);
  if (!catalog) {
    return { ok: false, message: "Invalid mega star or duration" };
  }

  let priceEgp = Number(body.priceEgp);
  if (Number.isNaN(priceEgp) || priceEgp !== catalog.priceEgp) {
    priceEgp = catalog.priceEgp;
  }

  if (!starName || !durationLabel || !displayLabel) {
    return {
      ok: false,
      message: "Mega star booking details are incomplete",
    };
  }

  return {
    ok: true,
    value: {
      starId: catalog.starId,
      durationId: catalog.durationId,
      starName,
      durationLabel,
      priceEgp,
      displayLabel,
    },
  };
}

module.exports = { sanitizeMegaStar };
