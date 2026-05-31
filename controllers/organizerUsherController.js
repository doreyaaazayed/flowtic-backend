const EntryGate = require("../models/EntryGate");
const Event = require("../models/Event");
const {
  provisionUsherAccount,
  setUsherGateAssignments,
  listOrganizerUshers,
  deactivateUsherForOrganizer,
  listUsherActivity,
  bulkProvisionUshers,
  parseBulkCsv,
  resendUsherCredentials,
} = require("../services/usherProvisionService");
const { getEventForOrganizerAccess } = require("../services/vendorProvisionService");

/** GET /api/organizer/ushers */
exports.listUshers = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const ushers = await listOrganizerUshers(userId);
    res.set("Cache-Control", "private, max-age=15");
    return res.json({ ushers });
  } catch (err) {
    console.error("organizer listUshers:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/organizer/ushers/activity */
exports.usherActivity = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const eventIdNum = req.query.eventId != null ? Number(req.query.eventId) : null;
    const limit = req.query.limit != null ? Number(req.query.limit) : 50;
    const data = await listUsherActivity(userId, { eventIdNum, limit });
    return res.json(data);
  } catch (err) {
    console.error("organizer usherActivity:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/organizer/ushers/provision */
exports.provisionUsher = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { Name, Email, Phone, Age, sendCredentialsEmail } = req.body || {};
    const result = await provisionUsherAccount({
      Name,
      Email,
      Phone,
      Age,
      organizerUserId: userId,
      sendCredentialsEmail: sendCredentialsEmail !== false,
    });

    return res.status(201).json({
      usher: {
        UsherID: result.usher.UsherID,
        Name: result.usher.Name,
        Email: result.usher.Email,
        userId: String(result.usher.userId),
      },
      credentials: result.credentials,
      createdNewAccount: result.createdNewAccount,
      linkedExisting: result.linkedExisting,
      emailSent: result.emailSent,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer provisionUsher:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/organizer/ushers/bulk */
exports.bulkProvision = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { csv, rows, sendCredentialsEmail } = req.body || {};
    let parsed = Array.isArray(rows) ? rows : [];
    if (csv && typeof csv === "string") {
      parsed = parseBulkCsv(csv);
    }
    if (!parsed.length) {
      return res.status(400).json({ message: "Provide csv text or rows array" });
    }

    const result = await bulkProvisionUshers(userId, parsed, sendCredentialsEmail !== false);
    return res.status(201).json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer bulkProvision:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/organizer/ushers/:usherUserId/send-credentials */
exports.sendCredentials = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const result = await resendUsherCredentials(userId, req.params.usherUserId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer sendCredentials:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /api/organizer/ushers/:usherUserId */
exports.deactivateUsher = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const result = await deactivateUsherForOrganizer(userId, req.params.usherUserId);
    return res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer deactivateUsher:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PUT /api/organizer/ushers/:usherUserId/gates */
exports.assignGates = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const usherUserId = req.params.usherUserId;
    const { EventID } = req.body || {};
    const eventIdNum = Number(EventID);
    const result = await setUsherGateAssignments(userId, req.user.role, usherUserId, eventIdNum, req.body);

    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer assignGates:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/organizer/events/:eventMongoId/entry-gates */
exports.listEventGates = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const event = await Event.findById(req.params.eventMongoId).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    await getEventForOrganizerAccess(userId, req.user.role, event.EventID);

    const gates = await EntryGate.find({ EventID: event.EventID })
      .sort({ gateIndex: 1 })
      .lean();

    return res.json({
      EventID: event.EventID,
      eventMongoId: String(event._id),
      eventName: event.Name,
      entryGatingEnabled: Boolean(event.entryGatingEnabled),
      usherManualFallbackEnabled: Boolean(event.usherManualFallbackEnabled),
      usherPinConfigured: Boolean(String(event.usherGateOverridePin || "").trim()),
      gates: gates.map((g) => ({
        gateIndex: g.gateIndex,
        label: g.label || `Gate ${g.gateIndex}`,
        jamScore: g.jamScore,
      })),
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer listEventGates:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PATCH /api/organizer/events/:eventMongoId/usher-settings */
exports.updateEventUsherSettings = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const event = await Event.findById(req.params.eventMongoId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    await getEventForOrganizerAccess(userId, req.user.role, event.EventID);

    const { usherManualFallbackEnabled, usherGateOverridePin } = req.body || {};
    if (usherManualFallbackEnabled != null) {
      event.usherManualFallbackEnabled = Boolean(usherManualFallbackEnabled);
    }
    if (usherGateOverridePin != null) {
      event.usherGateOverridePin = String(usherGateOverridePin).trim();
    }
    await event.save();

    return res.json({
      ok: true,
      EventID: event.EventID,
      usherManualFallbackEnabled: Boolean(event.usherManualFallbackEnabled),
      usherPinConfigured: Boolean(String(event.usherGateOverridePin || "").trim()),
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("organizer updateEventUsherSettings:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
