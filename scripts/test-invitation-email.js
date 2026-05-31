require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const emailService = require("../services/emailService");

const to = process.argv[2] || "andrewamged962003@gmail.com";

emailService
  .sendEventInvitation(to, {
    guestName: "Test Guest",
    hostNames: "Henry & Laura",
    inviteMessage: "You're invited to attend our wedding",
    eventName: "Test Wedding",
    eventDate: "Saturday, 28 May 2026",
    location: "Cairo, Egypt",
    inviteUrl: "https://localhost:5174/event/test?invite=abc123",
    kind: "wedding",
  })
  .then((r) => {
    console.log("Result:", JSON.stringify(r, null, 2));
    process.exit(r.success ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
