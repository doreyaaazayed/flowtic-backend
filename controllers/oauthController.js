const {
  isGoogleConfigured,
  isAppleConfigured,
  startGoogleRedirect,
  startAppleRedirect,
  completeOAuth,
} = require("../services/oauthService");

exports.providers = (req, res) => {
  res.json({
    google: isGoogleConfigured(),
    apple: isAppleConfigured(),
  });
};

exports.googleStart = (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "/dashboard";
  return startGoogleRedirect(res, from, req);
};

exports.googleCallback = async (req, res) => {
  const { code, state, error } = req.query || {};
  if (error) {
    const { redirectToFrontend, decodeState } = require("../services/oauthService");
    const { from, native } = decodeState(state);
    return redirectToFrontend(res, { error: String(error), from, native }, req);
  }
  if (!code) {
    const { redirectToFrontend, decodeState } = require("../services/oauthService");
    const { from, native } = decodeState(state);
    return redirectToFrontend(res, { error: "Missing authorization code", from, native }, req);
  }
  return completeOAuth("google", code, state, res, req);
};

exports.appleStart = (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "/dashboard";
  return startAppleRedirect(res, from, req);
};

exports.appleCallback = async (req, res) => {
  const code = req.body?.code || req.query?.code;
  const state = req.body?.state || req.query?.state;
  const error = req.body?.error || req.query?.error;
  if (error) {
    const { redirectToFrontend, decodeState } = require("../services/oauthService");
    const { from, native } = decodeState(state);
    return redirectToFrontend(res, { error: String(error), from, native }, req);
  }
  if (!code) {
    const { redirectToFrontend, decodeState } = require("../services/oauthService");
    const { from, native } = decodeState(state);
    return redirectToFrontend(res, { error: "Missing authorization code", from, native }, req);
  }
  return completeOAuth("apple", code, state, res, req);
};
