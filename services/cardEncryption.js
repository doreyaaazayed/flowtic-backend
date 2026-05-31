const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey() {
  const raw = process.env.CARD_ENCRYPTION_KEY || "";
  if (!raw.trim()) {
    throw new Error("CARD_ENCRYPTION_KEY is not set (use a strong secret in production)");
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest(); // 32 bytes
}

/**
 * Encrypt full PAN for storage only. Never returned to clients.
 */
function encryptPan(normalizedDigits) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: 16 });
  const enc = Buffer.concat([cipher.update(normalizedDigits, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt for future payment integration only — do not expose via HTTP listing. */
function decryptPan(blobBase64) {
  const key = getKey();
  const buf = Buffer.from(blobBase64, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function luhnValid(digits) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function inferBrand(digits) {
  const d = digits.charAt(0);
  const two = digits.slice(0, 2);
  if (d === "4") return "visa";
  if (two >= "51" && two <= "55") return "mastercard";
  if (digits.startsWith("6011") || two === "65") return "discover";
  if (two === "34" || two === "37") return "amex";
  return "unknown";
}

/** Deterministic fingerprint for duplicate detection (per-user only, not global). */
function panFingerprint(normalizedDigits) {
  const key = process.env.CARD_ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-card-fingerprint";
  return crypto.createHmac("sha256", key).update(String(normalizedDigits)).digest("hex");
}

module.exports = { encryptPan, decryptPan, luhnValid, inferBrand, panFingerprint };
