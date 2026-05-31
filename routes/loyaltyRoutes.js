const express = require("express");
const { requireAuth } = require("../middleware/auth");
const loyaltyController = require("../controllers/loyaltyController");

const router = express.Router();

router.get("/me", requireAuth, loyaltyController.getMe);
router.get("/promos", requireAuth, loyaltyController.listPromos);
router.post("/redeem", requireAuth, loyaltyController.redeem);
router.post("/validate-promo", requireAuth, loyaltyController.validatePromo);

module.exports = router;
