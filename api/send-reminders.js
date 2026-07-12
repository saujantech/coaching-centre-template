// GET /api/send-reminders
// Triggered daily by Vercel Cron (see vercel.json). Finds fees that are
// due soon or overdue and haven't had a reminder sent today, emails the
// parent, and logs that the reminder went out.

const { supabaseRequest } = require("./_supabase");
const { sendEmail } = require("./_email");
const centreConfig = require("../public/centre.config");

module.exports = async (req, res) => {
  // Vercel Cron sends a GET request with this header — reject anything else
  // so the endpoint can't be triggered by a random public GET.
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const today = new Date();
  const reminderDays = [
    ...centreConfig.reminderDaysBeforeDue.map((d) => d),
    ...centreConfig.reminderDaysAfterOverdue.map((d) => -d),
  ];

  try {
    const unpaidFees = await supabaseRequest(
      `fees?paid_status=eq.unpaid&select=*,students(full_name,parent_name,parent_email)`
    );

    const sent = [];

    for (const fee of unpaidFees) {
      const dueDate = new Date(fee.due_date);
      const daysUntilDue = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));

      if (!reminderDays.includes(daysUntilDue)) continue;

      const student = fee.students;
      if (!student || !student.parent_email) continue;

      const lastSent = fee.last_reminder_at ? new Date(fee.last_reminder_at) : null;
      const sentToday = lastSent && lastSent.toDateString() === today.toDateString();
      if (sentToday) continue;

      const isOverdue = daysUntilDue < 0;
      const subject = isOverdue
        ? `Overdue fee reminder — ${student.full_name}`
        : `Fee due soon — ${student.full_name}`;

      const html = `
        <p>Hi ${escapeHtml(student.parent_name)},</p>
        <p>This is a reminder that the ${escapeHtml(fee.term_label)} fee of
        ${centreConfig.currencySymbol}${fee.amount} for ${escapeHtml(student.full_name)}
        ${isOverdue ? `was due on ${fee.due_date} and is now overdue` : `is due on ${fee.due_date}`}.</p>
        <p>If you've already paid, please disregard this message.</p>
        <p>Thanks,<br/>${centreConfig.centreName}</p>
      `;

      await sendEmail({
        to: student.parent_email,
        from: centreConfig.fromEmail,
        subject,
        html,
      });

      await supabaseRequest(`fees?id=eq.${fee.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({
          reminders_sent: fee.reminders_sent + 1,
          last_reminder_at: new Date().toISOString(),
        }),
      });

      sent.push(fee.id);
    }

    res.status(200).json({ ok: true, remindersSent: sent.length });
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
