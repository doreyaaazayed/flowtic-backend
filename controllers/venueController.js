const Venue = require("../models/Venue");
const Event = require("../models/Event");
const venueImage = require("../services/venueImageService");

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LIST_PROJECTION =
  "VenueID Name Location Capacity Type Description imageUrl createdAt updatedAt";

async function enrichVenues(venues) {
  if (!venues.length) return [];
  const ids = venues.map((v) => v.VenueID);
  const counts = await Event.aggregate([
    { $match: { VenueID: { $in: ids }, Status: "Active" } },
    { $group: { _id: "$VenueID", count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));

  return Promise.all(
    venues.map(async (v) => {
      let imageUrl = venueImage.resolveVenueImageUrl(v);
      if (!imageUrl && venueImage.isDataUrl(v.imageUrl)) {
        imageUrl = await venueImage.migrateDataUrlToFile(v);
      }
      const activeEventCount = countMap[v.VenueID] || 0;
      return {
        ...v,
        imageUrl,
        activeEventCount,
        availabilityStatus: activeEventCount > 0 ? "hosting" : "available",
      };
    }),
  );
}

function formatVenue(doc) {
  if (!doc) return doc;
  const o = doc.toObject ? doc.toObject() : { ...doc };
  o.imageUrl = venueImage.resolveVenueImageUrl(o) || o.imageUrl || "";
  return o;
}

exports.list = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const paginated = req.query.page != null || req.query.limit != null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));

    const filter = {};
    if (search) {
      filter.$or = [
        { Name: { $regex: escapeRegex(search), $options: "i" } },
        { Location: { $regex: escapeRegex(search), $options: "i" } },
        { Type: { $regex: escapeRegex(search), $options: "i" } },
        { Description: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    if (paginated) {
      const skip = (page - 1) * limit;
      const [total, venues] = await Promise.all([
        Venue.countDocuments(filter),
        Venue.find(filter)
          .select(LIST_PROJECTION)
          .sort({ Name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);
      const data = await enrichVenues(venues);
      return res.json({
        data,
        total,
        page,
        limit,
        hasMore: skip + venues.length < total,
      });
    }

    const venues = await Venue.find(filter)
      .select(LIST_PROJECTION)
      .sort({ Name: 1 })
      .lean();
    const data = await enrichVenues(venues);
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return res.json(data);
  } catch (err) {
    console.error("List venues error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id).lean();
    if (!venue) return res.status(404).json({ message: "Venue not found" });
    const [enriched] = await enrichVenues([venue]);
    return res.json(enriched || venue);
  } catch (err) {
    console.error("Get venue error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Organizer or admin — create only */
exports.create = async (req, res) => {
  try {
    const { Name, Location, Capacity, Type, Description, imageUrl } = req.body || {};
    if (!Name || !Location) {
      return res.status(400).json({ message: "Name and Location are required" });
    }
    const last = await Venue.findOne().sort({ VenueID: -1 }).lean();
    const nextId = (last?.VenueID || 0) + 1;

    let storedImageUrl;
    if (imageUrl) {
      storedImageUrl = await venueImage.persistVenueImage(nextId, String(imageUrl).trim());
    }

    const venue = await Venue.create({
      VenueID: nextId,
      Name: String(Name).trim(),
      Location: String(Location).trim(),
      Capacity: Capacity ?? null,
      Type: Type ? String(Type).trim() : null,
      Description: Description ? String(Description).trim() : null,
      imageUrl: storedImageUrl || null,
    });
    return res.status(201).json(formatVenue(venue));
  } catch (err) {
    console.error("Create venue error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Admin only — update */
exports.update = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ message: "Venue not found" });
    const { Name, Location, Capacity, Type, Description, imageUrl } = req.body || {};
    if (Name !== undefined) venue.Name = String(Name).trim();
    if (Location !== undefined) venue.Location = String(Location).trim();
    if (Capacity !== undefined) venue.Capacity = Capacity === "" ? null : Number(Capacity);
    if (Type !== undefined) venue.Type = Type ? String(Type).trim() : null;
    if (Description !== undefined) venue.Description = Description ? String(Description).trim() : null;
    if (imageUrl !== undefined) {
      if (imageUrl === "" || imageUrl == null) {
        venue.imageUrl = null;
      } else {
        const stored = await venueImage.persistVenueImage(venue.VenueID, String(imageUrl).trim());
        venue.imageUrl = stored || String(imageUrl).trim();
      }
    }
    await venue.save();
    return res.json(formatVenue(venue));
  } catch (err) {
    console.error("Update venue error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Admin only — delete */
exports.remove = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const eventCount = await Event.countDocuments({ VenueID: venue.VenueID });
    if (eventCount > 0) {
      return res.status(400).json({
        message: `Cannot delete venue: ${eventCount} event(s) still reference it. Remove or reassign those events first.`,
      });
    }

    await Venue.findByIdAndDelete(req.params.id);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete venue error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
