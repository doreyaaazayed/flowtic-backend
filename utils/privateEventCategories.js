/** Prom, Weddings, Private — hidden from public listings and direct browse without invite. */
const PRIVATE_CATEGORY_IDS = [4, 5, 6];

function isPrivateCategoryId(categoryId) {
  return PRIVATE_CATEGORY_IDS.includes(Number(categoryId));
}

function isPrivateCategoryName(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return false;
  return (
    /\bprom\b/.test(n) ||
    /\bwedding/.test(n) ||
    n.includes("bridal") ||
    n.includes("marriage") ||
    /\bprivate\b/.test(n)
  );
}

/** wedding | prom | private */
function privateEventKind(categoryId, categoryName) {
  const id = Number(categoryId);
  const n = String(categoryName || "").toLowerCase();
  if (id === 5 || /\bwedding/.test(n) || n.includes("bridal") || n.includes("marriage")) {
    return "wedding";
  }
  if (id === 4 || /\bprom\b/.test(n)) {
    return "prom";
  }
  return "private";
}

function defaultInviteMessage(kind) {
  if (kind === "wedding") return "You're invited to attend our wedding";
  if (kind === "prom") return "You're invited to attend our prom";
  return "You're invited to this private celebration";
}

function isPrivateEventCategory(categoryId, categoryName) {
  return isPrivateCategoryId(categoryId) || isPrivateCategoryName(categoryName);
}

module.exports = {
  PRIVATE_CATEGORY_IDS,
  isPrivateCategoryId,
  isPrivateCategoryName,
  isPrivateEventCategory,
  privateEventKind,
  defaultInviteMessage,
};
