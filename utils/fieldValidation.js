/** Egyptian mobile: exactly 11 digits, must start with 01. */
function isValidEgyptPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return /^01\d{9}$/.test(digits);
}

function normalizeEgyptPhone(phone) {
  return String(phone || "").replace(/\D/g, "").slice(0, 11);
}

/** At least 8 chars with both letters and numbers. */
function isValidPassword(password) {
  const p = String(password || "");
  if (p.length < 8) return false;
  return /[A-Za-z]/.test(p) && /\d/.test(p);
}

function assertValidPassword(password) {
  if (!isValidPassword(password)) {
    const err = new Error("Password must be at least 8 characters and include both letters and numbers");
    err.statusCode = 400;
    throw err;
  }
}

function assertValidEgyptPhone(phone, { required = true } = {}) {
  const digits = normalizeEgyptPhone(phone);
  if (!digits && !required) return digits;
  if (!isValidEgyptPhone(digits)) {
    const err = new Error("Phone must be exactly 11 digits and start with 01 (e.g. 01012345678)");
    err.statusCode = 400;
    throw err;
  }
  return digits;
}

module.exports = {
  isValidEgyptPhone,
  normalizeEgyptPhone,
  isValidPassword,
  assertValidPassword,
  assertValidEgyptPhone,
};
