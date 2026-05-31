const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "events");

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1].trim().toLowerCase();
  const ext =
    mime === "image/png"
      ? "png"
      : mime === "image/webp"
        ? "webp"
        : mime === "image/gif"
          ? "gif"
          : "jpg";
  try {
    const buf = Buffer.from(match[2], "base64");
    if (!buf.length) return null;
    return { buf, ext, mime };
  } catch {
    return null;
  }
}

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function filePathForEvent(eventId, ext = "jpg") {
  return path.join(UPLOAD_ROOT, `${eventId}.${ext}`);
}

function publicPathForEvent(eventId, ext = "jpg") {
  return `/api/uploads/events/${eventId}.${ext}`;
}

function findExistingFile(eventId) {
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
    const fp = filePathForEvent(eventId, ext === "jpeg" ? "jpg" : ext);
    if (fs.existsSync(fp)) return { filePath: fp, publicPath: publicPathForEvent(eventId, ext === "jpeg" ? "jpg" : ext) };
  }
  return null;
}

/**
 * Save event hero image to disk. Accepts https URL (unchanged) or data URL (persisted).
 * @returns {Promise<string|undefined>} Public path (/api/uploads/...) or external URL
 */
async function persistEventImage(eventId, imageUrl) {
  const raw = imageUrl == null ? "" : String(imageUrl).trim();
  if (!raw) return undefined;

  if (!isDataUrl(raw)) {
    if (raw.startsWith("/api/uploads/events/")) return raw;
    if (raw.startsWith("/uploads/events/")) {
      return raw.replace(/^\/uploads/, "/api/uploads");
    }
    return raw;
  }

  const parsed = parseDataUrl(raw);
  if (!parsed) return undefined;

  ensureUploadDir();
  const fp = filePathForEvent(eventId, parsed.ext);
  await fs.promises.writeFile(fp, parsed.buf);
  return publicPathForEvent(eventId, parsed.ext);
}

/**
 * Resolve image URL for API clients (list cards, detail when needed).
 */
function resolveEventImageUrl(event) {
  const eventId = event?.EventID;
  const raw = event?.imageUrl == null ? "" : String(event.imageUrl).trim();
  if (!raw) {
    if (eventId != null) {
      const existing = findExistingFile(eventId);
      if (existing) return existing.publicPath;
    }
    return "";
  }

  if (isDataUrl(raw)) {
    if (eventId != null) {
      const existing = findExistingFile(eventId);
      if (existing) return existing.publicPath;
    }
    return "";
  }

  if (raw.startsWith("/api/uploads/events/")) return raw;
  if (raw.startsWith("/uploads/events/")) return raw.replace(/^\/uploads/, "/api/uploads");
  return raw;
}

/**
 * If DB still has a data URL, write file once and optionally update the document.
 */
async function migrateDataUrlToFile(event) {
  if (!event?.EventID || !isDataUrl(event.imageUrl)) return resolveEventImageUrl(event);
  const saved = await persistEventImage(event.EventID, event.imageUrl);
  if (saved && event._id) {
    const Event = require("../models/Event");
    await Event.updateOne({ _id: event._id }, { $set: { imageUrl: saved } });
  }
  return saved || "";
}

module.exports = {
  UPLOAD_ROOT,
  isDataUrl,
  persistEventImage,
  resolveEventImageUrl,
  migrateDataUrlToFile,
  findExistingFile,
};
