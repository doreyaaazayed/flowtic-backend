const Venue = require("../models/Venue");
const Vendor = require("../models/Vendor");
const Restaurant = require("../models/Restaurant");
const FoodCategory = require("../models/FoodCategory");
const FoodItem = require("../models/FoodItem");
const { resolveVenue } = require("../services/foodMenuService");

async function nextId(Model, field) {
  const last = await Model.findOne().sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

/** GET /api/admin/food/venues/:venueId */
exports.getVenueFoodSummary = async (req, res) => {
  try {
    const venue = await resolveVenue(req.params.venueId);
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const [restaurants, itemCount, categoryCount] = await Promise.all([
      Restaurant.find({ VenueID: venue.VenueID }).sort({ sortOrder: 1 }).lean(),
      FoodItem.countDocuments({ VenueID: venue.VenueID }),
      FoodCategory.countDocuments({ VenueID: venue.VenueID }),
    ]);

    return res.json({
      venue: {
        VenueID: venue.VenueID,
        Name: venue.Name,
        Location: venue.Location,
        Type: venue.Type,
      },
      restaurants,
      itemCount,
      categoryCount,
    });
  } catch (err) {
    console.error("adminFood getVenueFoodSummary:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/admin/food/venues/:venueId/restaurants */
exports.createRestaurant = async (req, res) => {
  try {
    const venue = await resolveVenue(req.params.venueId);
    if (!venue) return res.status(404).json({ message: "Venue not found" });

    const {
      Name,
      Description,
      imageUrl,
      categoryType,
      cuisineType,
      VendorID,
      sortOrder,
      isFeatured,
    } = req.body || {};
    if (!Name) return res.status(400).json({ message: "Name is required" });

    const restaurant = await Restaurant.create({
      RestaurantID: await nextId(Restaurant, "RestaurantID"),
      VenueID: venue.VenueID,
      VendorID: VendorID ? Number(VendorID) : null,
      Name,
      Description: Description || "",
      imageUrl: imageUrl || "",
      categoryType: categoryType || "",
      cuisineType: cuisineType || "",
      sortOrder: sortOrder ?? 0,
      isFeatured: !!isFeatured,
      active: true,
    });

    return res.status(201).json(restaurant);
  } catch (err) {
    console.error("adminFood createRestaurant:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/admin/food/restaurants/:restaurantId */
exports.updateRestaurant = async (req, res) => {
  try {
    const rest = await Restaurant.findOne({
      RestaurantID: Number(req.params.restaurantId),
    });
    if (!rest) return res.status(404).json({ message: "Restaurant not found" });

    const fields = [
      "Name",
      "Description",
      "imageUrl",
      "categoryType",
      "cuisineType",
      "VendorID",
      "sortOrder",
      "active",
      "isFeatured",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) rest[f] = req.body[f];
    }
    await rest.save();
    return res.json(rest);
  } catch (err) {
    console.error("adminFood updateRestaurant:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/admin/food/restaurants/:restaurantId/items */
exports.createFoodItem = async (req, res) => {
  try {
    const rest = await Restaurant.findOne({
      RestaurantID: Number(req.params.restaurantId),
    });
    if (!rest) return res.status(404).json({ message: "Restaurant not found" });

    const {
      Name,
      Description,
      Price,
      imageUrl,
      CategoryID,
      categoryName,
      stockQuantity,
      availability,
      isPopular,
      isVenueExclusive,
      isFeatured,
      EventID,
    } = req.body || {};
    if (!Name || Price == null) {
      return res.status(400).json({ message: "Name and Price are required" });
    }

    let catId = CategoryID ? Number(CategoryID) : null;
    if (!catId && categoryName) {
      let cat = await FoodCategory.findOne({
        VenueID: rest.VenueID,
        RestaurantID: rest.RestaurantID,
        Name: categoryName,
      });
      if (!cat) {
        cat = await FoodCategory.create({
          CategoryID: await nextId(FoodCategory, "CategoryID"),
          VenueID: rest.VenueID,
          RestaurantID: rest.RestaurantID,
          Name: categoryName,
          sortOrder: 0,
        });
      }
      catId = cat.CategoryID;
    }
    if (!catId) {
      return res.status(400).json({ message: "CategoryID or categoryName is required" });
    }

    const item = await FoodItem.create({
      FoodItemID: await nextId(FoodItem, "FoodItemID"),
      VenueID: rest.VenueID,
      RestaurantID: rest.RestaurantID,
      EventID: EventID ? Number(EventID) : null,
      CategoryID: catId,
      Name,
      Description: Description || "",
      Price: Number(Price),
      imageUrl: imageUrl || "",
      stockQuantity: stockQuantity ?? 100,
      availability: availability !== false,
      isPopular: !!isPopular,
      isVenueExclusive: !!isVenueExclusive,
      isFeatured: !!isFeatured,
      popularityScore: isPopular ? 10 : 0,
    });

    return res.status(201).json(item);
  } catch (err) {
    console.error("adminFood createFoodItem:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/admin/food/items/:foodItemId */
exports.updateFoodItem = async (req, res) => {
  try {
    const item = await FoodItem.findOne({
      FoodItemID: Number(req.params.foodItemId),
    });
    if (!item) return res.status(404).json({ message: "Food item not found" });

    const fields = [
      "Name",
      "Description",
      "Price",
      "imageUrl",
      "stockQuantity",
      "availability",
      "isPopular",
      "isVenueExclusive",
      "isFeatured",
      "RestaurantID",
      "CategoryID",
      "EventID",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) item[f] = req.body[f];
    }
    await item.save();
    return res.json(item);
  } catch (err) {
    console.error("adminFood updateFoodItem:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/admin/food/vendors */
exports.createVendor = async (req, res) => {
  try {
    const { Name, Email, Phone } = req.body || {};
    if (!Name) return res.status(400).json({ message: "Name is required" });
    const vendor = await Vendor.create({
      VendorID: await nextId(Vendor, "VendorID"),
      Name,
      Email: Email || "",
      Phone: Phone || "",
    });
    return res.status(201).json(vendor);
  } catch (err) {
    console.error("adminFood createVendor:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/admin/food/venues */
exports.listVenuesWithFood = async (req, res) => {
  try {
    const venues = await Venue.find().sort({ Name: 1 }).lean();
    const counts = await FoodItem.aggregate([
      { $match: { VenueID: { $ne: null } } },
      { $group: { _id: "$VenueID", count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    return res.json({
      venues: venues.map((v) => ({
        ...v,
        foodItemCount: countMap[v.VenueID] || 0,
      })),
    });
  } catch (err) {
    console.error("adminFood listVenuesWithFood:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
