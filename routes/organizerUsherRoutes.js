const express = require("express");
const { requireAuth, requireOrganizerOrAdmin } = require("../middleware/auth");
const organizerUsherController = require("../controllers/organizerUsherController");

const router = express.Router();

router.use(requireAuth, requireOrganizerOrAdmin);

router.get("/", organizerUsherController.listUshers);
router.get("/activity", organizerUsherController.usherActivity);
router.post("/provision", organizerUsherController.provisionUsher);
router.post("/bulk", organizerUsherController.bulkProvision);
router.get("/events/:eventMongoId/gates", organizerUsherController.listEventGates);
router.patch("/events/:eventMongoId/usher-settings", organizerUsherController.updateEventUsherSettings);
router.post("/:usherUserId/send-credentials", organizerUsherController.sendCredentials);
router.delete("/:usherUserId", organizerUsherController.deactivateUsher);
router.put("/:usherUserId/gates", organizerUsherController.assignGates);

module.exports = router;
