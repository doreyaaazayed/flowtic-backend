const express = require("express");
const {
  create,
  myBookings,
  myBookingsSummary,
  getById,
  cancel,
  update,
  remove,
  listDetails,
  getDetailById,
  updateDetail,
  removeDetail,
  validateTicketCode,
} = require("../controllers/bookingController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.post("/", requireAuth, create);
router.get("/my/summary", requireAuth, myBookingsSummary);
router.get("/my", requireAuth, myBookings);
router.get("/validate", validateTicketCode);
router.get("/:id", requireAuth, getById);
router.put("/:id", requireAuth, update);
router.patch("/:id", requireAuth, update);
router.delete("/:id", requireAuth, requireRole("admin"), remove);
router.post("/:id/cancel", requireAuth, cancel);
router.get("/:id/details", requireAuth, listDetails);
router.get("/:id/details/:detailId", requireAuth, getDetailById);
router.put("/:id/details/:detailId", requireAuth, updateDetail);
router.patch("/:id/details/:detailId", requireAuth, updateDetail);
router.delete("/:id/details/:detailId", requireAuth, requireRole("admin"), removeDetail);

module.exports = router;
