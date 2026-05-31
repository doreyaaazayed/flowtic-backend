/** Shared face embedding parsing, gallery enrollment, and cosine matching (Human.js faceres). */

const FACE_EMBED_MIN_LEN = 64;
const FACE_EMBED_MAX_LEN = 1024;
const DEFAULT_FACE_THRESHOLD = 0.76;
const DEFAULT_GALLERY_MAX = 8;
const GALLERY_INLIER_MIN = 0.52;
const GALLERY_DIVERSITY_MAX = 0.93;

function l2Normalize(arr) {
  if (!arr?.length) return null;
  const nums = arr.map((x) => Number(x));
  if (nums.some((x) => Number.isNaN(x) || !Number.isFinite(x))) return null;
  const norm = Math.sqrt(nums.reduce((s, x) => s + x * x, 0));
  if (norm < 1e-10) return null;
  return nums.map((x) => x / norm);
}

function parseEmbedding(body) {
  const raw = body?.embedding ?? body;
  if (!Array.isArray(raw) || raw.length < FACE_EMBED_MIN_LEN || raw.length > FACE_EMBED_MAX_LEN) {
    return null;
  }
  return l2Normalize(raw);
}

function parseSampleList(body) {
  const raw = body?.samples;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = [];
  for (const item of raw) {
    const v = parseEmbedding({ embedding: item });
    if (v) out.push(v);
  }
  return out.length >= 2 ? out : null;
}

function cosineSimilarity(a, b) {
  if (!a?.length || a.length !== b.length) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

function averageVectors(vectors) {
  if (!vectors.length) return null;
  const d = vectors[0].length;
  const sum = new Array(d).fill(0);
  for (const v of vectors) {
    if (v.length !== d) return null;
    for (let i = 0; i < d; i++) sum[i] += v[i];
  }
  return l2Normalize(sum.map((x) => x / vectors.length));
}

function matchThreshold() {
  const base = Number(process.env.FACE_MATCH_THRESHOLD || DEFAULT_FACE_THRESHOLD);
  if (process.env.FACE_MATCH_DEMO_RELAX === "1") {
    return Math.max(0.48, base - 0.08);
  }
  return base;
}

function galleryMaxSize() {
  const n = Number(process.env.FACE_GALLERY_MAX || DEFAULT_GALLERY_MAX);
  return Number.isFinite(n) && n >= 2 ? Math.min(12, Math.floor(n)) : DEFAULT_GALLERY_MAX;
}

/**
 * Build centroid + diverse template gallery from enrollment samples (lighting/pose variety).
 */
function buildEnrollmentGallery(rawVectors) {
  const normalized = rawVectors.map((v) => l2Normalize(v)).filter(Boolean);
  if (normalized.length < 2) return null;

  const centroid = averageVectors(normalized);
  if (!centroid) return null;

  const inliers = normalized.filter((v) => cosineSimilarity(centroid, v) >= GALLERY_INLIER_MIN);
  const pool = inliers.length >= 2 ? inliers : normalized;
  const maxKeep = galleryMaxSize();
  const gallery = [centroid];

  const ranked = pool
    .map((v) => ({ v, sim: cosineSimilarity(centroid, v) }))
    .sort((a, b) => b.sim - a.sim);

  for (const { v } of ranked) {
    if (gallery.length >= maxKeep) break;
    const tooSimilar = gallery.some((g) => cosineSimilarity(g, v) > GALLERY_DIVERSITY_MAX);
    if (!tooSimilar && cosineSimilarity(centroid, v) >= GALLERY_INLIER_MIN * 0.9) {
      gallery.push(v);
    }
  }

  if (gallery.length < 2) gallery.push(ranked[0]?.v || normalized[0]);
  return { centroid, gallery };
}

/** Templates for matching: gallery rows, else legacy single embedding. */
function getTemplateGallery(user) {
  if (user?.faceEmbeddingGallery?.length) {
    const rows = user.faceEmbeddingGallery.filter((g) => Array.isArray(g) && g.length >= FACE_EMBED_MIN_LEN);
    if (rows.length) return rows.map((g) => l2Normalize(g)).filter(Boolean);
  }
  if (user?.faceEmbedding?.length) {
    const one = l2Normalize(user.faceEmbedding);
    return one ? [one] : [];
  }
  return [];
}

/** Best cosine score across all stored templates (handles lighting/outfit drift better than one vector). */
function matchProbeToGallery(probe, gallery) {
  const threshold = matchThreshold();
  if (!probe?.length || !gallery?.length) {
    return { match: false, similarity: 0, threshold, gallerySize: 0 };
  }
  let best = -1;
  for (const template of gallery) {
    if (template.length !== probe.length) continue;
    const sim = cosineSimilarity(probe, template);
    if (sim > best) best = sim;
  }
  if (best < 0) {
    return { match: false, similarity: 0, threshold, gallerySize: gallery.length, dimensionMismatch: true };
  }
  return {
    match: best >= threshold,
    similarity: best,
    threshold,
    gallerySize: gallery.length,
  };
}

function parseFaceIdReference(ref) {
  if (!ref || typeof ref !== "string") return { model: null, dim: null };
  const parts = ref.split(":");
  const dim = parts.length > 1 ? Number(parts[1]) : null;
  return { model: parts[0], dim: Number.isFinite(dim) ? dim : null };
}

module.exports = {
  parseEmbedding,
  parseSampleList,
  cosineSimilarity,
  matchThreshold,
  buildEnrollmentGallery,
  getTemplateGallery,
  matchProbeToGallery,
  parseFaceIdReference,
  DEFAULT_FACE_THRESHOLD,
  FACE_EMBED_MIN_LEN,
  FACE_EMBED_MAX_LEN,
  galleryMaxSize,
};
