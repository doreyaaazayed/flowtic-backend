/**
 * Seed food categories + items for all events that have none yet.
 * Usage: node scripts/seedFoodMenus.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
try {
  require("dns").setServers(["1.1.1.1", "8.8.8.8"]);
} catch (_) {}

const mongoose = require("mongoose");
const Event = require("../models/Event");
const FoodCategory = require("../models/FoodCategory");
const FoodItem = require("../models/FoodItem");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";

const MENU = [
  {
    cat: { Name: "Meals", sortOrder: 1 },
    items: [
      {
        Name: "Gourmet Burger Combo",
        Description: "Angus beef burger, fries, house sauce",
        Price: 185,
        preparationTimeMinutes: 20,
        isPopular: true,
        imageUrl:
          "https://images.unsplash.com/photo-1623610934157-0fcb6d50e90f?auto=format&fit=crop&w=800&q=80",
      },
      {
        Name: "Wood-Fired Margherita Pizza",
        Description: "Fresh mozzarella, basil, tomato",
        Price: 165,
        preparationTimeMinutes: 18,
        imageUrl:
          "https://images.unsplash.com/photo-1637438333503-5e218b937aef?auto=format&fit=crop&w=800&q=80",
      },
    ],
  },
  {
    cat: { Name: "Snacks", sortOrder: 2 },
    items: [
      {
        Name: "Loaded Nachos Supreme",
        Description: "Cheese, jalapeños, guacamole",
        Price: 95,
        preparationTimeMinutes: 12,
        imageUrl:
          "https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?auto=format&fit=crop&w=800&q=80",
      },
      {
        Name: "Gourmet Popcorn Mix",
        Description: "Sweet & savory blend",
        Price: 55,
        preparationTimeMinutes: 5,
        isPopular: true,
        imageUrl:
          "https://images.unsplash.com/photo-1768582870566-d1ea815a7545?auto=format&fit=crop&w=800&q=80",
      },
    ],
  },
  {
    cat: { Name: "Drinks", sortOrder: 3 },
    items: [
      {
        Name: "Signature Mocktail",
        Description: "Fresh fruit, citrus, mint",
        Price: 75,
        preparationTimeMinutes: 8,
        isPopular: true,
        imageUrl:
          "https://images.unsplash.com/photo-1730390772308-0ae7f139d042?auto=format&fit=crop&w=800&q=80",
      },
      {
        Name: "Soft Drink",
        Description: "Coke, Sprite, or Fanta",
        Price: 35,
        preparationTimeMinutes: 2,
        imageUrl:
          "https://images.unsplash.com/photo-1581006852262-e4307cf6283a?auto=format&fit=crop&w=800&q=80",
      },
    ],
  },
  {
    cat: { Name: "Desserts", sortOrder: 4 },
    items: [
      {
        Name: "Chocolate Lava Cake",
        Description: "Warm center, vanilla cream",
        Price: 85,
        preparationTimeMinutes: 15,
        imageUrl:
          "https://images.unsplash.com/photo-1606313564200-e75d5e7a0568?auto=format&fit=crop&w=800&q=80",
      },
    ],
  },
];

async function nextCatId() {
  const last = await FoodCategory.findOne().sort({ CategoryID: -1 }).lean();
  return (last?.CategoryID || 0) + 1;
}

async function nextFoodId() {
  const last = await FoodItem.findOne().sort({ FoodItemID: -1 }).lean();
  return (last?.FoodItemID || 0) + 1;
}

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  const events = await Event.find({ Status: { $in: ["Active", "Completed"] } }).lean();
  let seeded = 0;

  for (const ev of events) {
    const existing = await FoodItem.countDocuments({ EventID: ev.EventID });
    if (existing > 0) continue;

    let catId = await nextCatId();
    let foodId = await nextFoodId();

    for (const block of MENU) {
      const cat = await FoodCategory.create({
        CategoryID: catId++,
        EventID: ev.EventID,
        Name: block.cat.Name,
        Description: block.cat.Name,
        sortOrder: block.cat.sortOrder,
      });

      for (const item of block.items) {
        await FoodItem.create({
          FoodItemID: foodId++,
          EventID: ev.EventID,
          CategoryID: cat.CategoryID,
          Name: item.Name,
          Description: item.Description,
          Price: item.Price,
          imageUrl: item.imageUrl,
          stockQuantity: 200,
          availability: true,
          preparationTimeMinutes: item.preparationTimeMinutes,
          isPopular: !!item.isPopular,
          popularityScore: item.isPopular ? 10 : 0,
          ratingAvg: 4.5,
          ratingCount: 12,
        });
      }
    }
    seeded++;
    console.log(`+ Menu for event #${ev.EventID} ${ev.Name}`);
  }

  console.log(`Done. Seeded menus for ${seeded} event(s).`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
