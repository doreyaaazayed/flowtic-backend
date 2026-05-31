const express = require("express");
const {
  checkAccess,
  getEventMenu,
  myTicketEvents,
  getFoodItem,
  getCart,
  addToCart,
  updateCart,
  removeFromCart,
  clearCart,
  checkout,
  myOrders,
  getOrder,
  updateOrderStatus,
  toggleFavorite,
  addReview,
  reorder,
  listDeliveryMethods,
  editOrder,
} = require("../controllers/foodController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.get("/my-events", myTicketEvents);
router.get("/event/:eventId/access", checkAccess);
router.get("/event/:eventId", getEventMenu);

router.get("/delivery-methods", listDeliveryMethods);

router.get("/cart", getCart);
router.post("/cart/add", addToCart);
router.put("/cart/update", updateCart);
router.delete("/cart/remove", removeFromCart);
router.delete("/cart/clear", clearCart);

router.post("/checkout", checkout);
router.post("/order", checkout);

router.get("/orders/my", myOrders);
router.get("/orders/:orderId", getOrder);
router.put("/orders/:orderId/status", updateOrderStatus);
router.put("/orders/:orderId/edit", editOrder);
router.post("/orders/:orderId/reorder", reorder);

router.post("/favorites/toggle", toggleFavorite);
router.post("/reviews", addReview);

router.get("/:id", getFoodItem);

module.exports = router;
