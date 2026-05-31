/**
 * Seed crowd-entry demo data (users, event, tickets, assignments).
 * Run from repo root: node backend/scripts/seedEntryGatingDemo.js
 * Options: --assign-only (stop before link-friend), --json (stdout only)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/User");
const Event = require("../models/Event");
const Venue = require("../models/Venue");
const EventCategory = require("../models/EventCategory");
const EntryAssignment = require("../models/EntryAssignment");
const svc = require("../services/entryAssignmentService");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const EMBED_DIM = 128;

function l2normalize(arr) {
  const norm = Math.sqrt(arr.reduce((s, x) => s + x * x, 0));
  return arr.map((x) => x / norm);
}

function fakeEmbedding(seed) {
  const v = [];
  for (let i = 0; i < EMBED_DIM; i++) v.push(Math.sin(seed + i * 0.17) * 0.5 + 0.01);
  return l2normalize(v);
}

function tokenFor(user) {
  return jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: "1d" });
}

async function ensureUser({ email, role, firstName, lastName, embedding, ts }) {
  let user = await User.findOne({ Email: email });
  const pass = "E2eTest!234";
  if (!user) {
    const last = await User.findOne().sort({ UserID: -1 }).lean();
    const hash = await bcrypt.hash(pass, 10);
    user = await User.create({
      UserID: (last?.UserID || 0) + 1,
      Username: email.split("@")[0],
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Password: hash,
      Phone: `+1555${String(ts).slice(-7)}`,
      NationalID: `${String(ts).padStart(12, "0").slice(-12)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`,
      dateOfBirth: new Date("2000-01-15"),
      role,
      RoleID: role === "organizer" ? 2 : 1,
      emailVerified: true,
      organizerApproved: true,
      organizerType: "individual",
      faceEmbedding: embedding,
      faceIdReference: `human-faceres-v1:${EMBED_DIM}`,
    });
  } else {
    user.emailVerified = true;
    user.organizerApproved = true;
    user.faceEmbedding = embedding;
    user.faceIdReference = `human-faceres-v1:${EMBED_DIM}`;
    await user.save();
  }
  return { user, token: tokenFor(user), password: pass };
}

async function runSeed({ stopAfterAssign = false } = {}) {
  const steps = [];
  const ts = Date.now();
  const att1Emb = fakeEmbedding(2);

  const org = await ensureUser({
    email: `e2e-org-${ts}@flowtic.test`,
    role: "organizer",
    firstName: "E2E",
    lastName: "Organizer",
    embedding: fakeEmbedding(1),
    ts,
  });
  const att1 = await ensureUser({
    email: `e2e-a1-${ts}@flowtic.test`,
    role: "attendee",
    firstName: "Alex",
    lastName: "Attendee",
    embedding: att1Emb,
    ts,
  });
  const att2 = await ensureUser({
    email: `e2e-a2-${ts}@flowtic.test`,
    role: "attendee",
    firstName: "Blake",
    lastName: "Friend",
    embedding: fakeEmbedding(3),
    ts,
  });
  steps.push("users_ready");

  const venue = await Venue.findOne().lean();
  const category = await EventCategory.findOne({ CategoryID: { $nin: [4, 5, 6] } }).lean();
  if (!venue || !category) {
    throw new Error("Seed Venue + EventCategory in MongoDB first");
  }

  const lastEv = await Event.findOne().sort({ EventID: -1 }).lean();
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  const eventDoc = await Event.create({
    EventID: (lastEv?.EventID || 0) + 1,
    VenueID: venue.VenueID,
    CategoryID: category.CategoryID,
    Name: `E2E Entry Gating ${ts}`,
    Description: "Automated entry gating walkthrough",
    StartDate: start,
    EndDate: end,
    Status: "Active",
    organizer: org.user._id,
  });
  const eventMongoId = String(eventDoc._id);
  steps.push("event_created");

  const TicketCategory = require("../models/TicketCategory");
  const Ticket = require("../models/Ticket");
  const lastCat = await TicketCategory.findOne().sort({ TicketCatID: -1 }).lean();
  const catId = (lastCat?.TicketCatID || 0) + 1;
  const cat = await TicketCategory.create({
    TicketCatID: catId,
    EventID: eventDoc.EventID,
    Name: "General",
    Price: 25,
    TotalQuantity: 10,
    Description: "E2E",
  });
  const lastT = await Ticket.findOne().sort({ TicketID: -1 }).lean();
  let nextT = (lastT?.TicketID || 0) + 1;
  const ticketDocs = [];
  for (let i = 0; i < 10; i++) {
    ticketDocs.push({
      TicketID: nextT + i,
      EventID: eventDoc.EventID,
      TicketCatID: cat.TicketCatID,
      SeatID: 0,
      IsAvailable: true,
    });
  }
  await Ticket.insertMany(ticketDocs);
  steps.push("tickets_created");

  const bookTicket = async (user) => {
    const t = await Ticket.findOne({
      EventID: eventDoc.EventID,
      TicketCatID: cat.TicketCatID,
      IsAvailable: true,
    });
    if (!t) throw new Error("No available ticket");
    t.IsAvailable = false;
    t.OwnerUserId = user._id;
    await t.save();
    const Booking = require("../models/Booking");
    const BookingDetail = require("../models/BookingDetail");
    const lastB = await Booking.findOne().sort({ BookingID: -1 }).lean();
    const lastD = await BookingDetail.findOne().sort({ DetailID: -1 }).lean();
    const booking = await Booking.create({
      BookingID: (lastB?.BookingID || 0) + 1,
      userId: user._id,
      Date: new Date(),
      TotalAmount: cat.Price,
      Status: "Confirmed",
    });
    await BookingDetail.create({
      DetailID: (lastD?.DetailID || 0) + 1,
      BookingID: booking.BookingID,
      TicketID: t.TicketID,
      PriceAtBooking: cat.Price,
    });
    return t.TicketID;
  };

  const t1 = await bookTicket(att1.user);
  const t2 = await bookTicket(att2.user);
  steps.push("tickets_sold");

  await svc.setupInfrastructure(eventDoc.EventID, eventDoc.StartDate, {
    gateCount: 4,
    slotMinutes: 20,
    slotCount: 12,
    hoursBeforeStart: 3,
  });
  eventDoc.entryGatingEnabled = true;
  await eventDoc.save();
  const assign = await svc.runAssignment(eventDoc.EventID, true);
  if (assign.assigned < 2) {
    throw new Error(`Assign failed: ${JSON.stringify(assign)}`);
  }
  steps.push("assigned");

  const row1 = await EntryAssignment.findOne({
    EventID: eventDoc.EventID,
    TicketID: t1,
    status: "active",
  }).lean();
  const row2 = await EntryAssignment.findOne({
    EventID: eventDoc.EventID,
    TicketID: t2,
    status: "active",
  }).lean();
  if (!row1 || !row2) {
    throw new Error("Missing assignments");
  }

  const frontend = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  const payload = {
    ok: true,
    steps,
    password: "E2eTest!234",
    eventMongoId,
    eventName: eventDoc.Name,
    ticket1: t1,
    ticket2: t2,
    tokens: {
      organizer: org.token,
      attendee1: att1.token,
      attendee2: att2.token,
    },
    users: {
      organizer: { id: String(org.user._id), email: org.user.Email, role: "organizer" },
      attendee1: { id: String(att1.user._id), email: att1.user.Email, role: "attendee" },
      attendee2: { id: String(att2.user._id), email: att2.user.Email, role: "attendee" },
    },
    assignments: {
      ticket1: { gateIndex: row1.gateIndex, slotIndex: row1.slotIndex },
      ticket2: { gateIndex: row2.gateIndex, slotIndex: row2.slotIndex },
    },
    ui: {
      dashboard: `${frontend}/dashboard`,
      creator: `${frontend}/creator`,
      gateTools: `${frontend}/creator/entry/${eventMongoId}`,
    },
  };

  if (stopAfterAssign) {
    return { ...payload, stopAfter: "assign" };
  }

  const realign = await svc.realignLinkedCluster(eventDoc.EventID, Math.min(t1, t2), Math.max(t1, t2));
  if (realign.realigned < 2) {
    throw new Error(`Realign failed: ${JSON.stringify(realign)}`);
  }
  steps.push("friend_linked_realigned");

  const a1 = await EntryAssignment.findOne({
    EventID: eventDoc.EventID,
    TicketID: t1,
    status: "active",
  }).lean();
  const a2 = await EntryAssignment.findOne({
    EventID: eventDoc.EventID,
    TicketID: t2,
    status: "active",
  }).lean();
  if (a1.gateIndex !== a2.gateIndex || a1.slotIndex !== a2.slotIndex) {
    throw new Error("Friends not on same gate/slot");
  }
  steps.push("same_gate_slot");

  const faceResult = await svc.verifyAtGateWithFace(eventDoc.EventID, a1.gateIndex, t1, {
    embedding: att1Emb,
  });
  await svc.verifyAtGate(eventDoc.EventID, a1.gateIndex, t2);
  steps.push("gate_verified");

  return {
    ...payload,
    gateIndex: a1.gateIndex,
    slotIndex: a1.slotIndex,
    faceMatch: faceResult.faceMatch,
    similarity: faceResult.similarity,
    accounts: {
      organizer: org.user.Email,
      attendee1: att1.user.Email,
      attendee2: att2.user.Email,
    },
  };
}

async function main() {
  const assignOnly = process.argv.includes("--assign-only");
  const jsonOnly = process.argv.includes("--json");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI required in backend/.env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const data = await runSeed({ stopAfterAssign: assignOnly });
    if (jsonOnly || assignOnly) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log("=== Entry gating seed OK ===");
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { runSeed };

if (require.main === module) {
  main();
}
