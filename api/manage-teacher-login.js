// POST /api/manage-teacher-login
// Owner-only. Toggles teachers.login_enabled. The first time a teacher's
// login is enabled and they have no auth_user_id yet, this also creates
// their Supabase Auth account and emails them a one-time recovery link
// to set their own password — see the enable=true branch below for why
// that's the mechanism used instead of emailing a temporary password.

const crypto = require("crypto");
const { sendEmail } = require("./_email");
const { supabaseRequest } = require("./_supabase");
const centreConfig = require("../public/centre.config");

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // ---- 1. Caller must have a valid session ----
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    res.status(401).json({ error: "Missing authorization" });
    return;
  }

  try {
    const authCheck = await fetch(`${centreConfig.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: centreConfig.supabaseAnonKey, Authorization: `Bearer ${token}` },
    });
    if (!authCheck.ok) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Could not verify session" });
    return;
  }

  // ---- 2. Caller must be the OWNER, not a teacher ----
  // Calls current_teacher_id() with the CALLER's own token (not
  // service_role), so it's evaluated as this specific session — a
  // non-null result means the caller is a teacher and must be rejected
  // before anything below this point ever runs.
  //
  // This check alone is NOT sufficient, and isn't the real boundary —
  // "teacher can update own record" (schema.sql) is row-scoped, not
  // column-scoped, so without the teachers_protect_login_columns trigger
  // (schema.sql), a teacher's own valid session could PATCH
  // /rest/v1/teachers?id=eq.<their own id> with {"login_enabled": true}
  // or {"auth_user_id": "..."} directly and have it succeed, bypassing
  // this entire file. That trigger, not this check, is what actually
  // closes that path — this endpoint check exists so the app's own
  // intended flow (and its audit trail/email side effects) can't be
  // sidestepped by a teacher calling this endpoint directly instead.
  try {
    const roleCheck = await fetch(`${centreConfig.supabaseUrl}/rest/v1/rpc/current_teacher_id`, {
      method: "POST",
      headers: {
        apikey: centreConfig.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!roleCheck.ok) {
      res.status(403).json({ error: "Could not verify caller role" });
      return;
    }
    const callerTeacherId = await roleCheck.json();
    if (callerTeacherId !== null) {
      res.status(403).json({ error: "Forbidden — owner access required" });
      return;
    }
  } catch {
    res.status(403).json({ error: "Could not verify caller role" });
    return;
  }

  // ---- 3. Validate input ----
  const { teacher_id, enable } = req.body || {};
  if (!teacher_id || typeof enable !== "boolean") {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    if (!enable) {
      await supabaseRequest(`teachers?id=eq.${teacher_id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ login_enabled: false }),
      });
      res.status(200).json({ ok: true });
      return;
    }

    const [teacher] = await supabaseRequest(`teachers?id=eq.${teacher_id}&select=id,full_name,email,auth_user_id`);
    if (!teacher) {
      res.status(404).json({ error: "Teacher not found" });
      return;
    }

    if (teacher.auth_user_id) {
      // Already has a Supabase Auth account (e.g. re-enabling after a
      // previous disable) — just flip the flag back on, no new account
      // or email needed.
      await supabaseRequest(`teachers?id=eq.${teacher_id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ login_enabled: true }),
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (!teacher.email) {
      res.status(400).json({ error: "This teacher has no email on file — add one before enabling login." });
      return;
    }

    const adminHeaders = {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // Genuinely random (not a guessable pattern) so the account is never
    // left with a predictable/empty credential — but this password is
    // never actually shown to the teacher. Supabase Auth has no native
    // "must change password on next login" flag; the mechanism it
    // actually supports for "one-time use, then they set their own" is a
    // recovery link (single-use, and it never requires or reveals this
    // temporary password at all), generated right below.
    const tempPassword = crypto.randomBytes(24).toString("base64url");

    const createRes = await fetch(`${centreConfig.supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: teacher.email, password: tempPassword, email_confirm: true }),
    });
    if (!createRes.ok) throw new Error(`Failed to create auth user: ${await createRes.text()}`);
    const newUser = await createRes.json();

    // redirect_to comes from centre.config.js's siteUrl, not from the
    // incoming request (e.g. req.headers.host) — a request header is
    // caller-supplied and untrustworthy for something this sensitive.
    // siteUrl is a fixed, owner-controlled value, same trust model as
    // every other config value this app reads.
    const redirectTo = `${centreConfig.siteUrl}/admin/index.html`;
    let actionLink;

    // From here until the teacher row is actually linked, a failure
    // would leave newUser as a real Supabase Auth account that
    // teachers.auth_user_id never points to — invisible to the app, and
    // a landmine for any retry (Supabase rejects a second create-user
    // call for the same email with a duplicate-email error, so the
    // retry wouldn't just fix itself). Roll the auth user back on any
    // failure in this span so a retry starts from a clean slate.
    try {
      const linkRes = await fetch(`${centreConfig.supabaseUrl}/auth/v1/admin/generate_link`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ type: "recovery", email: teacher.email, options: { redirect_to: redirectTo } }),
      });
      if (!linkRes.ok) throw new Error(`Failed to generate login link: ${await linkRes.text()}`);
      const linkBody = await linkRes.json();
      actionLink = linkBody.action_link || linkBody.properties?.action_link;
      if (!actionLink) throw new Error("Supabase did not return a recovery link");

      await supabaseRequest(`teachers?id=eq.${teacher_id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ auth_user_id: newUser.id, login_enabled: true }),
      });
    } catch (err) {
      // Best-effort: if even the cleanup delete fails, the original
      // error is still what gets reported — an orphaned account is a
      // less severe outcome than swallowing why this attempt failed.
      await fetch(`${centreConfig.supabaseUrl}/auth/v1/admin/users/${newUser.id}`, {
        method: "DELETE",
        headers: adminHeaders,
      }).catch(() => {});
      throw err;
    }

    // The teacher is already correctly linked and enabled by this point
    // — a failure sending the email is a lesser problem (the owner can
    // retell them or they can use "forgot password" separately) and
    // does not warrant tearing down an otherwise-working account.
    //
    // The email links to admin/confirm-login.html, NOT actionLink
    // directly — automated email-scanner prefetching (Gmail and others
    // silently auto-visiting links in emails) is a well-documented way
    // for a single-use Supabase auth token to get consumed before the
    // real human ever clicks it. actionLink is carried in the URL
    // fragment (#link=...), which is never sent to any server and isn't
    // read by scanners that don't execute JavaScript — the token is only
    // actually spent once a person clicks the button on that page.
    const confirmLoginUrl = `${centreConfig.siteUrl}/admin/confirm-login.html#link=${encodeURIComponent(actionLink)}`;

    await sendEmail({
      to: teacher.email,
      from: centreConfig.fromEmail,
      subject: `Your ${centreConfig.centreName} teacher login`,
      html: `
        <p>Hi ${escapeHtml(teacher.full_name)},</p>
        <p>You now have login access to the ${escapeHtml(centreConfig.centreName)} teacher dashboard.</p>
        <p><a href="${confirmLoginUrl}">Click here to set your password and log in</a></p>
        <p>This link can only be used once. After you've set your password, log in any time at
        <a href="${redirectTo}">${redirectTo}</a> with your email and that password.</p>
      `,
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
