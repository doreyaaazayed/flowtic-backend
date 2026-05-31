const loyaltyService = require("../services/loyaltyService");

exports.getMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const summary = await loyaltyService.getLoyaltySummary(userId);
    if (!summary) return res.status(404).json({ message: "User not found" });
    return res.json(summary);
  } catch (err) {
    console.error("loyalty getMe:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.redeem = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { optionId } = req.body || {};
    if (!optionId) {
      return res.status(400).json({ message: "optionId is required" });
    }
    const promo = await loyaltyService.redeemPromoOption(userId, optionId);
    const summary = await loyaltyService.getLoyaltySummary(userId);
    return res.status(201).json({
      message: "Promo code created",
      promoCode: promo.Code,
      expiresAt: promo.expiresAt,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      loyalty: {
        balance: summary.balance,
        tierId: summary.tierId,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        message: err.message,
        code: err.code,
      });
    }
    console.error("loyalty redeem:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.validatePromo = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { code, eventId, subtotal } = req.body || {};
    if (!code || subtotal == null) {
      return res.status(400).json({ message: "code and subtotal are required" });
    }
    const result = await loyaltyService.validatePromoForUser(
      userId,
      code,
      eventId,
      Number(subtotal),
    );
    return res.json({
      valid: true,
      code: result.promo.Code,
      discountAmount: result.discountAmount,
      totalAfter: result.totalAfter,
      discountType: result.promo.discountType,
      discountValue: result.promo.discountValue,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("loyalty validatePromo:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.listPromos = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const summary = await loyaltyService.getLoyaltySummary(userId);
    return res.json({ promoCodes: summary?.activePromoCodes || [] });
  } catch (err) {
    console.error("loyalty listPromos:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
