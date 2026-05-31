# Brevo email setup

1. **Create a Brevo account**  
   [https://www.brevo.com](https://www.brevo.com) → Sign up (free tier: 300 emails/day).

2. **Get your API key**  
   In Brevo: **SMTP & API** → **API Keys** → Create a new key. Copy it.

3. **Configure `.env`** in the backend root:
   ```env
   BREVO_API_KEY=your_api_key_here
   EMAIL_FROM=noreply@yourdomain.com
   EMAIL_FROM_NAME=FlowTic
   ```
   Use an email you can verify in Brevo (e.g. your Gmail for testing).  
   In Brevo: **Senders & IP** → add and verify your sender email.

4. **Test sending**  
   As an **admin** user, send a POST request:
   ```http
   POST /api/email/test
   Authorization: Bearer <admin_jwt_token>
   Content-Type: application/json

   { "to": "your@email.com" }
   ```
   You should receive a short “FlowTic – test email” message.

5. **Optional**  
   The service is used from controllers (e.g. after booking or resale actions).  
   If `BREVO_API_KEY` is not set, emails are skipped and a warning is logged.
