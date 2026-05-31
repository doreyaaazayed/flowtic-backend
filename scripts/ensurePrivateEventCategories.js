const EventCategory = require("../models/EventCategory");

const PRIVATE_CATEGORIES = [
  { CategoryID: 4, Name: "Prom", Description: "Private prom events — invite-only, hidden from public listings" },
  { CategoryID: 5, Name: "Weddings", Description: "Private wedding events — invite-only, hidden from public listings" },
  { CategoryID: 6, Name: "Private", Description: "Private celebrations — invite-only, hidden from public listings" },
];

async function ensurePrivateEventCategories() {
  let created = 0;
  for (const row of PRIVATE_CATEGORIES) {
    const existing = await EventCategory.findOne({ CategoryID: row.CategoryID }).lean();
    if (!existing) {
      await EventCategory.create(row);
      created += 1;
    }
  }
  return { created, skipped: created === 0 };
}

module.exports = { ensurePrivateEventCategories };
