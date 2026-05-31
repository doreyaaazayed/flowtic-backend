/**
 * Seed seats for Cairo Marathon 2026 (EventID 17).
 * Usage: node scripts/seedMarathonSeats.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

try { require("dns").setServers(["1.1.1.1", "8.8.8.8"]); } catch (_) {}

const mongoose = require("mongoose");
const Event = require("../models/Event");
const Seat = require("../models/Seat");
const Ticket = require("../models/Ticket");
const TicketCategory = require("../models/TicketCategory");

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  await mongoose.connect(MONGO_URI, { dbName: "EventManagementDB" });

  const event = await Event.findOne({ EventID: 17 });
  if (!event) { console.error("Event 17 not found"); process.exit(1); }

  // Clean existing seats for this event
  const existing = await Seat.countDocuments({ EventID: 17 });
  if (existing > 0) {
    console.log(`Removing ${existing} existing seats for EventID 17...`);
    const seats = await Seat.find({ EventID: 17 }).select("SeatID").lean();
    const seatIds = seats.map(s => s.SeatID);
    await Ticket.deleteMany({ EventID: 17, SeatID: { $in: seatIds } });
    await Seat.deleteMany({ EventID: 17 });
  }

  // Get ticket categories for this event
  const cats = await TicketCategory.find({ EventID: 17 }).lean();
  const byName = {};
  for (const c of cats) byName[c.Name.toLowerCase()] = c;

  const standard = byName["standard"];
  const vip = byName["vip"];
  const platinum = byName["platinum"];

  if (!standard || !vip || !platinum) {
    console.error("Missing ticket categories:", Object.keys(byName));
    process.exit(1);
  }

  // Layout: 3 sections, grid placement
  // Standard: 5 rows × 8 seats = 40
  // VIP: 3 rows × 6 seats = 18
  // Platinum: 2 rows × 4 seats = 8
  // Total: 66 seats
  const sections = [
    { name: "Standard", cat: standard, rows: 5, seatsPerRow: 8, xStart: 0.05, xEnd: 0.95, yStart: 0.50, yEnd: 0.95 },
    { name: "VIP",      cat: vip,      rows: 3, seatsPerRow: 6, xStart: 0.10, xEnd: 0.90, yStart: 0.25, yEnd: 0.48 },
    { name: "Platinum", cat: platinum, rows: 2, seatsPerRow: 4, xStart: 0.20, xEnd: 0.80, yStart: 0.05, yEnd: 0.22 },
  ];

  const rowLabels = "ABCDEFGHIJ".split("");
  const seatsToInsert = [];
  const ticketsToInsert = [];
  let seatId = 1;

  for (const sec of sections) {
    const rowCount = sec.rows;
    const colCount = sec.seatsPerRow;
    for (let r = 0; r < rowCount; r++) {
      const rowLabel = rowLabels[r];
      const posY = rowCount === 1 ? (sec.yStart + sec.yEnd) / 2
        : sec.yStart + (r / (rowCount - 1)) * (sec.yEnd - sec.yStart);
      for (let c = 0; c < colCount; c++) {
        const posX = colCount === 1 ? (sec.xStart + sec.xEnd) / 2
          : sec.xStart + (c / (colCount - 1)) * (sec.xEnd - sec.xStart);
        seatsToInsert.push({
          EventID: 17,
          SeatID: seatId,
          SectionName: sec.name,
          RowLabel: rowLabel,
          SeatNumber: c + 1,
          TicketCatID: sec.cat.TicketCatID,
          posX: Math.round(posX * 1000) / 1000,
          posY: Math.round(posY * 1000) / 1000,
        });
        ticketsToInsert.push({
          EventID: 17,
          TicketCatID: sec.cat.TicketCatID,
          SeatID: seatId,
          IsAvailable: true,
        });
        seatId++;
      }
    }
  }

  // Find max existing TicketID to avoid conflicts
  const maxTicket = await Ticket.findOne().sort({ TicketID: -1 }).select("TicketID").lean();
  let ticketId = (maxTicket?.TicketID ?? 0) + 1;
  for (const t of ticketsToInsert) t.TicketID = ticketId++;

  await Seat.insertMany(seatsToInsert);
  await Ticket.insertMany(ticketsToInsert);

  // Mark event as seated and update seat count
  await Event.updateOne({ EventID: 17 }, { $set: { isSeated: true, Capacity: seatsToInsert.length } });

  console.log(`✓ Cairo Marathon 2026 — ${seatsToInsert.length} seats created`);
  console.log(`  Standard: ${sections[0].rows * sections[0].seatsPerRow} seats @ EGP${standard.Price}`);
  console.log(`  VIP:      ${sections[1].rows * sections[1].seatsPerRow} seats @ EGP${vip.Price}`);
  console.log(`  Platinum: ${sections[2].rows * sections[2].seatsPerRow} seats @ EGP${platinum.Price}`);

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
