const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requireVendor } = require("../middleware/requireVendor");
const vendorController = require("../controllers/vendorController");

const router = express.Router();

router.use(requireAuth, requireVendor);

router.get("/me", vendorController.getMe);
router.get("/orders", vendorController.listOrders);
router.post("/orders", vendorController.createPosOrder);
router.get("/earnings", vendorController.getEarnings);
router.patch("/orders/:orderId/status", vendorController.updateOrderStatus);
router.get("/menu/items", vendorController.listMenuItems);
router.post("/menu/items", vendorController.createMenuItem);
router.put("/menu/items/:foodItemId", vendorController.updateMenuItem);

module.exports = router;
