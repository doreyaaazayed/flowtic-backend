const express = require("express");
const {
  getAdminStats,
  getAdminChart,
  getAdminSecurity,
  getAdminActivity,
  getOrganizerStats,
  getOrganizerChart,
  getOrganizerDemographics,
} = require("../controllers/statsController");
const { requireAuth, requireRole, requireOrganizerOrAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/admin", requireAuth, requireRole("admin"), getAdminStats);
router.get("/admin/chart", requireAuth, requireRole("admin"), getAdminChart);
router.get("/admin/security", requireAuth, requireRole("admin"), getAdminSecurity);
router.get("/admin/activity", requireAuth, requireRole("admin"), getAdminActivity);
router.get("/organizer", requireAuth, requireOrganizerOrAdmin, getOrganizerStats);
router.get("/organizer/chart", requireAuth, requireOrganizerOrAdmin, getOrganizerChart);
router.get("/organizer/demographics", requireAuth, requireOrganizerOrAdmin, getOrganizerDemographics);

module.exports = router;
