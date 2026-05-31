/**
 * Rough entry-assignment timing (no DB writes).
 * Usage: node scripts/benchmarkEntryAssign.js [ticketCount] [gateCount] [slotCount]
 *
 * Example: node scripts/benchmarkEntryAssign.js 10000 20 40
 */
const { buildTicketGroups } = require("../services/entryAssignmentService");

const ticketCount = Math.min(50000, Math.max(100, Number(process.argv[2]) || 10000));
const gateCount = Math.min(100, Math.max(1, Number(process.argv[3]) || 20));
const slotCount = Math.min(500, Math.max(1, Number(process.argv[4]) || 40));

const ticketIds = Array.from({ length: ticketCount }, (_, i) => i + 1);
const links = [];
for (let i = 0; i < Math.floor(ticketCount / 50); i++) {
  const a = 1 + i * 50;
  const b = a + 1;
  if (b <= ticketCount) links.push([a, b]);
}

const maxPerGate = Math.max(1, Math.ceil(ticketCount / (gateCount * slotCount)) + 2);
const remaining = new Map();
for (let s = 0; s < slotCount; s++) {
  for (let g = 1; g <= gateCount; g++) {
    remaining.set(`${s}:${g}`, maxPerGate);
  }
}

const groups = buildTicketGroups(ticketIds, links);
const t0 = Date.now();
let placed = 0;
for (const group of groups) {
  let ok = false;
  for (let s = 0; s < slotCount && !ok; s++) {
    for (let g = 1; g <= gateCount && !ok; g++) {
      const key = `${s}:${g}`;
      if ((remaining.get(key) || 0) >= group.length) {
        remaining.set(key, remaining.get(key) - group.length);
        placed += group.length;
        ok = true;
      }
    }
  }
  if (!ok) {
    console.error(`Could not place group of size ${group.length}`);
    process.exit(1);
  }
}
const ms = Date.now() - t0;

console.log(
  JSON.stringify(
    {
      ticketCount,
      gateCount,
      slotCount,
      friendLinks: links.length,
      groups: groups.length,
      placed,
      assignMs: ms,
      note: "In-memory greedy only; real run adds MongoDB round-trips.",
    },
    null,
    2
  )
);
