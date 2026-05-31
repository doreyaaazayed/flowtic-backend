const Event = require("../models/Event");
const Seat = require("../models/Seat");
const Ticket = require("../models/Ticket");
const TicketCategory = require("../models/TicketCategory");
const { analyzeFloorPlanImage } = require("../services/floorPlanAnalyzer");

function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Vertical center Y for each row inside the padded layout box.
 * If every row has rowFraction (0-1, top→bottom of box), use those; else equal spacing.
 */
function rowCenterYsGrid(layout, rows) {
  const nRows = rows.length;
  if (nRows === 0) return [];
  const padY = 0.1 * layout.h;
  const innerY = layout.y + padY;
  const innerH = Math.max(0.02, layout.h - 2 * padY);
  const allFrac =
    rows.length > 0 &&
    rows.every((r) => r.rowFraction != null && Number.isFinite(Number(r.rowFraction)));
  if (allFrac) {
    return rows.map((r) => innerY + clamp01(Number(r.rowFraction)) * innerH);
  }
  const rowH = innerH / nRows;
  return rows.map((_, ri) => innerY + (ri + 0.5) * rowH);
}

/** Straight rows: seats distributed horizontally within layout width, centered for shorter rows. */
function computeGridPositionsForSection(layout, rows) {
  const nRows = rows.length;
  if (nRows === 0) return [];
  const counts = rows.map((r) => Math.max(0, parseInt(Number(r.seatCount), 10) || 0));
  const maxSeats = Math.max(1, ...counts, 1);
  const padX = 0.06 * layout.w;
  const innerX = layout.x + padX;
  const innerW = Math.max(0.02, layout.w - 2 * padX);
  const rowYs = rowCenterYsGrid(layout, rows);
  const out = [];
  for (let ri = 0; ri < nRows; ri++) {
    const count = counts[ri];
    const rowY = rowYs[ri];
    const blockW = innerW * (maxSeats > 0 ? count / maxSeats : 1);
    const startX = innerX + (innerW - blockW) / 2;
    const slotW = count > 0 ? blockW / count : 0;
    const rowSeats = [];
    for (let si = 0; si < count; si++) {
      rowSeats.push({
        posX: slotW > 0 ? startX + (si + 0.5) * slotW : innerX + innerW / 2,
        posY: rowY,
      });
    }
    out.push(rowSeats);
  }
  return out;
}

/**
 * Curved bowl: each row is an arc facing a focal point (stage / pitch center).
 * @param {{ x: number, y: number }} [focal] normalized 0–1; default bottom-center for classic stadiums
 */
function computeArcPositionsForSection(layout, rows, focal) {
  const nRows = rows.length;
  if (nRows === 0) return [];
  const counts = rows.map((r) => Math.max(0, parseInt(Number(r.seatCount), 10) || 0));
  const scx = layout.x + layout.w / 2;
  const scy = layout.y + layout.h / 2;
  const fx = focal && Number.isFinite(focal.x) ? focal.x : scx;
  const fy = focal && Number.isFinite(focal.y) ? focal.y : layout.y + layout.h * 0.98;
  const towardFocal = Math.atan2(fy - scy, fx - scx);
  const arcSpan = Math.PI * 0.88;
  const angleStart = towardFocal - arcSpan / 2;
  const angleEnd = towardFocal + arcSpan / 2;
  const minR = Math.max(0.02, layout.w * 0.08);
  const maxR = Math.min(layout.w, layout.h) * 0.48;
  const out = [];
  for (let ri = 0; ri < nRows; ri++) {
    const count = counts[ri];
    const depth = nRows > 1 ? ri / (nRows - 1) : 0.5;
    const radius = minR + depth * (maxR - minR);
    const rowSeats = [];
    for (let si = 0; si < count; si++) {
      const t = count > 1 ? si / (count - 1) : 0.5;
      const theta = angleStart + t * (angleEnd - angleStart);
      const x = scx + radius * Math.cos(theta);
      const y = scy + radius * Math.sin(theta);
      rowSeats.push({ posX: clamp01(x), posY: clamp01(y) });
    }
    out.push(rowSeats);
  }
  return out;
}

function stageFocalPoint(stagePosition) {
  const sp = String(stagePosition || "bottom").toLowerCase();
  if (sp === "center") return { x: 0.5, y: 0.5 };
  if (sp === "top") return { x: 0.5, y: 0.02 };
  if (sp === "left") return { x: 0.02, y: 0.5 };
  if (sp === "right") return { x: 0.98, y: 0.5 };
  return { x: 0.5, y: 0.98 };
}

function computePositionsForSection(layout, rows, placement, stagePosition) {
  const mode = placement === "arc" ? "arc" : "grid";
  if (mode === "arc") {
    return computeArcPositionsForSection(layout, rows, stageFocalPoint(stagePosition));
  }
  return computeGridPositionsForSection(layout, rows);
}

function matchTicketCategory(sectionName, categories) {
  if (!categories.length) return null;
  const n = String(sectionName || "").toLowerCase();
  for (const c of categories) {
    const cn = (c.Name || "").toLowerCase();
    if (n && (n.includes(cn) || cn.includes(n))) return c;
  }
  const words = n.split(/\W+/).filter((w) => w.length > 1);
  let best = categories[0];
  let score = 0;
  for (const c of categories) {
    const cn = (c.Name || "").toLowerCase();
    const s = words.filter((w) => cn.includes(w)).length;
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return best;
}

// GET seat map for an event (public for display; includes availability when tickets exist)
exports.getSeatMap = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId)
      .select("EventID isSeated seatMapFloorPlanUrl seatMapStagePosition")
      .lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (!event.isSeated) {
      return res.json({ isSeated: false, sections: [], floorPlanUrl: null });
    }
    const seats = await Seat.find({ EventID: event.EventID }).sort({ SectionName: 1, RowLabel: 1, SeatNumber: 1 }).lean();
    const ticketIdsBySeat = await Ticket.find(
      { EventID: event.EventID, SeatID: { $in: seats.map((s) => s.SeatID) } }
    ).select("SeatID IsAvailable").lean();
    const availableBySeatId = Object.fromEntries(
      ticketIdsBySeat.map((t) => [t.SeatID, t.IsAvailable])
    );
    const categories = await TicketCategory.find({ EventID: event.EventID }).lean();
    const categoryMap = Object.fromEntries(categories.map((c) => [c.TicketCatID, { _id: c._id, Name: c.Name, Price: c.Price }]));

    const sectionsMap = {};
    for (const s of seats) {
      if (!sectionsMap[s.SectionName]) {
        sectionsMap[s.SectionName] = {
          name: s.SectionName,
          ticketCategoryId: categoryMap[s.TicketCatID]?._id?.toString(),
          ticketCategoryName: categoryMap[s.TicketCatID]?.Name,
          price: categoryMap[s.TicketCatID]?.Price,
          rows: {},
        };
      }
      if (!sectionsMap[s.SectionName].rows[s.RowLabel]) {
        sectionsMap[s.SectionName].rows[s.RowLabel] = [];
      }
      sectionsMap[s.SectionName].rows[s.RowLabel].push({
        SeatID: s.SeatID,
        SeatNumber: s.SeatNumber,
        available: availableBySeatId[s.SeatID] !== false,
        ...(s.posX != null && s.posY != null ? { posX: s.posX, posY: s.posY } : {}),
      });
    }
    const sections = Object.values(sectionsMap).map((sec) => ({
      name: sec.name,
      ticketCategoryId: sec.ticketCategoryId,
      ticketCategoryName: sec.ticketCategoryName,
      price: sec.price,
      rows: Object.entries(sec.rows).map(([label, seatsInRow]) => ({
        label,
        seats: seatsInRow.sort((a, b) => a.SeatNumber - b.SeatNumber),
      })),
    }));

    return res.json({
      isSeated: true,
      floorPlanUrl: event.seatMapFloorPlanUrl || null,
      stagePosition: event.seatMapStagePosition || "bottom",
      sections,
    });
  } catch (err) {
    console.error("Get seat map error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST save floor plan image URL (data URL or https) on the event
exports.saveSeatMapFloorPlan = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { imageUrl } = req.body || {};
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!imageUrl || String(imageUrl).trim().length < 20) {
      return res.status(400).json({ message: "imageUrl is required (URL or base64 data URL)" });
    }
    event.seatMapFloorPlanUrl = String(imageUrl).trim();
    await event.save();
    return res.json({ seatMapFloorPlanUrl: event.seatMapFloorPlanUrl });
  } catch (err) {
    console.error("Save floor plan error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST analyze image only (no event yet) — for event creation flow
exports.analyzeFloorPlanPreview = async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    const src = imageUrl && String(imageUrl).trim();
    if (!src || src.length < 20) {
      return res.status(400).json({ message: "imageUrl is required (URL or base64 data URL)" });
    }
    const { sections, stagePosition } = await analyzeFloorPlanImage(src);
    const out = sections.map((sec) => ({
      name: sec.name,
      rows: sec.rows,
      layout: sec.layout,
      placement: sec.placement || "grid",
    }));
    return res.json({ sections: out, stagePosition: stagePosition || "bottom" });
  } catch (err) {
    if (err.code === "NO_GEMINI_KEY") {
      return res.status(503).json({
        message:
          "AI analysis is not configured. Add GEMINI_API_KEY to the server .env file, or define the seat map on the event page after creating the event.",
      });
    }
    console.error("Analyze floor plan preview error:", err);
    return res.status(500).json({ message: err.message || "Analysis failed" });
  }
};

// POST analyze floor plan with AI → suggested sections (ticketCategoryId + rows + layout)
exports.analyzeSeatMapFloorPlan = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { imageUrl } = req.body || {};
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const src = (imageUrl && String(imageUrl).trim()) || event.seatMapFloorPlanUrl;
    if (!src) {
      return res.status(400).json({ message: "Upload a floor plan first or pass imageUrl in the body." });
    }
    const categories = await TicketCategory.find({ EventID: event.EventID }).lean();
    if (!categories.length) {
      return res.status(400).json({ message: "Create at least one ticket category before analyzing." });
    }
    const { sections, stagePosition } = await analyzeFloorPlanImage(src);
    const mapped = sections.map((sec) => {
      const cat = matchTicketCategory(sec.name, categories);
      return {
        name: sec.name,
        ticketCategoryId: cat._id.toString(),
        rows: sec.rows,
        layout: sec.layout,
        placement: sec.placement || "grid",
      };
    });
    return res.json({ sections: mapped, stagePosition: stagePosition || "bottom" });
  } catch (err) {
    if (err.code === "NO_GEMINI_KEY") {
      return res.status(503).json({
        message:
          "AI analysis is not configured. Add GEMINI_API_KEY to the server .env file, or define the seat map manually below.",
      });
    }
    console.error("Analyze floor plan error:", err);
    return res.status(500).json({ message: err.message || "Analysis failed" });
  }
};

// DELETE seat map — removes all Seat + Ticket records for the event so organizer can recreate
exports.deleteSeatMap = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const seats = await Seat.find({ EventID: event.EventID }).select("SeatID").lean();
    const seatIds = seats.map((s) => s.SeatID);
    await Ticket.deleteMany({ EventID: event.EventID, SeatID: { $in: seatIds } });
    await Seat.deleteMany({ EventID: event.EventID });
    return res.json({ deleted: true, seatCount: seatIds.length });
  } catch (err) {
    console.error("Delete seat map error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// POST create seat map (organizer/admin): body { sections: [ { name, ticketCategoryId (Mongo _id), rows: [ { label, seatCount } ] } ] }
exports.createSeatMap = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (!event.isSeated) {
      return res.status(400).json({ message: "Event is not a seated event. Set isSeated to true first." });
    }
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only manage seat maps for your own events" });
    }

    const existingSeats = await Seat.countDocuments({ EventID: event.EventID });
    if (existingSeats > 0) {
      return res.status(400).json({ message: "Seat map already exists for this event. Delete existing seats first to replace." });
    }

    const { sections, stagePosition: stagePositionRaw } = req.body || {};
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ message: "Body must include sections array with at least one section" });
    }

    const VALID_STAGE = new Set(["top", "bottom", "left", "right", "center", "none"]);
    if (stagePositionRaw != null) {
      const sp = String(stagePositionRaw).toLowerCase();
      event.seatMapStagePosition = VALID_STAGE.has(sp) ? sp : "bottom";
    }
    const mapStage = event.seatMapStagePosition || "bottom";
    const useArcPlacement = mapStage === "center";

    const categories = await TicketCategory.find({ EventID: event.EventID }).lean();
    const categoryById = Object.fromEntries(categories.map((c) => [c._id.toString(), c]));

    let nextSeatId = 1;
    const seatsToInsert = [];
    const ticketsToInsert = [];
    const categorySeatCount = {};

    for (const sec of sections) {
      const name = (sec.name && String(sec.name).trim()) || "Section";
      const ticketCategoryId = sec.ticketCategoryId;
      const category = ticketCategoryId ? categoryById[ticketCategoryId] : null;
      if (!category) {
        return res.status(400).json({
          message: `Section "${name}" has invalid or missing ticketCategoryId. Use a ticket category that belongs to this event.`,
        });
      }
      const rows = Array.isArray(sec.rows) ? sec.rows : [];
      const L = sec.layout;
      const hasLayout =
        L &&
        typeof L.x === "number" &&
        typeof L.y === "number" &&
        typeof L.w === "number" &&
        typeof L.h === "number";
      const layout = hasLayout
        ? {
            x: Math.max(0, Math.min(1, L.x)),
            y: Math.max(0, Math.min(1, L.y)),
            w: Math.max(0.02, Math.min(1, L.w)),
            h: Math.max(0.02, Math.min(1, L.h)),
          }
        : null;
      const placement =
        useArcPlacement || sec.placement === "arc" ? "arc" : "grid";
      const rowPosGrid = layout
        ? computePositionsForSection(layout, rows, placement, mapStage)
        : null;
      let rowIdx = 0;
      for (const row of rows) {
        const label = (row.label != null && String(row.label).trim()) || "A";
        const seatCount = Math.max(0, parseInt(Number(row.seatCount), 10) || 0);
        const positions = rowPosGrid && rowPosGrid[rowIdx] ? rowPosGrid[rowIdx] : null;
        for (let num = 1; num <= seatCount; num++) {
          const seatId = nextSeatId++;
          const pos = positions && positions[num - 1];
          seatsToInsert.push({
            EventID: event.EventID,
            SeatID: seatId,
            SectionName: name,
            RowLabel: label,
            SeatNumber: num,
            TicketCatID: category.TicketCatID,
            ...(pos && { posX: pos.posX, posY: pos.posY }),
          });
          ticketsToInsert.push({
            TicketID: 0, // set below with global next TicketID
            EventID: event.EventID,
            TicketCatID: category.TicketCatID,
            SeatID: seatId,
            IsAvailable: true,
          });
          categorySeatCount[category.TicketCatID] = (categorySeatCount[category.TicketCatID] || 0) + 1;
        }
        rowIdx++;
      }
    }

    if (seatsToInsert.length === 0) {
      return res.status(400).json({ message: "No seats defined. Each section must have rows with seatCount >= 1." });
    }

    const lastTicket = await Ticket.findOne().sort({ TicketID: -1 }).lean();
    let nextTicketId = (lastTicket?.TicketID || 0) + 1;
    for (let i = 0; i < ticketsToInsert.length; i++) {
      ticketsToInsert[i].TicketID = nextTicketId + i;
    }

    const insertOpts = { bypassDocumentValidation: true };
    await Seat.insertMany(seatsToInsert, insertOpts);
    await Ticket.insertMany(ticketsToInsert, insertOpts);

    for (const [ticketCatID, count] of Object.entries(categorySeatCount)) {
      await TicketCategory.findOneAndUpdate(
        { EventID: event.EventID, TicketCatID: Number(ticketCatID) },
        { $set: { TotalQuantity: count } }
      );
    }

    await event.save();

    const result = await Seat.find({ EventID: event.EventID }).sort({ SeatID: 1 }).lean();
    return res.status(201).json({
      message: "Seat map created",
      seatCount: result.length,
      stagePosition: event.seatMapStagePosition || "bottom",
      seats: result,
    });
  } catch (err) {
    console.error("Create seat map error:", err);
    const we = err.writeErrors?.[0]?.err;
    const details = we?.errInfo?.details ? JSON.stringify(we.errInfo.details) : we?.message;
    if (details) console.error("Validation detail:", details);
    return res.status(500).json({
      message: "Internal server error",
      ...(process.env.NODE_ENV !== "production" && details && { detail: details }),
    });
  }
};
