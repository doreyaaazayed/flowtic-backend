/**
 * Email service using Brevo (brevo.com) API.
 * Set BREVO_API_KEY and EMAIL_FROM in .env. Without BREVO_API_KEY, send is no-op.
 */

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

function getConfig() {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || "noreply@flowtic.com";
  const fromName = process.env.EMAIL_FROM_NAME || "FlowTic";
  return { apiKey, fromEmail, fromName };
}

function isEmailConfigured() {
  return Boolean(String(process.env.BREVO_API_KEY || "").trim());
}

/**
 * Send an email via Brevo.
 * @param {string} to - Recipient email
 * @param {string} subject - Subject line
 * @param {string} htmlContent - HTML body (required if no textContent)
 * @param {string} [textContent] - Plain text body (optional)
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function send({ to, subject, htmlContent, textContent }) {
  const { apiKey, fromEmail, fromName } = getConfig();
  if (!apiKey) {
    console.warn("[Email] BREVO_API_KEY not set; skipping send.");
    return { success: false, error: "Email not configured" };
  }
  const body = {
    sender: { email: fromEmail, name: fromName },
    to: [{ email: to }],
    subject,
    htmlContent: htmlContent || (textContent ? textContent.replace(/\n/g, "<br>") : "<p>No content</p>"),
  };
  if (textContent) body.textContent = textContent;

  try {
    const res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[Email] Brevo error:", res.status, data);
      return { success: false, error: data.message || res.statusText };
    }
    return { success: true, messageId: data.messageId };
  } catch (err) {
    console.error("[Email] Send failed:", err.message);
    return { success: false, error: err.message };
  }
}

// --- Convenience builders (you can call send() directly or use these) ---

/** Send OTP for email verification (e.g. sign-up). */
async function sendOTP(to, { otp, username }) {
  const subject = "FlowTic – verify your email";
  const htmlContent = `
    <h2>Verify your email</h2>
    <p>Hi${username ? ` ${username}` : ""},</p>
    <p>Your verification code is:</p>
    <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${otp}</p>
    <p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    <p>— FlowTic</p>
  `;
  return send({ to, subject, htmlContent });
}

async function sendSignupConfirmation(to, { username }) {
  const subject = "Welcome to FlowTic – account verified";
  const htmlContent = `
    <h2>Welcome, ${username}!</h2>
    <p>Your FlowTic account has been verified successfully.</p>
    <p>You can now sign in and explore events, book tickets, and use the resale market.</p>
    <p>Thank you for joining us.</p>
  `;
  return send({ to, subject, htmlContent });
}

async function sendPurchaseConfirmation(to, { bookingId, totalAmount, eventName }) {
  const subject = `Ticket purchase confirmed – ${eventName}`;
  const htmlContent = `
    <h2>Purchase confirmed</h2>
    <p>Thank you for your purchase.</p>
    <p><strong>Event:</strong> ${eventName}</p>
    <p><strong>Booking ID:</strong> ${bookingId}</p>
    <p><strong>Total:</strong> EGP ${Number(totalAmount).toFixed(2)}</p>
    <p>You can view your tickets in your dashboard.</p>
  `;
  return send({ to, subject, htmlContent });
}

async function sendResaleListingSubmitted(to, { eventName, price }) {
  const subject = `Resale listing submitted – ${eventName}`;
  const htmlContent = `
    <h2>Listing submitted</h2>
    <p>Your ticket for <strong>${eventName}</strong> has been submitted for resale at EGP ${Number(price).toFixed(2)}.</p>
    <p>It will appear on the White Market after an admin approves it.</p>
  `;
  return send({ to, subject, htmlContent });
}

async function sendResaleListingApproved(to, { eventName }) {
  const subject = `Your resale listing is live – ${eventName}`;
  const htmlContent = `
    <h2>Listing approved</h2>
    <p>Your listing for <strong>${eventName}</strong> is now live on the White Market. Buyers can request to purchase it.</p>
  `;
  return send({ to, subject, htmlContent });
}

async function sendResalePaymentRequired(to, { eventName, totalAmount, paymentUrl }) {
  const subject = `Complete your resale payment – ${eventName}`;
  const htmlContent = `
    <h2>Payment required</h2>
    <p>Your request to buy a ticket for <strong>${eventName}</strong> is ready for payment.</p>
    <p><strong>Total to pay:</strong> EGP ${Number(totalAmount).toFixed(2)} (ticket + EGP 50 platform fee)</p>
    <p><a href="${paymentUrl}">Open payment page</a></p>
    <p>After you pay, open that page and click <strong>Complete purchase</strong> to transfer the ticket to your account.</p>
  `;
  return send({ to, subject, htmlContent });
}

/** Vendor / F&B partner login credentials after provision. */
async function sendVendorCredentials(to, { name, email, temporaryPassword, eventName, portalUrl }) {
  const subject = "Your FlowTic vendor portal login";
  const loginUrl = portalUrl || process.env.FRONTEND_URL || "http://localhost:5173";
  const vendorUrl = `${loginUrl.replace(/\/$/, "")}/vendor`;
  const htmlContent = `
    <h2>Vendor account created</h2>
    <p>Hi ${name || "there"},</p>
    <p>You have been added as an F&B partner${eventName ? ` for <strong>${eventName}</strong>` : ""} on FlowTic.</p>
    <p><strong>Sign-in email:</strong> ${email}</p>
    <p><strong>Temporary password:</strong> <code>${temporaryPassword}</code></p>
    <p>Sign in at <a href="${vendorUrl}">${vendorUrl}</a> and change your password under Settings.</p>
    <p>— FlowTic</p>
  `;
  const textContent = `Vendor login\nEmail: ${email}\nTemporary password: ${temporaryPassword}\nPortal: ${vendorUrl}`;
  return send({ to, subject, htmlContent, textContent });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wedding / prom / private event invitation email. */
async function sendEventInvitation(to, {
  guestName,
  hostNames,
  inviteMessage,
  eventName,
  eventDate,
  location,
  inviteUrl,
  kind = "wedding",
}) {
  const safe = {
    guestName: escapeHtml(guestName),
    hostNames: escapeHtml(hostNames),
    inviteMessage: escapeHtml(inviteMessage),
    eventName: escapeHtml(eventName),
    eventDate: escapeHtml(eventDate),
    location: escapeHtml(location),
    inviteUrl: String(inviteUrl || "").trim(),
  };

  const subject =
    kind === "wedding"
      ? `You're invited — ${hostNames}`
      : kind === "prom"
        ? `Prom invitation — ${eventName}`
        : `Private invitation — ${eventName}`;

  const headerLabel =
    kind === "wedding" ? "MR & MRS" : kind === "prom" ? "SAVE THE DATE" : "YOU ARE INVITED";

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e8e8e4;">
          <tr>
            <td style="padding:28px 40px 12px;text-align:center;border-bottom:1px solid #eee;">
              <p style="margin:0;font-size:11px;letter-spacing:0.35em;text-transform:uppercase;color:#888;">FlowTic Invitations</p>
            </td>
          </tr>
          <tr>
            <td style="padding:48px 40px 24px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.4em;color:#666;">${headerLabel}</p>
              <p style="margin:0 0 24px;font-size:11px;letter-spacing:0.25em;color:#999;">SAVE • THE • DATE</p>
              <h1 style="margin:0 0 16px;font-size:42px;font-weight:400;font-family:'Brush Script MT','Segoe Script','Lucida Handwriting',cursive;color:#1a1a1a;line-height:1.2;">
                ${safe.hostNames}
              </h1>
              <p style="margin:0 0 8px;font-size:15px;color:#444;font-style:italic;">${safe.inviteMessage}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;color:#888;">When</p>
              <p style="margin:0 0 20px;font-size:18px;color:#1a1a1a;">${safe.eventDate}</p>
              <p style="margin:0 0 6px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;color:#888;">Where</p>
              <p style="margin:0 0 28px;font-size:16px;color:#333;line-height:1.5;">${safe.location}</p>
              <p style="margin:0 0 24px;font-size:14px;color:#555;">Dear ${safe.guestName},</p>
              <p style="margin:0 0 32px;font-size:14px;color:#555;line-height:1.6;">
                We would be honoured to have you join us${kind === "wedding" ? " on our special day" : ""}.
                Tap below to view event details and secure your place.
              </p>
              <a href="${safe.inviteUrl}" style="display:inline-block;padding:14px 36px;background:#1a1a1a;color:#ffffff;text-decoration:none;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;">
                View invitation
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #eee;text-align:center;">
              <p style="margin:0;font-size:11px;color:#aaa;letter-spacing:0.1em;">${safe.eventName} · FlowTic</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textContent = `${inviteMessage}\n\n${hostNames}\n${eventDate}\n${location}\n\nDear ${guestName},\n\nView your invitation: ${inviteUrl}`;
  return send({ to, subject, htmlContent, textContent });
}

/** Gate usher login credentials after provision. */
async function sendUsherCredentials(to, { name, email, temporaryPassword, portalUrl }) {
  const subject = "Your FlowTic usher portal login";
  const loginUrl = portalUrl || process.env.FRONTEND_URL || "http://localhost:5173";
  const usherUrl = `${loginUrl.replace(/\/$/, "")}/usher`;
  const htmlContent = `
    <h2>Usher account created</h2>
    <p>Hi ${name || "there"},</p>
    <p>You have been added as a gate usher on FlowTic. Your organizer assigned you to scan tickets at the event gate.</p>
    <p><strong>Sign-in email:</strong> ${email}</p>
    <p><strong>Temporary password:</strong> <code>${temporaryPassword}</code></p>
    <p>Sign in at <a href="${usherUrl}">${usherUrl}</a> and change your password when prompted.</p>
    <p>— FlowTic</p>
  `;
  const textContent = `Usher login\nEmail: ${email}\nTemporary password: ${temporaryPassword}\nPortal: ${usherUrl}`;
  return send({ to, subject, htmlContent, textContent });
}

module.exports = {
  send,
  isEmailConfigured,
  sendOTP,
  sendSignupConfirmation,
  sendPurchaseConfirmation,
  sendResaleListingSubmitted,
  sendResaleListingApproved,
  sendResalePaymentRequired,
  sendVendorCredentials,
  sendUsherCredentials,
  sendEventInvitation,
};
