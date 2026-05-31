const mongoose = require("mongoose");
const Venue = require("../models/Venue");
const Restaurant = require("../models/Restaurant");
const FoodCategory = require("../models/FoodCategory");
const FoodItem = require("../models/FoodItem");
const UserFoodFavorite = require("../models/UserFoodFavorite");

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveVenue(venueIdParam) {
  if (!venueIdParam) return null;
  if (mongoose.Types.ObjectId.isValid(venueIdParam)) {
    const byMongo = await Venue.findById(venueIdParam).lean();
    if (byMongo) return byMongo;
  }
  const num = Number(venueIdParam);
  if (!Number.isNaN(num)) {
    return Venue.findOne({ VenueID: num }).lean();
  }
  return null;
}

/** Items available for an event: venue catalog + optional event-only rows. */
function buildItemFilterForEvent(event, extra = {}) {
  const filter = { availability: true, ...extra };
  if (event.VenueID != null && event.VenueID !== "") {
    filter.VenueID = Number(event.VenueID);
    filter.$or = [
      { EventID: null },
      { EventID: { $exists: false } },
      { EventID: event.EventID },
    ];
  } else {
    filter.EventID = event.EventID;
  }
  return filter;
}

function buildCategoryFilterForEvent(event, restaurantId) {
  const filter = {};
  if (event.VenueID != null && event.VenueID !== "") {
    filter.VenueID = Number(event.VenueID);
    filter.$or = [
      { EventID: null },
      { EventID: { $exists: false } },
      { EventID: event.EventID },
    ];
  } else {
    filter.EventID = event.EventID;
  }
  if (restaurantId != null) {
    filter.RestaurantID = Number(restaurantId);
  }
  return filter;
}

function buildVenueItemFilter(venueId, eventId, extra = {}) {
  const filter = {
    VenueID: Number(venueId),
    availability: true,
    ...extra,
  };
  if (eventId != null) {
    filter.$or = [
      { EventID: null },
      { EventID: { $exists: false } },
      { EventID: Number(eventId) },
    ];
  }
  return filter;
}

function sortItems(items, sort) {
  const list = [...items];
  switch (sort) {
    case "price-low":
      return list.sort((a, b) => a.Price - b.Price);
    case "price-high":
      return list.sort((a, b) => b.Price - a.Price);
    case "rating":
      return list.sort((a, b) => (b.ratingAvg || 0) - (a.ratingAvg || 0));
    case "popular":
      return list.sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
    case "newest":
      return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    default:
      return list;
  }
}

function applyQueryFilters(items, query) {
  const { search, minPrice, maxPrice, minRating, restaurant, category } = query;
  let list = items;
  if (restaurant && restaurant !== "all") {
    const rid = Number(restaurant);
    if (!Number.isNaN(rid)) {
      list = list.filter((i) => i.RestaurantID === rid);
    }
  }
  if (category && category !== "all") {
    const catLower = String(category).toLowerCase();
    list = list.filter(
      (i) =>
        String(i.categoryName || "").toLowerCase() === catLower ||
        String(i.CategoryID) === category,
    );
  }
  if (minPrice != null) {
    const min = Number(minPrice);
    if (!Number.isNaN(min)) list = list.filter((i) => i.Price >= min);
  }
  if (maxPrice != null) {
    const max = Number(maxPrice);
    if (!Number.isNaN(max)) list = list.filter((i) => i.Price <= max);
  }
  if (minRating != null) {
    const minR = Number(minRating);
    if (!Number.isNaN(minR)) list = list.filter((i) => (i.ratingAvg || 0) >= minR);
  }
  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter(
      (i) =>
        i.Name.toLowerCase().includes(q) ||
        (i.Description || "").toLowerCase().includes(q) ||
        (i.restaurantName || "").toLowerCase().includes(q),
    );
  }
  return list;
}

async function findFoodItemForEvent(event, foodItemId) {
  const id = Number(foodItemId);
  const base = { FoodItemID: id, availability: true };
  if (event.VenueID != null && event.VenueID !== "") {
    const venueItem = await FoodItem.findOne({
      ...base,
      VenueID: Number(event.VenueID),
      $or: [
        { EventID: null },
        { EventID: { $exists: false } },
        { EventID: event.EventID },
      ],
    });
    if (venueItem) return venueItem;
  }
  return FoodItem.findOne({ ...base, EventID: event.EventID });
}

async function loadRestaurantsForVenue(venueId) {
  return Restaurant.find({ VenueID: Number(venueId), active: true })
    .sort({ sortOrder: 1, Name: 1 })
    .lean();
}

async function enrichItems(items, userIdObj, eventNumericId) {
  const favorites = userIdObj
    ? await UserFoodFavorite.find({
        userId: userIdObj,
        EventID: eventNumericId,
      }).lean()
    : [];
  const favSet = new Set(favorites.map((f) => f.FoodItemID));

  const restaurantIds = [...new Set(items.map((i) => i.RestaurantID).filter(Boolean))];
  const restaurants = restaurantIds.length
    ? await Restaurant.find({ RestaurantID: { $in: restaurantIds } }).lean()
    : [];
  const restMap = Object.fromEntries(restaurants.map((r) => [r.RestaurantID, r]));

  const catIds = [...new Set(items.map((i) => i.CategoryID))];
  const cats = catIds.length
    ? await FoodCategory.find({ CategoryID: { $in: catIds } }).lean()
    : [];
  const catMap = Object.fromEntries(cats.map((c) => [c.CategoryID, c]));

  return items.map((i) => {
    const rest = i.RestaurantID ? restMap[i.RestaurantID] : null;
    const cat = catMap[i.CategoryID];
    return {
      ...i,
      id: i.FoodItemID,
      stock: i.stockQuantity,
      isFavorite: favSet.has(i.FoodItemID),
      restaurantName: rest?.Name || null,
      restaurantImageUrl: rest?.imageUrl || null,
      categoryName: cat?.Name || null,
    };
  });
}

async function fetchMenuForEvent(event, query = {}, userIdObj = null) {
  const filter = buildItemFilterForEvent(event);
  if (query.restaurant && query.restaurant !== "all") {
    const rid = Number(query.restaurant);
    if (!Number.isNaN(rid)) filter.RestaurantID = rid;
  }
  if (query.category && query.category !== "all") {
    const cat = await FoodCategory.findOne({
      ...buildCategoryFilterForEvent(event, query.restaurant),
      Name: new RegExp(`^${escapeRegex(query.category)}$`, "i"),
    }).lean();
    if (cat) filter.CategoryID = cat.CategoryID;
  }

  let items = await FoodItem.find(filter).lean();
  let restaurants = event.VenueID
    ? await loadRestaurantsForVenue(event.VenueID)
    : [];

  let categories = await FoodCategory.find(buildCategoryFilterForEvent(event, query.restaurant))
    .sort({ sortOrder: 1, Name: 1 })
    .lean();

  // Legacy fallback: per-event menus seeded before venue-scoped F&B
  if (!items.length && event.VenueID) {
    items = await FoodItem.find({ EventID: event.EventID, availability: true }).lean();
    if (items.length) {
      categories = await FoodCategory.find({ EventID: event.EventID })
        .sort({ sortOrder: 1, Name: 1 })
        .lean();
      restaurants = [];
    }
  }

  let enriched = await enrichItems(items, userIdObj, event.EventID);
  enriched = applyQueryFilters(
    enriched.map((i) => ({
      ...i,
      categoryName:
        i.categoryName ||
        categories.find((c) => c.CategoryID === i.CategoryID)?.Name ||
        "",
    })),
    query,
  );
  enriched = sortItems(enriched, query.sort);

  const popular = enriched.filter((i) => i.isPopular).slice(0, 8);
  const featured = enriched.filter((i) => i.isFeatured).slice(0, 8);
  const venueExclusive = enriched.filter((i) => i.isVenueExclusive).slice(0, 12);

  const byCategory = {};
  for (const cat of categories) {
    byCategory[cat.Name] = enriched.filter((i) => i.CategoryID === cat.CategoryID);
  }

  const byRestaurant = {};
  for (const rest of restaurants) {
    byRestaurant[rest.RestaurantID] = {
      restaurant: rest,
      items: enriched.filter((i) => i.RestaurantID === rest.RestaurantID),
    };
  }

  let venue = null;
  if (event.VenueID) {
    venue = await Venue.findOne({ VenueID: event.VenueID }).lean();
  }

  return {
    venue: venue
      ? {
          VenueID: venue.VenueID,
          Name: venue.Name,
          Location: venue.Location,
          Type: venue.Type,
        }
      : null,
    restaurants,
    categories,
    items: enriched,
    popular,
    featured,
    venueExclusive,
    byCategory,
    byRestaurant,
  };
}

async function fetchVenueFoodCatalog(venue, query = {}, eventId = null) {
  const filter = buildVenueItemFilter(venue.VenueID, eventId, {});
  if (query.restaurant && query.restaurant !== "all") {
    const rid = Number(query.restaurant);
    if (!Number.isNaN(rid)) filter.RestaurantID = rid;
  }

  let items = await FoodItem.find(filter).lean();
  const restaurants = await loadRestaurantsForVenue(venue.VenueID);
  const categories = await FoodCategory.find({
    VenueID: venue.VenueID,
    ...(query.restaurant && query.restaurant !== "all"
      ? { RestaurantID: Number(query.restaurant) }
      : {}),
  })
    .sort({ sortOrder: 1, Name: 1 })
    .lean();

  let enriched = await enrichItems(items, null, eventId || 0);
  enriched = applyQueryFilters(enriched, query);
  enriched = sortItems(enriched, query.sort);

  return {
    venue: {
      VenueID: venue.VenueID,
      Name: venue.Name,
      Location: venue.Location,
      Type: venue.Type,
    },
    restaurants,
    categories,
    items: enriched,
    popular: enriched.filter((i) => i.isPopular).slice(0, 8),
    featured: enriched.filter((i) => i.isFeatured).slice(0, 8),
    venueExclusive: enriched.filter((i) => i.isVenueExclusive).slice(0, 12),
  };
}

async function fetchRestaurantMenu(restaurantId) {
  const rest = await Restaurant.findOne({
    RestaurantID: Number(restaurantId),
    active: true,
  }).lean();
  if (!rest) return null;

  const items = await FoodItem.find({
    RestaurantID: rest.RestaurantID,
    VenueID: rest.VenueID,
    availability: true,
  }).lean();

  const categories = await FoodCategory.find({
    VenueID: rest.VenueID,
    RestaurantID: rest.RestaurantID,
  })
    .sort({ sortOrder: 1, Name: 1 })
    .lean();

  const enriched = await enrichItems(items, null, 0);
  return { restaurant: rest, categories, items: enriched };
}

module.exports = {
  resolveVenue,
  buildItemFilterForEvent,
  buildCategoryFilterForEvent,
  findFoodItemForEvent,
  fetchMenuForEvent,
  fetchVenueFoodCatalog,
  fetchRestaurantMenu,
  sortItems,
  loadRestaurantsForVenue,
};
