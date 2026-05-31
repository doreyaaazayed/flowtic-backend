const express = require("express");
const { list, getById, create, update, remove } = require("../controllers/categoryController");
const { requireAuth, requireOrganizerOrAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", list);
router.get("/:id", getById);
router.post("/", requireAuth, requireOrganizerOrAdmin, create);
router.put("/:id", requireAuth, requireOrganizerOrAdmin, update);
router.patch("/:id", requireAuth, requireOrganizerOrAdmin, update);
router.delete("/:id", requireAuth, requireOrganizerOrAdmin, remove);

module.exports = router;
