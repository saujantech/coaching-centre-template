// Shared helper for sending email via Resend.

const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function sendEmail({ to, subject, html, from }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }

  return res.json();
}

module.exports = { sendEmail };
