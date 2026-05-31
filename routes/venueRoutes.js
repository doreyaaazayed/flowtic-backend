const express = require("express");
const { list, getById, create, update, remove } = require("../controllers/venueController");
const { requireAuth, requireOrganizerOrAdmin, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", list);
router.get("/:id", getById);

/** Organizer + admin: add new venues */
router.post("/", requireAuth, requireOrganizerOrAdmin, create);

/** Admin only: edit or delete venues */
router.put("/:id", requireAuth, requireRole("admin"), update);
router.patch("/:id", requireAuth, requireRole("admin"), update);
router.delete("/:id", requireAuth, requireRole("admin"), remove);

module.exports = router;
