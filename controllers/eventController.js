const Event = require("../models/Event");
const TicketCategory = require("../models/TicketCategory");
const loyaltyService = require("../services/loyaltyService");
const eventImage = require("../services/eventImageService");
const eventHosting = require("../services/eventHostingService");
const megaStarService = require("../services/megaStarService");
const eventDepositService = require("../services/eventDepositService");
const eventSetupCatalogue = require("../services/eventSetupCatalogueService");
const eventOrganizerNotifications = require("../services/eventOrganizerNotifications");
const eventCleanup = require("../services/eventCleanupService");
const { PRIVATE_CATEGORY_IDS, isPrivateCategoryId, isPrivateEventCategory } = require("../utils/privateEventCategories");
const EventCategory = require("../models/EventCategory");
const eventInvitationService = require("../services/eventInvitationService");

// CategoryIDs hidden from public event listing (Prom, Weddings, Private)

function sanitizeInvitationDetails(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  for (const key of ["brideName", "groomName", "honoreeName", "hostNames", "customMessage"]) {
    const v = String(raw[key] || "").trim();
    if (v) out[key] = v.slice(0, 240);
  }
  return Object.keys(out).length ? out : undefined;
}

// Create new event (organizer only)
exports.createEvent = async (req, res) => {
  try {
    const organizerId = req.user?.id;

    if (!organizerId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const {
      VenueID,
      CategoryID,
      Name,
      Description,
      StartDate,
      EndDate,
      Status,
      capacity,
      isSeated,
      imageUrl,
      ticketSalesOpensAt,
      selectedEquipment,
      equipmentSelection,
      hostingMode,
      externalVenue,
      megaStar,
      invitationDetails,
    } = req.body || {};

    const missing = [];
    if (CategoryID == null || CategoryID === "" || Number.isNaN(Number(CategoryID))) {
      missing.push("CategoryID");
    }
    if (!Name || !String(Name).trim()) missing.push("Name");
    if (!StartDate) missing.push("StartDate");
    if (!EndDate) missing.push("EndDate");

    if (missing.length > 0) {
      return res.status(400).json({
        message: `Missing required fields: ${missing.join(", ")}`,
        missingFields: missing,
      });
    }

    const hosting = eventHosting.validateHostingPayload({
      hostingMode,
      VenueID,
      externalVenue,
      selectedEquipment,
    });
    if (!hosting.ok) {
      return res.status(400).json({ message: hosting.message });
    }

    const megaStarResult = megaStarService.sanitizeMegaStar(megaStar);
    if (!megaStarResult.ok) {
      return res.status(400).json({ message: megaStarResult.message });
    }

    const catalogSelection = eventSetupCatalogue.sanitizeSelection(equipmentSelection);
    const setupPricing = eventDepositService.computeSetupDeposit({
      equipmentSelection: catalogSelection,
      megaStar: megaStarResult.value,
    });

    // Organizer-created events start as Pending; admin can set Status or default Active
    const isAdmin = req.user?.role === "admin";
    const eventStatus = isAdmin
      ? (Status || "Active")
      : "Pending";

    // Simple auto-increment for EventID
    const lastEvent = await Event.findOne().sort({ EventID: -1 }).lean();
    const nextEventID = (lastEvent?.EventID || 0) + 1;
    await eventCleanup.purgeOrphanedDataForEventId(nextEventID);

    let storedImageUrl;
    if (imageUrl) {
      storedImageUrl = await eventImage.persistEventImage(nextEventID, String(imageUrl).trim());
    }

    const event = await Event.create({
      EventID: nextEventID,
      hostingMode: hosting.mode,
      ...(hosting.VenueID != null && { VenueID: hosting.VenueID }),
      ...(hosting.externalVenue && { externalVenue: hosting.externalVenue }),
      CategoryID: Number(CategoryID),
      Name,
      Description,
      StartDate,
      EndDate,
      Status: eventStatus,
      ...(capacity != null && { capacity: Number(capacity) }),
      ...(typeof isSeated === "boolean" && { isSeated }),
      ...(storedImageUrl && { imageUrl: storedImageUrl }),
      ...(ticketSalesOpensAt && {
        ticketSalesOpensAt: new Date(ticketSalesOpensAt),
      }),
      ...(hosting.equipmentLabels.length > 0 && {
        selectedEquipment: hosting.equipmentLabels,
      }),
      ...(catalogSelection.length > 0 && { equipmentSelection: catalogSelection }),
      ...(megaStarResult.value && { megaStar: megaStarResult.value }),
      setupDeposit: eventDepositService.buildStoredDeposit(
        setupPricing,
        eventDepositService.depositRequired(setupPricing.totalEgp)
          ? "awaiting_payment"
          : "not_required",
      ),
      ...(sanitizeInvitationDetails(invitationDetails) && {
        invitationDetails: sanitizeInvitationDetails(invitationDetails),
      }),
      organizer: organizerId,
    });

    if (eventStatus === "Pending") {
      event.setupDeposit.paymentStatus = "not_required";
      await event.save();
    } else if (
      eventStatus === "Active" &&
      eventDepositService.depositRequired(setupPricing.totalEgp)
    ) {
      event.Status = "AwaitingDeposit";
      event.setupDeposit.paymentStatus = "awaiting_payment";
      await event.save();
      eventOrganizerNotifications
        .notifyEventApprovedAwaitingDeposit(event)
        .catch((err) => console.warn("Admin create deposit notify:", err?.message || err));
    }

    if (eventStatus === "Active" && event.Status === "Active") {
      loyaltyService
        .earnPoints(
          organizerId,
          loyaltyService.ORGANIZER_EVENT_CREATED_POINTS,
          "event_created",
          {
            referenceType: "event",
            referenceId: event.EventID,
            description: `Created event: ${event.Name}`,
          },
        )
        .catch((err) => console.warn("Organizer loyalty points:", err.message));
    }

    return res.status(201).json(event);
  } catch (err) {
    console.error("Create event error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Listing projection — keep payloads small and avoid shipping floor plan / long description.
// `Description` is excluded; full details come from GET /events/:id.
const LIST_PROJECTION = {
  EventID: 1,
  Name: 1,
  StartDate: 1,
  EndDate: 1,
  VenueID: 1,
  CategoryID: 1,
  Status: 1,
  capacity: 1,
  isSeated: 1,
  imageUrl: 1,
  organizer: 1,
  entryGatingEnabled: 1,
  hostingMode: 1,
  externalVenue: 1,
  createdAt: 1,
  updatedAt: 1,
};

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 24;

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// List events (public, with optional filters). By default excludes Pending/Rejected.
// Events in Prom (4), Weddings (5), Private (6) are hidden from public listing.
// Pagination: ?page=1&limit=24&search=foo — when no `page` or `limit` is sent,
// behavior matches the legacy "all matching events" response for back-compat.
exports.listEvents = async (req, res) => {
  try {
    const { CategoryID, VenueID, Status, fromDate, toDate, search } = req.query;
    const paginated = req.query.page != null || req.query.limit != null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, Number(req.query.limit) || (paginated ? DEFAULT_LIST_LIMIT : MAX_LIST_LIMIT)),
    );

    const filter = {};

    if (CategoryID) {
      const catId = Number(CategoryID);
      if (PRIVATE_CATEGORY_IDS.includes(catId)) {
        filter.CategoryID = -1; // no event has -1, so returns empty
      } else {
        filter.CategoryID = catId;
      }
    } else {
      filter.CategoryID = { $nin: PRIVATE_CATEGORY_IDS };
    }
    if (VenueID) filter.VenueID = Number(VenueID);
    if (Status) {
      filter.Status = Status;
    } else {
      const publicStatuses = ["Active", "Cancelled", "Completed"];
      if (process.env.PUBLIC_LIST_PENDING_EVENTS === "true") {
        publicStatuses.push("Pending");
      }
      filter.Status = { $in: publicStatuses };
    }

    if (fromDate || toDate) {
      filter.StartDate = {};
      if (fromDate) filter.StartDate.$gte = new Date(fromDate);
      if (toDate) filter.StartDate.$lte = new Date(toDate);
    }

    if (search) {
      filter.Name = { $regex: escapeRegex(search), $options: "i" };
    }

    const skip = paginated ? (page - 1) * limit : 0;

    // Count + page query in parallel so total events / page boundaries are known cheaply.
    const [total, events] = await Promise.all([
      paginated ? Event.countDocuments(filter) : Promise.resolve(null),
      Event.find(filter, LIST_PROJECTION)
        .collation({ locale: "en", strength: 2 })
        .sort({ StartDate: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    // Compute minPrice via grouping aggregation — single round-trip, scoped to the page.
    const eventIds = events.map((e) => e.EventID);
    const priceAgg = eventIds.length
      ? await TicketCategory.aggregate([
          { $match: { EventID: { $in: eventIds }, Price: { $gt: 0 } } },
          { $group: { _id: "$EventID", minPrice: { $min: "$Price" } } },
        ])
      : [];
    const minPriceMap = Object.fromEntries(priceAgg.map((p) => [p._id, p.minPrice]));

    const enriched = await Promise.all(
      events.map(async (e) => {
        let imageUrl = eventImage.resolveEventImageUrl(e);
        if (!imageUrl && eventImage.isDataUrl(e.imageUrl)) {
          imageUrl = await eventImage.migrateDataUrlToFile(e);
        }
        return eventHosting.redactEventVenue(
          {
            ...e,
            imageUrl,
            minPrice: minPriceMap[e.EventID] ?? 0,
          },
          false,
        );
      }),
    );

    // Short-TTL cache (CDN-friendly). Per-user data isn't returned here so this is safe.
    res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=30");
    if (paginated) {
      res.set("X-Total-Count", String(total ?? enriched.length));
      res.set("X-Page", String(page));
      res.set("X-Limit", String(limit));
      res.set("X-Has-More", String((skip + enriched.length) < (total ?? enriched.length)));
      res.set("Access-Control-Expose-Headers", "X-Total-Count, X-Page, X-Limit, X-Has-More");
    }

    return res.json(enriched);
  } catch (err) {
    console.error("List events error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// List pending events (admin only) for approval queue
exports.listPendingEvents = async (req, res) => {
  try {
    const events = await Event.find({ Status: "Pending" })
      .collation({ locale: "en", strength: 2 })
      .populate("organizer", "Username Email")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(events);
  } catch (err) {
    console.error("List pending events error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// List my events (organizer): events where I am the organizer, with sold/capacity
exports.listMyEvents = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const events = await Event.find({ organizer: userId }, LIST_PROJECTION)
      .sort({ StartDate: 1 })
      .lean();
    const Ticket = require("../models/Ticket");
    const eventIds = events.map((e) => e.EventID);
    const statsRows =
      eventIds.length > 0
        ? await Ticket.aggregate([
            { $match: { EventID: { $in: eventIds } } },
            {
              $group: {
                _id: "$EventID",
                capacity: { $sum: 1 },
                sold: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$OwnerUserId", null] },
                          { $ne: [{ $type: "$OwnerUserId" }, "missing"] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ])
        : [];
    const statsMap = Object.fromEntries(statsRows.map((r) => [r._id, r]));
    const result = await Promise.all(
      events.map(async (ev) => {
        let imageUrl = eventImage.resolveEventImageUrl(ev);
        if (!imageUrl && eventImage.isDataUrl(ev.imageUrl)) {
          imageUrl = await eventImage.migrateDataUrlToFile(ev);
        }
        return eventHosting.redactEventVenue(
          {
            ...ev,
            imageUrl,
            capacity: statsMap[ev.EventID]?.capacity ?? 0,
            sold: statsMap[ev.EventID]?.sold ?? 0,
          },
          true,
        );
      }),
    );
    res.set("Cache-Control", "private, max-age=15");
    return res.json(result);
  } catch (err) {
    console.error("List my events error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Approve event (admin only): await deposit if setup total > 0, else Active
exports.approveEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.Status !== "Pending") {
      return res.status(400).json({ message: "Event is not pending approval" });
    }

    const totalDue = event.setupDeposit?.totalEgp ?? 0;
    const needsDeposit = eventDepositService.depositRequired(totalDue);

    if (needsDeposit) {
      event.Status = "AwaitingDeposit";
      if (!event.setupDeposit) {
        event.setupDeposit = eventDepositService.buildStoredDeposit(
          eventDepositService.computeSetupDeposit({
            equipmentSelection: event.equipmentSelection || [],
            megaStar: event.megaStar,
          }),
          "awaiting_payment",
        );
      } else {
        event.setupDeposit.paymentStatus = "awaiting_payment";
      }
    } else {
      event.Status = "Active";
      if (event.setupDeposit) {
        event.setupDeposit.paymentStatus = "not_required";
      }
    }

    await event.save();

    if (event.organizer) {
      loyaltyService
        .earnPoints(
          event.organizer,
          loyaltyService.ORGANIZER_EVENT_CREATED_POINTS,
          "event_created",
          {
            referenceType: "event",
            referenceId: event.EventID,
            description: `Event approved: ${event.Name}`,
          },
        )
        .catch((err) => console.warn("Organizer loyalty on approve:", err.message));
    }

    if (needsDeposit) {
      eventOrganizerNotifications
        .notifyEventApprovedAwaitingDeposit(event)
        .catch((err) => console.warn("Approve deposit notify:", err?.message || err));
    } else {
      eventOrganizerNotifications
        .notifyEventApprovedActive(event)
        .catch((err) => console.warn("Approve active notify:", err?.message || err));
    }

    return res.json(event);
  } catch (err) {
    console.error("Approve event error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Reject event (admin only): set Status to Rejected
exports.rejectEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.Status !== "Pending") {
      return res.status(400).json({ message: "Event is not pending approval" });
    }
    event.Status = "Rejected";
    if (event.setupDeposit) {
      event.setupDeposit.paymentStatus = "not_required";
    }
    await event.save();

    eventOrganizerNotifications
      .notifyEventRejected(event)
      .catch((err) => console.warn("Reject notify:", err?.message || err));

    return res.json(event);
  } catch (err) {
    console.error("Reject event error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get single event by id
exports.getEventById = async (req, res) => {
  try {
    const { id } = req.params; // this will be the Mongo _id
    const event = await Event.findById(id).lean();

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const categoryDoc = await EventCategory.findOne({ CategoryID: event.CategoryID })
      .select("Name")
      .lean();
    const isPrivateEvent = isPrivateEventCategory(event.CategoryID, categoryDoc?.Name);

    if (isPrivateEvent) {
      const allowed = await eventInvitationService.canAccessPrivateEvent(event, {
        userId: req.user?.id,
        userRole: req.user?.role,
        userEmail: req.user?.email,
        inviteToken: req.query.invite,
      });
      if (!allowed) {
        return res.status(404).json({ message: "Event not found" });
      }
      if (req.query.invite) {
        eventInvitationService.markInvitationOpened(req.query.invite).catch(() => {});
      }
    }

    let imageUrl = eventImage.resolveEventImageUrl(event);
    if (!imageUrl && eventImage.isDataUrl(event.imageUrl)) {
      imageUrl = await eventImage.migrateDataUrlToFile(event);
    }

    const userId = req.user?.id;
    const revealPrivate = await eventHosting.userCanRevealPrivateVenue(
      event,
      userId,
    );
    const isOrganizerOrAdmin =
      req.user?.role === "admin" ||
      (userId && String(event.organizer) === String(userId));
    const revealVenueForInvite =
      isPrivateEvent &&
      (isOrganizerOrAdmin || Boolean(req.query.invite));
    const payload = eventHosting.redactEventVenue(
      { ...event, imageUrl: imageUrl || event.imageUrl },
      revealPrivate || revealVenueForInvite,
    );
    return res.json({
      ...payload,
      venueDetailsRevealed: revealPrivate,
    });
  } catch (err) {
    console.error("Get event error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function recalcSetupDepositOnEvent(event, { equipmentSelection, megaStarValue }) {
  const catalogSelection = eventSetupCatalogue.sanitizeSelection(
    equipmentSelection !== undefined ? equipmentSelection : event.equipmentSelection,
  );
  const mega =
    megaStarValue !== undefined
      ? megaStarValue
      : event.megaStar?.starId
        ? event.megaStar
        : undefined;
  const pricing = eventDepositService.computeSetupDeposit({
    equipmentSelection: catalogSelection,
    megaStar: mega,
  });
  const stored = eventDepositService.buildStoredDeposit(pricing, event.setupDeposit?.paymentStatus || "not_required");
  const prevPaid = event.setupDeposit?.paymentStatus === "paid";
  if (prevPaid) {
    stored.paymentStatus = "paid";
    stored.paidAt = event.setupDeposit.paidAt;
    stored.paymentCardId = event.setupDeposit.paymentCardId;
  } else if (event.Status === "AwaitingDeposit" && eventDepositService.depositRequired(pricing.totalEgp)) {
    stored.paymentStatus = "awaiting_payment";
  } else if (!eventDepositService.depositRequired(pricing.totalEgp)) {
    stored.paymentStatus = "not_required";
  }
  event.setupDeposit = stored;
  event.equipmentSelection = catalogSelection;
}

// Update event (organizer or admin; organizer can only update own events)
exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ message: "Event not found" });
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only update your own events" });
    }

    const body = req.body || {};
    const hostingFieldsTouched =
      body.hostingMode !== undefined ||
      body.VenueID !== undefined ||
      body.externalVenue !== undefined ||
      body.selectedEquipment !== undefined;

    if (hostingFieldsTouched || body.selectedEquipment !== undefined) {
      const hosting = eventHosting.validateHostingPayload({
        hostingMode: body.hostingMode !== undefined ? body.hostingMode : event.hostingMode,
        VenueID: body.VenueID !== undefined ? body.VenueID : event.VenueID,
        externalVenue:
          body.externalVenue !== undefined ? body.externalVenue : event.externalVenue,
        selectedEquipment:
          body.selectedEquipment !== undefined
            ? body.selectedEquipment
            : event.selectedEquipment,
      });
      if (!hosting.ok) {
        return res.status(400).json({ message: hosting.message });
      }
      event.hostingMode = hosting.mode;
      if (hosting.VenueID != null) {
        event.VenueID = hosting.VenueID;
      } else {
        event.VenueID = undefined;
      }
      if (hosting.externalVenue) {
        event.externalVenue = hosting.externalVenue;
      } else if (eventHosting.usesExternalVenueMode(hosting.mode)) {
        return res.status(400).json({ message: "External venue name and city/area are required" });
      } else {
        event.externalVenue = undefined;
      }
      if (hosting.equipmentLabels.length > 0) {
        event.selectedEquipment = hosting.equipmentLabels;
      } else {
        event.selectedEquipment = undefined;
      }
    }

    let megaStarValue = undefined;
    if (body.megaStar !== undefined) {
      if (body.megaStar === null || body.megaStar === false) {
        event.megaStar = undefined;
        megaStarValue = undefined;
      } else {
        const megaStarResult = megaStarService.sanitizeMegaStar(body.megaStar);
        if (!megaStarResult.ok) {
          return res.status(400).json({ message: megaStarResult.message });
        }
        if (megaStarResult.value) {
          event.megaStar = megaStarResult.value;
          megaStarValue = megaStarResult.value;
        } else {
          event.megaStar = undefined;
        }
      }
    }

    if (body.equipmentSelection !== undefined || body.megaStar !== undefined) {
      recalcSetupDepositOnEvent(event, {
        equipmentSelection: body.equipmentSelection,
        megaStarValue: body.megaStar !== undefined ? megaStarValue : undefined,
      });
    }

    const {
      CategoryID,
      Name,
      Description,
      StartDate,
      EndDate,
      Status,
      capacity,
      isSeated,
      imageUrl,
      seatMapFloorPlanUrl,
      seatMapStagePosition,
      entryGatingEnabled,
      ticketSalesOpensAt,
      invitationDetails,
    } = body;

    if (CategoryID !== undefined) event.CategoryID = Number(CategoryID);
    if (Name !== undefined) event.Name = String(Name).trim();
    if (Description !== undefined) event.Description = Description;
    if (StartDate !== undefined) event.StartDate = StartDate;
    if (EndDate !== undefined) event.EndDate = EndDate;

    if (Status !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ message: "Only admins can change event status" });
      }
      event.Status = String(Status).trim();
    }

    if (capacity !== undefined) {
      event.capacity = capacity === "" || capacity == null ? undefined : Number(capacity);
    }
    if (typeof isSeated === "boolean") {
      if (event.isSeated && !isSeated) {
        const Seat = require("../models/Seat");
        const seatCount = await Seat.countDocuments({ EventID: event.EventID });
        if (seatCount > 0) {
          return res.status(400).json({
            message: "Cannot set isSeated to false: seat map already exists. Delete seats first.",
          });
        }
      }
      event.isSeated = isSeated;
    }
    if (imageUrl !== undefined) {
      if (imageUrl === "") {
        event.imageUrl = undefined;
      } else {
        const stored = await eventImage.persistEventImage(event.EventID, String(imageUrl).trim());
        event.imageUrl = stored || String(imageUrl).trim();
      }
    }
    if (seatMapFloorPlanUrl !== undefined) {
      event.seatMapFloorPlanUrl =
        seatMapFloorPlanUrl === "" ? undefined : String(seatMapFloorPlanUrl).trim();
    }
    if (seatMapStagePosition !== undefined) {
      const VALID_STAGE = new Set(["top", "bottom", "left", "right", "center", "none"]);
      const sp = String(seatMapStagePosition).toLowerCase();
      event.seatMapStagePosition = VALID_STAGE.has(sp) ? sp : "bottom";
    }
    if (typeof entryGatingEnabled === "boolean") {
      event.entryGatingEnabled = entryGatingEnabled;
    }
    if (ticketSalesOpensAt !== undefined) {
      event.ticketSalesOpensAt =
        ticketSalesOpensAt === "" || ticketSalesOpensAt == null
          ? undefined
          : new Date(ticketSalesOpensAt);
    }
    if (invitationDetails !== undefined) {
      event.invitationDetails = sanitizeInvitationDetails(invitationDetails);
    }

    if (
      isAdmin &&
      event.Status === "AwaitingDeposit" &&
      event.setupDeposit &&
      !eventDepositService.depositRequired(event.setupDeposit.totalEgp)
    ) {
      event.Status = "Active";
      event.setupDeposit.paymentStatus = "not_required";
    }

    await event.save();

    let imageUrlOut = eventImage.resolveEventImageUrl(event);
    const lean = event.toObject();
    return res.json({ ...lean, imageUrl: imageUrlOut || lean.imageUrl });
  } catch (err) {
    console.error("Update event error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete event (organizer or admin; organizer can only delete own events)
exports.deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (req.user.role !== "admin" && String(event.organizer) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only delete your own events" });
    }
    await eventCleanup.purgeEventDocumentData(event);
    await Event.findByIdAndDelete(id);
    return res.status(204).send();
  } catch (err) {
    console.error("Delete event error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

