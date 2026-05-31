/** Event hosting modes — what FlowTic supplies vs organizer brings */
const HOSTING_MODES = [
  "ticketing_only",
  "equipment_only",
  "venue_only",
  "full_setup",
];

function normalizeHostingMode(raw) {
  const m = String(raw || "").trim();
  return HOSTING_MODES.includes(m) ? m : "full_setup";
}

function usesExternalVenueMode(mode) {
  const m = normalizeHostingMode(mode);
  return m === "ticketing_only" || m === "equipment_only";
}

function sanitizeExternalVenue(body) {
  if (!body || typeof body !== "object") return null;
  const name = String(body.name || "").trim();
  const location = String(body.location || "").trim();
  const address = String(body.address || "").trim();
  const capRaw = body.capacity;
  const capacity =
    capRaw != null && capRaw !== "" ? Number(capRaw) : undefined;
  if (!name || !location) return null;
  const out = {
    name: name.slice(0, 200),
    location: location.slice(0, 120),
  };
  if (address) {
    out.address = address.slice(0, 300);
  }
  if (
    capacity != null &&
    !Number.isNaN(capacity) &&
    capacity >= 0
  ) {
    out.capacity = Math.floor(capacity);
  }
  return out;
}

function sanitizeEquipmentLabels(selectedEquipment) {
  if (!Array.isArray(selectedEquipment)) return [];
  return selectedEquipment
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0 && x.length <= 120)
    .slice(0, 40);
}

function equipmentRequiredForMode(mode) {
  const m = normalizeHostingMode(mode);
  return m === "equipment_only" || m === "full_setup";
}

/**
 * Strip private venue fields for public API responses.
 * Public: city/area only. Private (after purchase): name + address + capacity.
 */
function redactEventVenue(event, revealPrivate) {
  if (!event || typeof event !== "object") return event;
  const mode = normalizeHostingMode(event.hostingMode);
  if (!usesExternalVenueMode(mode) || !event.externalVenue) {
    return event;
  }
  if (revealPrivate) {
    return event;
  }
  const loc = event.externalVenue.location;
  return {
    ...event,
    externalVenue: loc ? { location: loc } : undefined,
  };
}

/**
 * @param {object} event — lean event with EventID, organizer, hostingMode
 * @param {string} [userId]
 */
async function userCanRevealPrivateVenue(event, userId) {
  if (!event) return false;
  const mode = normalizeHostingMode(event.hostingMode);
  if (!usesExternalVenueMode(mode)) return true;

  if (!userId) return false;

  const User = require("../models/User");
  const user = await User.findById(userId).select("role").lean();
  if (user?.role === "admin") return true;

  if (event.organizer && String(event.organizer) === String(userId)) {
    return true;
  }

  const Ticket = require("../models/Ticket");
  const owned = await Ticket.countDocuments({
    EventID: event.EventID,
    OwnerUserId: userId,
    IsAvailable: false,
  });
  return owned > 0;
}

/**
 * Validate create/update payload for hosting mode rules.
 * @returns {{ ok: true, mode, VenueID?, externalVenue?, equipmentLabels } | { ok: false, message: string }}
 */
function validateHostingPayload({
  hostingMode,
  VenueID,
  externalVenue,
  selectedEquipment,
}) {
  const mode = normalizeHostingMode(hostingMode);
  const ext = sanitizeExternalVenue(externalVenue);
  const equipmentLabels = sanitizeEquipmentLabels(selectedEquipment);
  const venueNum =
    VenueID != null && VenueID !== "" ? Number(VenueID) : null;

  if (equipmentRequiredForMode(mode) && equipmentLabels.length === 0) {
    return {
      ok: false,
      message: "Select at least one item from the setup catalogue",
    };
  }

  switch (mode) {
    case "ticketing_only":
      if (venueNum != null && !Number.isNaN(venueNum)) {
        return {
          ok: false,
          message:
            "Platform venue is not used when you only sell tickets on FlowTic",
        };
      }
      if (!ext) {
        return {
          ok: false,
          message: "External venue name and location are required",
        };
      }
      if (equipmentLabels.length > 0) {
        return {
          ok: false,
          message: "Equipment cannot be selected for ticketing-only events",
        };
      }
      return {
        ok: true,
        mode,
        externalVenue: ext,
        equipmentLabels: [],
      };

    case "equipment_only":
      if (venueNum != null && !Number.isNaN(venueNum)) {
        return {
          ok: false,
          message: "Use your own venue details instead of a platform venue",
        };
      }
      if (!ext) {
        return {
          ok: false,
          message: "External venue name and location are required",
        };
      }
      return {
        ok: true,
        mode,
        externalVenue: ext,
        equipmentLabels,
      };

    case "venue_only":
      if (!venueNum || Number.isNaN(venueNum)) {
        return { ok: false, message: "Select a FlowTic venue" };
      }
      if (ext) {
        return {
          ok: false,
          message: "External venue is not used when booking a FlowTic venue",
        };
      }
      if (equipmentLabels.length > 0) {
        return {
          ok: false,
          message: "Equipment catalogue is not available for venue-only events",
        };
      }
      return {
        ok: true,
        mode,
        VenueID: venueNum,
        equipmentLabels: [],
      };

    case "full_setup":
      if (!venueNum || Number.isNaN(venueNum)) {
        return { ok: false, message: "Select a FlowTic venue" };
      }
      if (ext) {
        return {
          ok: false,
          message:
            "External venue is not used when booking venue through FlowTic",
        };
      }
      return {
        ok: true,
        mode,
        VenueID: venueNum,
        equipmentLabels,
      };

    default:
      return { ok: false, message: "Invalid hosting mode" };
  }
}

module.exports = {
  HOSTING_MODES,
  normalizeHostingMode,
  usesExternalVenueMode,
  sanitizeExternalVenue,
  sanitizeEquipmentLabels,
  equipmentRequiredForMode,
  redactEventVenue,
  userCanRevealPrivateVenue,
  validateHostingPayload,
};
