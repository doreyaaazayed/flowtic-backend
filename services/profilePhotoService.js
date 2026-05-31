const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "profiles");
const ALLOWED_EXT = ["jpg", "png", "webp", "gif"];

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return "jpg";
}

function filePathForUser(userId, ext = "jpg") {
  return path.join(UPLOAD_ROOT, `${userId}.${ext}`);
}

function publicPathForUser(userId, ext = "jpg") {
  return `/api/uploads/profiles/${userId}.${ext}`;
}

function findExistingPhoto(userId) {
  for (const ext of ALLOWED_EXT) {
    const fp = filePathForUser(userId, ext);
    if (fs.existsSync(fp)) return { filePath: fp, publicPath: publicPathForUser(userId, ext), ext };
  }
  return null;
}

async function removeOtherExtensions(userId, keepExt) {
  for (const ext of ALLOWED_EXT) {
    if (ext === keepExt) continue;
    const fp = filePathForUser(userId, ext);
    if (fs.existsSync(fp)) {
      await fs.promises.unlink(fp).catch(() => {});
    }
  }
}

/**
 * Save profile photo buffer to disk; returns public API path.
 */
async function saveProfilePhoto(userId, buffer, mimeType) {
  if (!userId || !buffer?.length) return null;
  ensureUploadDir();
  const ext = extFromMime(mimeType);
  const fp = filePathForUser(userId, ext);
  await fs.promises.writeFile(fp, buffer);
  await removeOtherExtensions(userId, ext);
  return publicPathForUser(userId, ext);
}

function resolveProfilePhotoUrl(user) {
  const raw = user?.profilePhotoUrl == null ? "" : String(user.profilePhotoUrl).trim();
  if (raw) {
    if (raw.startsWith("/api/uploads/profiles/")) return raw;
    if (raw.startsWith("/uploads/profiles/")) return raw.replace(/^\/uploads/, "/api/uploads");
    if (raw.startsWith("data:") || /^https?:\/\//i.test(raw)) return raw;
  }
  const existing = user?._id ? findExistingPhoto(String(user._id)) : null;
  return existing?.publicPath || "";
}

async function deleteProfilePhoto(userId) {
  for (const ext of ALLOWED_EXT) {
    const fp = filePathForUser(userId, ext);
    if (fs.existsSync(fp)) {
      await fs.promises.unlink(fp).catch(() => {});
    }
  }
}

module.exports = {
  saveProfilePhoto,
  resolveProfilePhotoUrl,
  deleteProfilePhoto,
  findExistingPhoto,
};
