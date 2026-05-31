/**
 * Uses Google Gemini (vision) to suggest sections, rows, seat counts, and normalized layout boxes
 * on a venue floor plan image. Requires GEMINI_API_KEY in .env.
 * Optional GEMINI_MODEL — if unset, tries common Flash model IDs until one works (404/quota differs per project).
 */

const { jsonrepair } = require("jsonrepair");

const SYSTEM_PROMPT = `You analyze venue seating diagrams and floor plans. Output ONLY a single JSON object, no markdown fences, no commentary.
Schema:
{
  "stagePosition": "bottom",
  "sections": [
    {
      "name": "Short label for this block e.g. North Upper, Field A, East 432, VIP Front",
      "placement": "grid",
      "rows": [ { "label": "A", "seatCount": 12, "rowFraction": 0.35 } ],
      "layout": { "x": 0, "y": 0, "w": 1, "h": 1 }
    }
  ]
}
Rules:
- Goal: the interactive map will overlay clickable seats on the SAME image. Your layout boxes and seat positions must match the uploaded drawing as closely as possible.
- layout x,y,w,h are fractions of the FULL image (0-1). x,y = top-left corner of the tight bounding box around THAT block of seats only; w,h = that box size. Draw boxes around each visible cluster of seat dots or each distinct colored tier block — do not use one huge box for the whole stadium unless it is one continuous block.
- Prefer MANY smaller sections (often 8-30+) for large stadium/oval maps: e.g. separate sections for north stand, east wing, field rectangles, side overlays, each with its own tight layout. Merge into one section only when seats are one contiguous same-color block.
- stagePosition (required): where the stage/pitch/screen sits in the image relative to seating — one of "top", "bottom", "left", "right", "center", "none". Use "bottom" when the pitch is along the bottom edge (common stadium maps). Use "top" when stage is at top. Use "left"/"right" for side stages. Use "center" for in-the-round arenas where the pitch/stage is surrounded by seating on all sides. Use "none" only if no stage is visible.
- When stagePosition is "center" or seating wraps around a central pitch, set placement to "arc" for every section so rows follow the curved stands (not "grid").
- If the stage/pitch is at the BOTTOM of the image, blocks nearest the stage have LARGER y (closer to 1.0). Upper stands have smaller y.
- placement:
  - "grid" = rectangular / straight rows of dots or tiers (default). Use for field blocks, straight stands, side rectangles.
  - "arc" = curved bowl or horseshoe stands around a stage at the bottom. Use when seats clearly follow a curve facing the stage.
- rows: estimate seatCount per row from the drawing. rowFraction is optional 0-1: vertical position of that row's center INSIDE the section layout box (0 = top of box, 1 = bottom). If you omit rowFraction for all rows in a section, seats are spaced evenly. If you use rowFraction, provide it for EVERY row in that section and order rows top-to-bottom in the image (smaller rowFraction = higher on the page).
- Row labels start at A per section and increment alphabetically.
- At most 24 rows per section; split into another section if needed.`;

/** Tried in order when GEMINI_MODEL is not set (unversioned names are often retired). */
const DEFAULT_MODEL_TRY_ORDER = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash-002",
  "gemini-1.5-flash-8b",
];

/**
 * Minimal JSON Schema only (types + required). Descriptions, maxItems, and propertyOrdering
 * inflate Gemini's constraint state machine and can trigger "too many states for serving".
 */
const FLOOR_PLAN_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    stagePosition: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          placement: { type: "string" },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                seatCount: { type: "integer" },
                rowFraction: { type: "number" },
              },
              required: ["label", "seatCount"],
            },
          },
          layout: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
            },
            required: ["x", "y", "w", "h"],
          },
        },
        required: ["name", "rows", "layout"],
      },
    },
  },
  required: ["sections", "stagePosition"],
};

const VALID_STAGE = new Set(["top", "bottom", "left", "right", "center", "none"]);

function clampStagePosition(raw) {
  const v = String(raw || "bottom").toLowerCase();
  return VALID_STAGE.has(v) ? v : "bottom";
}

/**
 * @param {string} imageDataUrl - data:image/jpeg;base64,... or https URL
 * @returns {Promise<{ mimeType: string, data: string }>} base64 payload (no data: prefix)
 */
async function resolveImageForGemini(imageDataUrl) {
  const src = String(imageDataUrl || "").trim();
  if (src.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(src.replace(/\s/g, ""));
    if (!match) {
      throw new Error("Invalid image data URL (expected base64)");
    }
    return { mimeType: match[1].trim() || "image/jpeg", data: match[2] };
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    const res = await fetch(src);
    if (!res.ok) {
      throw new Error(`Failed to fetch floor plan image: ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    return { mimeType: ct || "image/jpeg", data: buf.toString("base64") };
  }
  throw new Error("Image must be a data URL or http(s) URL");
}

function extractTextFromGeminiResponse(data) {
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked the request: ${blockReason}`);
  }
  const parts = data.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    const fr = data.candidates?.[0]?.finishReason;
    throw new Error(fr ? `No model output (finish: ${fr})` : "Empty response from Gemini");
  }
  return parts.map((p) => p.text || "").join("");
}

function normalizeSections(parsed) {
  if (!parsed.sections || !Array.isArray(parsed.sections)) {
    throw new Error('Model JSON must include "sections" array');
  }
  const sections = parsed.sections
    .map((sec) => {
      const name = String(sec.name || "Section").trim();
      const rawRows = Array.isArray(sec.rows) ? sec.rows : [];
      const placementRaw = String(sec.placement || "grid").toLowerCase();
      const placement = placementRaw === "arc" ? "arc" : "grid";
      const rows = rawRows.map((r, i) => {
        const label = String(r.label || String.fromCharCode(65 + i)).trim();
        const seatCount = Math.max(1, Math.min(200, parseInt(Number(r.seatCount), 10) || 10));
        const rf = r.rowFraction;
        const rowFraction =
          rf != null && Number.isFinite(Number(rf)) ? clamp01(Number(rf)) : undefined;
        return { label, seatCount, ...(rowFraction != null ? { rowFraction } : {}) };
      });
      const allFrac = rows.length > 0 && rows.every((r) => r.rowFraction != null);
      const rowsNorm =
        allFrac
          ? rows
          : rows.map(({ label, seatCount }) => ({ label, seatCount }));
      const L = sec.layout || {};
      const layout = {
        x: clamp01(Number(L.x) || 0),
        y: clamp01(Number(L.y) || 0),
        w: clamp01(Number(L.w) || 0.5),
        h: clamp01(Number(L.h) || 0.2),
      };
      if (layout.w < 0.05) layout.w = 0.2;
      if (layout.h < 0.05) layout.h = 0.15;
      return { name, rows: rowsNorm, layout, placement };
    })
    .filter((s) => s.rows.length > 0);
  const stagePosition = clampStagePosition(parsed.stagePosition);
  return { sections, stagePosition };
}

function sanitizeModelJsonText(text) {
  let s = String(text).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/im.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

/** Gemini occasionally emits trailing commas; strip before re-parse. */
function stripTrailingCommasInJson(s) {
  return s.replace(/,(\s*[\]}])/g, "$1");
}

/** First complete `{ ... }` using brace depth (avoids greedy `/\{[\s\S]*\}/` breaking on `}` inside strings). */
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

function parseToSections(jsonString) {
  let parsed = JSON.parse(jsonString);
  if (typeof parsed === "string") {
    parsed = JSON.parse(parsed);
  }
  return normalizeSections(parsed);
}

function parseModelJsonText(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty response from vision model");
  }
  const raw = sanitizeModelJsonText(text);
  const balanced = extractBalancedJsonObject(raw);

  const candidateStrings = [];
  const add = (s) => {
    if (s && typeof s === "string" && s.length > 0 && !candidateStrings.includes(s)) {
      candidateStrings.push(s);
    }
  };

  add(raw);
  add(stripTrailingCommasInJson(raw));
  if (balanced) {
    add(balanced);
    add(stripTrailingCommasInJson(balanced));
  }

  for (const c of candidateStrings) {
    try {
      return parseToSections(c);
    } catch {
      /* try next */
    }
  }

  for (const c of candidateStrings) {
    try {
      return parseToSections(jsonrepair(c));
    } catch {
      /* try next */
    }
  }

  try {
    return parseToSections(jsonrepair(raw));
  } catch {
    /* fall through */
  }

  throw new Error(
    "Model returned JSON that could not be parsed. Try a simpler floor plan image, or set GEMINI_MODEL (e.g. gemini-2.5-flash)."
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Seconds + jitter for exponential backoff between retries */
function backoffDelayMs(attemptIndex) {
  const base =
    Number.parseInt(process.env.GEMINI_RETRY_MS_BASE ?? "600", 10) || 600;
  const cap = Number.parseInt(process.env.GEMINI_RETRY_MS_CAP ?? "9000", 10) || 9000;
  const raw = Math.min(cap, Math.round(base * Math.pow(1.85, Math.max(0, attemptIndex - 1))));
  const jitter = Math.floor(raw * (0.12 + Math.random() * 0.15));
  return raw + jitter;
}

/**
 * Busy / overloaded / transient — retry before giving up (same request + model).
 */
function isTransientGeminiFailure(status, message) {
  const msg = String(message || "").toLowerCase();
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (/try again later|too many requests|overloaded|rate limit|RESOURCE_EXHAUSTED|unavailable/i.test(msg)) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function shouldTryNextModel(explicitModel, status, message) {
  if (explicitModel) return false;
  const msg = String(message || "").toLowerCase();
  if (status === 404) return true;
  if (status === 429) return true;
  /** Overloaded tier — another model slot may succeed */
  if (status === 503) return true;
  if (/high demand/i.test(message || "")) return true;
  if (status === 502 || status === 504) return true;
  if (msg.includes("not found") && msg.includes("model")) return true;
  if (msg.includes("not supported for generatecontent")) return true;
  return false;
}

function shouldRetryWithoutResponseSchema(apiJson) {
  const msg = String(apiJson?.error?.message || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("responsejsonschema") ||
    msg.includes("response schema") ||
    msg.includes("structured output") ||
    msg.includes("json schema") ||
    (msg.includes("invalid") && msg.includes("schema")) ||
    msg.includes("too many states") ||
    msg.includes("too many state")
  );
}

async function geminiGenerateContent(apiKey, model, mimeType, data) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const baseGenerationConfig = {
    maxOutputTokens: 8192,
    temperature: 0.2,
    responseMimeType: "application/json",
  };

  const bodyBase = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "Analyze this venue seating / floor plan image. Output JSON so that normalized layout boxes and seat placement match the drawing: many tight sections for separate blocks, correct placement (grid vs arc), and optional rowFraction so rows line up vertically inside each box. Return the JSON object as specified.",
          },
          {
            inlineData: {
              mimeType,
              data,
            },
          },
        ],
      },
    ],
  };

  const post = async (generationConfig) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...bodyBase,
        generationConfig,
      }),
    });
    const apiJson = await res.json().catch(() => ({}));
    return { res, apiJson };
  };

  let { res, apiJson } = await post({
    ...baseGenerationConfig,
    responseJsonSchema: FLOOR_PLAN_RESPONSE_JSON_SCHEMA,
  });

  if (!res.ok && res.status === 400 && shouldRetryWithoutResponseSchema(apiJson)) {
    ({ res, apiJson } = await post(baseGenerationConfig));
  }

  return { res, apiJson };
}

/**
 * @param {string} imageDataUrl - data:image/jpeg;base64,... or https URL
 * @returns {Promise<{ sections: Array<{ name: string, rows: Array<{ label: string, seatCount: number }>, layout: { x: number, y: number, w: number, h: number } }> }>}
 */
async function analyzeFloorPlanImage(imageDataUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    const err = new Error("GEMINI_API_KEY is not configured");
    err.code = "NO_GEMINI_KEY";
    throw err;
  }

  const explicitModel = process.env.GEMINI_MODEL?.trim() || "";
  const modelList = explicitModel ? [explicitModel] : DEFAULT_MODEL_TRY_ORDER;
  const { mimeType, data } = await resolveImageForGemini(imageDataUrl);

  /** Retries after *first failure* → total attempts = 1 + GEMINI_RETRY_PER_MODEL_EXTRA */
  const extraRetries = Math.min(
    12,
    Math.max(0, Number.parseInt(process.env.GEMINI_RETRY_PER_MODEL_EXTRA ?? "3", 10) || 3),
  );
  const attemptsPerModel = 1 + extraRetries;

  let lastErr = null;

  for (let i = 0; i < modelList.length; i++) {
    const model = modelList[i];

    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      const { res, apiJson } = await geminiGenerateContent(apiKey, model, mimeType, data);

      if (res.ok) {
        const text = extractTextFromGeminiResponse(apiJson);
        return parseModelJsonText(text);
      }

      const msg = apiJson.error?.message || res.statusText || "Gemini request failed";
      lastErr = Object.assign(new Error(msg), {
        code: "GEMINI_ERROR",
        status: res.status,
      });

      const transient = isTransientGeminiFailure(res.status, msg);

      /** Same model — retry delays for temporary overload */
      const canBackoff = transient && attempt < attemptsPerModel;
      if (canBackoff) {
        const waitMs = backoffDelayMs(attempt);
        await sleep(waitMs);
        continue;
      }

      /** No more backoff for this model */
      break;
    }

    const msg = lastErr?.message ?? "";
    const st = typeof lastErr?.status === "number" ? lastErr.status : 503;
    const hasNextModel = i < modelList.length - 1;

    /** Try another model ID (only when GEMINI_MODEL is not pinned) */
    if (hasNextModel && shouldTryNextModel(explicitModel, typeof st === "number" ? st : Number(st), msg)) {
      const gap = backoffDelayMs(1 + i);
      await sleep(Math.min(gap, 4500));

      console.warn(`[floorPlanAnalyzer] Gemini model "${model}" failed (${msg}); trying next fallback model …`);
      continue;
    }

    throw lastErr;
  }

  throw lastErr || new Error("Gemini request failed");
}

function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

module.exports = { analyzeFloorPlanImage };
