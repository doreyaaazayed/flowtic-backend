const express = require("express");
const {
  listRestaurants,
  getVenueMenu,
  listVenueFood,
  getRestaurantMenu,
} = require("../controllers/venueFoodController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/:venueId/restaurants", requireAuth, listRestaurants);
router.get("/:venueId/menu", requireAuth, getVenueMenu);
router.get("/:venueId/food", requireAuth, listVenueFood);

const restaurantRouter = express.Router();
restaurantRouter.get("/:id/menu", requireAuth, getRestaurantMenu);

module.exports = { venueFoodRouter: router, restaurantFoodRouter: restaurantRouter };
