const express = require("express");
const { requireAuth, requireOrganizerOrAdmin } = require("../middleware/auth");
const organizerVendorController = require("../controllers/organizerVendorController");

const router = express.Router();

router.use(requireAuth, requireOrganizerOrAdmin);

router.get("/", organizerVendorController.listVendors);
router.post("/provision", organizerVendorController.provisionVendor);
router.get("/:vendorId/summary", organizerVendorController.getVendorSummary);

module.exports = router;
