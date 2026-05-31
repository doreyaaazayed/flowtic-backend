/**
 * Seed/refresh global delivery methods for food ordering.
 * Idempotent — upserts by `code`. Run with: node scripts/seedDeliveryMethods.js
 * Also exported so the server can auto-seed on first boot.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const DeliveryMethod = require("../models/DeliveryMethod");

const METHODS = [
  {
    code: "pickup",
    name: "Standard pickup",
    description: "Pick up your order from the standard counter when it's ready.",
    price: 0,
    estimatedDeliveryMinutes: 15,
    tier: "pickup",
    icon: "package",
    sortOrder: 1,
  },
  {
    code: "counter",
    name: "Express counter",
    description: "Skip the line at our express priority counter.",
    price: 10,
    estimatedDeliveryMinutes: 10,
    tier: "standard",
    icon: "store",
    sortOrder: 2,
  },
  {
    code: "seat_delivery",
    name: "Deliver to my seat",
    description: "A runner brings your order straight to your seat.",
    price: 45,
    estimatedDeliveryMinutes: 25,
    tier: "standard",
    icon: "armchair",
    sortOrder: 3,
  },
  {
    code: "vip_table",
    name: "VIP table delivery",
    description: "Premium tableside service at your reserved VIP lounge.",
    price: 75,
    estimatedDeliveryMinutes: 30,
    tier: "premium",
    icon: "crown",
    sortOrder: 4,
  },
  {
    code: "express",
    name: "Express delivery",
    description: "Fastest possible delivery — prepared first and rushed to you.",
    price: 100,
    estimatedDeliveryMinutes: 12,
    tier: "express",
    icon: "rocket",
    sortOrder: 5,
  },
];

async function seedDeliveryMethods() {
  let created = 0;
  let updated = 0;
  for (const m of METHODS) {
    const existing = await DeliveryMethod.findOne({ code: m.code, EventID: null });
    if (!existing) {
      await DeliveryMethod.create({ ...m, EventID: null, active: true });
      created++;
    } else {
      Object.assign(existing, m, { active: true });
      await existing.save();
      updated++;
    }
  }
  return { created, updated, total: METHODS.length };
}

async function ensureDeliveryMethodsSeeded() {
  const count = await DeliveryMethod.countDocuments({ EventID: null });
  if (count > 0) return { skipped: true, count };
  return seedDeliveryMethods();
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing in .env");
    process.exit(1);
  }
  try {
    require("dns").setServers(["1.1.1.1", "8.8.8.8"]);
  } catch (_) {}
  await mongoose.connect(process.env.MONGO_URI, { dbName: "EventManagementDB" });
  const res = await seedDeliveryMethods();
  console.log("Delivery methods seeded:", res);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedDeliveryMethods, ensureDeliveryMethodsSeeded };
