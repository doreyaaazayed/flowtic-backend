require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const toList = ["andrewamged962003@gmail.com", "Doreyazayed4@gmail.com"];
const apiKey = process.env.BREVO_API_KEY;
const fromEmail = process.env.EMAIL_FROM || "noreply@flowtic.com";
const fromName = process.env.EMAIL_FROM_NAME || "FlowTic";

if (!apiKey) {
  console.error("BREVO_API_KEY is missing in .env");
  process.exit(1);
}

const body = {
  sender: { email: fromEmail, name: fromName },
  to: toList.map((email) => ({ email })),
  subject: "FlowTic – test email",
  htmlContent: "<p>This is a test email from FlowTic. Brevo is configured correctly.</p>",
  textContent: "This is a test email from FlowTic. Brevo is configured correctly.",
};

console.log("Sending from:", fromEmail, "to:", toList.join(", "));

fetch(BREVO_API_URL, {
  method: "POST",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
    "api-key": apiKey,
  },
  body: JSON.stringify(body),
})
  .then(async (res) => {
    const data = await res.json().catch(() => ({}));
    console.log("Status:", res.status);
    console.log("Response:", JSON.stringify(data, null, 2));
    if (!res.ok) {
      console.error("Brevo error:", data.message || data.code || res.statusText);
      process.exit(1);
    }
    console.log("\nBrevo accepted the email. Check inbox (and spam) at:", toList.join(", "));
  })
  .catch((err) => {
    console.error("Request failed:", err.message);
    process.exit(1);
  });
