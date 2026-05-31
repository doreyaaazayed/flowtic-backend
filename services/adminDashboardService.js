const EntryAuditLog = require("../models/EntryAuditLog");
const ResaleListing = require("../models/ResaleListing");
const ResaleRequest = require("../models/ResaleRequest");
const User = require("../models/User");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");

const AUDIT_ACTION_LABELS = {
  verify_face: "Face ID Mismatch",
  verify_manual: "Manual verification failed",
  assign: "Entry assignment issue",
  regenerate: "Slot regeneration issue",
  jam: "Crowd jam redirect",
  redirect: "Gate redirect",
};

function formatRelativeTime(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${Math.max(1, sec)} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

async function buildEventMapForAuditRows(auditRows) {
  const numericEventIds = [
    ...new Set(auditRows.map((a) => a.EventID).filter((id) => id != null)),
  ];
  if (numericEventIds.length === 0) return new Map();
  const eventRows = await Event.find({ EventID: { $in: numericEventIds } })
    .select("EventID Name")
    .lean();
  return new Map(
    eventRows.map((e) => [e.EventID, { mongoId: String(e._id), name: e.Name }]),
  );
}

const REASON_LABELS = {
  FACE_MISMATCH: "Face scan did not match the ticket holder's enrolled Face ID template",
  ENTRY_ALREADY_USED: "This ticket was already scanned for entry",
  "Ticket not found": "No ticket record found for the scanned ID",
  "ticketId required": "Gate scan missing ticket ID",
  "National ID does not match ticket holder": "National ID entered at the gate does not match the ticket owner",
  "Attendee has not completed Face ID enrollment": "Ticket holder has not enrolled Face ID in the app",
};

function humanizeReason(reason) {
  if (!reason) return null;
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  return String(reason);
}

function toUserBrief(u) {
  if (!u) return null;
  return {
    id: String(u._id),
    username: u.Username ?? null,
    email: u.Email ?? null,
    display: u.Username || u.Email || String(u._id),
    faceIdEnrolled: Boolean(u.faceIdReference),
  };
}

function mapAuditToAlert(row, eventByNumericId = new Map()) {
  const type = AUDIT_ACTION_LABELS[row.action] || row.reason || row.action || "Security alert";
  const high = row.action === "verify_face" || (row.reason && /face|fraud|denied/i.test(row.reason));
  const ev = row.EventID != null ? eventByNumericId.get(row.EventID) : null;
  const ticketId = row.ticketId ?? null;
  let navigateTo = null;
  if (ticketId != null) navigateTo = "ticket-history";
  else if (ev?.mongoId) navigateTo = "entry-tools";
  const reasonText = humanizeReason(row.reason);
  return {
    id: String(row._id),
    kind: "audit",
    type,
    severity: high ? "High" : "Medium",
    time: formatRelativeTime(row.createdAt),
    occurredAt: row.createdAt,
    status: high ? "Blocked" : "Under Review",
    ticketId,
    eventId: row.EventID ?? null,
    eventMongoId: ev?.mongoId ?? null,
    eventName: ev?.name ?? null,
    action: row.action,
    reason: row.reason ?? null,
    reasonLabel: reasonText,
    gateIndex: row.gateIndex ?? null,
    detail: reasonText || row.reason || null,
    navigateTo,
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
  };
}

async function enrichAuditAlerts(auditRows, eventByNumericId) {
  if (!auditRows.length) return [];

  const actorIds = [
    ...new Set(auditRows.map((r) => r.actorUserId).filter(Boolean).map((id) => String(id))),
  ];
  const ticketPairs = auditRows
    .filter((r) => r.ticketId != null && r.EventID != null)
    .map((r) => ({ EventID: r.EventID, TicketID: r.ticketId }));
  const uniquePairs = [
    ...new Map(ticketPairs.map((p) => [`${p.EventID}:${p.TicketID}`, p])).values(),
  ];

  const [actors, tickets] = await Promise.all([
    actorIds.length
      ? User.find({ _id: { $in: actorIds } }).select("Username Email role").lean()
      : [],
    uniquePairs.length
      ? Ticket.find({ $or: uniquePairs }).select("TicketID EventID OwnerUserId").lean()
      : [],
  ]);

  const actorMap = new Map(actors.map((u) => [String(u._id), u]));
  const ticketMap = new Map(tickets.map((t) => [`${t.EventID}:${t.TicketID}`, t]));
  const holderIds = [
    ...new Set(tickets.map((t) => t.OwnerUserId).filter(Boolean).map((id) => String(id))),
  ];
  const holders =
    holderIds.length > 0
      ? await User.find({ _id: { $in: holderIds } })
          .select("Username Email faceIdReference NationalID")
          .lean()
      : [];
  const holderMap = new Map(holders.map((u) => [String(u._id), u]));

  return auditRows.map((row) => {
    const base = mapAuditToAlert(row, eventByNumericId);
    const actor = actorMap.get(String(row.actorUserId));
    const ticket =
      row.ticketId != null && row.EventID != null
        ? ticketMap.get(`${row.EventID}:${row.ticketId}`)
        : null;
    const holder = ticket?.OwnerUserId ? holderMap.get(String(ticket.OwnerUserId)) : null;

    const participants = [];
    if (holder) {
      participants.push({
        role: "ticket_holder",
        roleLabel: "Ticket holder (scanned at gate)",
        ...toUserBrief(holder),
      });
    }
    if (actor) {
      const isHolder = holder && String(actor._id) === String(holder._id);
      if (!isHolder) {
        participants.push({
          role: "gate_operator",
          roleLabel: actor.role === "admin" ? "Admin at gate" : "Staff at gate",
          ...toUserBrief(actor),
          accountRole: actor.role ?? null,
        });
      }
    }

    const meta = base.meta || {};
    const faceMatch =
      meta.similarity != null && meta.threshold != null
        ? {
            similarityPercent: Math.round(Number(meta.similarity) * 1000) / 10,
            thresholdPercent: Math.round(Number(meta.threshold) * 1000) / 10,
            passed: Number(meta.similarity) >= Number(meta.threshold),
          }
        : null;

    return {
      ...base,
      occurredAtIso: row.createdAt,
      participants,
      faceMatch,
      auditLogId: String(row._id),
    };
  });
}

async function countFraudAlerts() {
  const [failedAudits, rejectedResales, duplicateListings] = await Promise.all([
    EntryAuditLog.countDocuments({ success: false }),
    ResaleRequest.countDocuments({ status: "Rejected" }),
    ResaleListing.aggregate([
      {
        $match: {
          status: { $in: ["Listed", "PendingApproval", "Pending"] },
        },
      },
      { $group: { _id: "$TicketID", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: "total" },
    ]),
  ]);
  const dup = duplicateListings[0]?.total ?? 0;
  return failedAudits + rejectedResales + dup;
}

async function getSecurityPanel() {
  const [
    failedAudits,
    rejectedResales,
    activeListings,
    completedTransfers,
    pendingApproval,
    paymentPending,
    approvedCount,
    rejectedCount,
    duplicateListings,
  ] = await Promise.all([
    EntryAuditLog.find({ success: false })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    ResaleRequest.find({ status: "Rejected" })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("buyerId", "Username Email")
      .lean(),
    ResaleListing.countDocuments({ status: "Listed" }),
    ResaleRequest.countDocuments({ status: "Approved" }),
    ResaleListing.countDocuments({ status: "PendingApproval" }),
    ResaleRequest.countDocuments({ status: "PaymentPending" }),
    ResaleRequest.countDocuments({ status: "Approved" }),
    ResaleRequest.countDocuments({ status: "Rejected" }),
    ResaleListing.aggregate([
      {
        $match: {
          status: { $in: ["Listed", "PendingApproval", "Pending"] },
        },
      },
      { $group: { _id: "$TicketID", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: "total" },
    ]),
  ]);

  const eventByNumericId = await buildEventMapForAuditRows(failedAudits);
  const alerts = await enrichAuditAlerts(failedAudits, eventByNumericId);

  for (const req of rejectedResales) {
    const buyer = req.buyerId;
    alerts.push({
      id: `resale-${req._id}`,
      kind: "resale_rejected",
      type: "Resale request rejected",
      severity: "Medium",
      time: formatRelativeTime(req.updatedAt || req.createdAt),
      occurredAt: req.updatedAt || req.createdAt,
      occurredAtIso: req.updatedAt || req.createdAt,
      status: "Blocked",
      ticketId: null,
      eventId: null,
      eventMongoId: null,
      eventName: null,
      requestId: String(req._id),
      buyerEmail: buyer?.Email ?? null,
      buyerUsername: buyer?.Username ?? null,
      reasonLabel: "White-market resale request was rejected by an admin",
      detail: buyer?.Email || buyer?.Username || "Resale buyer",
      navigateTo: "resale",
      participants: buyer
        ? [
            {
              role: "buyer",
              roleLabel: "Buyer (resale request)",
              ...toUserBrief(buyer),
            },
          ]
        : [],
    });
  }

  const dupCount = duplicateListings[0]?.total ?? 0;
  if (dupCount > 0) {
    alerts.push({
      id: "duplicate-listings",
      kind: "duplicate_listings",
      type: "Duplicate ticket listings",
      severity: "High",
      time: "now",
      occurredAt: new Date(),
      status: "Under Review",
      ticketId: null,
      eventId: null,
      eventMongoId: null,
      eventName: null,
      duplicateTicketCount: dupCount,
      reasonLabel: `${dupCount} ticket(s) appear on more than one active resale listing`,
      detail: `${dupCount} ticket(s) with multiple active listings`,
      navigateTo: "resale",
      participants: [],
    });
  }

  alerts.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

  const decided = approvedCount + rejectedCount;
  const verificationRate = decided > 0 ? Math.round((approvedCount / decided) * 1000) / 10 : 100;

  return {
    alerts: alerts.slice(0, 25),
    resale: {
      activeListings,
      completedTransfers,
      flaggedListings: pendingApproval + paymentPending,
      pendingApproval,
      paymentPending,
      verificationRate,
      links: {
        activeListings: { navigateTo: "white-market" },
        completedTransfers: { navigateTo: "resale" },
        flaggedListings: { navigateTo: "resale", focus: "all-pending" },
        pendingApproval: { navigateTo: "resale", focus: "listings" },
        paymentPending: { navigateTo: "resale", focus: "payments" },
        verificationRate: { navigateTo: "resale" },
      },
    },
  };
}

async function getRecentActivity() {
  const [users, events, auditFails, resales] = await Promise.all([
    User.find()
      .select("Username Email Created_At")
      .sort({ Created_At: -1 })
      .limit(8)
      .lean(),
    Event.find({ Status: { $in: ["Active", "Pending", "AwaitingDeposit"] } })
      .select("Name Status createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    EntryAuditLog.find({ success: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    ResaleRequest.find({ status: "Approved" })
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate({ path: "listingId", populate: { path: "eventId", select: "Name" } })
      .populate("buyerId", "Username Email")
      .lean(),
  ]);

  const items = [];

  for (const u of users) {
    items.push({
      id: `user-${u._id}`,
      type: "user",
      action: "New user registered",
      detail: u.Email || u.Username || "—",
      occurredAt: u.Created_At,
      time: formatRelativeTime(u.Created_At),
    });
  }

  for (const ev of events) {
    const label =
      ev.Status === "Pending"
        ? "Event submitted for approval"
        : ev.Status === "AwaitingDeposit"
          ? "Event awaiting setup deposit"
          : "Event updated";
    items.push({
      id: `event-${ev._id}`,
      type: ev.Status === "Pending" ? "approval" : "event",
      action: label,
      detail: ev.Name || "—",
      occurredAt: ev.updatedAt || ev.createdAt,
      time: formatRelativeTime(ev.updatedAt || ev.createdAt),
    });
  }

  const auditEventMap = await buildEventMapForAuditRows(auditFails);
  for (const row of auditFails) {
    const mapped = mapAuditToAlert(row, auditEventMap);
    items.push({
      id: `audit-${row._id}`,
      type: "security",
      action: mapped.type,
      detail: row.reason || "Gate security",
      occurredAt: row.createdAt,
      time: mapped.time,
    });
  }

  for (const req of resales) {
    const eventName =
      req.listingId?.eventId?.Name ||
      (typeof req.listingId === "object" && req.listingId?.eventId?.Name) ||
      "Resale";
    items.push({
      id: `resale-${req._id}`,
      type: "resale",
      action: "White market transfer completed",
      detail: `${eventName} · ${req.buyerId?.Username || req.buyerId?.Email || "buyer"}`,
      occurredAt: req.updatedAt || req.createdAt,
      time: formatRelativeTime(req.updatedAt || req.createdAt),
    });
  }

  items.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  return items.slice(0, 20);
}

module.exports = {
  countFraudAlerts,
  getSecurityPanel,
  getRecentActivity,
  formatRelativeTime,
};
