const mongoose = require("mongoose");
const UserPaymentCard = require("../models/UserPaymentCard");
const { encryptPan, luhnValid, inferBrand, panFingerprint } = require("../services/cardEncryption");

function uid(req) {
  const id = req.user?.id;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
}

function normalizePan(input) {
  if (input == null) return "";
  return String(input)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\D/g, "");
}

function normalizeExpiryYear(y) {
  let n = Number(y);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n < 100) n += 2000;
  return n;
}

exports.listCards = async (req, res) => {
  try {
    const userId = uid(req);
    const rows = await UserPaymentCard.find({ userId }).sort({ createdAt: -1 }).select("-encryptedPan").lean();
    return res.json(rows);
  } catch (e) {
    console.error("listCards:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.addCard = async (req, res) => {
  try {
    const userId = uid(req);
    const { cardNumber, expiryMonth, expiryYear, cardholderName, label } = req.body || {};
    const digits = normalizePan(cardNumber);
    const month = Math.trunc(Number(expiryMonth));
    const year = normalizeExpiryYear(expiryYear);

    if (!digits || digits.length < 13 || digits.length > 19) {
      return res.status(400).json({
        message: "Card number must be 13–19 digits (spaces are OK).",
      });
    }
    const relaxLuhn = String(process.env.RELAX_CARD_LUHN || "").trim() === "1";
    if (!relaxLuhn && !luhnValid(digits)) {
      return res.status(400).json({
        message:
          "Card number failed the checksum (Luhn). Check for typos, or try a common test card like 4242424242424242. For local demos only, set RELAX_CARD_LUHN=1 in backend/.env.",
      });
    }
    if (!month || month < 1 || month > 12) {
      return res.status(400).json({ message: "Expiry month must be 1–12." });
    }
    if (!year || year < 2000 || year > 2100) {
      return res.status(400).json({
        message: "Expiry year must be a full year (e.g. 2030) or two digits (e.g. 30 → 2030).",
      });
    }

    const now = new Date();
    const expiry = new Date(year, month, 0, 23, 59, 59, 999);
    if (expiry < now) {
      return res.status(400).json({
        message: `This card reads as expired (Thru ${String(month).padStart(2, "0")}/${year}). Use a future expiry for testing.`,
      });
    }

    let encryptedPan;
    try {
      encryptedPan = encryptPan(digits);
    } catch (err) {
      console.error("Card encrypt config error:", err.message);
      return res.status(500).json({
        message: "Card storage is not configured. Set CARD_ENCRYPTION_KEY on the server.",
      });
    }

    const lastFour = digits.slice(-4);
    const brand = inferBrand(digits);
    const fingerprint = panFingerprint(digits);

    const existingGlobal = await UserPaymentCard.findOne({ panFingerprint: fingerprint })
      .select("_id userId")
      .lean();
    if (existingGlobal) {
      if (String(existingGlobal.userId) === String(userId)) {
        return res.status(409).json({ message: "This card is already saved to your wallet" });
      }
      return res.status(409).json({
        message: "This card number is already registered to another FlowTic account",
      });
    }

    const doc = await UserPaymentCard.create({
      userId,
      lastFour,
      brand,
      expiryMonth: month,
      expiryYear: year,
      cardholderName: String(cardholderName || "").trim().slice(0, 120),
      label: String(label || "").trim().slice(0, 80),
      encryptedPan,
      panFingerprint: fingerprint,
    });

    const safe = await UserPaymentCard.findById(doc._id).select("-encryptedPan").lean();
    return res.status(201).json(safe);
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        message: "This card number is already registered to another FlowTic account",
      });
    }
    console.error("addCard:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteCard = async (req, res) => {
  try {
    const userId = uid(req);
    const card = await UserPaymentCard.findOne({ _id: req.params.id, userId });
    if (!card) return res.status(404).json({ message: "Card not found" });
    await UserPaymentCard.deleteOne({ _id: card._id });
    return res.status(204).send();
  } catch (e) {
    console.error("deleteCard:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
};
