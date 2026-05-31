require("dotenv").config({ path: require("path").join(__dirname, ".env") });

// Public DNS — fixes Atlas SRV lookup failures on some networks (Windows/VPN/ISP).
try {
  require("dns").setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1", "8.8.4.4"]);
} catch (_) {}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
const os = require("os");


const authRoutes = require("./routes/authRoutes");
const eventRoutes = require("./routes/eventRoutes");
const venueRoutes = require("./routes/venueRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const resaleRoutes = require("./routes/resaleRoutes");
const profileRoutes = require("./routes/profileRoutes");
const userRoutes = require("./routes/userRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const emailRoutes = require("./routes/emailRoutes");
const statsRoutes = require("./routes/statsRoutes");
const venueSeatingRoutes = require("./routes/venueSeatingRoutes");
const entryRoutes = require("./routes/entryRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const seatHoldRoutes = require("./routes/seatHoldRoutes");
const foodRoutes = require("./routes/foodRoutes");
const { venueFoodRouter, restaurantFoodRouter } = require("./routes/venueFoodRoutes");
const adminFoodRoutes = require("./routes/adminFoodRoutes");
const organizerVendorRoutes = require("./routes/organizerVendorRoutes");
const organizerUsherRoutes = require("./routes/organizerUsherRoutes");
const organizerInvitationRoutes = require("./routes/organizerInvitationRoutes");
const invitationRoutes = require("./routes/invitationRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const usherRoutes = require("./routes/usherRoutes");
const loyaltyRoutes = require("./routes/loyaltyRoutes");
const { syncUserPaymentCardIndexes } = require("./utils/syncUserPaymentCardIndexes");
const { syncEntryGatingMongoIndexes } = require("./utils/syncEntryGatingMongo");
const { ensureDeliveryMethodsSeeded } = require("./scripts/seedDeliveryMethods");
const { ensurePrivateEventCategories } = require("./scripts/ensurePrivateEventCategories");
const { isGoogleConfigured, oauthRedirectUri, getFrontendUrl } = require("./services/oauthService");

const app = express();

// Middleware (raise body limit so event creation with base64 photo can succeed)
const allow_origins = [
  "http://localhost:5173/",
];

//cors policies
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allow_origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: "15mb" }));

// Event hero images (written by eventImageService on create/update)
app.use("/", (req, res) => {
  res.json({
    msg: "done",
  });
});

app.use(
  "/api/uploads/events",
  express.static(path.join(__dirname, "uploads", "events"), { maxAge: "7d" }),
);
app.use(
  "/api/uploads/venues",
  express.static(path.join(__dirname, "uploads", "venues"), { maxAge: "7d" }),
);
app.use(
  "/api/uploads/profiles",
  express.static(path.join(__dirname, "uploads", "profiles"), { maxAge: "1d" }),
);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/venues", venueRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/resale", resaleRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api", venueSeatingRoutes);
app.use("/api", entryRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/events/:eventId/seat-hold", seatHoldRoutes);
app.use("/api/food", foodRoutes);
app.use("/api/venue", venueFoodRouter);
app.use("/api/restaurant", restaurantFoodRouter);
app.use("/api/admin/food", adminFoodRoutes);
app.use("/api/organizer/vendors", organizerVendorRoutes);
app.use("/api/organizer/ushers", organizerUsherRoutes);
app.use("/api/organizer/invitations", organizerInvitationRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/usher", usherRoutes);
app.use("/api/loyalty", loyaltyRoutes);

// Health check route
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

function getLanIPv4() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return [...new Set(ips)];
}

if (!MONGO_URI) {
  console.error("MONGO_URI is not defined in environment variables");
  process.exit(1);
}

// DB Connection and server start
function startServer() {
  mongoose
    .connect(MONGO_URI, { dbName: "EventManagementDB", serverSelectionTimeoutMS: 10000 })
    .then(async () => {
      console.log("Connected to MongoDB");
      try {
        await syncUserPaymentCardIndexes();
      } catch (syncErr) {
        console.warn("MongoDB index sync:", syncErr?.message || syncErr);
      }
      try {
        await syncEntryGatingMongoIndexes();
      } catch (entrySyncErr) {
        console.warn("Entry gating index sync:", entrySyncErr?.message || entrySyncErr);
      }
      try {
        const result = await ensureDeliveryMethodsSeeded();
        if (result && !result.skipped) {
          console.log(`Delivery methods seeded: created=${result.created}, updated=${result.updated}`);
        }
      } catch (dmErr) {
        console.warn("Delivery method seed:", dmErr?.message || dmErr);
      }
      try {
        const catResult = await ensurePrivateEventCategories();
        if (catResult.created > 0) {
          console.log(`Private event categories seeded: created=${catResult.created}`);
        }
      } catch (catErr) {
        console.warn("Private category seed:", catErr?.message || catErr);
      }
      if (!String(process.env.CARD_ENCRYPTION_KEY || "").trim()) {
        console.warn(
          "[Saved cards] CARD_ENCRYPTION_KEY is not set — add it to backend/.env to enable Profile → My cards (AES-256-GCM encryption)."
        );
      }
      if (!String(process.env.BREVO_API_KEY || "").trim()) {
        console.warn(
          "[Email] BREVO_API_KEY is not set — entry assignment emails are skipped; in-app notifications still work. Set BREVO_API_KEY and EMAIL_FROM in backend/.env."
        );
      }
      if (!isGoogleConfigured()) {
        console.warn(
          "[OAuth] Google sign-in disabled — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env (see docs/GOOGLE_SIGNIN.md). Run: npm run oauth:check"
        );
      } else {
        console.log(`[OAuth] Google sign-in enabled | redirect ${oauthRedirectUri("google")}`);
        if (!process.env.FRONTEND_URL) {
          console.warn(`[OAuth] FRONTEND_URL not set — using default ${getFrontendUrl()} (set https://localhost:5174 if Vite uses SSL)`);
        }
      }
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server is running on http://localhost:${PORT}`);
        for (const ip of getLanIPv4()) {
          console.log(`  iPhone/LAN API: http://${ip}:${PORT}/api/health`);
        }
      });
    })
    .catch((err) => {
      console.error("MongoDB connection error:", err.message);
      if (err.name === "MongooseServerSelectionError") {
        console.error("\n--- Fix: Whitelist your IP in MongoDB Atlas ---");
        console.error("1. Go to https://cloud.mongodb.com → your project → Network Access");
        console.error("2. Click 'Add IP Address' → 'Add Current IP Address' (or use 0.0.0.0/0 for dev)");
        console.error("3. Wait 1–2 minutes, then run 'npm start' again.\n");
      }
      process.exit(1);
    });
}

startServer();
module.exports = app;