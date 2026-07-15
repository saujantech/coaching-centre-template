// POST /api/send-custom-email
// Sends an ad-hoc email to a parent, built from a saved template whose
// {{placeholders}} the admin dashboard already resolved against a
// specific student and let the owner edit before sending. This function
// only ever sees the final subject/body — placeholder resolution happens
// client-side (see resolveTemplatePlaceholders() in admin.js), since the
// Resend API key is server-side only and the actual send must go through
// here regardless of how the text was produced.
//
// Unlike notify-booking (intentionally public — the anon booking page
// calls it directly), this sends email using the centre's own Resend
// account on the owner's behalf, so it must only be reachable by the
// logged-in owner. We verify the caller's Supabase access token against
// Supabase Auth itself rather than trusting the request body alone.

const { sendEmail } = require("./_email");
const centreConfig = require("../public/centre.config");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    res.status(401).json({ error: "Missing authorization" });
    return;
  }

  try {
    const authCheck = await fetch(`${centreConfig.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: centreConfig.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!authCheck.ok) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Could not verify session" });
    return;
  }

  const { to, subject, body } = req.body || {};

  if (!to || !subject || !body) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // The frontend already blocks opening the Send Email modal when a
  // student has no parent_email, but that's a UI convenience, not a
  // safeguard — this endpoint has to reject a missing/malformed
  // recipient itself in case it's ever called directly.
  if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    res.status(400).json({ error: "Invalid recipient email" });
    return;
  }

  const html = escapeHtml(body).replace(/\n/g, "<br>");

  try {
    await sendEmail({
      to,
      from: centreConfig.fromEmail,
      subject,
      html,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
