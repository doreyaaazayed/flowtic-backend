require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const EventInvitation = require("../models/EventInvitation");

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: "EventManagementDB" });
  const rows = await EventInvitation.find().sort({ createdAt: -1 }).limit(10).lean();
  console.log("Recent invitations:", rows.length);
  for (const r of rows) {
    console.log({
      guest: r.guestEmail,
      status: r.status,
      emailError: r.emailError,
      sentAt: r.sentAt,
      createdAt: r.createdAt,
    });
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
