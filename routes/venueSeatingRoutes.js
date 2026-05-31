const express = require("express");
const router = express.Router();
const venueSeating = require("../controllers/venueSeatingController");

router.post("/analyze-venue", venueSeating.analyzeVenueMiddleware, venueSeating.analyzeVenue);
router.post("/seating-layouts", express.json({ limit: "12mb" }), venueSeating.saveSeatingLayout);
router.get("/seating-layouts/:id", venueSeating.getSeatingLayout);

module.exports = router;
