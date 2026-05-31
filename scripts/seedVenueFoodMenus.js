/**
 * Seed venue-scoped F&B: restaurants, categories, and items per venue type.
 * Each venue gets a unique menu (cinema vs stadium vs festival, etc.).
 *
 * Usage (from backend/):
 *   node scripts/seedVenueFoodMenus.js
 *   node scripts/seedVenueFoodMenus.js --reset   # remove venue-scoped food then re-seed
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
try {
  require("dns").setServers(["1.1.1.1", "8.8.8.8"]);
} catch (_) {}

const mongoose = require("mongoose");
const Venue = require("../models/Venue");
const Vendor = require("../models/Vendor");
const Restaurant = require("../models/Restaurant");
const FoodCategory = require("../models/FoodCategory");
const FoodItem = require("../models/FoodItem");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";

const VENUE_MENU_PROFILES = {
  Theater: {
    restaurants: [
      {
        Name: "Cinema Concessions",
        categoryType: "Cinema",
        imageUrl:
          "https://images.unsplash.com/photo-1768582870566-d1ea815a7545?auto=format&fit=crop&w=800&q=80",
        isFeatured: true,
        menu: [
          {
            cat: "Snacks",
            items: [
              {
                Name: "Butter Popcorn (Large)",
                Description: "Fresh popped with real butter",
                Price: 65,
                isPopular: true,
                isVenueExclusive: true,
                imageUrl:
                  "https://images.unsplash.com/photo-1768582870566-d1ea815a7545?auto=format&fit=crop&w=800&q=80",
              },
              {
                Name: "Nachos & Cheese",
                Description: "Crispy chips with warm cheese dip",
                Price: 75,
                imageUrl:
                  "https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?auto=format&fit=crop&w=800&q=80",
              },
            ],
          },
          {
            cat: "Drinks",
            items: [
              {
                Name: "Soft Drink Combo",
                Description: "Coke, Sprite, or Fanta — large",
                Price: 45,
                isPopular: true,
                imageUrl:
                  "https://images.unsplash.com/photo-1581006852262-e4307cf6283a?auto=format&fit=crop&w=800&q=80",
              },
              {
                Name: "Bottled Water",
                Description: "500ml chilled",
                Price: 25,
                preparationTimeMinutes: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  Stadium: {
    restaurants: [
      {
        Name: "Stadium Grill",
        categoryType: "Fast Food",
        imageUrl:
          "https://images.unsplash.com/photo-1623610934157-0fcb6d50e90f?auto=format&fit=crop&w=800&q=80",
        isFeatured: true,
        menu: [
          {
            cat: "Combos",
            items: [
              {
                Name: "Match Day Burger Combo",
                Description: "Beef burger, fries, drink",
                Price: 195,
                isPopular: true,
                isFeatured: true,
                imageUrl:
                  "https://images.unsplash.com/photo-1623610934157-0fcb6d50e90f?auto=format&fit=crop&w=800&q=80",
              },
              {
                Name: "Chicken Wrap & Chips",
                Description: "Grilled chicken, garlic sauce",
                Price: 145,
                imageUrl:
                  "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&w=800&q=80",
              },
            ],
          },
          {
            cat: "Drinks",
            items: [
              {
                Name: "Energy Drink",
                Description: "Boost for the second half",
                Price: 55,
                isPopular: true,
                isVenueExclusive: true,
              },
              {
                Name: "Sports Drink",
                Description: "Electrolyte hydration",
                Price: 40,
              },
            ],
          },
        ],
      },
      {
        Name: "Sideline Snacks",
        categoryType: "Snacks",
        imageUrl:
          "https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?auto=format&fit=crop&w=800&q=80",
        menu: [
          {
            cat: "Snacks",
            items: [
              {
                Name: "Loaded Hot Dog",
                Description: "Ketchup, mustard, onions",
                Price: 85,
                isPopular: true,
              },
              {
                Name: "Pretzel with Dip",
                Description: "Warm salted pretzel",
                Price: 60,
              },
            ],
          },
        ],
      },
    ],
  },
  Arena: {
    restaurants: [
      {
        Name: "Arena Bites",
        categoryType: "Concert Food",
        imageUrl:
          "https://images.unsplash.com/photo-1623610934157-0fcb6d50e90f?auto=format&fit=crop&w=800&q=80",
        isFeatured: true,
        menu: [
          {
            cat: "Meals",
            items: [
              {
                Name: "Concert Burger & Fries",
                Description: "Classic arena burger combo",
                Price: 185,
                isPopular: true,
                isFeatured: true,
                imageUrl:
                  "https://images.unsplash.com/photo-1623610934157-0fcb6d50e90f?auto=format&fit=crop&w=800&q=80",
              },
              {
                Name: "Veggie Bowl",
                Description: "Rice, falafel, tahini",
                Price: 155,
              },
            ],
          },
          {
            cat: "Drinks",
            items: [
              {
                Name: "Craft Mocktail",
                Description: "House blend — non-alcoholic",
                Price: 75,
                isPopular: true,
                imageUrl:
                  "https://images.unsplash.com/photo-1730390772308-0ae7f139d042?auto=format&fit=crop&w=800&q=80",
              },
            ],
          },
        ],
      },
    ],
  },
  Conference: {
    restaurants: [
      {
        Name: "Executive Lounge Catering",
        categoryType: "VIP",
        imageUrl:
          "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80",
        isFeatured: true,
        menu: [
          {
            cat: "Premium Meals",
            items: [
              {
                Name: "Grilled Salmon Plate",
                Description: "Seasonal vegetables, lemon butter",
                Price: 320,
                isFeatured: true,
                isVenueExclusive: true,
                preparationTimeMinutes: 25,
                imageUrl:
                  "https://images.unsplash.com/photo-1467003909585-2f8a727cf88d?auto=format&fit=crop&w=800&q=80",
              },
              {
                Name: "Truffle Pasta",
                Description: "Handmade pasta, parmesan",
                Price: 285,
                isPopular: true,
              },
            ],
          },
          {
            cat: "Beverages",
            items: [
              {
                Name: "Premium Coffee",
                Description: "Single-origin espresso",
                Price: 65,
                isPopular: true,
              },
              {
                Name: "Sparkling Water",
                Description: "Imported 750ml",
                Price: 45,
              },
            ],
          },
        ],
      },
    ],
  },
  "Open Air": {
    restaurants: [
      {
        Name: "Festival Food Trucks",
        categoryType: "Food Trucks",
        VendorName: "North Coast Vendors Co.",
        imageUrl:
          "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=800&q=80",
        isFeatured: true,
        menu: [
          {
            cat: "Street Food",
            items: [
              {
                Name: "Shawarma Wrap",
                Description: "Chicken or beef — food truck special",
                Price: 120,
                isPopular: true,
                isVenueExclusive: true,
                imageUrl:
                  "https://images.unsplash.com/photo-1529006557810-274dbfddcef8?auto=format&fit=crop&w=800&q=80",
              },
              {
                Name: "Loaded Fries",
                Description: "Cheese, herbs, spicy sauce",
                Price: 95,
              },
            ],
          },
          {
            cat: "Drinks",
            items: [
              {
                Name: "Fresh Lemonade",
                Description: "Made to order at the truck",
                Price: 50,
                isPopular: true,
              },
            ],
          },
        ],
      },
      {
        Name: "Coastal Grill Truck",
        categoryType: "Grill",
        VendorName: "Sea Breeze Kitchen",
        menu: [
          {
            cat: "Grill",
            items: [
              {
                Name: "Fish Tacos (2pc)",
                Description: "Grilled catch of the day",
                Price: 140,
                isFeatured: true,
              },
            ],
          },
        ],
      },
    ],
  },
  "Cultural Center": {
    restaurants: [
      {
        Name: "Café at the Wheel",
        categoryType: "Café",
        imageUrl:
          "https://images.unsplash.com/photo-1495474472284-4d489827aabd?auto=format&fit=crop&w=800&q=80",
        isFeatured: true,
        menu: [
          {
            cat: "Café",
            items: [
              {
                Name: "Cappuccino",
                Description: "Arabica blend",
                Price: 55,
                isPopular: true,
              },
              {
                Name: "Date Cake Slice",
                Description: "Local dates, cardamom",
                Price: 70,
                isVenueExclusive: true,
              },
            ],
          },
        ],
      },
    ],
  },
  Campus: {
    restaurants: [
      {
        Name: "Campus Canteen",
        categoryType: "Canteen",
        menu: [
          {
            cat: "Meals",
            items: [
              {
                Name: "Chicken Sandwich",
                Description: "Whole wheat, veggies",
                Price: 75,
                isPopular: true,
              },
              {
                Name: "Fruit Cup",
                Description: "Seasonal mix",
                Price: 45,
              },
            ],
          },
        ],
      },
    ],
  },
  default: {
    restaurants: [
      {
        Name: "Venue Concessions",
        categoryType: "General",
        isFeatured: true,
        menu: [
          {
            cat: "Snacks",
            items: [
              {
                Name: "Mixed Snack Box",
                Description: "Chips, nuts, chocolate",
                Price: 80,
                isPopular: true,
              },
            ],
          },
          {
            cat: "Drinks",
            items: [
              {
                Name: "Soft Drink",
                Description: "Assorted brands",
                Price: 35,
              },
            ],
          },
        ],
      },
    ],
  },
};

function profileForVenue(venue) {
  const type = (venue.Type || "").trim();
  if (VENUE_MENU_PROFILES[type]) return VENUE_MENU_PROFILES[type];
  if (type.toLowerCase().includes("stadium")) return VENUE_MENU_PROFILES.Stadium;
  if (type.toLowerCase().includes("theater") || type.toLowerCase().includes("opera")) {
    return VENUE_MENU_PROFILES.Theater;
  }
  return VENUE_MENU_PROFILES.default;
}

async function nextId(Model, field) {
  const last = await Model.findOne().sort({ [field]: -1 }).select(field).lean();
  return (last?.[field] || 0) + 1;
}

async function resetVenueFood() {
  const venueIds = (await Venue.find().select("VenueID").lean()).map((v) => v.VenueID);
  if (!venueIds.length) return;
  await FoodItem.deleteMany({ VenueID: { $in: venueIds } });
  await FoodCategory.deleteMany({ VenueID: { $in: venueIds } });
  await Restaurant.deleteMany({ VenueID: { $in: venueIds } });
  console.log("Cleared venue-scoped restaurants, categories, and items.");
}

async function main() {
  const reset = process.argv.includes("--reset");
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });

  if (reset) await resetVenueFood();

  let catId = await nextId(FoodCategory, "CategoryID");
  let foodId = await nextId(FoodItem, "FoodItemID");
  let restId = await nextId(Restaurant, "RestaurantID");
  let vendorId = await nextId(Vendor, "VendorID");

  const vendorCache = {};
  async function getVendorId(name) {
    if (!name) return null;
    if (vendorCache[name]) return vendorCache[name];
    let v = await Vendor.findOne({ Name: name }).lean();
    if (!v) {
      v = await Vendor.create({ VendorID: vendorId++, Name: name, active: true });
    }
    vendorCache[name] = v.VendorID;
    return v.VendorID;
  }

  const venues = await Venue.find().lean();
  let seededVenues = 0;

  for (const venue of venues) {
    const existing = await Restaurant.countDocuments({ VenueID: venue.VenueID });
    if (existing > 0 && !reset) {
      console.log(`= Skip ${venue.Name} (already has restaurants)`);
      continue;
    }

    const profile = profileForVenue(venue);
    console.log(`+ Seeding F&B for ${venue.Name} (${venue.Type || "default"})`);

    for (const rDef of profile.restaurants) {
      const vid = await getVendorId(rDef.VendorName);
      const restaurant = await Restaurant.create({
        RestaurantID: restId++,
        VenueID: venue.VenueID,
        VendorID: vid,
        Name: rDef.Name,
        Description: rDef.Name,
        imageUrl: rDef.imageUrl || "",
        categoryType: rDef.categoryType || "",
        isFeatured: !!rDef.isFeatured,
        sortOrder: 0,
        ratingAvg: 4.4,
        ratingCount: 20,
        active: true,
      });

      for (const block of rDef.menu) {
        const cat = await FoodCategory.create({
          CategoryID: catId++,
          VenueID: venue.VenueID,
          RestaurantID: restaurant.RestaurantID,
          EventID: null,
          Name: block.cat,
          sortOrder: 1,
        });

        for (const item of block.items) {
          await FoodItem.create({
            FoodItemID: foodId++,
            VenueID: venue.VenueID,
            RestaurantID: restaurant.RestaurantID,
            EventID: null,
            CategoryID: cat.CategoryID,
            Name: item.Name,
            Description: item.Description || "",
            Price: item.Price,
            imageUrl: item.imageUrl || "",
            stockQuantity: 300,
            availability: true,
            preparationTimeMinutes: item.preparationTimeMinutes || 12,
            isPopular: !!item.isPopular,
            isFeatured: !!item.isFeatured,
            isVenueExclusive: !!item.isVenueExclusive,
            popularityScore: item.isPopular ? 12 : 0,
            ratingAvg: 4.5,
            ratingCount: 8,
          });
        }
      }
    }
    seededVenues++;
  }

  console.log(`Done. Seeded ${seededVenues} venue(s). Run with --reset to replace existing venue menus.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
