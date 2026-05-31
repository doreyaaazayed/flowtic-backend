const express = require("express");
const {
  get,
  update,
  uploadPhoto,
  removePhoto,
  uploadPhotoMiddleware,
  faceStatus,
  enrollFace,
  verifyFace,
  deleteFace,
} = require("../controllers/profileController");
const { listCards, addCard, deleteCard } = require("../controllers/profileCardsController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, get);
router.put("/", requireAuth, update);
router.patch("/", requireAuth, update);

router.post("/photo", requireAuth, (req, res, next) => {
  uploadPhotoMiddleware(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || "Invalid upload" });
    next();
  });
}, uploadPhoto);
router.delete("/photo", requireAuth, removePhoto);

router.get("/cards", requireAuth, listCards);
router.post("/cards", requireAuth, addCard);
router.delete("/cards/:id", requireAuth, deleteCard);

router.get("/face", requireAuth, faceStatus);
router.post("/face/enroll", requireAuth, enrollFace);
router.post("/face/verify", requireAuth, verifyFace);
router.delete("/face", requireAuth, deleteFace);

module.exports = router;
