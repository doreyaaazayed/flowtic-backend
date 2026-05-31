/**
 * Entry gating smoke test: link friend, same gate, face verify.
 * Requires MONGO_URI in backend/.env (no running server needed).
 *
 * Run: node backend/scripts/e2eEntryGatingDemo.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { runSeed } = require("./seedEntryGatingDemo");

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI required in backend/.env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const data = await runSeed();
    if (!data.ok) {
      console.error("=== E2E FAILED ===");
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }
    console.log("=== E2E PASSED ===");
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("=== E2E FAILED ===");
    console.error(e.message || e);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
