// Shared logic for the admin login page and the dashboard. Both pages
// load centre.config.js first, then this file, then call the relevant
// init function.

const SESSION_KEY = "cc_admin_session";

function getSupabaseHeaders(useUserToken = true) {
  const cfg = window.CENTRE_CONFIG;
  const session = getSession();
  return {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${useUserToken && session ? session.access_token : cfg.supabaseAnonKey}`,
    "Content-Type": "application/json",
  };
}

function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function isExpiredJwtError(status, text) {
  return status === 401 && /jwt expired/i.test(text);
}

async function refreshSession() {
  const cfg = window.CENTRE_CONFIG;
  const session = getSession();
  if (!session || !session.refresh_token) return false;

  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: cfg.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!res.ok) return false;

  const body = await res.json();
  setSession(body);
  return true;
}

async function supabaseTable(path, options = {}, isRetry = false) {
  const cfg = window.CENTRE_CONFIG;
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...getSupabaseHeaders(),
      Prefer: options.prefer || "return=representation",
      ...options.headers,
    },
  });
  const text = await res.text();

  if (!res.ok) {
    if (!isRetry && isExpiredJwtError(res.status, text)) {
      const refreshed = await refreshSession();
      if (refreshed) return supabaseTable(path, options, true);

      clearSession();
      alert("Your session expired, please log in again.");
      window.location.href = "/admin/index.html";
      return new Promise(() => {}); // stop further execution while we navigate away
    }
    throw new Error(text);
  }

  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------
// Login page
// ---------------------------------------------------------------
function initLoginPage() {
  const cfg = window.CENTRE_CONFIG;
  document.title = `Admin login — ${cfg.centreName}`;
  document.getElementById("centre-name").textContent = cfg.centreName;
  const logo = document.getElementById("logo");
  logo.addEventListener("error", () => logo.classList.add("hidden"));
  logo.src = cfg.logoUrl;
  logo.alt = cfg.centreName;
  document.documentElement.style.setProperty("--brand", cfg.brandColor);

  if (getSession()) {
    window.location.href = "/admin/dashboard.html";
    return;
  }

  const form = document.getElementById("login-form");
  const btn = document.getElementById("login-btn");
  const status = document.getElementById("login-status");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    status.textContent = "Logging in...";
    status.className = "status-msg";

    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: cfg.supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error_description || body.msg || "Login failed");

      setSession(body);
      window.location.href = "/admin/dashboard.html";
    } catch (err) {
      status.textContent = err.message;
      status.className = "status-msg error";
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------
async function initDashboard() {
  const cfg = window.CENTRE_CONFIG;
  document.title = `Dashboard — ${cfg.centreName}`;
  document.getElementById("centre-name").textContent = cfg.centreName;
  document.documentElement.style.setProperty("--brand", cfg.brandColor);

  if (!getSession()) {
    window.location.href = "/admin/index.html";
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    clearSession();
    window.location.href = "/admin/index.html";
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  await Promise.all([loadBookings(), loadStudents()]);
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
}

// --- Trial bookings ---
async function loadBookings() {
  const tbody = document.getElementById("bookings-body");
  tbody.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;

  try {
    const bookings = await supabaseTable("trial_bookings?select=*&order=created_at.desc");
    if (bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">No bookings yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = bookings
      .map(
        (b) => `
      <tr data-id="${b.id}">
        <td>${new Date(b.created_at).toLocaleDateString()}</td>
        <td>${escapeHtml(b.child_name)} (${escapeHtml(b.year_level)})</td>
        <td>${escapeHtml((b.subject || []).join(", "))}</td>
        <td>${escapeHtml(b.parent_name)}<br/><small>${escapeHtml(b.parent_phone || "")} ${escapeHtml(b.parent_email || "")}</small></td>
        <td>${escapeHtml(b.preferred_time || "-")}</td>
        <td><span class="badge ${b.status}">${b.status}</span></td>
        <td class="row-actions">
          ${b.status === "new" ? `<button class="secondary" data-action="contacted">Mark contacted</button>` : ""}
          ${b.status !== "converted" ? `<button data-action="convert">Convert to student</button>` : ""}
          ${b.status !== "declined" && b.status !== "converted" ? `<button class="secondary" data-action="decline">Decline</button>` : ""}
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => handleBookingAction(btn, bookings));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="error">Failed to load bookings: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function handleBookingAction(btn, bookings) {
  const row = btn.closest("tr");
  const id = row.dataset.id;
  const booking = bookings.find((b) => b.id === id);
  const action = btn.dataset.action;

  btn.disabled = true;
  try {
    if (action === "contacted") {
      await supabaseTable(`trial_bookings?id=eq.${id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ status: "contacted" }),
      });
    } else if (action === "decline") {
      await supabaseTable(`trial_bookings?id=eq.${id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ status: "declined" }),
      });
    } else if (action === "convert") {
      await supabaseTable("students", {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify({
          full_name: booking.child_name,
          year_level: booking.year_level,
          parent_name: booking.parent_name,
          parent_phone: booking.parent_phone,
          parent_email: booking.parent_email,
          status: "active",
        }),
      });
      await supabaseTable(`trial_bookings?id=eq.${id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ status: "converted" }),
      });
      await loadStudents();
    }
    await loadBookings();
  } catch (err) {
    alert(`Action failed: ${err.message}`);
    btn.disabled = false;
  }
}

// --- Students & fees ---
let studentsCache = [];

async function loadStudents() {
  const tbody = document.getElementById("students-body");
  tbody.innerHTML = `<tr><td colspan="5">Loading...</td></tr>`;

  try {
    const students = await supabaseTable("students?select=*,fees(*)&order=full_name.asc");
    studentsCache = students;

    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No students yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = students
      .map((s) => {
        const unpaid = s.fees.filter((f) => f.paid_status === "unpaid").length;
        return `
      <tr data-id="${s.id}">
        <td>${escapeHtml(s.full_name)}</td>
        <td>${escapeHtml(s.year_level)}</td>
        <td>${escapeHtml(s.parent_name)}<br/><small>${escapeHtml(s.parent_phone || "")} ${escapeHtml(s.parent_email || "")}</small></td>
        <td><span class="badge ${s.status}">${s.status}</span> ${unpaid > 0 ? `<span class="badge unpaid">${unpaid} unpaid fee${unpaid > 1 ? "s" : ""}</span>` : ""}</td>
        <td class="row-actions"><button class="secondary" data-action="view">View fees</button></td>
      </tr>`;
      })
      .join("");

    tbody.querySelectorAll("button[data-action='view']").forEach((btn) => {
      btn.addEventListener("click", () => showStudentDetail(btn.closest("tr").dataset.id));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="error">Failed to load students: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function showStudentDetail(studentId) {
  const student = studentsCache.find((s) => s.id === studentId);
  const container = document.getElementById("student-detail");
  container.dataset.studentId = studentId;
  container.classList.remove("hidden");

  const feesRows = student.fees
    .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))
    .map(
      (f) => `
      <tr data-fee-id="${f.id}">
        <td>${escapeHtml(f.term_label)}</td>
        <td>${window.CENTRE_CONFIG.currencySymbol}${f.amount}</td>
        <td>${f.due_date}</td>
        <td><span class="badge ${f.paid_status}">${f.paid_status}</span></td>
        <td>${f.paid_status === "unpaid" ? `<button class="secondary" data-action="mark-paid">Mark paid</button>` : ""}</td>
      </tr>`
    )
    .join("");

  container.innerHTML = `
    <h3>${escapeHtml(student.full_name)} — fees</h3>
    <table>
      <thead><tr><th>Term</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${feesRows || `<tr><td colspan="5">No fees recorded.</td></tr>`}</tbody>
    </table>
    <form id="add-fee-form" class="inline-form">
      <label>Term <input type="text" name="term_label" placeholder="Term 3" required /></label>
      <label>Amount <input type="number" name="amount" step="0.01" min="0" required /></label>
      <label>Due date <input type="date" name="due_date" required /></label>
      <button type="submit">Add fee</button>
    </form>
  `;

  container.querySelectorAll("button[data-action='mark-paid']").forEach((btn) => {
    btn.addEventListener("click", () => markFeePaid(btn.closest("tr").dataset.feeId, studentId));
  });

  document.getElementById("add-fee-form").addEventListener("submit", (e) => addFee(e, studentId));
}

async function markFeePaid(feeId, studentId) {
  try {
    await supabaseTable(`fees?id=eq.${feeId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ paid_status: "paid", paid_date: new Date().toISOString().slice(0, 10) }),
    });
    await loadStudents();
    showStudentDetail(studentId);
  } catch (err) {
    alert(`Failed to update fee: ${err.message}`);
  }
}

async function addFee(e, studentId) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    await supabaseTable("fees", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({
        student_id: studentId,
        term_label: data.term_label,
        amount: data.amount,
        due_date: data.due_date,
      }),
    });
    await loadStudents();
    showStudentDetail(studentId);
  } catch (err) {
    alert(`Failed to add fee: ${err.message}`);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
