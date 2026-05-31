const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const multer = require("multer");
const { callGeminiVision } = require("../services/venueSeatingGemini");

const MAX_MB = Number.parseInt(process.env.MAX_UPLOAD_SIZE_MB ?? "10", 10) || 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const m = (file.mimetype || "").toLowerCase();
    if (/^image\/(jpeg|pjpeg|png|webp)$/i.test(m)) return cb(null, true);
    cb(new Error("Only JPG, PNG, or WEBP images are supported (PDF is not processed server-side)."));
  },
});

function layoutsDir() {
  const dir = path.join(__dirname, "..", "data", "seating-layouts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * POST /api/analyze-venue
 * multipart field name: "file"
 */
exports.analyzeVenueMiddleware = upload.single("file");

exports.analyzeVenue = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "Missing image file (field name: file)" });
    }

    let mime = req.file.mimetype || "image/jpeg";
    if (!/^image\//i.test(mime)) mime = "image/jpeg";

    const processed = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();

    const outMime = "image/jpeg";
    const base64 = processed.toString("base64");

    const { rawText, parsed } = await callGeminiVision(outMime, base64);

    return res.json({
      success: true,
      layout: parsed,
      confidence: computeOverallConfidence(parsed),
      rawResponse: rawText,
    });
  } catch (err) {
    console.error("analyze-venue error:", err.message);
    if (err.code === "NO_GEMINI_KEY") {
      return res.status(503).json({
        success: false,
        layout: null,
        confidence: 0,
        rawResponse: "",
        error: err.message,
      });
    }
    return res.status(err.status && err.status < 600 ? err.status : 502).json({
      success: false,
      layout: null,
      confidence: 0,
      rawResponse: "",
      error: err.message || "Analysis failed",
    });
  }
};

function computeOverallConfidence(parsed) {
  const secs = parsed?.sections;
  if (!Array.isArray(secs) || secs.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const s of secs) {
    const c = Number(s.confidence);
    if (Number.isFinite(c) && c >= 0 && c <= 1) {
      sum += c;
      n++;
    }
  }
  if (n === 0) return 0.5;
  return Math.round((sum / n) * 1000) / 1000;
}

/**
 * POST /api/seating-layouts
 * body: { layout: object }
 */
exports.saveSeatingLayout = async (req, res) => {
  try {
    const { layout } = req.body || {};
    if (!layout || typeof layout !== "object") {
      return res.status(400).json({ message: "Body must include layout object" });
    }
    const id = layout.id && String(layout.id).trim() ? String(layout.id).trim() : require("crypto").randomUUID();
    const payload = { ...layout, id, savedAt: new Date().toISOString() };
    const file = path.join(layoutsDir(), `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    return res.status(201).json({ id, url: `/api/seating-layouts/${id}` });
  } catch (err) {
    console.error("save seating layout:", err);
    return res.status(500).json({ message: "Could not save layout" });
  }
};

/**
 * GET /api/seating-layouts/:id
 */
exports.getSeatingLayout = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !/^[\w-]+$/.test(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const file = path.join(layoutsDir(), `${id}.json`);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ message: "Layout not found" });
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return res.json(data);
  } catch (err) {
    console.error("get seating layout:", err);
    return res.status(500).json({ message: "Could not load layout" });
  }
};

