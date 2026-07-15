// POST /api/notify-booking
// Called by the public booking page immediately after a trial_bookings
// insert succeeds. Sends the owner a heads-up email. The booking itself
// is already saved by the time this runs, so a failure here never loses
// data — it only means the owner has to check the dashboard instead.

const { sendEmail } = require("./_email");
const centreConfig = require("../public/centre.config");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { child_name, year_level, subject, preferred_time, parent_name, parent_phone, parent_email, message } = req.body || {};

  if (!child_name || !parent_name) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const html = `
    <h2>New trial booking — ${centreConfig.centreName}</h2>
    <p><strong>Child:</strong> ${escapeHtml(child_name)} (${escapeHtml(year_level)})</p>
    <p><strong>Subject:</strong> ${escapeHtml(Array.isArray(subject) ? subject.join(", ") : subject)}</p>
    <p><strong>Preferred time:</strong> ${escapeHtml(preferred_time || "Not specified")}</p>
    <p><strong>Parent:</strong> ${escapeHtml(parent_name)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(parent_phone || "Not provided")}</p>
    <p><strong>Email:</strong> ${escapeHtml(parent_email || "Not provided")}</p>
    ${message ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>` : ""}
  `;

  try {
    await sendEmail({
      to: centreConfig.ownerNotificationEmail,
      from: centreConfig.fromEmail,
      subject: `New trial booking: ${child_name}`,
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
