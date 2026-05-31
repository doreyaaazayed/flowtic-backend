const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const loyaltyService = require("./loyaltyService");

function authUserPayload(user) {
  const u = user.toObject ? user.toObject() : user;
  return {
    id: String(u._id),
    username: u.Username,
    firstName: u.FirstName,
    lastName: u.LastName,
    email: u.Email,
    phone: u.Phone,
    nationalId: u.NationalID,
    dateOfBirth: u.dateOfBirth,
    role: u.role,
    roleId: u.RoleID,
    emailVerified: u.emailVerified !== false,
    organizerType: u.organizerType || undefined,
    organizerApproved: u.organizerApproved !== false,
    organizationName: u.organizationName || undefined,
    organizationLocation: u.organizationLocation || undefined,
    loyaltyPointsBalance: u.loyaltyPointsBalance ?? 0,
    loyaltyLifetimePoints: u.loyaltyLifetimePoints ?? 0,
    loyaltyTier: u.loyaltyTier || "bronze",
  };
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRES_IN = "7d";
const ROLE_IDS = { attendee: 1, organizer: 2, admin: 3, vendor: 4 };

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_ISSUER = "https://appleid.apple.com";

function googleCredentials() {
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
  };
}

/** Prefer FRONTEND_URL; else the browser Origin/Referer from the sign-in click (fixes http vs https). */
function resolveFrontendUrl(req) {
  const fromEnv = String(process.env.FRONTEND_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const origin = req?.headers?.origin;
  if (origin && isAllowedDevOrigin(origin)) return origin.replace(/\/$/, "");

  const referer = req?.headers?.referer;
  if (referer) {
    try {
      const u = new URL(referer);
      const base = `${u.protocol}//${u.host}`;
      if (isAllowedDevOrigin(base)) return base;
    } catch {
      /* ignore */
    }
  }

  return "https://localhost:5174";
}

function isAllowedDevOrigin(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    return false;
  } catch {
    return false;
  }
}

function getFrontendUrl(req) {
  return resolveFrontendUrl(req);
}

function getApiPublicUrl() {
  return (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(
    /\/$/,
    "",
  );
}

function oauthRedirectUri(provider) {
  return `${getApiPublicUrl()}/api/auth/${provider}/callback`;
}

function isGoogleConfigured() {
  const { clientId, clientSecret } = googleCredentials();
  return Boolean(clientId && clientSecret);
}

function isAppleConfigured() {
  return Boolean(
    process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY,
  );
}

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(state) {
  if (!state) return { from: "/dashboard", native: false };
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    const from =
      typeof parsed.from === "string" && parsed.from.startsWith("/") ? parsed.from : "/dashboard";
    return { from, native: parsed.native === true };
  } catch {
    return { from: "/dashboard", native: false };
  }
}

const NATIVE_APP_CALLBACK_BASE = "com.flowtic.app://auth/callback";

function redirectToFrontend(res, { token, user, from, error, native }, req) {
  const useNative = native === true;
  if (useNative) {
    if (error) {
      const url = `${NATIVE_APP_CALLBACK_BASE}?error=${encodeURIComponent(error)}&from=${encodeURIComponent(from || "/dashboard")}`;
      return res.redirect(url);
    }
    const userB64 = Buffer.from(JSON.stringify(authUserPayload(user)), "utf8").toString("base64url");
    const url = `${NATIVE_APP_CALLBACK_BASE}#token=${encodeURIComponent(token)}&user=${encodeURIComponent(userB64)}&from=${encodeURIComponent(from || "/dashboard")}`;
    return res.redirect(url);
  }

  const base = resolveFrontendUrl(req).replace(/\/$/, "");
  if (error) {
    const url = `${base}/auth/callback?error=${encodeURIComponent(error)}&from=${encodeURIComponent(from || "/dashboard")}`;
    return res.redirect(url);
  }
  const userB64 = Buffer.from(JSON.stringify(authUserPayload(user)), "utf8").toString("base64url");
  const url = `${base}/auth/callback#token=${encodeURIComponent(token)}&user=${encodeURIComponent(userB64)}&from=${encodeURIComponent(from || "/dashboard")}`;
  return res.redirect(url);
}

function issueToken(user) {
  return jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

async function nextUserId() {
  const lastUser = await User.findOne().sort({ UserID: -1 }).select("UserID").lean();
  return (lastUser?.UserID ?? 0) + 1;
}

async function findOrCreateOAuthUser({ provider, providerId, email, firstName, lastName }) {
  const emailNorm = email ? String(email).toLowerCase().trim() : "";
  const idField = provider === "google" ? "googleId" : "appleId";

  let user =
    (await User.findOne({ [idField]: providerId })) ||
    (emailNorm ? await User.findOne({ Email: emailNorm }) : null);

  if (user) {
    if (!user[idField]) {
      user[idField] = providerId;
    }
    if (provider === "google" || provider === "apple") {
      user.emailVerified = true;
    }
    if (firstName && !user.FirstName) user.FirstName = firstName;
    if (lastName && !user.LastName) user.LastName = lastName;
    await user.save();
    return user;
  }

  if (!emailNorm) {
    throw new Error("No email returned from provider. Allow email sharing and try again.");
  }

  const randomPass = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const username =
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    emailNorm.split("@")[0] ||
    "FlowTic User";

  user = await User.create({
    UserID: await nextUserId(),
    Username: username,
    FirstName: firstName || username,
    LastName: lastName || "",
    Email: emailNorm,
    Password: randomPass,
    RoleID: ROLE_IDS.attendee,
    role: "attendee",
    emailVerified: true,
    organizerApproved: true,
    [idField]: providerId,
  });

  loyaltyService
    .earnPoints(user._id, loyaltyService.WELCOME_POINTS, "welcome", { description: "Welcome bonus" })
    .catch((err) => console.warn("Welcome loyalty points:", err.message));

  return user;
}

async function exchangeGoogleCode(code) {
  const { clientId, clientSecret } = googleCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: oauthRedirectUri("google"),
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(tokenData.error_description || tokenData.error || "Google token exchange failed");
  }

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok) {
    throw new Error(profile.error_description || "Google profile fetch failed");
  }

  return {
    providerId: profile.sub,
    email: profile.email,
    firstName: profile.given_name || "",
    lastName: profile.family_name || "",
  };
}

function appleClientSecret() {
  const privateKey = String(process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: process.env.APPLE_TEAM_ID,
      iat: now,
      exp: now + 60 * 5,
      aud: APPLE_ISSUER,
      sub: process.env.APPLE_CLIENT_ID,
    },
    privateKey,
    {
      algorithm: "ES256",
      keyid: process.env.APPLE_KEY_ID,
    },
  );
}

async function exchangeAppleCode(code) {
  const clientSecret = appleClientSecret();
  const body = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: oauthRedirectUri("apple"),
  });

  const tokenRes = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(tokenData.error_description || tokenData.error || "Apple token exchange failed");
  }

  const idToken = tokenData.id_token;
  if (!idToken) throw new Error("Apple did not return an id_token");

  const parts = idToken.split(".");
  if (parts.length < 2) throw new Error("Invalid Apple id_token");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));

  return {
    providerId: payload.sub,
    email: payload.email,
    firstName: "",
    lastName: "",
  };
}

function startGoogleRedirect(res, from, req) {
  if (!isGoogleConfigured()) {
    console.warn(
      "[OAuth] Google sign-in blocked — GOOGLE_CLIENT_ID/SECRET missing. Restart backend from the backend/ folder (see docs/GOOGLE_SIGNIN.md).",
    );
    return redirectToFrontend(res, { error: "Google sign-in is not configured", from }, req);
  }
  const native = req.query.native === "1" || req.query.native === "true";
  const { clientId } = googleCredentials();
  const state = encodeState({ from: from || "/dashboard", native, n: crypto.randomBytes(8).toString("hex") });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri("google"),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
}

function startAppleRedirect(res, from, req) {
  if (!isAppleConfigured()) {
    return redirectToFrontend(res, { error: "Apple sign-in is not configured", from }, req);
  }
  const state = encodeState({ from: from || "/dashboard", n: crypto.randomBytes(8).toString("hex") });
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: oauthRedirectUri("apple"),
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
  });
  return res.redirect(`${APPLE_AUTH_URL}?${params}`);
}

async function completeOAuth(provider, code, state, res, req) {
  const { from, native } = decodeState(state);
  try {
    const profile =
      provider === "google" ? await exchangeGoogleCode(code) : await exchangeAppleCode(code);
    const user = await findOrCreateOAuthUser({
      provider,
      providerId: profile.providerId,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
    });
    const token = issueToken(user);
    return redirectToFrontend(res, { token, user, from, native }, req);
  } catch (err) {
    console.error(`${provider} OAuth error:`, err);
    return redirectToFrontend(res, {
      error: err.message || `${provider} sign-in failed`,
      from,
      native,
    }, req);
  }
}

module.exports = {
  getFrontendUrl,
  resolveFrontendUrl,
  getApiPublicUrl,
  oauthRedirectUri,
  isGoogleConfigured,
  isAppleConfigured,
  encodeState,
  decodeState,
  redirectToFrontend,
  startGoogleRedirect,
  startAppleRedirect,
  completeOAuth,
};
