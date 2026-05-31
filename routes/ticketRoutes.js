const express = require("express");
const {
  list,
  getById,
  create,
  update,
  remove,
} = require("../controllers/ticketController");
const { requireAuth, requireRole, requireOrganizerOrAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, list);
router.get("/:id", requireAuth, getById);
router.post("/", requireAuth, requireOrganizerOrAdmin, create);
router.put("/:id", requireAuth, requireRole("admin"), update);
router.patch("/:id", requireAuth, requireRole("admin"), update);
router.delete("/:id", requireAuth, requireRole("admin"), remove);

module.exports = router;
