const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "venues");

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

function filePathForVenue(venueId, ext = "jpg") {
  return path.join(UPLOAD_ROOT, `${venueId}.${ext}`);
}

function publicPathForVenue(venueId, ext = "jpg") {
  return `/api/uploads/venues/${venueId}.${ext}`;
}

function findExistingFile(venueId) {
  for (const ext of ["jpg", "png", "webp", "gif"]) {
    const fp = filePathForVenue(venueId, ext);
    if (fs.existsSync(fp)) return { filePath: fp, publicPath: publicPathForVenue(venueId, ext) };
  }
  return null;
}

async function persistVenueImage(venueId, imageUrl) {
  const raw = imageUrl == null ? "" : String(imageUrl).trim();
  if (!raw) return undefined;

  if (!isDataUrl(raw)) {
    if (raw.startsWith("/api/uploads/venues/")) return raw;
    if (raw.startsWith("/uploads/venues/")) {
      return raw.replace(/^\/uploads/, "/api/uploads");
    }
    return raw;
  }

  const parsed = parseDataUrl(raw);
  if (!parsed) return undefined;

  ensureUploadDir();
  const fp = filePathForVenue(venueId, parsed.ext);
  await fs.promises.writeFile(fp, parsed.buf);
  return publicPathForVenue(venueId, parsed.ext);
}

function resolveVenueImageUrl(venue) {
  const venueId = venue?.VenueID;
  const raw = venue?.imageUrl == null ? "" : String(venue.imageUrl).trim();
  if (!raw) {
    if (venueId != null) {
      const existing = findExistingFile(venueId);
      if (existing) return existing.publicPath;
    }
    return "";
  }

  if (isDataUrl(raw)) {
    if (venueId != null) {
      const existing = findExistingFile(venueId);
      if (existing) return existing.publicPath;
    }
    return "";
  }

  if (raw.startsWith("/api/uploads/venues/")) return raw;
  if (raw.startsWith("/uploads/venues/")) return raw.replace(/^\/uploads/, "/api/uploads");
  return raw;
}

async function migrateDataUrlToFile(venue) {
  if (!venue?.VenueID || !isDataUrl(venue.imageUrl)) return resolveVenueImageUrl(venue);
  const saved = await persistVenueImage(venue.VenueID, venue.imageUrl);
  if (saved && venue._id) {
    const Venue = require("../models/Venue");
    await Venue.updateOne({ _id: venue._id }, { $set: { imageUrl: saved } });
  }
  return saved || "";
}

module.exports = {
  persistVenueImage,
  resolveVenueImageUrl,
  migrateDataUrlToFile,
  isDataUrl,
};
