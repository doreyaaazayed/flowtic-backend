const eventSetupCatalogue = require("./eventSetupCatalogueService");

const PLATFORM_FEE_PERCENT = Number(process.env.EVENT_SETUP_PLATFORM_FEE_PERCENT || 10);

function roundEgp(n) {
  return Math.round(Number(n) || 0);
}

function computeSetupDeposit({ equipmentSelection, megaStar }) {
  const selection = eventSetupCatalogue.sanitizeSelection(equipmentSelection);
  const equipmentSubtotalEgp = eventSetupCatalogue.equipmentSubtotalFromSelection(selection);
  const megaStarEgp = megaStar?.priceEgp ? roundEgp(megaStar.priceEgp) : 0;
  const subtotalEgp = equipmentSubtotalEgp + megaStarEgp;
  const platformFeeEgp = roundEgp((subtotalEgp * PLATFORM_FEE_PERCENT) / 100);
  const totalEgp = subtotalEgp + platformFeeEgp;

  return {
    equipmentSelection: selection,
    equipmentSubtotalEgp,
    megaStarEgp,
    subtotalEgp,
    platformFeePercent: PLATFORM_FEE_PERCENT,
    platformFeeEgp,
    totalEgp,
  };
}

function depositRequired(totalEgp) {
  return roundEgp(totalEgp) > 0;
}

function buildStoredDeposit(pricing, paymentStatus = "not_required") {
  return {
    equipmentSubtotalEgp: pricing.equipmentSubtotalEgp,
    megaStarEgp: pricing.megaStarEgp,
    subtotalEgp: pricing.subtotalEgp,
    platformFeePercent: pricing.platformFeePercent,
    platformFeeEgp: pricing.platformFeeEgp,
    totalEgp: pricing.totalEgp,
    paymentStatus,
    paidAt: null,
  };
}

module.exports = {
  PLATFORM_FEE_PERCENT,
  computeSetupDeposit,
  depositRequired,
  buildStoredDeposit,
  roundEgp,
};
