const mongoose = require("mongoose");
const EntryAuditLog = require("../models/EntryAuditLog");

function actorOid(req) {
  const id = req.user?.id;
  if (!id) return null;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

/**
 * Best-effort append-only audit row. Never throws to callers.
 * @param {object} opts
 * @param {import('express').Request} opts.req
 * @param {number} opts.eventId - numeric EventID
 * @param {'assign'|'regenerate'|'jam'|'redirect'|'verify_manual'|'verify_face'} opts.action
 * @param {boolean} [opts.success]
 * @param {string|null} [opts.reason]
 * @param {number|null} [opts.ticketId]
 * @param {number|null} [opts.gateIndex]
 * @param {object} [opts.meta]
 */
async function log(opts) {
  try {
    const { req, eventId, action, success = true, reason = null, ticketId = null, gateIndex = null, meta = {} } = opts;
    const actorUserId = actorOid(req);
    if (!actorUserId || eventId == null || Number.isNaN(Number(eventId))) return;

    const safeMeta = { ...(typeof meta === "object" && meta ? meta : {}) };
    if (Array.isArray(safeMeta.ticketIds) && safeMeta.ticketIds.length > 120) {
      safeMeta.ticketIds = safeMeta.ticketIds.slice(0, 120);
      safeMeta.ticketIdsTruncated = true;
    }

    await EntryAuditLog.create({
      EventID: Number(eventId),
      actorUserId,
      action,
      success: Boolean(success),
      reason: reason != null ? String(reason).slice(0, 500) : null,
      ticketId: ticketId != null && !Number.isNaN(Number(ticketId)) ? Number(ticketId) : null,
      gateIndex: gateIndex != null && !Number.isNaN(Number(gateIndex)) ? Number(gateIndex) : null,
      meta: safeMeta,
    });
  } catch (err) {
    console.error("[entryAuditService.log]", err?.message || err);
  }
}

module.exports = { log };
