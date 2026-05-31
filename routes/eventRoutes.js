const express = require("express");
const {
  createEvent,
  listEvents,
  listMyEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  listPendingEvents,
  approveEvent,
  rejectEvent,
} = require("../controllers/eventController");
const {
  getSetupDeposit,
  paySetupDeposit,
} = require("../controllers/eventDepositController");
const {
  listByEvent,
  getById: getTicketCategoryById,
  create: createTicketCategory,
  update: updateTicketCategory,
  remove: removeTicketCategory,
} = require("../controllers/ticketCategoryController");
const {
  getSeatMap,
  createSeatMap,
  deleteSeatMap,
  saveSeatMapFloorPlan,
  analyzeSeatMapFloorPlan,
  analyzeFloorPlanPreview,
} = require("../controllers/seatMapController");
const {
  listByEvent: listReviewsByEvent,
  create: createReview,
  getById: getReviewById,
  update: updateReview,
  remove: removeReview,
} = require("../controllers/reviewController");
const {
  requireAuth,
  requireRole,
  requireOrganizerOrAdmin,
  optionalAuth,
} = require("../middleware/auth");

const router = express.Router();

// Public list & details
router.get("/", listEvents);
// Admin: pending events for approval (must be before /:id)
router.get("/pending", requireAuth, requireRole("admin"), listPendingEvents);
// Organizer: my events (must be before /:id)
router.get("/my", requireAuth, listMyEvents);
// AI floor-plan preview before an event exists (must be before /:eventId routes)
router.post(
  "/analyze-floor-plan-preview",
  requireAuth,
  requireOrganizerOrAdmin,
  analyzeFloorPlanPreview
);
// Ticket categories for an event (must be before /:id)
router.get("/:eventId/ticket-categories", listByEvent);
router.get("/:eventId/ticket-categories/:ticketCategoryId", getTicketCategoryById);
router.post(
  "/:eventId/ticket-categories",
  requireAuth,
  requireOrganizerOrAdmin,
  createTicketCategory
);
router.put(
  "/:eventId/ticket-categories/:ticketCategoryId",
  requireAuth,
  requireOrganizerOrAdmin,
  updateTicketCategory
);
router.patch(
  "/:eventId/ticket-categories/:ticketCategoryId",
  requireAuth,
  requireOrganizerOrAdmin,
  updateTicketCategory
);
router.delete(
  "/:eventId/ticket-categories/:ticketCategoryId",
  requireAuth,
  requireOrganizerOrAdmin,
  removeTicketCategory
);
// Seat map (seated events)
router.get("/:eventId/seat-map", getSeatMap);
router.post(
  "/:eventId/seat-map/floor-plan",
  requireAuth,
  requireOrganizerOrAdmin,
  saveSeatMapFloorPlan
);
router.post(
  "/:eventId/seat-map/analyze",
  requireAuth,
  requireOrganizerOrAdmin,
  analyzeSeatMapFloorPlan
);
router.post(
  "/:eventId/seat-map",
  requireAuth,
  requireOrganizerOrAdmin,
  createSeatMap
);
router.delete(
  "/:eventId/seat-map",
  requireAuth,
  requireOrganizerOrAdmin,
  deleteSeatMap
);
// Reviews for an event
router.get("/:eventId/reviews", listReviewsByEvent);
router.get("/:eventId/reviews/:reviewId", getReviewById);
router.post("/:eventId/reviews", requireAuth, createReview);
router.put("/:eventId/reviews/:reviewId", requireAuth, updateReview);
router.patch("/:eventId/reviews/:reviewId", requireAuth, updateReview);
router.delete("/:eventId/reviews/:reviewId", requireAuth, removeReview);
router.get(
  "/:id/setup-deposit",
  requireAuth,
  requireOrganizerOrAdmin,
  getSetupDeposit,
);
router.post(
  "/:id/setup-deposit/pay",
  requireAuth,
  requireOrganizerOrAdmin,
  paySetupDeposit,
);
router.get("/:id", optionalAuth, getEventById);
router.post("/:id/approve", requireAuth, requireRole("admin"), approveEvent);
router.post("/:id/reject", requireAuth, requireRole("admin"), rejectEvent);
router.put("/:id", requireAuth, requireOrganizerOrAdmin, updateEvent);
router.patch("/:id", requireAuth, requireOrganizerOrAdmin, updateEvent);
router.delete("/:id", requireAuth, requireOrganizerOrAdmin, deleteEvent);

// Organizer/admin create
router.post("/", requireAuth, requireOrganizerOrAdmin, createEvent);

module.exports = router;

