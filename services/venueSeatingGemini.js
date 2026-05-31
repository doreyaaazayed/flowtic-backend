/**
 * Venue floor-plan → structured seating JSON via Gemini vision.
 * Uses GEMINI_API_KEY; optional GEMINI_VENUE_MODEL (first candidate, then fallbacks).
 * Unversioned names like "gemini-1.5-flash" are often retired — we try newer IDs automatically.
 */

const { jsonrepair } = require("jsonrepair");

const VENUE_ANALYSIS_PROMPT = `Analyze this venue floor plan image and return ONLY a valid JSON object with this exact structure:
{
  "venueName": "string or null",
  "stagePosition": "front|rear|left|right|center|none",
  "mapShape": "rectangle|arc|u-shape|round|custom",
  "sections": [
    {
      "name": "string",
      "type": "standard|vip|accessible|standing|restricted",
      "rowCount": number,
      "seatsPerRow": number,
      "rowOverrides": [] or [{"row": 1, "seats": number}],
      "estimatedArea": "front|middle|rear|left|right|balcony|floor",
      "confidence": 0.0
    }
  ],
  "hasAisles": boolean,
  "hasBalcony": boolean,
  "hasStandingArea": boolean,
  "totalEstimatedCapacity": number,
  "notes": "any observations about the layout"
}
Return ONLY the JSON, no explanation, no markdown.
confidence must be between 0 and 1 per section.`;

/** Same family as floorPlanAnalyzer.js — try in order when the first model 404s or is unsupported. */
const VENUE_MODEL_FALLBACKS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash-002",
  "gemini-1.5-flash-8b",
];

function venueModelCandidates() {
  const pinned = process.env.GEMINI_VENUE_MODEL?.trim();
  const first = pinned || "gemini-2.5-flash";
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const m of [first, ...VENUE_MODEL_FALLBACKS]) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/** Wrong / retired model ID — switch immediately (retries won't help). */
function isWrongModelError(status, message) {
  const msg = String(message || "").toLowerCase();
  if (status === 404) return true;
  if (msg.includes("not found") && msg.includes("model")) return true;
  if (msg.includes("not supported for generatecontent")) return true;
  if (msg.includes("is not found for api version")) return true;
  return false;
}

/** Busy / overloaded — retry same model with backoff. */
function isTransientVenueFailure(status, message) {
  const msg = String(message || "").toLowerCase();
  if (status === 403 || status === 429) return true;
  if (status === 502 || status === 503 || status === 504) return true;
  if (status >= 500 && status < 600) return true;
  if (
    /high demand|try again later|too many requests|overloaded|rate limit|resource_exhausted|unavailable|spikes in demand|exceed.*your.*quota|quota exceeded|free_tier|generativelanguage\./i.test(
      msg,
    )
  )
    return true;
  return false;
}

/**
 * Free tier / RPD is often per model + key. Hitting 20 req on gemini-2.5-flash
 * will keep failing; don't burn GEMINI_VENUE_RETRY_PER_MODEL on the same model.
 */
function suggestsAnotherModelForQuotaOrSlice(message) {
  const m = String(message || "");
  if (!/quota|exceed|exceeded|rate limit|resource_exhausted|free_tier|generate_content_free_tier|limit:\s*\d+/i.test(m)) {
    return false;
  }
  if (/\bfor model:\s*gemini-/i.test(m) || /model:\s*gemini-/i.test(m) || /,\s*model:\s*gemini-/i.test(m)) {
    return true;
  }
  if (/exceeded your current quota/i.test(m) && /limit:\s*\d+/i.test(m)) {
    return true;
  }
  if (/generativelanguage\./i.test(m) && /limit:\s*\d+/i.test(m)) {
    return true;
  }
  if (/free_tier/i.test(m.toLowerCase()) && /requests/i.test(m.toLowerCase())) {
    return true;
  }
  return /please retry in [\d.]+/i.test(m) && (m.toLowerCase().includes("quota") || m.toLowerCase().includes("exceed"));
}

/** "Please retry in 12.577s" in Google error text, or standard Retry-After. */
function parseRetryAfterMs(res, message) {
  const h = res.headers.get("retry-after");
  if (h) {
    const sec = Number.parseInt(h, 10);
    if (Number.isFinite(sec) && sec > 0 && sec <= 7200) {
      return Math.min(120_000, sec * 1000 + 250);
    }
  }
  const m = String(message || "");
  const a = /please retry in ([\d.]+)s?/i.exec(m);
  if (a) {
    const s = Math.min(120, Math.max(0, parseFloat(a[1])));
    if (Number.isFinite(s) && s > 0) {
      return Math.min(120_000, s * 1000 + 250);
    }
  }
  return 0;
}

/**
 * After retries on this model, try another model ID (capacity differs per model).
 * Same idea as floorPlanAnalyzer.shouldTryNextModel (no strict pin — env is first preference only).
 */
function shouldFallbackToNextModel(status, message) {
  const msg = String(message || "").toLowerCase();
  if (isWrongModelError(status, message)) return true;
  if (status === 403 || status === 429 || status === 503 || status === 502 || status === 504) return true;
  if (
    /high demand|try again later|overloaded|rate limit|resource_exhausted|unavailable|spikes in demand|exceed.*your.*quota|free_tier/i.test(msg)
  )
    return true;
  return false;
}

function venueBackoffMs(attemptIndex) {
  const base = Number.parseInt(process.env.GEMINI_RETRY_MS_BASE ?? "700", 10) || 700;
  const cap = Number.parseInt(process.env.GEMINI_RETRY_MS_CAP ?? "12000", 10) || 12000;
  const raw = Math.min(cap, Math.round(base * Math.pow(1.85, Math.max(0, attemptIndex - 1))));
  const jitter = Math.floor(raw * (0.12 + Math.random() * 0.15));
  return raw + jitter;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractBalancedJsonObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function sanitizeModelText(text) {
  let s = String(text || "").trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/im.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

/**
 * @param {string} mimeType
 * @param {string} base64Data
 * @returns {Promise<{ rawText: string, parsed: object }>}
 */
async function callGeminiVision(mimeType, base64Data) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    const e = new Error("GEMINI_API_KEY is not configured");
    e.code = "NO_GEMINI_KEY";
    throw e;
  }

  const body = {
    systemInstruction: { parts: [{ text: VENUE_ANALYSIS_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: "Analyze this image and output the JSON object only." },
          { inlineData: { mimeType, data: base64Data } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };

  const models = venueModelCandidates();
  let lastErr = null;
  const attemptsPerModel = Math.min(
    12,
    Math.max(3, Number.parseInt(process.env.GEMINI_VENUE_RETRY_PER_MODEL ?? "6", 10) || 6),
  );

  modelLoop: for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const apiJson = await res.json().catch(() => ({}));
      if (res.ok) {
        const parts = apiJson.candidates?.[0]?.content?.parts;
        const text = Array.isArray(parts) ? parts.map((p) => p.text || "").join("") : "";
        if (!text) {
          const fr = apiJson.candidates?.[0]?.finishReason;
          throw new Error(fr ? `Empty Gemini output (finish: ${fr})` : "Empty Gemini output");
        }
        const rawText = text;
        let parsed;
        try {
          parsed = JSON.parse(sanitizeModelText(text));
        } catch {
          const balanced = extractBalancedJsonObject(sanitizeModelText(text));
          if (balanced) {
            try {
              parsed = JSON.parse(balanced);
            } catch {
              parsed = JSON.parse(jsonrepair(balanced));
            }
          } else {
            parsed = JSON.parse(jsonrepair(sanitizeModelText(text)));
          }
        }
        return { rawText, parsed };
      }

      const msg = apiJson.error?.message || res.statusText || "Gemini request failed";
      lastErr = Object.assign(new Error(msg), { status: res.status, code: "GEMINI_ERROR" });

      if (isWrongModelError(res.status, msg) && mi < models.length - 1) {
        console.warn(`[venueSeatingGemini] model "${model}" not available (${msg}); trying next model…`);
        continue modelLoop;
      }

      if (suggestsAnotherModelForQuotaOrSlice(msg) && mi < models.length - 1) {
        const oneLine = String(msg).split("\n").find((l) => l.trim()) || String(msg);
        const clip = oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
        console.warn(`[venueSeatingGemini] model "${model}" quota / slice limit (will try other modelIds next): ${clip}`);
        continue modelLoop;
      }

      const waitMs = parseRetryAfterMs(res, msg);
      if (waitMs > 0 && isTransientVenueFailure(res.status, msg) && attempt < attemptsPerModel) {
        console.warn(`[venueSeatingGemini] waiting ${(waitMs / 1000).toFixed(1)}s per API hint for "${model}"…`);
        await sleep(waitMs);
        continue;
      }

      const transient = isTransientVenueFailure(res.status, msg);
      if (transient && attempt < attemptsPerModel) {
        await sleep(venueBackoffMs(attempt));
        continue;
      }

      if (shouldFallbackToNextModel(res.status, msg) && mi < models.length - 1) {
        const clip = String(msg).split("\n").find((l) => l.trim()) || String(msg);
        console.warn(
          `[venueSeatingGemini] model "${model}" failed after retries; trying next model… (${
            clip.length > 180 ? `${clip.slice(0, 180)}…` : clip
          })`,
        );
        continue modelLoop;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

module.exports = { callGeminiVision, VENUE_ANALYSIS_PROMPT };
