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

// Shared by supabaseTable() (/rest/v1/) and the storage helpers below
// (/storage/v1/) — on a 401, refreshes the session once and retries with
// the new access_token before giving up and redirecting to login.
async function authenticatedFetch(url, options = {}, isRetry = false) {
  const res = await fetch(url, options);

  if (!res.ok && res.status === 401 && !isRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const retryOptions = {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${refreshed.access_token}` },
      };
      return authenticatedFetch(url, retryOptions, true);
    }
    redirectToExpiredLogin();
    return new Promise(() => {}); // navigating away — never resolve
  }

  return res;
}

async function supabaseTable(path, options = {}) {
  const cfg = window.CENTRE_CONFIG;
  const res = await authenticatedFetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...getSupabaseHeaders(),
      Prefer: options.prefer || "return=representation",
      ...options.headers,
    },
  });

  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function refreshSession() {
  const cfg = window.CENTRE_CONFIG;
  const session = getSession();
  if (!session || !session.refresh_token) return null;

  try {
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: cfg.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) return null;

    const body = await res.json();
    setSession(body);
    return body;
  } catch {
    return null;
  }
}

function redirectToExpiredLogin() {
  clearSession();
  sessionStorage.setItem("cc_admin_login_message", "Your session expired, please log in again.");
  window.location.href = "/admin/index.html";
}

// ---------------------------------------------------------------
// Storage (student-files bucket — profile photos + documents)
// ---------------------------------------------------------------
// The bucket is private. profile_photo_url / file_url columns store the
// object's *path* within the bucket, not a usable URL — every view/
// download goes through getSignedFileUrl() to mint a fresh, time-limited
// link via the Storage API, generated on demand rather than persisted.
const STORAGE_BUCKET = "student-files";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — matches the bucket's own file_size_limit
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const SIGNED_URL_EXPIRY_SECONDS = 600; // 10 minutes

function validateFile(file, allowedTypes) {
  if (!allowedTypes.includes(file.type)) {
    return `"${file.name}" isn't an allowed file type.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `"${file.name}" is larger than 5MB.`;
  }
  return null;
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

// x-upsert overwrites any existing object at the same path — used for
// profile photos so re-uploading replaces the old one instead of
// accumulating orphaned files.
async function storageUpload(path, file, { upsert = false } = {}) {
  const cfg = window.CENTRE_CONFIG;
  const session = getSession();
  const headers = {
    apikey: cfg.supabaseAnonKey,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": file.type,
  };
  if (upsert) headers["x-upsert"] = "true";

  const res = await authenticatedFetch(`${cfg.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers,
    body: file,
  });
  if (!res.ok) throw new Error(await res.text());
  return path;
}

async function storageDelete(path) {
  const cfg = window.CENTRE_CONFIG;
  const session = getSession();
  const res = await authenticatedFetch(`${cfg.supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "DELETE",
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
}

async function getSignedFileUrl(path) {
  const cfg = window.CENTRE_CONFIG;
  const session = getSession();
  const res = await authenticatedFetch(`${cfg.supabaseUrl}/storage/v1/object/sign/${STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRY_SECONDS }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  // data.signedURL is relative to the storage service root (it omits
  // /storage/v1), not to cfg.supabaseUrl directly — prepending just the
  // bare domain dropped that segment and produced a malformed URL.
  return `${cfg.supabaseUrl}/storage/v1${data.signedURL}`;
}

// ---------------------------------------------------------------
// Shared modal component
// ---------------------------------------------------------------
function openModal(contentHtml, { wide = false } = {}) {
  closeModal();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true">
      <button type="button" class="modal-close" aria-label="Close">&times;</button>
      <div class="modal-body">${contentHtml}</div>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.body.classList.add("modal-open");

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  backdrop.querySelector(".modal-close").addEventListener("click", closeModal);
  document.addEventListener("keydown", handleModalEscape);

  return backdrop.querySelector(".modal-body");
}

function closeModal() {
  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop) backdrop.remove();
  document.body.classList.remove("modal-open");
  document.removeEventListener("keydown", handleModalEscape);
}

function handleModalEscape(e) {
  if (e.key === "Escape") closeModal();
}

// ---------------------------------------------------------------
// Login page
// ---------------------------------------------------------------
function initLoginPage() {
  const cfg = window.CENTRE_CONFIG;
  document.title = `Admin login — ${cfg.centreName}`;
  document.getElementById("centre-name").textContent = cfg.centreName;
  const logo = document.getElementById("logo");
  logo.onerror = () => { logo.style.display = "none"; };
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

  const expiredMessage = sessionStorage.getItem("cc_admin_login_message");
  if (expiredMessage) {
    sessionStorage.removeItem("cc_admin_login_message");
    status.textContent = expiredMessage;
    status.className = "status-msg error";
  }

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

  document.getElementById("add-student-btn").addEventListener("click", showAddStudentModal);

  document.getElementById("student-search").addEventListener("input", (e) => {
    studentSearchTerm = e.target.value;
    renderStudents();
  });

  document.getElementById("student-status-filter").addEventListener("click", (e) => {
    const btn = e.target.closest(".status-tab");
    if (!btn) return;
    studentStatusFilter = btn.dataset.status;
    // Scoped to this filter bar only — .status-tab is shared with the
    // Teachers tab's own status filter now, so a document-wide selector
    // here would also (cosmetically, harmlessly, but wrongly) toggle
    // "active" on that unrelated group's buttons.
    e.currentTarget.querySelectorAll(".status-tab").forEach((b) => b.classList.toggle("active", b === btn));
    renderStudents();
  });

  const yearFilterSelect = document.getElementById("student-year-filter");
  cfg.yearLevels.forEach((y) => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearFilterSelect.appendChild(opt);
  });
  yearFilterSelect.addEventListener("change", (e) => {
    studentYearFilter = e.target.value;
    renderStudents();
  });

  document.querySelectorAll(".sort-header").forEach((btn) => {
    btn.addEventListener("click", () => {
      const column = btn.dataset.sort;
      if (studentSortColumn === column) {
        studentSortDirection = studentSortDirection === "asc" ? "desc" : "asc";
      } else {
        studentSortColumn = column;
        studentSortDirection = "asc";
      }
      updateSortHeaderIndicators();
      renderStudents();
    });
  });
  updateSortHeaderIndicators();

  document.getElementById("add-class-btn").addEventListener("click", showAddClassModal);

  document.getElementById("add-teacher-btn").addEventListener("click", showAddTeacherModal);

  document.getElementById("teacher-search").addEventListener("input", (e) => {
    teacherSearchTerm = e.target.value;
    renderTeachers();
  });

  document.getElementById("teacher-status-filter").addEventListener("click", (e) => {
    const btn = e.target.closest(".status-tab");
    if (!btn) return;
    teacherStatusFilter = btn.dataset.status;
    e.currentTarget.querySelectorAll(".status-tab").forEach((b) => b.classList.toggle("active", b === btn));
    renderTeachers();
  });

  // Lets "back" links from student.html / class.html / teacher.html land
  // on the tab they came from, instead of always resetting to the
  // default (Students) tab.
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  if (requestedTab === "students" || requestedTab === "classes" || requestedTab === "teachers" || requestedTab === "bookings") {
    switchTab(requestedTab);
  }

  await Promise.all([loadBookings(), loadStudents(), loadClasses(), loadTeachers()]);
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
}

// Jumps from a converted booking's "View Student" button straight to that
// student's profile page — the one way into a student's full record.
function viewStudentFromBooking(studentId) {
  window.location.href = `/admin/student.html?id=${studentId}`;
}

// ---------------------------------------------------------------
// Student profile page (student.html)
// ---------------------------------------------------------------
let currentStudent = null;

async function initStudentPage() {
  const cfg = window.CENTRE_CONFIG;
  document.documentElement.style.setProperty("--brand", cfg.brandColor);
  document.getElementById("centre-name").textContent = cfg.centreName;

  // Print-only masthead (see @media print in admin.css) — invisible on
  // screen, shown only when "Download PDF" triggers window.print(), so
  // the printed page reads as an official document with no dashboard
  // chrome.
  document.getElementById("print-centre-name").textContent = cfg.centreName;
  const printLogo = document.getElementById("print-logo");
  printLogo.onerror = () => { printLogo.style.display = "none"; };
  printLogo.src = cfg.logoUrl;
  printLogo.alt = cfg.centreName;

  document.getElementById("download-pdf-btn").addEventListener("click", () => window.print());

  if (!getSession()) {
    window.location.href = "/admin/index.html";
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    clearSession();
    window.location.href = "/admin/index.html";
  });

  const studentId = new URLSearchParams(window.location.search).get("id");
  if (!studentId) {
    document.getElementById("student-profile-header").innerHTML = `<p class="error">No student specified.</p>`;
    return;
  }

  document.getElementById("edit-details-btn").addEventListener("click", () => {
    showStudentFormModal(currentStudent, () => loadStudentProfile(studentId));
  });

  document.getElementById("enroll-class-btn").addEventListener("click", showEnrollClassModal);

  document.getElementById("add-fee-form").addEventListener("submit", addFee);
  document.getElementById("document-input").addEventListener("change", (e) => handleDocumentUpload(e, "student"));

  await loadStudentProfile(studentId);
}

async function loadStudentProfile(studentId) {
  const header = document.getElementById("student-profile-header");

  try {
    const [student] = await supabaseTable(
      `students?id=eq.${studentId}&select=*,fees(*),documents:student_documents(*),class_enrollments(*,classes(*)),attendance_records(*)`
    );

    if (!student) {
      header.innerHTML = `<p class="error">Student not found.</p>`;
      return;
    }

    currentStudent = student;
    document.title = `${student.full_name} — ${window.CENTRE_CONFIG.centreName}`;

    renderProfileHeader();
    renderStudentClassesSection();
    renderStudentAttendanceHistory();
    renderFeesSection();
    renderDocumentList("student");
    await refreshProfilePhotoAvatar("profile-photo-avatar", "student");
  } catch (err) {
    header.innerHTML = `<p class="error">Failed to load student: ${escapeHtml(err.message)}</p>`;
  }
}

function renderProfileHeader() {
  const student = currentStudent;

  document.getElementById("student-name").textContent = student.full_name;

  document.getElementById("student-year-badge").textContent = student.year_level;

  const statusBadge = document.getElementById("student-status-badge");
  statusBadge.textContent = titleCase(student.status);
  statusBadge.className = `badge ${student.status}`;

  document.getElementById("student-parent-info").innerHTML = `
    ${escapeHtml(student.parent_name)}<br/>
    <small>${escapeHtml(student.parent_phone || "")} ${escapeHtml(student.parent_email || "")}</small>
  `;
}

function renderFeesSection() {
  const student = currentStudent;
  const tbody = document.getElementById("fees-body");

  const feesRows = student.fees
    .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))
    .map(
      (f) => `
      <tr data-fee-id="${f.id}">
        <td>${escapeHtml(titleCaseWords(f.term_label))}</td>
        <td>${window.CENTRE_CONFIG.currencySymbol}${f.amount}</td>
        <td>${escapeHtml(formatDate(f.due_date))}</td>
        <td><span class="badge ${f.paid_status}">${escapeHtml(titleCase(f.paid_status))}</span></td>
        <td>${f.payment_method ? escapeHtml(f.payment_method) : "-"}</td>
        <td>${f.notes ? escapeHtml(f.notes) : "-"}</td>
        <td class="row-actions">
          <a href="/admin/fee-document.html?fee_id=${f.id}&type=invoice" target="_blank" rel="noopener">Invoice</a>
          ${parseFloat(f.amount_paid || 0) > 0 ? `<a href="/admin/fee-document.html?fee_id=${f.id}&type=receipt" target="_blank" rel="noopener">Receipt</a>` : ""}
        </td>
        <td>${f.paid_status !== "paid" ? `<button class="secondary" data-action="record-payment">Record Payment</button>` : ""}</td>
      </tr>`
    )
    .join("");

  tbody.innerHTML = feesRows || `<tr><td colspan="8">No fees recorded.</td></tr>`;

  tbody.querySelectorAll("button[data-action='record-payment']").forEach((btn) => {
    btn.addEventListener("click", () => showRecordPaymentModal(btn.closest("tr").dataset.feeId));
  });
}

// ---------------------------------------------------------------
// Fee document page (fee-document.html — printable invoice/receipt)
// ---------------------------------------------------------------
async function initFeeDocumentPage() {
  const cfg = window.CENTRE_CONFIG;
  document.documentElement.style.setProperty("--brand", cfg.brandColor);

  if (!getSession()) {
    window.location.href = "/admin/index.html";
    return;
  }

  document.getElementById("print-btn").addEventListener("click", () => window.print());

  const logo = document.getElementById("doc-logo");
  logo.onerror = () => { logo.style.display = "none"; };
  logo.src = cfg.logoUrl;
  logo.alt = cfg.centreName;
  document.getElementById("doc-centre-name").textContent = cfg.centreName;

  const params = new URLSearchParams(window.location.search);
  const feeId = params.get("fee_id");
  const type = params.get("type") === "receipt" ? "receipt" : "invoice";
  const docBody = document.getElementById("doc-body");

  if (!feeId) {
    document.getElementById("doc-title").textContent = "Error";
    docBody.innerHTML = `<p class="error">No fee specified.</p>`;
    return;
  }

  try {
    const [fee] = await supabaseTable(
      `fees?id=eq.${feeId}&select=*,students(id,full_name,parent_name,parent_email,parent_phone)`
    );

    if (!fee) {
      document.getElementById("doc-title").textContent = "Error";
      docBody.innerHTML = `<p class="error">Fee not found.</p>`;
      return;
    }

    document.getElementById("back-link").href = `/admin/student.html?id=${fee.students.id}`;

    if (type === "receipt") {
      renderFeeReceipt(fee);
    } else {
      renderFeeInvoice(fee);
    }
  } catch (err) {
    document.getElementById("doc-title").textContent = "Error";
    docBody.innerHTML = `<p class="error">Failed to load fee: ${escapeHtml(err.message)}</p>`;
  }
}

// Available for a fee in any paid_status — unlike the receipt, an invoice
// is a request for payment, not a record of one, so it always makes sense.
function renderFeeInvoice(fee) {
  const cfg = window.CENTRE_CONFIG;
  document.title = `Invoice - ${fee.students.full_name} - ${cfg.centreName}`;
  document.getElementById("doc-title").textContent = "Invoice";

  const amountOwed = (parseFloat(fee.amount) - parseFloat(fee.amount_paid || 0)).toFixed(2);
  const balanceLine =
    fee.paid_status === "partial"
      ? `<p><strong>Remaining balance:</strong> ${cfg.currencySymbol}${amountOwed} (of ${cfg.currencySymbol}${fee.amount} total)</p>`
      : "";

  document.getElementById("doc-body").innerHTML = `
    <dl class="fee-document-details">
      <div><dt>Student</dt><dd>${escapeHtml(fee.students.full_name)}</dd></div>
      <div><dt>Parent</dt><dd>${escapeHtml(fee.students.parent_name)}</dd></div>
      <div><dt>Term</dt><dd>${escapeHtml(titleCaseWords(fee.term_label))}</dd></div>
      <div><dt>Amount</dt><dd>${cfg.currencySymbol}${fee.amount}</dd></div>
      <div><dt>Due date</dt><dd>${escapeHtml(formatDate(fee.due_date))}</dd></div>
      <div><dt>Status</dt><dd><span class="badge ${fee.paid_status}">${escapeHtml(titleCase(fee.paid_status))}</span></dd></div>
    </dl>
    ${balanceLine}
  `;
}

function renderFeeReceipt(fee) {
  const cfg = window.CENTRE_CONFIG;
  document.title = `Receipt - ${fee.students.full_name} - ${cfg.centreName}`;

  const amountPaid = parseFloat(fee.amount_paid || 0);

  // Defensive: the access point on student.html only shows the Receipt
  // link once amount_paid > 0, but this page can still be reached
  // directly by URL — don't render a nonsensical "receipt" for $0.
  if (amountPaid <= 0) {
    document.getElementById("doc-title").textContent = "Receipt";
    document.getElementById("doc-body").innerHTML = `<p class="text-muted">No payment has been recorded for this fee yet.</p>`;
    return;
  }

  const isPartial = fee.paid_status === "partial";
  document.getElementById("doc-title").textContent = isPartial ? "Partial Payment Receipt" : "Receipt";

  const remaining = (parseFloat(fee.amount) - amountPaid).toFixed(2);
  const balanceLine = isPartial
    ? `<p><strong>Remaining balance:</strong> ${cfg.currencySymbol}${remaining} (of ${cfg.currencySymbol}${fee.amount} total)</p>`
    : "";
  const notesRow = fee.notes ? `<div><dt>Notes</dt><dd>${escapeHtml(fee.notes)}</dd></div>` : "";

  document.getElementById("doc-body").innerHTML = `
    <dl class="fee-document-details">
      <div><dt>Student</dt><dd>${escapeHtml(fee.students.full_name)}</dd></div>
      <div><dt>Parent</dt><dd>${escapeHtml(fee.students.parent_name)}</dd></div>
      <div><dt>Term</dt><dd>${escapeHtml(titleCaseWords(fee.term_label))}</dd></div>
      <div><dt>Amount paid</dt><dd>${cfg.currencySymbol}${amountPaid.toFixed(2)}</dd></div>
      <div><dt>Payment method</dt><dd>${fee.payment_method ? escapeHtml(fee.payment_method) : "-"}</dd></div>
      <div><dt>Paid date</dt><dd>${fee.paid_date ? escapeHtml(formatDate(fee.paid_date)) : "-"}</dd></div>
      ${notesRow}
    </dl>
    ${balanceLine}
  `;
}

// Renders the "Classes" section on the student profile page — which
// classes this student is actively enrolled in, each linking to that
// class's own roster page.
function renderStudentClassesSection() {
  const list = document.getElementById("student-class-list");
  const totalEl = document.getElementById("attendance-summary-total");
  const enrollments = (currentStudent.class_enrollments || []).filter((e) => e.status === "active");
  const allAttendance = currentStudent.attendance_records || [];

  totalEl.textContent = `${allAttendance.length} session${allAttendance.length === 1 ? "" : "s"} marked in total.`;

  if (enrollments.length === 0) {
    list.innerHTML = `<li class="document-list-empty">Not enrolled in any classes.</li>`;
    return;
  }

  list.innerHTML = enrollments
    .map((e) => {
      const classAttendance = allAttendance.filter((r) => r.class_id === e.classes.id);
      const present = classAttendance.filter((r) => r.status === "present").length;
      const absent = classAttendance.filter((r) => r.status === "absent").length;
      const late = classAttendance.filter((r) => r.status === "late").length;
      const breakdown =
        classAttendance.length > 0
          ? `${classAttendance.length} session${classAttendance.length === 1 ? "" : "s"} - ${present} present, ${absent} absent, ${late} late`
          : "No sessions marked yet.";

      return `
      <li>
        <a href="/admin/class.html?id=${e.classes.id}">
          <span class="document-name">${escapeHtml(classDisplayName(e.classes))}</span>
          <small>${escapeHtml(formatDays(e.classes.day_of_week))}, ${formatTimeRange(e.classes.start_time, e.classes.end_time)}</small>
          <small>${escapeHtml(breakdown)}</small>
        </a>
      </li>`;
    })
    .join("");
}

// The reverse direction of class.html's "Enroll Student": picking a class
// for this fixed student, instead of a student for a fixed class. Reuses
// assignEntityToClass() rather than duplicating the enroll/reactivate logic.
async function showEnrollClassModal() {
  const modalBody = openModal(`
    <h3>Enroll in Class</h3>
    <label>Search classes <input type="text" id="enroll-class-search" placeholder="Search by subject or class name" /></label>
    <ul id="enroll-class-candidate-list" class="document-list"></ul>
    <p id="enroll-class-status" class="status-msg"></p>
    <div class="dialog-actions">
      <button type="button" class="secondary" id="enroll-class-cancel">Close</button>
    </div>
  `);

  modalBody.querySelector("#enroll-class-cancel").addEventListener("click", closeModal);

  const listEl = modalBody.querySelector("#enroll-class-candidate-list");
  const searchInput = modalBody.querySelector("#enroll-class-search");
  const status = modalBody.querySelector("#enroll-class-status");

  let allClasses = [];
  const activeEnrolledClassIds = new Set(
    (currentStudent.class_enrollments || []).filter((e) => e.status === "active").map((e) => e.classes.id)
  );

  function renderCandidates() {
    const term = searchInput.value.trim().toLowerCase();
    const candidates = allClasses.filter(
      (c) => !activeEnrolledClassIds.has(c.id) && (!term || classDisplayName(c).toLowerCase().includes(term))
    );

    if (candidates.length === 0) {
      listEl.innerHTML = `<li class="document-list-empty">No matching classes.</li>`;
      return;
    }

    listEl.innerHTML = candidates
      .map((c) => {
        const enrolledCount = (c.class_enrollments || []).filter((e) => e.status === "active").length;
        const enrolledText = c.capacity ? `${enrolledCount} / ${c.capacity} enrolled` : `${enrolledCount} enrolled`;
        return `
        <li data-class-id="${c.id}">
          <div class="document-info">
            <span class="document-name">${escapeHtml(classDisplayName(c))}</span>
            <small>${escapeHtml(formatDays(c.day_of_week))}, ${formatTimeRange(c.start_time, c.end_time)} - ${escapeHtml(enrolledText)}</small>
          </div>
          <div class="document-actions">
            <button type="button" data-action="enroll">Enroll</button>
          </div>
        </li>`;
      })
      .join("");

    listEl.querySelectorAll("button[data-action='enroll']").forEach((btn) => {
      const classId = btn.closest("li").dataset.classId;
      btn.addEventListener("click", () => {
        const cls = allClasses.find((c) => c.id === classId);
        assignEntityToClass(cls, "student", currentStudent.id, status, () => loadStudentProfile(currentStudent.id));
      });
    });
  }

  searchInput.addEventListener("input", renderCandidates);

  try {
    allClasses = await supabaseTable("classes?select=*,class_enrollments(id,status,student_id)");
    renderCandidates();
  } catch (err) {
    listEl.innerHTML = `<li class="document-list-empty">Failed to load classes: ${escapeHtml(err.message)}</li>`;
  }
}

// Full chronological attendance log for this student, across every class
// they've ever been marked in — supplements the aggregate counts above
// with the actual record list, newest first.
function renderStudentAttendanceHistory() {
  const tbody = document.getElementById("attendance-history-body");
  const classById = {};
  (currentStudent.class_enrollments || []).forEach((e) => {
    classById[e.classes.id] = e.classes;
  });

  const records = [...(currentStudent.attendance_records || [])].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No attendance recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = records
    .map((r) => {
      const cls = classById[r.class_id];
      return `
      <tr>
        <td>${escapeHtml(formatDate(r.date))}</td>
        <td>${cls ? escapeHtml(classDisplayName(cls)) : "-"}</td>
        <td><span class="badge ${r.status}">${escapeHtml(titleCase(r.status))}</span></td>
        <td>${r.notes ? escapeHtml(r.notes) : "-"}</td>
      </tr>`;
    })
    .join("");
}

// ---------------------------------------------------------------
// Classes (dashboard tab + class.html profile page)
// ---------------------------------------------------------------
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_ABBREVIATIONS = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

function formatTimeRange(startTime, endTime) {
  return `${formatTimeString(startTime.slice(0, 5))} - ${formatTimeString(endTime.slice(0, 5))}`;
}

// classes.day_of_week is an array (a class can run on multiple days) —
// this renders it as a short, readable list, e.g. "Tue, Thu".
function formatDays(days) {
  return (days || []).map((d) => WEEKDAY_ABBREVIATIONS[d] || d).join(", ");
}

// class_name is an optional custom label — fall back to subject so a
// class never displays blank when one hasn't been set.
function classDisplayName(cls) {
  return cls.class_name || cls.subject;
}

// A class's day_of_week can hold several days — sort by the earliest one.
function earliestWeekdayIndex(days) {
  return Math.min(...(days || []).map((d) => WEEKDAYS.indexOf(d)));
}

// --- Dashboard: Classes tab ---
let classesCache = [];

async function loadClasses() {
  const tbody = document.getElementById("classes-body");
  tbody.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;

  try {
    classesCache = await supabaseTable(
      "classes?select=*,class_enrollments(id,status),class_teachers(status,teachers(full_name))"
    );
    renderClasses();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="error">Failed to load classes: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderClasses() {
  const tbody = document.getElementById("classes-body");

  if (classesCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">No classes yet.</td></tr>`;
    return;
  }

  const sorted = [...classesCache].sort((a, b) => {
    const dayDiff = earliestWeekdayIndex(a.day_of_week) - earliestWeekdayIndex(b.day_of_week);
    return dayDiff !== 0 ? dayDiff : a.start_time.localeCompare(b.start_time);
  });

  tbody.innerHTML = sorted
    .map((c) => {
      const enrolledCount = (c.class_enrollments || []).filter((e) => e.status === "active").length;
      const enrolledText = c.capacity ? `${enrolledCount} / ${c.capacity}` : `${enrolledCount}`;
      const teacherNames = (c.class_teachers || [])
        .filter((a) => a.status === "active")
        .map((a) => a.teachers.full_name)
        .join(", ");
      return `
      <tr data-id="${c.id}">
        <td><a href="/admin/class.html?id=${c.id}">${escapeHtml(classDisplayName(c))}</a></td>
        <td>${escapeHtml(formatDays(c.day_of_week))}</td>
        <td>${formatTimeRange(c.start_time, c.end_time)}</td>
        <td>${c.year_level ? escapeHtml(c.year_level) : "-"}</td>
        <td>${teacherNames ? escapeHtml(teacherNames) : "No teacher assigned"}</td>
        <td>${escapeHtml(enrolledText)}</td>
        <td><span class="badge ${c.status}">${escapeHtml(titleCase(c.status))}</span></td>
      </tr>`;
    })
    .join("");
}

async function showAddClassModal() {
  const cfg = window.CENTRE_CONFIG;
  const subjectOptions =
    cfg.subjects.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("") +
    `<option value="__other__">Other</option>`;
  const yearOptions =
    `<option value="">Any year</option>` +
    cfg.yearLevels.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
  const dayCheckboxesHtml = WEEKDAYS.map(
    (d, i) => `<label class="checkbox-label"><input type="checkbox" name="day_of_week" id="class-day-${i}" value="${d}" /> ${d}</label>`
  ).join("");

  // Active teachers are fetched before the modal opens (rather than inside
  // it, like showEnrollStudentModal/showAssignTeacherModal do) since this
  // is an add-only form with a single "Add Class" submit — there's no
  // benefit to a loading flicker inside an otherwise-static checkbox list.
  let teachers = [];
  try {
    teachers = await supabaseTable("teachers?status=eq.active&select=id,full_name&order=full_name.asc");
  } catch (err) {
    teachers = [];
  }
  const teacherCheckboxesHtml =
    teachers.length > 0
      ? teachers
          .map(
            (t) =>
              `<label class="checkbox-label"><input type="checkbox" name="teacher_ids" value="${t.id}" /> ${escapeHtml(t.full_name)}</label>`
          )
          .join("")
      : `<p class="text-muted">No active teachers yet.</p>`;

  const modalBody = openModal(`
    <h3>Add Class</h3>
    <form id="class-form" novalidate>
      <label>
        Subject
        <select name="subject" id="class-subject-select" required>${subjectOptions}</select>
      </label>
      <label id="class-subject-other-label" class="hidden">
        Other subject
        <input type="text" name="subject_other" placeholder="Enter subject name" />
      </label>
      <label>Class name <input type="text" name="class_name" placeholder="e.g. Year 8 Maths - Advanced (optional)" /></label>
      <fieldset>
        <legend>Days</legend>
        <div class="checkbox-group class-day-checkboxes">${dayCheckboxesHtml}</div>
      </fieldset>
      <label>
        Start time
        ${timePickerHtml("class-start-time-picker")}
      </label>
      <label>
        End time
        ${timePickerHtml("class-end-time-picker")}
      </label>
      <label>Year level <select name="year_level">${yearOptions}</select></label>
      <label>Capacity <input type="number" name="capacity" min="1" placeholder="Optional" /></label>
      <fieldset>
        <legend>Teachers</legend>
        <div class="checkbox-group">${teacherCheckboxesHtml}</div>
      </fieldset>
      <label>Notes <textarea name="notes" rows="3" placeholder="Optional"></textarea></label>
      <p id="class-form-status" class="status-msg"></p>
      <div class="dialog-actions">
        <button type="button" class="secondary" id="class-form-cancel">Cancel</button>
        <button type="submit">Add Class</button>
      </div>
    </form>
  `);

  const startTimePicker = modalBody.querySelector("#class-start-time-picker");
  const endTimePicker = modalBody.querySelector("#class-end-time-picker");
  setTimePickerValue(startTimePicker, "09:00");
  setTimePickerValue(endTimePicker, "10:00");

  modalBody.querySelector("#class-form-cancel").addEventListener("click", closeModal);

  const subjectSelect = modalBody.querySelector("#class-subject-select");
  const subjectOtherLabel = modalBody.querySelector("#class-subject-other-label");
  const subjectOtherInput = subjectOtherLabel.querySelector("input");
  subjectSelect.addEventListener("change", () => {
    const isOther = subjectSelect.value === "__other__";
    subjectOtherLabel.classList.toggle("hidden", !isOther);
    subjectOtherInput.required = isOther;
  });

  modalBody.querySelector("#class-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector("button[type='submit']");
    const status = modalBody.querySelector("#class-form-status");
    const data = Object.fromEntries(new FormData(form).entries());
    const selectedDays = new FormData(form).getAll("day_of_week");
    const selectedTeacherIds = new FormData(form).getAll("teacher_ids");
    const startTime = getTimePickerValue(startTimePicker);
    const endTime = getTimePickerValue(endTimePicker);
    const subject = data.subject === "__other__" ? data.subject_other.trim() : data.subject;

    if (data.subject === "__other__" && !subject) {
      status.textContent = "Please enter a subject.";
      status.className = "status-msg error";
      return;
    }

    if (selectedDays.length === 0) {
      status.textContent = "Please select at least one day.";
      status.className = "status-msg error";
      return;
    }

    if (endTime <= startTime) {
      status.textContent = "End time must be after start time.";
      status.className = "status-msg error";
      return;
    }

    submitBtn.disabled = true;
    status.textContent = "Saving...";
    status.className = "status-msg";

    try {
      const [newClass] = await supabaseTable("classes", {
        method: "POST",
        prefer: "return=representation",
        body: JSON.stringify({
          subject,
          class_name: data.class_name ? data.class_name.trim() : null,
          day_of_week: selectedDays,
          start_time: startTime,
          end_time: endTime,
          year_level: data.year_level || null,
          capacity: data.capacity ? parseInt(data.capacity, 10) : null,
          notes: data.notes ? data.notes.trim() : null,
        }),
      });

      if (selectedTeacherIds.length > 0) {
        await Promise.all(
          selectedTeacherIds.map((teacherId) =>
            supabaseTable("class_teachers", {
              method: "POST",
              prefer: "return=minimal",
              body: JSON.stringify({ class_id: newClass.id, teacher_id: teacherId, status: "active" }),
            })
          )
        );
      }

      closeModal();
      await loadClasses();
    } catch (err) {
      status.textContent = `Failed to add class: ${err.message}`;
      status.className = "status-msg error";
      submitBtn.disabled = false;
    }
  });
}

// --- class.html profile page ---
let currentClass = null;

async function initClassPage() {
  const cfg = window.CENTRE_CONFIG;
  document.documentElement.style.setProperty("--brand", cfg.brandColor);
  document.getElementById("centre-name").textContent = cfg.centreName;

  if (!getSession()) {
    window.location.href = "/admin/index.html";
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    clearSession();
    window.location.href = "/admin/index.html";
  });

  const classId = new URLSearchParams(window.location.search).get("id");
  if (!classId) {
    document.getElementById("class-header").innerHTML = `<p class="error">No class specified.</p>`;
    return;
  }

  document.getElementById("enroll-student-btn").addEventListener("click", showEnrollStudentModal);
  document.getElementById("assign-teacher-btn").addEventListener("click", showAssignTeacherModal);

  const dateInput = document.getElementById("attendance-date");
  dateInput.value = todayIso();
  attendanceDate = dateInput.value;
  dateInput.addEventListener("change", () => {
    attendanceDate = dateInput.value;
    loadAttendanceForDate();
  });

  document.getElementById("save-attendance-btn").addEventListener("click", saveAttendance);

  await loadClassProfile(classId);
}

async function loadClassProfile(classId) {
  const header = document.getElementById("class-header");

  try {
    const [cls] = await supabaseTable(
      `classes?id=eq.${classId}&select=*,class_enrollments(*,students(id,full_name,year_level)),class_teachers(*,teachers(id,full_name))`
    );

    if (!cls) {
      header.innerHTML = `<p class="error">Class not found.</p>`;
      return;
    }

    currentClass = cls;
    document.title = `${cls.subject} — ${window.CENTRE_CONFIG.centreName}`;

    renderClassHeader();
    renderRoster();
    renderTeacherRoster();
    await loadAttendanceForDate();
    await loadAttendanceHistory();
  } catch (err) {
    header.innerHTML = `<p class="error">Failed to load class: ${escapeHtml(err.message)}</p>`;
  }
}

function renderClassHeader() {
  const cls = currentClass;
  const enrolledCount = cls.class_enrollments.filter((e) => e.status === "active").length;
  const enrolledText = cls.capacity ? `${enrolledCount} / ${cls.capacity} enrolled` : `${enrolledCount} enrolled`;

  // When a custom class_name is set, it becomes the main heading and the
  // subject drops down to secondary/smaller text; otherwise the subject
  // is the only heading, matching the dashboard list's same fallback.
  const subjectLine = cls.class_name
    ? `<p class="class-subject-line"><small>${escapeHtml(cls.subject)}</small></p>`
    : "";

  const notesSection = cls.notes
    ? `
    <hr class="modal-divider" />
    <h3>Notes</h3>
    <p>${escapeHtml(cls.notes)}</p>
  `
    : "";

  document.getElementById("class-header").innerHTML = `
    <h1>${escapeHtml(classDisplayName(cls))}</h1>
    ${subjectLine}
    <div class="profile-badges">
      <span class="badge ${cls.status}">${escapeHtml(titleCase(cls.status))}</span>
    </div>
    <p class="text-muted">
      ${escapeHtml(formatDays(cls.day_of_week))}, ${formatTimeRange(cls.start_time, cls.end_time)}<br/>
      ${cls.year_level ? escapeHtml(cls.year_level) : "All year levels"} - ${escapeHtml(enrolledText)}
    </p>
    ${notesSection}
  `;
}

function renderRoster() {
  const tbody = document.getElementById("roster-body");
  const enrollments = currentClass.class_enrollments || [];

  if (enrollments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No students enrolled yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = enrollments
    .map(
      (e) => `
      <tr data-enrollment-id="${e.id}">
        <td><a href="/admin/student.html?id=${e.students.id}">${escapeHtml(e.students.full_name)}</a></td>
        <td>${escapeHtml(e.students.year_level)}</td>
        <td>${escapeHtml(formatDate(e.enrolled_at))}</td>
        <td><span class="badge ${e.status}">${escapeHtml(titleCase(e.status))}</span></td>
        <td>${e.status === "active" ? `<button class="secondary" data-action="remove-enrollment">Remove</button>` : ""}</td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("button[data-action='remove-enrollment']").forEach((btn) => {
    btn.addEventListener("click", () =>
      deactivateClassJoin("student", btn.closest("tr").dataset.enrollmentId, "Remove this student from the class?")
    );
  });
}

// Mirrors renderRoster() above, but for the class_teachers join table.
function renderTeacherRoster() {
  const tbody = document.getElementById("teacher-roster-body");
  const assignments = currentClass.class_teachers || [];

  if (assignments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No teachers assigned yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = assignments
    .map(
      (a) => `
      <tr data-assignment-id="${a.id}">
        <td><a href="/admin/teacher.html?id=${a.teachers.id}">${escapeHtml(a.teachers.full_name)}</a></td>
        <td>${escapeHtml(formatDate(a.assigned_at))}</td>
        <td><span class="badge ${a.status}">${escapeHtml(titleCase(a.status))}</span></td>
        <td>${a.status === "active" ? `<button class="secondary" data-action="remove-teacher">Remove</button>` : ""}</td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("button[data-action='remove-teacher']").forEach((btn) => {
    btn.addEventListener("click", () =>
      deactivateClassJoin("teacher", btn.closest("tr").dataset.assignmentId, "Remove this teacher from the class?")
    );
  });
}

async function showEnrollStudentModal() {
  const modalBody = openModal(`
    <h3>Enroll Student</h3>
    <label>Search students <input type="text" id="enroll-search" placeholder="Search by student name" /></label>
    <ul id="enroll-candidate-list" class="document-list"></ul>
    <p id="enroll-status" class="status-msg"></p>
    <div class="dialog-actions">
      <button type="button" class="secondary" id="enroll-cancel">Close</button>
    </div>
  `);

  modalBody.querySelector("#enroll-cancel").addEventListener("click", closeModal);

  const listEl = modalBody.querySelector("#enroll-candidate-list");
  const searchInput = modalBody.querySelector("#enroll-search");
  const status = modalBody.querySelector("#enroll-status");

  let allStudents = [];
  const activeEnrolledIds = new Set(
    currentClass.class_enrollments.filter((e) => e.status === "active").map((e) => e.student_id)
  );

  function renderCandidates() {
    const term = searchInput.value.trim().toLowerCase();
    const candidates = allStudents.filter(
      (s) => !activeEnrolledIds.has(s.id) && (!term || s.full_name.toLowerCase().includes(term))
    );

    if (candidates.length === 0) {
      listEl.innerHTML = `<li class="document-list-empty">No matching students.</li>`;
      return;
    }

    listEl.innerHTML = candidates
      .map(
        (s) => `
        <li data-student-id="${s.id}">
          <div class="document-info">
            <span class="document-name">${escapeHtml(s.full_name)}</span>
            <small>${escapeHtml(s.year_level)}</small>
          </div>
          <div class="document-actions">
            <button type="button" data-action="enroll">Enroll</button>
          </div>
        </li>`
      )
      .join("");

    listEl.querySelectorAll("button[data-action='enroll']").forEach((btn) => {
      btn.addEventListener("click", () => enrollStudent(btn.closest("li").dataset.studentId, status));
    });
  }

  searchInput.addEventListener("input", renderCandidates);

  try {
    allStudents = await supabaseTable("students?select=id,full_name,year_level&order=full_name.asc");
    renderCandidates();
  } catch (err) {
    listEl.innerHTML = `<li class="document-list-empty">Failed to load students: ${escapeHtml(err.message)}</li>`;
  }
}

// Mirrors showEnrollStudentModal() above, but assigns a teacher instead of
// enrolling a student — only active teachers are offered as candidates.
async function showAssignTeacherModal() {
  const modalBody = openModal(`
    <h3>Assign Teacher</h3>
    <label>Search teachers <input type="text" id="assign-teacher-search" placeholder="Search by teacher name" /></label>
    <ul id="assign-teacher-candidate-list" class="document-list"></ul>
    <p id="assign-teacher-status" class="status-msg"></p>
    <div class="dialog-actions">
      <button type="button" class="secondary" id="assign-teacher-cancel">Close</button>
    </div>
  `);

  modalBody.querySelector("#assign-teacher-cancel").addEventListener("click", closeModal);

  const listEl = modalBody.querySelector("#assign-teacher-candidate-list");
  const searchInput = modalBody.querySelector("#assign-teacher-search");
  const status = modalBody.querySelector("#assign-teacher-status");

  let allTeachers = [];
  const activeAssignedIds = new Set(
    (currentClass.class_teachers || []).filter((a) => a.status === "active").map((a) => a.teacher_id)
  );

  function renderCandidates() {
    const term = searchInput.value.trim().toLowerCase();
    const candidates = allTeachers.filter(
      (t) => !activeAssignedIds.has(t.id) && (!term || t.full_name.toLowerCase().includes(term))
    );

    if (candidates.length === 0) {
      listEl.innerHTML = `<li class="document-list-empty">No matching teachers.</li>`;
      return;
    }

    listEl.innerHTML = candidates
      .map(
        (t) => `
        <li data-teacher-id="${t.id}">
          <div class="document-info">
            <span class="document-name">${escapeHtml(t.full_name)}</span>
          </div>
          <div class="document-actions">
            <button type="button" data-action="assign">Assign</button>
          </div>
        </li>`
      )
      .join("");

    listEl.querySelectorAll("button[data-action='assign']").forEach((btn) => {
      btn.addEventListener("click", () => assignTeacher(btn.closest("li").dataset.teacherId, status));
    });
  }

  searchInput.addEventListener("input", renderCandidates);

  try {
    allTeachers = await supabaseTable("teachers?status=eq.active&select=id,full_name&order=full_name.asc");
    renderCandidates();
  } catch (err) {
    listEl.innerHTML = `<li class="document-list-empty">Failed to load teachers: ${escapeHtml(err.message)}</li>`;
  }
}

// Generalization of the reactivation-safe join-table pattern, shared by
// both students-into-classes (class_enrollments) and teachers-into-classes
// (class_teachers) — the same way PROFILE_ENTITY_CONFIGS shares the
// photo/document upload logic between students and teachers, rather than
// writing a third copy of the same enroll/reactivate idiom.
const CLASS_JOIN_CONFIGS = {
  student: {
    joinTable: "class_enrollments",
    fkColumn: "student_id",
    timestampColumn: "enrolled_at",
    enforceCapacity: true,
  },
  teacher: {
    joinTable: "class_teachers",
    fkColumn: "teacher_id",
    timestampColumn: "assigned_at",
    enforceCapacity: false,
  },
};

// Shared by both directions of enrollment/assignment: class.html's "Enroll
// Student"/"Assign Teacher" (picking an entity for a fixed class) and
// student.html's "Enroll in Class" (picking a class for a fixed student).
// cls must include its capacity and the relevant join rows (id, status,
// fkColumn) embedded under entityCfg.joinTable so capacity and the
// reactivation lookup below both work regardless of which page called
// this. onAssigned is called after a successful save to refresh whichever
// page is showing.
async function assignEntityToClass(cls, entityType, entityId, status, onAssigned) {
  const entityCfg = CLASS_JOIN_CONFIGS[entityType];
  const joins = cls[entityCfg.joinTable] || [];
  const activeCount = joins.filter((j) => j.status === "active").length;

  if (entityCfg.enforceCapacity && cls.capacity && activeCount >= cls.capacity) {
    const proceed = confirm(`This class is at capacity (${activeCount}/${cls.capacity} enrolled). Enroll anyway?`);
    if (!proceed) return;
  }

  status.textContent = "Saving...";
  status.className = "status-msg";

  try {
    // A previous join row (now inactive) already occupies the unique
    // (class_id, fkColumn) slot — reactivate it instead of inserting a
    // second row, which the unique constraint would reject anyway.
    const existing = joins.find((j) => j[entityCfg.fkColumn] === entityId);

    if (existing) {
      await supabaseTable(`${entityCfg.joinTable}?id=eq.${existing.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ status: "active", [entityCfg.timestampColumn]: new Date().toISOString() }),
      });
    } else {
      await supabaseTable(entityCfg.joinTable, {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify({ class_id: cls.id, [entityCfg.fkColumn]: entityId, status: "active" }),
      });
    }
    closeModal();
    await onAssigned();
  } catch (err) {
    status.textContent = `Failed to save: ${err.message}`;
    status.className = "status-msg error";
  }
}

// Removing either a student or a teacher from a class is the same
// PATCH-to-inactive regardless of entityType, so this is shared too.
async function deactivateClassJoin(entityType, joinId, confirmMessage) {
  if (!confirm(confirmMessage)) return;

  const entityCfg = CLASS_JOIN_CONFIGS[entityType];
  try {
    await supabaseTable(`${entityCfg.joinTable}?id=eq.${joinId}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ status: "inactive" }),
    });
    await loadClassProfile(currentClass.id);
  } catch (err) {
    alert(`Failed to remove: ${err.message}`);
  }
}

// class.html's "Enroll Student" always operates on the page-level
// currentClass.
async function enrollStudent(studentId, status) {
  await assignEntityToClass(currentClass, "student", studentId, status, () => loadClassProfile(currentClass.id));
}

// class.html's "Assign Teacher" — same shape as enrollStudent above.
async function assignTeacher(teacherId, status) {
  await assignEntityToClass(currentClass, "teacher", teacherId, status, () => loadClassProfile(currentClass.id));
}

// --- Attendance ---
let attendanceDate = null;
let attendanceRecords = []; // existing rows for currentClass + attendanceDate only
let attendanceSelections = {}; // student_id -> { status, notes }, staged locally until "Save Attendance"
let attendanceHistory = []; // every attendance_records row for currentClass, across all dates

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadAttendanceForDate() {
  const roster = document.getElementById("attendance-roster");
  roster.innerHTML = `<p class="text-muted">Loading...</p>`;

  try {
    attendanceRecords = await supabaseTable(
      `attendance_records?class_id=eq.${currentClass.id}&date=eq.${attendanceDate}`
    );
  } catch (err) {
    roster.innerHTML = `<p class="error">Failed to load attendance: ${escapeHtml(err.message)}</p>`;
    return;
  }

  // Pre-select whatever's already recorded for this date instead of
  // showing every student blank.
  attendanceSelections = {};
  attendanceRecords.forEach((r) => {
    attendanceSelections[r.student_id] = { status: r.status, notes: r.notes || "" };
  });

  renderAttendanceRoster();
}

function renderAttendanceRoster() {
  const roster = document.getElementById("attendance-roster");
  const activeEnrollments = currentClass.class_enrollments.filter((e) => e.status === "active");

  if (activeEnrollments.length === 0) {
    roster.innerHTML = `<p class="text-muted">No students enrolled yet.</p>`;
    return;
  }

  const toggleButton = (status, label, selected) =>
    `<button type="button" class="attendance-toggle ${selected === status ? "active" : ""}" data-status="${status}">${label}</button>`;

  roster.innerHTML = activeEnrollments
    .map((e) => {
      const sel = attendanceSelections[e.student_id] || { status: null, notes: "" };
      const hasNote = !!(sel.notes && sel.notes.trim());
      return `
      <div class="attendance-row" data-student-id="${e.student_id}">
        <span class="attendance-student-name">${escapeHtml(e.students.full_name)}</span>
        <div class="attendance-toggle-group">
          ${toggleButton("present", "Present", sel.status)}
          ${toggleButton("absent", "Absent", sel.status)}
          ${toggleButton("late", "Late", sel.status)}
          <button type="button" class="attendance-note-toggle secondary">${hasNote ? "Edit note" : "+ Note"}</button>
        </div>
        <input
          type="text"
          class="attendance-notes-input${hasNote ? "" : " hidden"}"
          placeholder="Note (optional)"
          value="${escapeHtml(sel.notes || "")}"
        />
      </div>`;
    })
    .join("");

  roster.querySelectorAll(".attendance-row").forEach((row) => {
    const studentId = row.dataset.studentId;

    const ensureSelection = () => {
      if (!attendanceSelections[studentId]) attendanceSelections[studentId] = { status: null, notes: "" };
      return attendanceSelections[studentId];
    };

    row.querySelectorAll(".attendance-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        ensureSelection().status = btn.dataset.status;
        row.querySelectorAll(".attendance-toggle").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });

    const notesInput = row.querySelector(".attendance-notes-input");
    const noteToggleBtn = row.querySelector(".attendance-note-toggle");

    // Collapsing never discards the value — the input stays in the DOM
    // (just visually hidden) and its "input" listener keeps firing, so
    // whatever's typed is still staged in attendanceSelections and gets
    // included when Save Attendance runs.
    notesInput.addEventListener("input", (e) => {
      ensureSelection().notes = e.target.value;
    });

    noteToggleBtn.addEventListener("click", () => {
      const isHidden = notesInput.classList.contains("hidden");
      if (isHidden) {
        notesInput.classList.remove("hidden");
        noteToggleBtn.textContent = "- Hide note";
        notesInput.focus();
      } else {
        notesInput.classList.add("hidden");
        noteToggleBtn.textContent = notesInput.value.trim() ? "Edit note" : "+ Note";
      }
    });
  });
}

async function saveAttendance() {
  const status = document.getElementById("attendance-status");
  const activeEnrollments = currentClass.class_enrollments.filter((e) => e.status === "active");
  const marked = activeEnrollments.filter((e) => attendanceSelections[e.student_id]?.status);

  if (marked.length === 0) {
    status.textContent = "Mark at least one student before saving.";
    status.className = "status-msg error";
    return;
  }

  // Soft warning (not a hard block) if the selected date's weekday isn't
  // one of this class's scheduled days — same soft-warn pattern as the
  // capacity and fee-overpayment confirmations elsewhere in the dashboard.
  const selectedWeekday = WEEKDAYS[(new Date(`${attendanceDate}T00:00:00`).getDay() + 6) % 7];
  if (!currentClass.day_of_week.includes(selectedWeekday)) {
    const proceed = confirm(`This class isn't normally scheduled on ${selectedWeekday} - continue?`);
    if (!proceed) return;
  }

  status.textContent = "Saving...";
  status.className = "status-msg";

  try {
    for (const e of marked) {
      const studentId = e.student_id;
      const sel = attendanceSelections[studentId];
      // Same reactivation-style pattern as class enrollment: reuse the
      // existing row for this class/student/date if one exists, since a
      // fresh insert would hit the unique (class_id, student_id, date)
      // constraint.
      const existing = attendanceRecords.find((r) => r.student_id === studentId);
      const notes = sel.notes ? sel.notes.trim() : null;

      if (existing) {
        await supabaseTable(`attendance_records?id=eq.${existing.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: JSON.stringify({ status: sel.status, notes, marked_at: new Date().toISOString() }),
        });
      } else {
        await supabaseTable("attendance_records", {
          method: "POST",
          prefer: "return=minimal",
          body: JSON.stringify({
            class_id: currentClass.id,
            student_id: studentId,
            date: attendanceDate,
            status: sel.status,
            notes,
          }),
        });
      }
    }

    status.textContent = "Attendance saved.";
    status.className = "status-msg success";
    await loadAttendanceForDate();
    await loadAttendanceHistory();
  } catch (err) {
    status.textContent = `Failed to save attendance: ${err.message}`;
    status.className = "status-msg error";
  }
}

// Every distinct date this class has recorded attendance for, each with a
// quick present/absent/late summary and a click target that jumps the
// date picker straight to it — so the owner isn't guessing which dates
// have data.
async function loadAttendanceHistory() {
  const list = document.getElementById("attendance-history-list");
  list.innerHTML = `<li class="document-list-empty">Loading...</li>`;

  try {
    attendanceHistory = await supabaseTable(`attendance_records?class_id=eq.${currentClass.id}&order=date.desc`);
  } catch (err) {
    list.innerHTML = `<li class="document-list-empty">Failed to load history: ${escapeHtml(err.message)}</li>`;
    return;
  }

  renderAttendanceHistoryList();
}

function renderAttendanceHistoryList() {
  const list = document.getElementById("attendance-history-list");
  const byDate = {};
  attendanceHistory.forEach((r) => {
    (byDate[r.date] = byDate[r.date] || []).push(r);
  });

  const dates = Object.keys(byDate).sort((a, b) => new Date(b) - new Date(a));

  if (dates.length === 0) {
    list.innerHTML = `<li class="document-list-empty">No attendance recorded yet.</li>`;
    return;
  }

  list.innerHTML = dates
    .map((date) => {
      const records = byDate[date];
      const present = records.filter((r) => r.status === "present").length;
      const absent = records.filter((r) => r.status === "absent").length;
      const late = records.filter((r) => r.status === "late").length;
      return `
      <li>
        <button type="button" class="attendance-history-date" data-date="${date}">
          <span class="document-name">${escapeHtml(formatDate(date))}</span>
          <small>${present} present, ${absent} absent, ${late} late</small>
        </button>
      </li>`;
    })
    .join("");

  list.querySelectorAll(".attendance-history-date").forEach((btn) => {
    btn.addEventListener("click", () => {
      const date = btn.dataset.date;
      const dateInput = document.getElementById("attendance-date");
      dateInput.value = date;
      attendanceDate = date;
      loadAttendanceForDate();
      dateInput.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
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
        <td>${escapeHtml(formatDate(b.created_at))}</td>
        <td>${escapeHtml(b.child_name)} (${escapeHtml(b.year_level)})</td>
        <td>${escapeHtml(Array.isArray(b.subject) ? b.subject.join(", ") : b.subject)}</td>
        <td>${escapeHtml(b.parent_name)}<br/><small>${escapeHtml(b.parent_phone || "")} ${escapeHtml(b.parent_email || "")}</small></td>
        <td>${escapeHtml(formatPreferredTime(b.preferred_time))}</td>
        <td><span class="badge ${b.status}">${escapeHtml(titleCase(b.status))}</span></td>
        <td class="row-actions">
          ${b.status === "new" ? `<button class="secondary" data-action="contacted">Mark contacted</button>` : ""}
          ${b.status !== "converted" ? `<button data-action="convert">Convert to student</button>` : ""}
          ${b.status !== "declined" && b.status !== "converted" ? `<button class="secondary" data-action="decline">Decline</button>` : ""}
          ${b.status === "converted" && b.student_id ? `<button class="secondary" data-action="view-student">View Student</button>` : ""}
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

  if (action === "view-student") {
    viewStudentFromBooking(booking.student_id);
    return;
  }

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
      const [newStudent] = await supabaseTable("students", {
        method: "POST",
        prefer: "return=representation",
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
        body: JSON.stringify({ status: "converted", student_id: newStudent.id }),
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
let studentSearchTerm = "";
let studentStatusFilter = "all";
let studentYearFilter = "all";
let studentSortColumn = "full_name";
let studentSortDirection = "asc";

function updateSortHeaderIndicators() {
  document.querySelectorAll(".sort-header").forEach((btn) => {
    const isActive = btn.dataset.sort === studentSortColumn;
    btn.classList.toggle("sort-active", isActive);
    btn.classList.toggle("sort-desc", isActive && studentSortDirection === "desc");
  });
}

async function loadStudents() {
  const tbody = document.getElementById("students-body");
  tbody.innerHTML = `<tr><td colspan="4">Loading...</td></tr>`;

  try {
    studentsCache = await supabaseTable("students?select=*,fees(*)&order=full_name.asc");
    renderStudents();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="error">Failed to load students: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Filters studentsCache client-side by the current search term and status
// tab — no Supabase request involved, so this can run on every keystroke.
function renderStudents() {
  const tbody = document.getElementById("students-body");
  const term = studentSearchTerm.trim().toLowerCase();

  const filtered = studentsCache.filter((s) => {
    const matchesStatus = studentStatusFilter === "all" || s.status === studentStatusFilter;
    const matchesYear = studentYearFilter === "all" || s.year_level === studentYearFilter;
    const matchesSearch =
      !term ||
      s.full_name.toLowerCase().includes(term) ||
      s.parent_name.toLowerCase().includes(term) ||
      (s.parent_phone || "").toLowerCase().includes(term) ||
      (s.parent_email || "").toLowerCase().includes(term);
    return matchesStatus && matchesYear && matchesSearch;
  });

  if (studentsCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No students yet.</td></tr>`;
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No students match your search.</td></tr>`;
    return;
  }

  // Sorting applies on top of whatever's already been filtered above, not
  // instead of it.
  filtered.sort((a, b) => {
    const aVal = String(a[studentSortColumn] || "").toLowerCase();
    const bVal = String(b[studentSortColumn] || "").toLowerCase();
    if (aVal < bVal) return studentSortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return studentSortDirection === "asc" ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = filtered
    .map((s) => {
      const unpaid = s.fees.filter((f) => f.paid_status === "unpaid").length;
      return `
    <tr data-id="${s.id}">
      <td><a href="/admin/student.html?id=${s.id}">${escapeHtml(s.full_name)}</a></td>
      <td>${escapeHtml(s.year_level)}</td>
      <td>${escapeHtml(s.parent_name)}<br/><small>${escapeHtml(s.parent_phone || "")} ${escapeHtml(s.parent_email || "")}</small></td>
      <td><span class="badge ${s.status}">${escapeHtml(titleCase(s.status))}</span> ${unpaid > 0 ? `<span class="badge unpaid">${unpaid} unpaid fee${unpaid > 1 ? "s" : ""}</span>` : ""}</td>
    </tr>`;
    })
    .join("");
}

function showRecordPaymentModal(feeId) {
  const fee = currentStudent.fees.find((f) => f.id === feeId);

  const modalBody = openModal(`
    <h3>Record Payment — ${escapeHtml(titleCaseWords(fee.term_label))}</h3>
    <form id="record-payment-form" novalidate>
      <label>Amount paid <input type="number" name="amount_paid" step="0.01" min="0" value="${fee.amount}" required /></label>
      <label>
        Payment method
        <select name="payment_method">
          <option value="">Select</option>
          <option value="Cash">Cash</option>
          <option value="Bank Transfer">Bank Transfer</option>
          <option value="Card">Card</option>
          <option value="Other">Other</option>
        </select>
      </label>
      <label>Notes <input type="text" name="notes" placeholder="Optional" value="${escapeHtml(fee.notes || "")}" /></label>
      <p id="record-payment-status" class="status-msg"></p>
      <div class="dialog-actions">
        <button type="button" class="secondary" id="record-payment-cancel">Cancel</button>
        <button type="submit">Save Payment</button>
      </div>
    </form>
  `);

  modalBody.querySelector("#record-payment-cancel").addEventListener("click", closeModal);
  modalBody.querySelector("#record-payment-form").addEventListener("submit", (e) => recordFeePayment(e, fee));
}

async function recordFeePayment(e, fee) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector("button[type='submit']");
  const status = form.querySelector("#record-payment-status");
  const data = Object.fromEntries(new FormData(form).entries());

  const amountPaid = parseFloat(data.amount_paid);
  if (isNaN(amountPaid) || amountPaid < 0) {
    status.textContent = "Enter a valid amount.";
    status.className = "status-msg error";
    return;
  }

  const amountOwed = parseFloat(fee.amount);

  if (amountPaid > amountOwed) {
    const proceed = confirm(
      `You've entered $${amountPaid.toFixed(2)}, which is more than the $${amountOwed.toFixed(2)} owed for this fee. Continue?`
    );
    if (!proceed) return;
  }

  let paidStatus = "unpaid";
  if (amountPaid >= amountOwed) paidStatus = "paid";
  else if (amountPaid > 0) paidStatus = "partial";

  submitBtn.disabled = true;
  status.textContent = "Saving...";
  status.className = "status-msg";

  try {
    await supabaseTable(`fees?id=eq.${fee.id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({
        paid_status: paidStatus,
        amount_paid: amountPaid,
        payment_method: data.payment_method || null,
        notes: data.notes ? data.notes.trim() : null,
        paid_date: paidStatus === "paid" ? new Date().toISOString().slice(0, 10) : null,
      }),
    });
    closeModal();
    await loadStudentProfile(currentStudent.id);
  } catch (err) {
    status.textContent = `Failed to save payment: ${err.message}`;
    status.className = "status-msg error";
    submitBtn.disabled = false;
  }
}

function showAddStudentModal() {
  showStudentFormModal(null, loadStudents);
}

// Shared by "Add Student" and "Edit Student" — student is null for add,
// or the existing student record (to pre-fill and PATCH) for edit.
// student is null when adding, or the existing record when editing.
// onSaved is called after a successful save (and after the modal has
// closed) so the caller can refresh whatever view is showing —
// loadStudents() for the dashboard's Add Student flow, or
// loadStudentProfile() for the profile page's Edit Details flow.
function showStudentFormModal(student, onSaved) {
  const isEdit = !!student;
  const cfg = window.CENTRE_CONFIG;
  const yearOptions = cfg.yearLevels
    .map(
      (y) =>
        `<option value="${escapeHtml(y)}" ${student && student.year_level === y ? "selected" : ""}>${escapeHtml(y)}</option>`
    )
    .join("");

  // Photo upload only makes sense once a student exists (Edit, never Add) —
  // it lives at the top of the form, above every other field.
  const photoRowHtml = isEdit
    ? `
    <div class="profile-photo-row">
      <div id="modal-profile-photo-avatar" class="avatar avatar-lg"></div>
      <div class="profile-photo-controls">
        <label class="file-upload-label secondary">
          Upload Photo
          <input type="file" id="modal-profile-photo-input" accept="image/jpeg,image/png,image/webp" hidden />
        </label>
        <p id="modal-photo-upload-status" class="status-msg"></p>
      </div>
    </div>
    <hr class="modal-divider" />
  `
    : "";

  const modalBody = openModal(`
    <h3>${isEdit ? "Edit Student" : "Add Student"}</h3>
    <form id="student-form" novalidate>
      ${photoRowHtml}
      <h3>Student Info</h3>
      <label>Full name <input type="text" name="full_name" required value="${escapeHtml(student?.full_name || "")}" /></label>
      <div class="student-form-grid">
        <label>Year level <select name="year_level">${yearOptions}</select></label>
        <label>
          Status
          <select name="status">
            <option value="active" ${!isEdit || student.status === "active" ? "selected" : ""}>Active</option>
            <option value="inactive" ${isEdit && student.status === "inactive" ? "selected" : ""}>Inactive</option>
          </select>
        </label>
      </div>

      <hr class="modal-divider" />
      <h3>Parent Contact</h3>
      <label>Parent name <input type="text" name="parent_name" required value="${escapeHtml(student?.parent_name || "")}" /></label>
      <div class="student-form-grid">
        <label>Parent phone <input type="tel" name="parent_phone" value="${escapeHtml(student?.parent_phone || "")}" /></label>
        <label>Parent email <input type="email" name="parent_email" value="${escapeHtml(student?.parent_email || "")}" /></label>
      </div>

      <hr class="modal-divider" />
      <label>Notes <textarea name="notes" rows="3">${escapeHtml(student?.notes || "")}</textarea></label>
      <p id="student-form-status" class="status-msg"></p>
      <div class="dialog-actions">
        <button type="button" class="secondary" id="student-form-cancel">Cancel</button>
        <button type="submit">${isEdit ? "Save Changes" : "Add Student"}</button>
      </div>
    </form>
  `, { wide: true });

  if (isEdit) {
    refreshProfilePhotoAvatar("modal-profile-photo-avatar", "student");
    modalBody.querySelector("#modal-profile-photo-input").addEventListener("change", (e) => handlePhotoUpload(e, "student"));
  }

  modalBody.querySelector("#student-form-cancel").addEventListener("click", closeModal);

  modalBody.querySelector("#student-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector("button[type='submit']");
    const status = modalBody.querySelector("#student-form-status");
    const data = Object.fromEntries(new FormData(form).entries());

    if (!data.full_name.trim() || !data.parent_name.trim()) {
      status.textContent = "Full name and parent name are required.";
      status.className = "status-msg error";
      return;
    }

    submitBtn.disabled = true;
    status.textContent = "Saving...";
    status.className = "status-msg";

    const payload = {
      full_name: data.full_name,
      year_level: data.year_level || null,
      parent_name: data.parent_name,
      parent_phone: data.parent_phone || null,
      parent_email: data.parent_email || null,
      status: data.status || "active",
      notes: data.notes || null,
    };

    try {
      if (isEdit) {
        await supabaseTable(`students?id=eq.${student.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: JSON.stringify(payload),
        });
      } else {
        await supabaseTable("students", {
          method: "POST",
          prefer: "return=minimal",
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      await onSaved();
    } catch (err) {
      status.textContent = `Failed to save student: ${err.message}`;
      status.className = "status-msg error";
      submitBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------
// Teachers (dashboard tab + teacher.html profile page)
// ---------------------------------------------------------------
let teachersCache = [];
let teacherSearchTerm = "";
let teacherStatusFilter = "all";

async function loadTeachers() {
  const tbody = document.getElementById("teachers-body");
  tbody.innerHTML = `<tr><td colspan="3">Loading...</td></tr>`;

  try {
    teachersCache = await supabaseTable("teachers?select=*&order=full_name.asc");
    renderTeachers();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="error">Failed to load teachers: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Same composable search+status pattern as the Students tab.
function renderTeachers() {
  const tbody = document.getElementById("teachers-body");
  const term = teacherSearchTerm.trim().toLowerCase();

  const filtered = teachersCache.filter((t) => {
    const matchesStatus = teacherStatusFilter === "all" || t.status === teacherStatusFilter;
    const matchesSearch =
      !term ||
      t.full_name.toLowerCase().includes(term) ||
      (t.phone || "").toLowerCase().includes(term) ||
      (t.email || "").toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  if (teachersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">No teachers yet.</td></tr>`;
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">No teachers match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (t) => `
    <tr data-id="${t.id}">
      <td><a href="/admin/teacher.html?id=${t.id}">${escapeHtml(t.full_name)}</a></td>
      <td>${escapeHtml(t.phone || "-")}<br/><small>${escapeHtml(t.email || "")}</small></td>
      <td><span class="badge ${t.status}">${escapeHtml(titleCase(t.status))}</span></td>
    </tr>`
    )
    .join("");
}

function showAddTeacherModal() {
  showTeacherFormModal(null, loadTeachers);
}

// teacher is null for Add, or the existing record for Edit — same
// isEdit-gated photo row pattern as showStudentFormModal (no photo
// upload for a not-yet-created teacher, since there's no id to attach
// files to yet).
function showTeacherFormModal(teacher, onSaved) {
  const isEdit = !!teacher;

  const photoRowHtml = isEdit
    ? `
    <div class="profile-photo-row">
      <div id="modal-profile-photo-avatar" class="avatar avatar-lg"></div>
      <div class="profile-photo-controls">
        <label class="file-upload-label secondary">
          Upload Photo
          <input type="file" id="modal-profile-photo-input" accept="image/jpeg,image/png,image/webp" hidden />
        </label>
        <p id="modal-photo-upload-status" class="status-msg"></p>
      </div>
    </div>
    <hr class="modal-divider" />
  `
    : "";

  const modalBody = openModal(
    `
    <h3>${isEdit ? "Edit Teacher" : "Add Teacher"}</h3>
    <form id="teacher-form" novalidate>
      ${photoRowHtml}
      <label>Full name <input type="text" name="full_name" required value="${escapeHtml(teacher?.full_name || "")}" /></label>
      <label>Phone <input type="tel" name="phone" value="${escapeHtml(teacher?.phone || "")}" /></label>
      <label>Email <input type="email" name="email" value="${escapeHtml(teacher?.email || "")}" /></label>
      <label>
        Status
        <select name="status">
          <option value="active" ${!isEdit || teacher.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${isEdit && teacher.status === "inactive" ? "selected" : ""}>Inactive</option>
        </select>
      </label>
      <label>Bio <textarea name="bio" rows="3">${escapeHtml(teacher?.bio || "")}</textarea></label>
      <p id="teacher-form-status" class="status-msg"></p>
      <div class="dialog-actions">
        <button type="button" class="secondary" id="teacher-form-cancel">Cancel</button>
        <button type="submit">${isEdit ? "Save Changes" : "Add Teacher"}</button>
      </div>
    </form>
  `,
    { wide: true }
  );

  if (isEdit) {
    refreshProfilePhotoAvatar("modal-profile-photo-avatar", "teacher");
    modalBody.querySelector("#modal-profile-photo-input").addEventListener("change", (e) => handlePhotoUpload(e, "teacher"));
  }

  modalBody.querySelector("#teacher-form-cancel").addEventListener("click", closeModal);

  modalBody.querySelector("#teacher-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector("button[type='submit']");
    const status = modalBody.querySelector("#teacher-form-status");
    const data = Object.fromEntries(new FormData(form).entries());

    if (!data.full_name.trim()) {
      status.textContent = "Full name is required.";
      status.className = "status-msg error";
      return;
    }

    submitBtn.disabled = true;
    status.textContent = "Saving...";
    status.className = "status-msg";

    const payload = {
      full_name: data.full_name,
      phone: data.phone || null,
      email: data.email || null,
      status: data.status || "active",
      bio: data.bio || null,
    };

    try {
      if (isEdit) {
        await supabaseTable(`teachers?id=eq.${teacher.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: JSON.stringify(payload),
        });
      } else {
        await supabaseTable("teachers", {
          method: "POST",
          prefer: "return=minimal",
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      await onSaved();
    } catch (err) {
      status.textContent = `Failed to save teacher: ${err.message}`;
      status.className = "status-msg error";
      submitBtn.disabled = false;
    }
  });
}

// --- teacher.html profile page ---
let currentTeacher = null;

async function initTeacherPage() {
  const cfg = window.CENTRE_CONFIG;
  document.documentElement.style.setProperty("--brand", cfg.brandColor);
  document.getElementById("centre-name").textContent = cfg.centreName;

  if (!getSession()) {
    window.location.href = "/admin/index.html";
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    clearSession();
    window.location.href = "/admin/index.html";
  });

  const teacherId = new URLSearchParams(window.location.search).get("id");
  if (!teacherId) {
    document.getElementById("teacher-profile-header").innerHTML = `<p class="error">No teacher specified.</p>`;
    return;
  }

  document.getElementById("edit-teacher-details-btn").addEventListener("click", () => {
    showTeacherFormModal(currentTeacher, () => loadTeacherProfile(teacherId));
  });

  document.getElementById("document-input").addEventListener("change", (e) => handleDocumentUpload(e, "teacher"));

  await loadTeacherProfile(teacherId);
}

async function loadTeacherProfile(teacherId) {
  const header = document.getElementById("teacher-profile-header");

  try {
    const [teacher] = await supabaseTable(
      `teachers?id=eq.${teacherId}&select=*,documents:teacher_documents(*),class_teachers(*,classes(*))`
    );

    if (!teacher) {
      header.innerHTML = `<p class="error">Teacher not found.</p>`;
      return;
    }

    currentTeacher = teacher;
    document.title = `${teacher.full_name} — ${window.CENTRE_CONFIG.centreName}`;

    renderTeacherProfileHeader();
    renderTeacherClassesSection();
    renderDocumentList("teacher");
    await refreshProfilePhotoAvatar("profile-photo-avatar", "teacher");
  } catch (err) {
    header.innerHTML = `<p class="error">Failed to load teacher: ${escapeHtml(err.message)}</p>`;
  }
}

function renderTeacherProfileHeader() {
  const teacher = currentTeacher;

  document.getElementById("teacher-name").textContent = teacher.full_name;

  const statusBadge = document.getElementById("teacher-status-badge");
  statusBadge.textContent = titleCase(teacher.status);
  statusBadge.className = `badge ${teacher.status}`;

  // .textContent, not .innerHTML, so no escapeHtml() here — it isn't
  // interpreting entities back, so escaping first would show a literal
  // "&amp;" instead of "&" for an email/phone containing one.
  document.getElementById("teacher-contact-info").textContent = [teacher.phone, teacher.email]
    .filter(Boolean)
    .join(" ");

  const bioEl = document.getElementById("teacher-bio");
  bioEl.textContent = teacher.bio || "";
  bioEl.classList.toggle("hidden", !teacher.bio);
}

// Mirrors student.html's renderStudentClassesSection() — which classes
// this teacher is actively assigned to, each linking to that class's page.
function renderTeacherClassesSection() {
  const list = document.getElementById("teacher-class-list");
  const assignments = (currentTeacher.class_teachers || []).filter((a) => a.status === "active");

  if (assignments.length === 0) {
    list.innerHTML = `<li class="document-list-empty">Not assigned to any classes.</li>`;
    return;
  }

  list.innerHTML = assignments
    .map(
      (a) => `
      <li>
        <a href="/admin/class.html?id=${a.classes.id}">
          <span class="document-name">${escapeHtml(classDisplayName(a.classes))}</span>
          <small>${escapeHtml(formatDays(a.classes.day_of_week))}, ${formatTimeRange(a.classes.start_time, a.classes.end_time)}</small>
        </a>
      </li>`
    )
    .join("");
}

// --- Profile photo & documents ---
// Shared between student.html (currentStudent) and teacher.html
// (currentTeacher) — parameterized by entityType rather than duplicated,
// since both pages upload photos/documents through the exact same
// Storage bucket/signed-URL flow, just against different tables and a
// different storage path prefix.
const PROFILE_ENTITY_CONFIGS = {
  student: {
    table: "students",
    documentsTable: "student_documents",
    fkColumn: "student_id",
    storagePrefix: "students",
    getCurrent: () => currentStudent,
    reload: (id) => loadStudentProfile(id),
  },
  teacher: {
    table: "teachers",
    documentsTable: "teacher_documents",
    fkColumn: "teacher_id",
    storagePrefix: "teachers",
    getCurrent: () => currentTeacher,
    reload: (id) => loadTeacherProfile(id),
  },
};

// avatarId defaults to the profile header's persistent avatar; the Edit
// Details modal passes its own preview element's id so both stay in sync
// independently (the modal has its own <div>, not the same DOM node).
async function refreshProfilePhotoAvatar(avatarId = "profile-photo-avatar", entityType) {
  const entity = PROFILE_ENTITY_CONFIGS[entityType].getCurrent();
  const avatar = document.getElementById(avatarId);
  if (!avatar) return;
  avatar.style.backgroundImage = "";
  avatar.classList.remove("has-photo");

  if (!entity.profile_photo_url) return;

  try {
    const url = await getSignedFileUrl(entity.profile_photo_url);
    // Preload before committing to the background-image — mirrors the
    // public booking page's logo.onerror pattern. A CSS background-image
    // never shows a broken-icon on its own, but without this check the
    // code would still mark the photo as "loaded" even if the signed
    // URL's token were already stale by the time it's actually fetched.
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    avatar.style.backgroundImage = `url("${url}")`;
    avatar.classList.add("has-photo");
  } catch (err) {
    // Still leave the placeholder showing rather than a broken state —
    // but log it. This used to be a bare `catch {}`, which meant a real
    // failure here (bad signed URL, RLS rejecting the sign request, the
    // image itself failing to load) was completely invisible: the photo
    // just silently never appeared, with nothing in the console to
    // diagnose why.
    console.error("Failed to load profile photo avatar:", err);
  }
}

async function handlePhotoUpload(e, entityType) {
  const entityCfg = PROFILE_ENTITY_CONFIGS[entityType];
  const input = e.target;
  const file = input.files[0];
  input.value = ""; // allow re-selecting the same file later
  if (!file) return;

  const entity = entityCfg.getCurrent();
  const status = document.getElementById("modal-photo-upload-status");

  const error = validateFile(file, ALLOWED_PHOTO_TYPES);
  if (error) {
    status.textContent = error;
    status.className = "status-msg error";
    return;
  }

  status.textContent = "Uploading...";
  status.className = "status-msg";

  try {
    const previousPath = entity.profile_photo_url;
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const path = `${entityCfg.storagePrefix}/${entity.id}/profile.${ext}`;
    await storageUpload(path, file, { upsert: true });

    await supabaseTable(`${entityCfg.table}?id=eq.${entity.id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ profile_photo_url: path }),
    });

    // x-upsert only overwrites an object at the exact same path, so a
    // replacement photo with a different extension (png -> jpg) lands at
    // a new path — clean up the old one so it doesn't orphan in the bucket.
    if (previousPath && previousPath !== path) {
      try {
        await storageDelete(previousPath);
      } catch {
        // The new photo already saved successfully; a failed cleanup of
        // the old orphaned file isn't worth surfacing as an error here.
      }
    }

    await entityCfg.reload(entity.id); // refreshes currentStudent/currentTeacher + the page header's avatar
    await refreshProfilePhotoAvatar("modal-profile-photo-avatar", entityType); // keep the still-open modal's own preview in sync too
    status.textContent = "Photo updated.";
    status.className = "status-msg success";
  } catch (err) {
    status.textContent = `Failed to upload photo: ${err.message}`;
    status.className = "status-msg error";
  }
}

// --- Documents ---

function mimeToLabel(type) {
  if (type === "application/pdf") return "PDF";
  if (type && type.startsWith("image/")) return "Image";
  return type || "File";
}

function renderDocumentList(entityType) {
  const entity = PROFILE_ENTITY_CONFIGS[entityType].getCurrent();
  const list = document.getElementById("document-list");
  const documents = entity.documents || [];

  if (documents.length === 0) {
    list.innerHTML = `<li class="document-list-empty">No documents uploaded yet.</li>`;
    return;
  }

  list.innerHTML = documents
    .map(
      (doc) => `
      <li data-document-id="${doc.id}">
        <div class="document-info">
          <span class="document-name">${escapeHtml(doc.file_name)}</span>
          <small>${escapeHtml(mimeToLabel(doc.file_type))} - ${escapeHtml(formatDate(doc.uploaded_at))}</small>
        </div>
        <div class="document-actions">
          <button type="button" class="secondary" data-action="view-document">View</button>
          <button type="button" class="secondary" data-action="delete-document">Delete</button>
        </div>
      </li>`
    )
    .join("");

  list.querySelectorAll("button[data-action='view-document']").forEach((btn) => {
    btn.addEventListener("click", () => viewDocument(btn.closest("li").dataset.documentId, entityType));
  });

  list.querySelectorAll("button[data-action='delete-document']").forEach((btn) => {
    btn.addEventListener("click", () => deleteDocument(btn.closest("li").dataset.documentId, entityType));
  });
}

async function viewDocument(documentId, entityType) {
  const entity = PROFILE_ENTITY_CONFIGS[entityType].getCurrent();
  const doc = (entity.documents || []).find((d) => d.id === documentId);
  if (!doc) return;
  try {
    const url = await getSignedFileUrl(doc.file_url);
    window.open(url, "_blank", "noopener");
  } catch (err) {
    alert(`Failed to open document: ${err.message}`);
  }
}

async function deleteDocument(documentId, entityType) {
  const entityCfg = PROFILE_ENTITY_CONFIGS[entityType];
  const entity = entityCfg.getCurrent();
  const doc = (entity.documents || []).find((d) => d.id === documentId);
  if (!doc) return;
  if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return;

  try {
    await storageDelete(doc.file_url);
    await supabaseTable(`${entityCfg.documentsTable}?id=eq.${documentId}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });

    await entityCfg.reload(entity.id);
  } catch (err) {
    alert(`Failed to delete document: ${err.message}`);
  }
}

async function handleDocumentUpload(e, entityType) {
  const entityCfg = PROFILE_ENTITY_CONFIGS[entityType];
  const input = e.target;
  const files = Array.from(input.files || []);
  input.value = "";
  if (files.length === 0) return;

  const entity = entityCfg.getCurrent();
  const status = document.getElementById("document-upload-status");

  const errors = files.map((f) => validateFile(f, ALLOWED_DOCUMENT_TYPES)).filter(Boolean);
  if (errors.length > 0) {
    status.textContent = errors.join(" ");
    status.className = "status-msg error";
    return;
  }

  status.textContent = `Uploading ${files.length} file${files.length > 1 ? "s" : ""}...`;
  status.className = "status-msg";

  try {
    for (const file of files) {
      const path = `${entityCfg.storagePrefix}/${entity.id}/documents/${Date.now()}-${sanitizeFileName(file.name)}`;
      await storageUpload(path, file);
      await supabaseTable(entityCfg.documentsTable, {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify({
          [entityCfg.fkColumn]: entity.id,
          file_name: file.name,
          file_url: path,
          file_type: file.type,
          category: "document",
        }),
      });
    }

    await entityCfg.reload(entity.id);
    status.textContent = "Upload complete.";
    status.className = "status-msg success";
  } catch (err) {
    status.textContent = `Failed to upload document: ${err.message}`;
    status.className = "status-msg error";
  }
}

async function addFee(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    await supabaseTable("fees", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({
        student_id: currentStudent.id,
        term_label: titleCaseWords(data.term_label.trim()),
        amount: data.amount,
        due_date: data.due_date,
        payment_method: data.payment_method || null,
        notes: data.notes ? data.notes.trim() : null,
      }),
    });
    form.reset();
    await loadStudentProfile(currentStudent.id);
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

// --- Display formatting helpers ---
// Locale is hardcoded to en-AU (this template is Australia-only, per
// centre.config.js's timezone field) so every viewer sees the same date
// format regardless of their own device/browser locale.
const DISPLAY_LOCALE = "en-AU";

function formatDate(value) {
  if (!value) return "-";
  const parts = String(value).split("-");
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    const [y, m, d] = parts.map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(DISPLAY_LOCALE, { day: "numeric", month: "short", year: "numeric" });
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(DISPLAY_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

function formatTimeString(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m)
    .toLocaleTimeString(DISPLAY_LOCALE, { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(" ", "");
}

// preferred_time can be a combined "YYYY-MM-DDTHH:mm", a date-only, or a
// time-only string depending on what the booking form submitted.
function formatPreferredTime(value) {
  if (!value) return "-";
  const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (dateTimeMatch) {
    const [, datePart, timePart] = dateTimeMatch;
    return `${formatDate(datePart)}, ${formatTimeString(timePart)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (/^\d{2}:\d{2}$/.test(value)) return formatTimeString(value);
  return String(value);
}

function titleCase(str) {
  const s = String(str);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function titleCaseWords(str) {
  return String(str).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
