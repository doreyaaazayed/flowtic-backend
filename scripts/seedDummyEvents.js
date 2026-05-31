/**
 * Insert dummy events for testing (with venues, categories, ticket categories, and tickets).
 *
 * Usage (from backend folder):
 *   node scripts/seedDummyEvents.js
 *   node scripts/seedDummyEvents.js --clean      # remove prior seed events first, then insert
 *   node scripts/seedDummyEvents.js --clean-only # remove prior seed events and exit
 *   EVENT_PER_RUN=15 node scripts/seedDummyEvents.js
 *
 * Env:
 *   MONGO_URI       — required (same as server)
 *   SEED_PASSWORD   — optional, default: DummyTest123!
 *   EVENT_PER_RUN   — optional, how many events from the catalog to insert (default: all)
 *
 * What it creates / reuses:
 *   - A single seed organizer user: seed.organizer@flowtic.test (role: organizer)
 *   - Public categories (creates only if missing): Concerts, Sports, Conferences, Festivals,
 *     Workshops, Technology
 *   - Venues (creates only if missing): six well-known halls in Cairo + a couple of generic ones
 *   - Events (Status: Active) with imageUrl, capacity, isSeated=false
 *   - 3 ticket categories per event (Standard / VIP / Platinum) with small inventory so /purchase works
 *   - Ticket rows for each ticket category (IsAvailable=true)
 *
 * Idempotent: events are skipped if an event with the exact Name + seed organizer already exists.
 *
 * --clean / --clean-only removes:
 *   - All Events created by the seed organizer
 *   - All TicketCategories and Tickets linked to those events
 *   (Venues and Categories are left in place since they're useful even without the seeded events.)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

// Force public DNS so Atlas SRV lookups work even when the local resolver is blocked.
// (Some ISPs / VPNs return REFUSED for SRV queries, which causes Atlas connection to fail.)
try {
  require("dns").setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1", "8.8.4.4"]);
} catch (_) {}

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Event = require("../models/Event");
const Venue = require("../models/Venue");
const EventCategory = require("../models/EventCategory");
const TicketCategory = require("../models/TicketCategory");
const Ticket = require("../models/Ticket");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "EventManagementDB";
const ROLE_IDS = { attendee: 1, organizer: 2, admin: 3, vendor: 4 };

const SEED_ORGANIZER_EMAIL = "seed.organizer@flowtic.test";

function parseArgs() {
  const clean = process.argv.includes("--clean") || process.argv.includes("--clean-only");
  const cleanOnly = process.argv.includes("--clean-only");
  let limit = parseInt(process.env.EVENT_PER_RUN || "0", 10);
  if (Number.isNaN(limit) || limit < 0) limit = 0;
  return { clean, cleanOnly, limit };
}

// ---------- Catalog ----------

const CATEGORIES = [
  { Name: "Concerts", Description: "Live music shows and tours" },
  { Name: "Sports", Description: "Matches, finals and tournaments" },
  { Name: "Conferences", Description: "Tech & business conferences" },
  { Name: "Festivals", Description: "Outdoor & cultural festivals" },
  { Name: "Workshops", Description: "Hands-on learning experiences" },
  { Name: "Technology", Description: "Tech meetups and launches" },
  { Name: "Bazaars", Description: "Pop-up markets, fashion, design & artisan bazaars" },
];

const VENUES = [
  { Name: "Cairo Opera House", Location: "Zamalek, Cairo", Capacity: 1200, Type: "Theater" },
  { Name: "Cairo International Stadium", Location: "Nasr City, Cairo", Capacity: 75000, Type: "Stadium" },
  { Name: "New Administrative Capital Arena", Location: "New Capital, Egypt", Capacity: 17000, Type: "Arena" },
  { Name: "El Sawy Culture Wheel", Location: "Zamalek, Cairo", Capacity: 800, Type: "Cultural Center" },
  { Name: "Smart Village Conference Center", Location: "6th of October, Giza", Capacity: 3000, Type: "Conference" },
  { Name: "Marassi North Coast", Location: "Sidi Abdel Rahman, North Coast", Capacity: 12000, Type: "Open Air" },
  { Name: "AUC New Cairo Campus", Location: "New Cairo", Capacity: 1500, Type: "Campus" },
  { Name: "Bibliotheca Alexandrina", Location: "Alexandria", Capacity: 1700, Type: "Cultural Center" },
];

// Map an event's preferred venue/category by name (resolved at runtime to IDs)
const EVENT_CATALOG = [
  {
    Name: "Amr Diab — Cinematic Live",
    Description: "An immersive arena show with full orchestra, holographic stage and surprise guests.",
    categoryName: "Concerts",
    venueName: "New Administrative Capital Arena",
    daysFromNow: 14,
    durationHours: 3,
    capacity: 15000,
    imageUrl:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1500, VIP: 3500, Platinum: 7500 },
  },
  {
    Name: "El Ahly vs Zamalek — Cairo Derby",
    Description: "The biggest derby in African football, live at Cairo International Stadium.",
    categoryName: "Sports",
    venueName: "Cairo International Stadium",
    daysFromNow: 28,
    durationHours: 2,
    capacity: 60000,
    imageUrl:
      "https://images.unsplash.com/photo-1518091043644-c1d4457512c6?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 800, VIP: 2200, Platinum: 5500 },
  },
  {
    Name: "FlowTic AI Summit 2026",
    Description: "Keynotes from AI founders, hands-on labs, and a curated investor mixer.",
    categoryName: "Conferences",
    venueName: "Smart Village Conference Center",
    daysFromNow: 35,
    durationHours: 9,
    capacity: 2500,
    imageUrl:
      "https://images.unsplash.com/photo-1591115765373-5207764f72e7?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 2500, VIP: 5000, Platinum: 9500 },
  },
  {
    Name: "Sahel Beats — North Coast Festival",
    Description: "Three days of beachfront music, art installations, and sunset DJ sets.",
    categoryName: "Festivals",
    venueName: "Marassi North Coast",
    daysFromNow: 42,
    durationHours: 12,
    capacity: 10000,
    imageUrl:
      "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1800, VIP: 4500, Platinum: 9000 },
  },
  {
    Name: "Cinematic UI/UX Bootcamp",
    Description: "A two-day hands-on workshop on building luxury, motion-rich product experiences.",
    categoryName: "Workshops",
    venueName: "AUC New Cairo Campus",
    daysFromNow: 21,
    durationHours: 8,
    capacity: 200,
    imageUrl:
      "https://images.unsplash.com/photo-1551836022-deb4988cc6c0?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1200, VIP: 2200, Platinum: 3500 },
  },
  {
    Name: "Egypt Game Dev Expo",
    Description: "Indie showcases, AAA studio talks, esports finals and recruiting booths.",
    categoryName: "Technology",
    venueName: "Smart Village Conference Center",
    daysFromNow: 50,
    durationHours: 10,
    capacity: 4000,
    imageUrl:
      "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 600, VIP: 1400, Platinum: 3200 },
  },
  {
    Name: "Tamer Hosny — Roof Live",
    Description: "An intimate rooftop session with acoustic arrangements and string quartet.",
    categoryName: "Concerts",
    venueName: "El Sawy Culture Wheel",
    daysFromNow: 10,
    durationHours: 2,
    capacity: 700,
    imageUrl:
      "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1100, VIP: 2400, Platinum: 4800 },
  },
  {
    Name: "Padel Pro Championship — Cairo Open",
    Description: "Two days of professional padel finals with international top-20 seeds.",
    categoryName: "Sports",
    venueName: "AUC New Cairo Campus",
    daysFromNow: 18,
    durationHours: 7,
    capacity: 1500,
    imageUrl:
      "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 400, VIP: 1100, Platinum: 2600 },
  },
  {
    Name: "Founders Mixer · Series A Edition",
    Description: "An invite-only night for founders and VCs. Curated 1-on-1s and live demos.",
    categoryName: "Conferences",
    venueName: "Cairo Opera House",
    daysFromNow: 9,
    durationHours: 4,
    capacity: 400,
    imageUrl:
      "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1500, VIP: 3000, Platinum: 6500 },
  },
  {
    Name: "Ramadan Tent Live · 30 Nights",
    Description: "Nightly variety lineup — comedy sets, DJs, traditional music and late-night sahour.",
    categoryName: "Festivals",
    venueName: "Bibliotheca Alexandrina",
    daysFromNow: 60,
    durationHours: 6,
    capacity: 1500,
    imageUrl:
      "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 900, VIP: 1900, Platinum: 3800 },
  },
  {
    Name: "Filmmaking Masterclass · Cinematic Lighting",
    Description: "Hands-on cinema lighting workshop with award-winning DPs.",
    categoryName: "Workshops",
    venueName: "El Sawy Culture Wheel",
    daysFromNow: 24,
    durationHours: 8,
    capacity: 120,
    imageUrl:
      "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1400, VIP: 2800, Platinum: 4900 },
  },
  {
    Name: "Cairo Tech Crunch · Demo Night",
    Description: "A high-energy demo night for early-stage startups, judged by founders & investors.",
    categoryName: "Technology",
    venueName: "Cairo Opera House",
    daysFromNow: 12,
    durationHours: 4,
    capacity: 800,
    imageUrl:
      "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 700, VIP: 1500, Platinum: 3200 },
  },
  {
    Name: "Wegz — Stadium Tour",
    Description: "The Egyptian icon brings his cinematic stadium production to Cairo.",
    categoryName: "Concerts",
    venueName: "Cairo International Stadium",
    daysFromNow: 70,
    durationHours: 3,
    capacity: 45000,
    imageUrl:
      "https://images.unsplash.com/photo-1518972559570-7cc1309f3229?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1200, VIP: 3000, Platinum: 8500 },
  },
  {
    Name: "Cairo Marathon 2026",
    Description: "The annual Cairo Marathon — 5K, 10K and full marathon distances.",
    categoryName: "Sports",
    venueName: "Cairo International Stadium",
    daysFromNow: 90,
    durationHours: 5,
    capacity: 8000,
    imageUrl:
      "https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 350, VIP: 800, Platinum: 1800 },
  },
  {
    Name: "Future of Work · MENA Edition",
    Description: "AI, remote-first, and the new operating model for MENA companies.",
    categoryName: "Conferences",
    venueName: "New Administrative Capital Arena",
    daysFromNow: 56,
    durationHours: 9,
    capacity: 3500,
    imageUrl:
      "https://images.unsplash.com/photo-1515187029135-18ee286d815b?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 2200, VIP: 4500, Platinum: 8800 },
  },
  {
    Name: "Sahara Glow · Desert Festival",
    Description: "An overnight desert experience with cinematic stage design and live ensembles.",
    categoryName: "Festivals",
    venueName: "Marassi North Coast",
    daysFromNow: 75,
    durationHours: 14,
    capacity: 6000,
    imageUrl:
      "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 2000, VIP: 4800, Platinum: 9800 },
  },
  {
    Name: "Product Design · Portfolio Lab",
    Description: "Build a hireable senior product portfolio in two intensive weekends.",
    categoryName: "Workshops",
    venueName: "AUC New Cairo Campus",
    daysFromNow: 30,
    durationHours: 16,
    capacity: 80,
    imageUrl:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1800, VIP: 3200, Platinum: 5200 },
  },
  {
    Name: "GenAI Builders · Hackathon",
    Description: "48 hours of building production-grade GenAI apps with mentors on hand.",
    categoryName: "Technology",
    venueName: "Smart Village Conference Center",
    daysFromNow: 45,
    durationHours: 48,
    capacity: 600,
    imageUrl:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 500, VIP: 1200, Platinum: 2500 },
  },
  {
    Name: "Coldplay · Pyramids Live",
    Description: "A once-in-a-decade open-air show at the Giza Pyramids plateau.",
    categoryName: "Concerts",
    venueName: "Marassi North Coast",
    daysFromNow: 110,
    durationHours: 3,
    capacity: 18000,
    imageUrl:
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 3500, VIP: 8000, Platinum: 18000 },
  },
  {
    Name: "F1 Cairo GP · Show Run",
    Description: "Demonstration run featuring two current-season F1 cars on a closed Cairo circuit.",
    categoryName: "Sports",
    venueName: "Cairo International Stadium",
    daysFromNow: 130,
    durationHours: 4,
    capacity: 25000,
    imageUrl:
      "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 1800, VIP: 4500, Platinum: 9500 },
  },
  // ── Bazaars ────────────────────────────────────────────────────────────────
  {
    Name: "Zamalek Designers Bazaar",
    Description:
      "A curated pop-up market featuring 80+ Egyptian independent fashion, jewelry, and home-decor designers — live DJ, food trucks, and a kids' corner.",
    categoryName: "Bazaars",
    venueName: "El Sawy Culture Wheel",
    daysFromNow: 7,
    durationHours: 10,
    capacity: 4000,
    imageUrl:
      "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 150, VIP: 350, Platinum: 750 },
  },
  {
    Name: "Sahel Sunset Bazaar",
    Description:
      "An open-air seaside bazaar with boutique fashion houses, handcrafted ceramics, gourmet street food and a chill-out lounge.",
    categoryName: "Bazaars",
    venueName: "Marassi North Coast",
    daysFromNow: 38,
    durationHours: 9,
    capacity: 6000,
    imageUrl:
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 200, VIP: 500, Platinum: 1200 },
  },
  {
    Name: "Ramadan Nights Bazaar",
    Description:
      "A traditional Ramadan bazaar — lanterns, oriental sweets, calligraphy stalls, oud sessions and family-friendly nightly programming.",
    categoryName: "Bazaars",
    venueName: "Bibliotheca Alexandrina",
    daysFromNow: 55,
    durationHours: 8,
    capacity: 3500,
    imageUrl:
      "https://images.unsplash.com/photo-1583953006988-d1f57d4d4c64?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 120, VIP: 280, Platinum: 600 },
  },
  {
    Name: "Cairo Vintage Market",
    Description:
      "A two-day vintage and second-hand bazaar — designer thrift, vinyl records, retro electronics and curated antiques from 100+ sellers.",
    categoryName: "Bazaars",
    venueName: "AUC New Cairo Campus",
    daysFromNow: 20,
    durationHours: 9,
    capacity: 2000,
    imageUrl:
      "https://images.unsplash.com/photo-1567696911980-2eed69a46042?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 100, VIP: 250, Platinum: 500 },
  },
  {
    Name: "FlowTic Holiday Bazaar",
    Description:
      "The end-of-year cinematic bazaar — gift stalls, mulled drinks, live carols, photo booths and a Santa grotto for the kids.",
    categoryName: "Bazaars",
    venueName: "Cairo Opera House",
    daysFromNow: 80,
    durationHours: 11,
    capacity: 5000,
    imageUrl:
      "https://images.unsplash.com/photo-1543589077-47d81606c1bf?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 180, VIP: 420, Platinum: 900 },
  },
  {
    Name: "Smart Village Tech Bazaar",
    Description:
      "A tech-meets-marketplace bazaar — gadget makers, 3D-printed goods, smart-home demos and a hands-on robotics zone.",
    categoryName: "Bazaars",
    venueName: "Smart Village Conference Center",
    daysFromNow: 100,
    durationHours: 10,
    capacity: 2500,
    imageUrl:
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=80",
    prices: { Standard: 220, VIP: 480, Platinum: 1100 },
  },
];

// Stock-keeping per tier (how many seats per tier per event)
const TIER_INVENTORY = {
  Standard: 40,
  VIP: 18,
  Platinum: 8,
};

// ---------- Helpers ----------

async function getOrCreateSeedOrganizer() {
  let user = await User.findOne({ Email: SEED_ORGANIZER_EMAIL }).select("_id Email role");
  if (user) return user;

  const lastUser = await User.findOne().sort({ UserID: -1 }).select("UserID").lean();
  const nextUserID = (lastUser?.UserID ?? 0) + 1;
  const hashedPassword = await bcrypt.hash(process.env.SEED_PASSWORD || "DummyTest123!", 10);

  user = await User.create({
    UserID: nextUserID,
    Username: "FlowTic Seed Organizer",
    FirstName: "Seed",
    LastName: "Organizer",
    Phone: "01000000000",
    NationalID: "29900101099001",
    dateOfBirth: new Date("1990-01-01"),
    Email: SEED_ORGANIZER_EMAIL,
    Password: hashedPassword,
    RoleID: ROLE_IDS.organizer,
    role: "organizer",
    emailVerified: true,
    organizerType: "organization",
    organizationName: "FlowTic Studio",
    organizationLocation: "Cairo, Egypt",
    organizerApproved: true,
  });
  console.log(`Created seed organizer: ${SEED_ORGANIZER_EMAIL}`);
  return user;
}

async function ensureCategories() {
  const byName = {};
  for (const c of CATEGORIES) {
    let existing = await EventCategory.findOne({ Name: c.Name }).lean();
    if (!existing) {
      const last = await EventCategory.findOne().sort({ CategoryID: -1 }).lean();
      const nextId = (last?.CategoryID || 0) + 1;
      // Skip private IDs reserved for Prom/Weddings/Private
      const safeId = [4, 5, 6].includes(nextId) ? 7 : nextId;
      existing = await EventCategory.create({
        CategoryID: safeId,
        Name: c.Name,
        Description: c.Description,
      });
      console.log(`+ Category: ${c.Name} (#${safeId})`);
    }
    byName[c.Name] = existing.CategoryID;
  }
  return byName;
}

async function ensureVenues() {
  const byName = {};
  for (const v of VENUES) {
    let existing = await Venue.findOne({ Name: v.Name }).lean();
    if (!existing) {
      const last = await Venue.findOne().sort({ VenueID: -1 }).lean();
      const nextId = (last?.VenueID || 0) + 1;
      existing = await Venue.create({
        VenueID: nextId,
        Name: v.Name,
        Location: v.Location,
        Capacity: v.Capacity,
        Type: v.Type,
      });
      console.log(`+ Venue: ${v.Name} (#${nextId})`);
    }
    byName[v.Name] = existing.VenueID;
  }
  return byName;
}

function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  // Snap to 19:00 local
  d.setHours(19, 0, 0, 0);
  return d;
}

async function nextEventID() {
  const last = await Event.findOne().sort({ EventID: -1 }).lean();
  return (last?.EventID || 0) + 1;
}

async function nextTicketCatID() {
  const last = await TicketCategory.findOne().sort({ TicketCatID: -1 }).lean();
  return (last?.TicketCatID || 0) + 1;
}

async function nextTicketID() {
  const last = await Ticket.findOne().sort({ TicketID: -1 }).lean();
  return (last?.TicketID || 0) + 1;
}

async function insertEvent(spec, ctx) {
  const { organizerId, categoryByName, venueByName, limit } = ctx;

  if (limit && ctx.created >= limit) return { skipped: true, reason: "limit" };

  const CategoryID = categoryByName[spec.categoryName];
  const VenueID = venueByName[spec.venueName];
  if (!CategoryID || !VenueID) {
    return { skipped: true, reason: `missing category/venue (${spec.categoryName} / ${spec.venueName})` };
  }

  const existing = await Event.findOne({ Name: spec.Name, organizer: organizerId }).lean();
  if (existing) return { skipped: true, reason: "exists" };

  const StartDate = dayOffset(spec.daysFromNow);
  const EndDate = new Date(StartDate.getTime() + (spec.durationHours || 3) * 60 * 60 * 1000);

  const EventID = await nextEventID();
  const event = await Event.create({
    EventID,
    VenueID,
    CategoryID,
    Name: spec.Name,
    Description: spec.Description,
    StartDate,
    EndDate,
    Status: "Active",
    capacity: spec.capacity,
    isSeated: false,
    imageUrl: spec.imageUrl,
    organizer: organizerId,
  });

  // Ticket categories + tickets
  for (const tier of ["Standard", "VIP", "Platinum"]) {
    const price = spec.prices?.[tier];
    if (price == null) continue;
    const qty = TIER_INVENTORY[tier];
    const TicketCatID = await nextTicketCatID();
    await TicketCategory.create({
      TicketCatID,
      EventID,
      Name: tier,
      Price: price,
      TotalQuantity: qty,
      Description: `${tier} access`,
    });
    if (qty > 0) {
      let tid = await nextTicketID();
      const docs = [];
      for (let i = 0; i < qty; i++) {
        docs.push({
          TicketID: tid + i,
          EventID,
          TicketCatID,
          SeatID: 0,
          IsAvailable: true,
        });
      }
      await Ticket.insertMany(docs);
    }
  }

  ctx.created += 1;
  return { skipped: false, eventID: EventID };
}

async function cleanSeedEvents(organizerId) {
  const events = await Event.find({ organizer: organizerId }).select("EventID Name").lean();
  if (!events.length) {
    console.log("No seeded events to remove.");
    return 0;
  }
  const ids = events.map((e) => e.EventID);
  const ticketsDel = await Ticket.deleteMany({ EventID: { $in: ids } });
  const catsDel = await TicketCategory.deleteMany({ EventID: { $in: ids } });
  const eventsDel = await Event.deleteMany({ EventID: { $in: ids } });
  console.log(
    `--clean removed ${eventsDel.deletedCount} event(s), ${catsDel.deletedCount} ticket categor(ies), ${ticketsDel.deletedCount} ticket(s).`,
  );
  return eventsDel.deletedCount;
}

async function main() {
  const { clean, cleanOnly, limit } = parseArgs();

  if (!MONGO_URI) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 15000 });
  console.log("Connected:", DB_NAME);

  const organizer = await getOrCreateSeedOrganizer();

  if (clean) {
    await cleanSeedEvents(organizer._id);
    if (cleanOnly) {
      await mongoose.disconnect();
      process.exit(0);
    }
  }

  const categoryByName = await ensureCategories();
  const venueByName = await ensureVenues();

  const ctx = {
    organizerId: organizer._id,
    categoryByName,
    venueByName,
    limit,
    created: 0,
  };

  let inserted = 0;
  let skipped = 0;
  for (const spec of EVENT_CATALOG) {
    const res = await insertEvent(spec, ctx);
    if (res.skipped) {
      skipped++;
      if (res.reason && res.reason !== "exists" && res.reason !== "limit") {
        console.warn(`Skipped "${spec.Name}": ${res.reason}`);
      }
    } else {
      inserted++;
      console.log(`+ Event #${res.eventID}: ${spec.Name}`);
    }
  }

  console.log(`Done. Inserted ${inserted} event(s), skipped ${skipped}.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
