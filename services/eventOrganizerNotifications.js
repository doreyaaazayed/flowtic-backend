const User = require("../models/User");
const UserNotification = require("../models/UserNotification");
const emailService = require("./emailService");

function appBaseUrl() {
  const base = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";
  return String(base).replace(/\/$/, "");
}

async function createOrganizerNotification(organizerId, { type, title, body, meta }) {
  if (!organizerId) return;
  await UserNotification.create({
    userId: organizerId,
    type,
    title,
    body,
    meta: meta || {},
  });
}

async function notifyOrganizerEmail(organizerId, subject, html) {
  try {
    const user = await User.findById(organizerId).select("Email").lean();
    if (!user?.Email) return;
    await emailService.send({
      to: user.Email,
      subject,
      htmlContent: html,
    });
  } catch (err) {
    console.warn("[eventOrganizerNotifications] email failed:", err?.message || err);
  }
}

async function notifyEventApprovedAwaitingDeposit(event) {
  const checkoutPath = `/creator/events/${event._id}/deposit`;
  const checkoutUrl = `${appBaseUrl()}${checkoutPath}`;
  const total = event.setupDeposit?.totalEgp ?? 0;

  const title = "Event approved — deposit required";
  const body = `Your event "${event.Name}" was approved. Pay the setup deposit of EGP ${total.toLocaleString("en-EG")} (includes ${event.setupDeposit?.platformFeePercent ?? 10}% platform fee) to publish it.`;

  await createOrganizerNotification(event.organizer, {
    type: "event_deposit_required",
    title,
    body,
    meta: { eventMongoId: String(event._id), checkoutPath },
  });

  await notifyOrganizerEmail(
    event.organizer,
    `FlowTic: Pay setup deposit for ${event.Name}`,
    `<p>Your event <strong>${event.Name}</strong> has been approved.</p>
     <p>Setup deposit due: <strong>EGP ${total.toLocaleString("en-EG")}</strong></p>
     <p><a href="${checkoutUrl}">Complete payment</a></p>`,
  );
}

async function notifyEventApprovedActive(event) {
  const title = "Event approved and live";
  const body = `Your event "${event.Name}" is now active on FlowTic.`;

  await createOrganizerNotification(event.organizer, {
    type: "event_approved",
    title,
    body,
    meta: { eventMongoId: String(event._id) },
  });

  await notifyOrganizerEmail(
    event.organizer,
    `FlowTic: ${event.Name} is live`,
    `<p>Your event <strong>${event.Name}</strong> has been approved and is now active.</p>`,
  );
}

async function notifyEventRejected(event) {
  const title = "Event not approved";
  const body = `Your event "${event.Name}" was not approved. Contact support if you have questions.`;

  await createOrganizerNotification(event.organizer, {
    type: "event_rejected",
    title,
    body,
    meta: { eventMongoId: String(event._id) },
  });

  await notifyOrganizerEmail(
    event.organizer,
    `FlowTic: Update on ${event.Name}`,
    `<p>Your event <strong>${event.Name}</strong> was not approved at this time.</p>`,
  );
}

async function notifyDepositPaid(event) {
  const title = "Deposit received";
  const body = `We received your setup deposit for "${event.Name}". Your event is now live.`;

  await createOrganizerNotification(event.organizer, {
    type: "event_deposit_paid",
    title,
    body,
    meta: { eventMongoId: String(event._id) },
  });
}

module.exports = {
  notifyEventApprovedAwaitingDeposit,
  notifyEventApprovedActive,
  notifyEventRejected,
  notifyDepositPaid,
};
