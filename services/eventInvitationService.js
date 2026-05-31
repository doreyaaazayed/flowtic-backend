const crypto = require("crypto");
const Event = require("../models/Event");
const EventCategory = require("../models/EventCategory");
const EventInvitation = require("../models/EventInvitation");
const Venue = require("../models/Venue");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const emailService = require("./emailService");
const {
  isPrivateCategoryId,
  isPrivateEventCategory,
  privateEventKind,
  defaultInviteMessage,
} = require("../utils/privateEventCategories");

function generateToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function getCategoryName(categoryId) {
  const cat = await EventCategory.findOne({ CategoryID: Number(categoryId) })
    .select("Name")
    .lean();
  return cat?.Name || "";
}

async function eventIsPrivate(event) {
  const categoryName = await getCategoryName(event.CategoryID);
  return isPrivateEventCategory(event.CategoryID, categoryName);
}

async function resolveEventLocation(event) {
  if (event.externalVenue?.name) {
    return [event.externalVenue.name, event.externalVenue.address, event.externalVenue.location]
      .filter(Boolean)
      .join(", ");
  }
  if (event.VenueID != null) {
    const venue = await Venue.findOne({ VenueID: event.VenueID }).select("Name Location").lean();
    if (venue) return `${venue.Name}, ${venue.Location}`;
  }
  return event.Name || "Location to be announced";
}

function displayHostNames(event, kind) {
  const d = event.invitationDetails || {};
  if (kind === "wedding") {
    const bride = String(d.brideName || "").trim();
    const groom = String(d.groomName || "").trim();
    if (bride && groom) return `${bride} & ${groom}`;
    if (bride || groom) return bride || groom;
  }
  if (kind === "prom") {
    const honoree = String(d.honoreeName || d.hostNames || "").trim();
    if (honoree) return honoree;
  }
  const hosts = String(d.hostNames || "").trim();
  if (hosts) return hosts;
  return event.Name || "Your hosts";
}

function inviteMessage(event, kind) {
  const custom = String(event.invitationDetails?.customMessage || "").trim();
  if (custom) return custom;
  return defaultInviteMessage(kind);
}

function formatEventDate(startDate) {
  try {
    return new Date(startDate).toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return String(startDate);
  }
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
}

function buildInviteUrl(eventMongoId, token) {
  return `${frontendBaseUrl()}/event/${eventMongoId}?invite=${encodeURIComponent(token)}`;
}

async function userHasBookingForEvent(userId, eventEventId) {
  if (!userId) return false;
  const ticket = await Ticket.findOne({
    EventID: eventEventId,
    OwnerUserId: userId,
    IsAvailable: false,
  })
    .select("_id")
    .lean();
  return Boolean(ticket);
}

async function userEmailInvitedToEvent(email, eventId) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const row = await EventInvitation.findOne({
    eventId,
    guestEmail: normalized,
    status: { $in: ["sent", "pending"] },
  })
    .select("_id")
    .lean();
  return Boolean(row);
}

async function findInvitationByToken(token) {
  if (!token) return null;
  return EventInvitation.findOne({ token: String(token).trim() }).lean();
}

/**
 * Who may view a private-category event?
 */
async function canAccessPrivateEvent(event, { userId, userRole, userEmail, inviteToken }) {
  const categoryName = await getCategoryName(event.CategoryID);
  if (!isPrivateEventCategory(event.CategoryID, categoryName)) return true;

  if (userRole === "admin") return true;
  if (userId && String(event.organizer) === String(userId)) return true;

  if (inviteToken) {
    const inv = await findInvitationByToken(inviteToken);
    if (inv && String(inv.eventId) === String(event._id)) return true;
  }

  if (userEmail && (await userEmailInvitedToEvent(userEmail, event._id))) return true;

  if (userId) {
    const user = await User.findById(userId).select("Email").lean();
    if (user?.Email && (await userEmailInvitedToEvent(user.Email, event._id))) return true;
    if (await userHasBookingForEvent(userId, event.EventID)) return true;
  }

  return false;
}

async function assertPrivateEventAccess(event, ctx) {
  const categoryName = await getCategoryName(event.CategoryID);
  if (!isPrivateEventCategory(event.CategoryID, categoryName)) return;
  const ok = await canAccessPrivateEvent(event, ctx);
  if (!ok) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    throw err;
  }
}

async function markInvitationOpened(token) {
  if (!token) return;
  await EventInvitation.updateOne(
    { token: String(token).trim(), openedAt: { $exists: false } },
    { $set: { openedAt: new Date() } },
  );
}

async function listInvitationsForEvent(organizerId, eventMongoId) {
  const event = await Event.findById(eventMongoId).lean();
  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(event.organizer) !== String(organizerId)) {
    const err = new Error("You can only manage invitations for your own events");
    err.statusCode = 403;
    throw err;
  }
  if (!(await eventIsPrivate(event))) {
    const err = new Error("Invitations are only available for wedding, prom, and private events");
    err.statusCode = 400;
    throw err;
  }

  const rows = await EventInvitation.find({ eventId: event._id })
    .sort({ createdAt: -1 })
    .lean();

  return {
    emailConfigured: emailService.isEmailConfigured(),
    invitations: rows.map((r) => ({
    _id: String(r._id),
    guestName: r.guestName,
    guestEmail: r.guestEmail,
    guestPhone: r.guestPhone || "",
    status: r.status,
    sentAt: r.sentAt,
    emailError: r.emailError,
    openedAt: r.openedAt,
    createdAt: r.createdAt,
    inviteUrl: buildInviteUrl(String(event._id), r.token),
  })),
  };
}

async function createAndSendInvitation({
  organizerId,
  eventMongoId,
  guestName,
  guestEmail,
  guestPhone,
  sendEmail = true,
}) {
  const event = await Event.findById(eventMongoId);
  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(event.organizer) !== String(organizerId)) {
    const err = new Error("You can only send invitations for your own events");
    err.statusCode = 403;
    throw err;
  }
  if (!(await eventIsPrivate(event))) {
    const err = new Error("Invitations are only available for wedding, prom, and private events");
    err.statusCode = 400;
    throw err;
  }

  const name = String(guestName || "").trim();
  const email = normalizeEmail(guestEmail);
  if (!name) {
    const err = new Error("Guest name is required");
    err.statusCode = 400;
    throw err;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error("A valid guest email is required");
    err.statusCode = 400;
    throw err;
  }

  const phone = guestPhone ? String(guestPhone).replace(/\D/g, "").slice(0, 11) : "";

  const existing = await EventInvitation.findOne({ eventId: event._id, guestEmail: email }).lean();
  if (existing) {
    const err = new Error("An invitation has already been sent to this email for this event");
    err.statusCode = 409;
    throw err;
  }

  const token = generateToken();
  const invitation = await EventInvitation.create({
    eventId: event._id,
    eventEventId: event.EventID,
    organizerId,
    guestName: name,
    guestEmail: email,
    guestPhone: phone || undefined,
    token,
    status: "pending",
  });

  let emailSent = false;
  let emailError = null;

  if (sendEmail) {
    if (!emailService.isEmailConfigured()) {
      emailError = "Email is not configured on the server (BREVO_API_KEY missing)";
      invitation.status = "failed";
      invitation.emailError = emailError;
      await invitation.save();
      console.warn("[Invitation] Email skipped — BREVO_API_KEY not set");
    } else {
    const categoryName = await getCategoryName(event.CategoryID);
    const kind = privateEventKind(event.CategoryID, categoryName);
    const location = await resolveEventLocation(event.toObject ? event.toObject() : event);
    const hosts = displayHostNames(event, kind);
    const message = inviteMessage(event, kind);
    const inviteUrl = buildInviteUrl(String(event._id), token);

    const result = await emailService.sendEventInvitation(email, {
      guestName: name,
      hostNames: hosts,
      inviteMessage: message,
      eventName: event.Name,
      eventDate: formatEventDate(event.StartDate),
      location,
      inviteUrl,
      kind,
    });

    emailSent = result.success;
    emailError = result.error || null;
    invitation.status = result.success ? "sent" : "failed";
    invitation.sentAt = result.success ? new Date() : undefined;
    invitation.emailError = emailError || undefined;
    await invitation.save();
    if (result.success) {
      console.log(`[Invitation] Email sent to ${email} for event ${event.Name}`);
    } else {
      console.error(`[Invitation] Email failed for ${email}:`, emailError);
    }
    }
  }

  return {
    invitation: {
      _id: String(invitation._id),
      guestName: invitation.guestName,
      guestEmail: invitation.guestEmail,
      guestPhone: invitation.guestPhone || "",
      status: invitation.status,
      sentAt: invitation.sentAt,
      emailError: invitation.emailError,
      inviteUrl: buildInviteUrl(String(event._id), token),
    },
    emailSent,
    emailError,
  };
}

async function resendInvitation(organizerId, invitationId) {
  const invitation = await EventInvitation.findById(invitationId);
  if (!invitation) {
    const err = new Error("Invitation not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(invitation.organizerId) !== String(organizerId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  const event = await Event.findById(invitation.eventId);
  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    throw err;
  }

  const categoryName = await getCategoryName(event.CategoryID);
  const kind = privateEventKind(event.CategoryID, categoryName);
  const location = await resolveEventLocation(event.toObject ? event.toObject() : event);
  const hosts = displayHostNames(event, kind);
  const message = inviteMessage(event, kind);
  const inviteUrl = buildInviteUrl(String(event._id), invitation.token);

  const result = await emailService.sendEventInvitation(invitation.guestEmail, {
    guestName: invitation.guestName,
    hostNames: hosts,
    inviteMessage: message,
    eventName: event.Name,
    eventDate: formatEventDate(event.StartDate),
    location,
    inviteUrl,
    kind,
  });

  invitation.status = result.success ? "sent" : "failed";
  invitation.sentAt = result.success ? new Date() : invitation.sentAt;
  invitation.emailError = result.error || undefined;
  await invitation.save();

  return { emailSent: result.success, emailError: result.error };
}

async function deleteInvitation(organizerId, invitationId) {
  const invitation = await EventInvitation.findById(invitationId);
  if (!invitation) {
    const err = new Error("Invitation not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(invitation.organizerId) !== String(organizerId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }
  await invitation.deleteOne();
}

async function validateInviteToken(token) {
  const inv = await findInvitationByToken(token);
  if (!inv) {
    const err = new Error("Invalid or expired invitation");
    err.statusCode = 404;
    throw err;
  }
  const event = await Event.findById(inv.eventId).lean();
  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    throw err;
  }
  await markInvitationOpened(token);
  return {
    eventId: String(event._id),
    guestName: inv.guestName,
    guestEmail: inv.guestEmail,
  };
}

module.exports = {
  canAccessPrivateEvent,
  assertPrivateEventAccess,
  markInvitationOpened,
  listInvitationsForEvent,
  createAndSendInvitation,
  resendInvitation,
  deleteInvitation,
  validateInviteToken,
  buildInviteUrl,
  displayHostNames,
  inviteMessage,
  resolveEventLocation,
};
