#!/usr/bin/env node
/**
 * Prints OAuth provider readiness and redirect URIs to register in Google/Apple consoles.
 * Usage: node scripts/checkOAuthConfig.js   (from backend/)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const {
  isGoogleConfigured,
  isAppleConfigured,
  oauthRedirectUri,
  getFrontendUrl,
  getApiPublicUrl,
} = require("../services/oauthService");

const google = isGoogleConfigured();

console.log("\nFlowTic Google sign-in\n");
console.log("  FRONTEND_URL     ", getFrontendUrl());
console.log("  API_PUBLIC_URL   ", getApiPublicUrl());
console.log("  Google redirect  ", oauthRedirectUri("google"));
console.log("\n  Google sign-in   ", google ? "OK" : "MISSING (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)");

if (!google) {
  console.log("\n  → Follow docs/GOOGLE_SIGNIN.md, then restart the backend.\n");
  process.exit(1);
}

console.log("\n  Google sign-in is ready. Restart the backend if you just changed .env.\n");
