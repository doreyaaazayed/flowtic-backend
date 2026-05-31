const UserPaymentCard = require("../models/UserPaymentCard");

/** Keeps MongoDB indexes aligned with the UserPaymentCard model (safe to run each boot). */
async function syncUserPaymentCardIndexes() {
  const coll = UserPaymentCard.collection;
  // Drop per-user compound index from earlier schema; card numbers are globally unique.
  for (const name of ["userId_1_panFingerprint_1", "encryptedPan_1"]) {
    try {
      await coll.dropIndex(name);
    } catch (_) {
      /* index may not exist */
    }
  }
  await UserPaymentCard.syncIndexes();
}

module.exports = { syncUserPaymentCardIndexes };
