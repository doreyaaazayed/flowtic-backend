const Event = require("../models/Event");
const {
  resolveVenue,
  fetchVenueFoodCatalog,
  fetchRestaurantMenu,
} = require("../services/foodMenuService");

/** GET /api/venue/:venueId/restaurants */
exports.listRestaurants = async (req, res) => {
  try {
    const venue = await resolveVenue(req.params.venueId);
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const catalog = await fetchVenueFoodCatalog(venue, {}, null);
    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return res.json({
      venue: catalog.venue,
      restaurants: catalog.restaurants,
    });
  } catch (err) {
    console.error("venueFood listRestaurants:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/venue/:venueId/menu */
exports.getVenueMenu = async (req, res) => {
  try {
    const venue = await resolveVenue(req.params.venueId);
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const eventId = req.query.eventId
      ? (await Event.findById(req.query.eventId).lean())?.EventID ||
        Number(req.query.eventId) ||
        null
      : null;

    const catalog = await fetchVenueFoodCatalog(venue, req.query, eventId);
    return res.json(catalog);
  } catch (err) {
    console.error("venueFood getVenueMenu:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/venue/:venueId/food */
exports.listVenueFood = async (req, res) => {
  try {
    const venue = await resolveVenue(req.params.venueId);
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const eventId = req.query.eventId
      ? (await Event.findById(req.query.eventId).lean())?.EventID ||
        Number(req.query.eventId) ||
        null
      : null;

    const catalog = await fetchVenueFoodCatalog(venue, req.query, eventId);
    return res.json({
      venue: catalog.venue,
      items: catalog.items,
      total: catalog.items.length,
    });
  } catch (err) {
    console.error("venueFood listVenueFood:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/restaurant/:id/menu */
exports.getRestaurantMenu = async (req, res) => {
  try {
    const data = await fetchRestaurantMenu(req.params.id);
    if (!data) return res.status(404).json({ message: "Restaurant not found" });
    return res.json(data);
  } catch (err) {
    console.error("venueFood getRestaurantMenu:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
