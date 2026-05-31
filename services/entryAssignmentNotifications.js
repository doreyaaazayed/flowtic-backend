const Event = require("../models/Event");
const User = require("../models/User");
const EntryAssignment = require("../models/EntryAssignment");
const UserNotification = require("../models/UserNotification");
const { send } = require("./emailService");

function formatWindow(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

async function sendEntryAssignmentEmail(to, { firstName, eventName, dashboardUrl, tickets, kind }) {
  const intro =
    kind === "regenerated"
      ? "Your entry gate or time window was updated for the following ticket(s)."
      : "Your gate and time window for entry are assigned.";

  const rows = (tickets || [])
    .map(
      (t) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${t.ticketId}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">Gate ${t.gateIndex}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">Slot ${t.slotIndex}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${formatWindow(t.windowStart)} – ${formatWindow(t.windowEnd)}</td>
    </tr>`
    )
    .join("");

  const htmlContent = `
    <h2>Hi${firstName ? ` ${firstName}` : ""},</h2>
    <p><strong>${eventName}</strong></p>
    <p>${intro}</p>
    <table style="border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Ticket</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Gate</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Slot</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Window</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p><a href="${dashboardUrl}">Open your FlowTic dashboard</a> for full details.</p>
    <p>Arrive during your assigned window at the correct gate.</p>
    <p>— FlowTic</p>
  `;

  const textLines = [
    `Hi${firstName ? ` ${firstName}` : ""},`,
    "",
    `${eventName}`,
    intro,
    "",
    ...(tickets || []).map(
      (t) =>
        `Ticket ${t.ticketId}: Gate ${t.gateIndex}, slot ${t.slotIndex}, ${formatWindow(t.windowStart)} – ${formatWindow(
          t.windowEnd
        )}`
    ),
    "",
    `Dashboard: ${dashboardUrl}`,
  ];

  return send({
    to,
    subject:
      kind === "regenerated"
        ? `FlowTic – entry time updated: ${eventName}`
        : `FlowTic – your gate & entry time: ${eventName}`,
    htmlContent,
    textContent: textLines.join("\n"),
  });
}

/**
 * Create in-app notifications and send email for each affected user after assignment / regenerate.
 */
async function notifyUsersAfterAssignment(eventMongoId, eventNumericId, ticketIds, { kind = "assigned" } = {}) {
  if (!ticketIds?.length) return;
  const uniq = [...new Set(ticketIds.map(Number).filter((n) => n > 0))];
  if (!uniq.length) return;

  const event = await Event.findOne({ EventID: eventNumericId }).select("Name").lean();
  const eventName = event?.Name || "Your event";
  const rows = await EntryAssignment.find({
    EventID: eventNumericId,
    TicketID: { $in: uniq },
    status: { $ne: "void" },
  }).lean();

  const byUser = new Map();
  for (const r of rows) {
    const uid = String(r.userId);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(r);
  }

  const frontend = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  const dashboardUrl = `${frontend}/dashboard`;

  for (const [userId, assigns] of byUser) {
    try {
      const user = await User.findById(userId).select("Email FirstName Username").lean();
      if (!user?.Email) continue;

      const ticketsPayload = assigns.map((a) => ({
        ticketId: a.TicketID,
        gateIndex: a.gateIndex,
        slotIndex: a.slotIndex,
        windowStart: a.windowStart,
        windowEnd: a.windowEnd,
      }));

      const emailResult = await sendEntryAssignmentEmail(user.Email, {
        firstName: user.FirstName || user.Username,
        eventName,
        dashboardUrl,
        tickets: ticketsPayload,
        kind,
      });

      await UserNotification.create({
        userId,
        type: "entry_assignment",
        title: kind === "regenerated" ? "Your entry time was updated" : "Your gate and entry time are ready",
        body: `${eventName}: gate and window ${kind === "regenerated" ? "were updated" : "are set"}. Open your dashboard for details.`,
        read: false,
        meta: {
          eventMongoId,
          eventName,
          kind,
          tickets: ticketsPayload,
          emailSent: Boolean(emailResult?.success),
          emailSkipReason: emailResult?.success ? undefined : emailResult?.error || "email_not_configured",
        },
      });
    } catch (err) {
      console.error("[entryAssignmentNotifications] user notify failed:", userId, err?.message || err);
    }
  }
}

module.exports = { notifyUsersAfterAssignment, sendEntryAssignmentEmail };
