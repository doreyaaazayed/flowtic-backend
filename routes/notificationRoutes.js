const express = require("express");
const { requireAuth } = require("../middleware/auth");
const n = require("../controllers/notificationController");

const router = express.Router();

router.get("/", requireAuth, n.listMine);
router.patch("/:id/read", requireAuth, n.markRead);
router.post("/read-all", requireAuth, n.markAllRead);

module.exports = router;
