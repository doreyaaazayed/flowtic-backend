const express = require("express");
const {
  list,
  getById,
  update,
  remove,
  listPendingOrganizers,
  approveOrganizer,
  rejectOrganizer,
  resetUserFaceId,
} = require("../controllers/userController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, requireRole("admin"), list);
router.get("/pending-organizers", requireAuth, requireRole("admin"), listPendingOrganizers);
router.post("/:id/approve-organizer", requireAuth, requireRole("admin"), approveOrganizer);
router.post("/:id/reject-organizer", requireAuth, requireRole("admin"), rejectOrganizer);
router.post("/:id/reset-face-id", requireAuth, requireRole("admin"), resetUserFaceId);
router.get("/:id", requireAuth, requireRole("admin"), getById);
router.put("/:id", requireAuth, requireRole("admin"), update);
router.patch("/:id", requireAuth, requireRole("admin"), update);
router.delete("/:id", requireAuth, requireRole("admin"), remove);

module.exports = router;
