(function () {
  const cfg = window.CENTRE_CONFIG;

  document.title = `Book a Trial — ${cfg.centreName}`;
  document.getElementById("centre-name").textContent = cfg.centreName;
  document.getElementById("tagline").textContent = cfg.tagline;
  document.getElementById("contact-line").textContent =
    `Questions? Call ${cfg.contactPhone} or email ${cfg.contactEmail}`;

  const logo = document.getElementById("logo");
  logo.addEventListener("error", () => logo.classList.add("hidden"));
  logo.src = cfg.logoUrl;
  logo.alt = cfg.centreName;

  document.documentElement.style.setProperty("--brand", cfg.brandColor);

  const yearSelect = document.getElementById("year-level");
  cfg.yearLevels.forEach((year) => {
    const opt = document.createElement("option");
    opt.value = year;
    opt.textContent = year;
    yearSelect.appendChild(opt);
  });

  const subjectOptions = document.getElementById("subject-options");
  cfg.subjects.forEach((subject, i) => {
    const id = `subject-${i}`;
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" name="subject" value="${subject}" id="${id}" /> <span>${subject}</span>`;
    subjectOptions.appendChild(label);
  });

  const form = document.getElementById("booking-form");
  const submitBtn = document.getElementById("submit-btn");
  const status = document.getElementById("form-status");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    status.textContent = "Submitting...";
    status.className = "";

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    delete payload.consent;

    payload.subject = formData.getAll("subject");

    const preferredDate = formData.get("preferred_date");
    const preferredTime = formData.get("preferred_time");
    payload.preferred_time =
      preferredDate && preferredTime
        ? `${preferredDate} ${preferredTime}`
        : preferredDate || preferredTime || null;
    delete payload.preferred_date;

    try {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/trial_bookings`, {
        method: "POST",
        headers: {
          apikey: cfg.supabaseAnonKey,
          Authorization: `Bearer ${cfg.supabaseAnonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await res.text());

      // Fire-and-forget: notify the owner. Don't block the parent's success
      // message on this — the booking is already saved either way.
      fetch("/api/notify-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});

      form.reset();
      status.textContent = "Thanks! We'll be in touch shortly to confirm your trial.";
      status.className = "success";
    } catch (err) {
      status.textContent = "Something went wrong. Please try again or contact us directly.";
      status.className = "error";
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
