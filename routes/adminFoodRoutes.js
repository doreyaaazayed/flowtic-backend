const express = require("express");
const {
  getVenueFoodSummary,
  createRestaurant,
  updateRestaurant,
  createFoodItem,
  updateFoodItem,
  createVendor,
  listVenuesWithFood,
} = require("../controllers/adminFoodController");
const { provisionVendor, listVendors } = require("../controllers/vendorController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

router.get("/venues", listVenuesWithFood);
router.get("/venues/:venueId", getVenueFoodSummary);
router.post("/venues/:venueId/restaurants", createRestaurant);
router.put("/restaurants/:restaurantId", updateRestaurant);
router.post("/restaurants/:restaurantId/items", createFoodItem);
router.put("/items/:foodItemId", updateFoodItem);
router.post("/vendors", createVendor);
router.post("/vendors/provision", provisionVendor);
router.get("/vendors", listVendors);

module.exports = router;
