(function () {
  const cfg = window.CENTRE_CONFIG;

  document.title = `Book a Trial — ${cfg.centreName}`;
  document.getElementById("centre-name").textContent = cfg.centreName;
  document.getElementById("tagline").textContent = cfg.tagline;
  document.getElementById("contact-line").textContent =
    `Questions? Call ${cfg.contactPhone} or email ${cfg.contactEmail}`;

  const logo = document.getElementById("logo");
  logo.onerror = () => { logo.style.display = "none"; };
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

  const subjectsContainer = document.getElementById("subjects");
  cfg.subjects.forEach((subject, i) => {
    const id = `subject-${i}`;
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-label";
    wrapper.innerHTML = `<input type="checkbox" name="subject" id="${id}" value="${subject}" /> ${subject}`;
    subjectsContainer.appendChild(wrapper);
  });

  document.getElementById("preferred-time-picker").outerHTML = timePickerHtml("preferred-time-picker", { allowEmpty: true });
  const preferredTimePicker = document.getElementById("preferred-time-picker");
  setTimePickerValue(preferredTimePicker, null);

  const phoneInput = document.querySelector('input[name="parent_phone"]');
  phoneInput.addEventListener("input", () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
  });

  const form = document.getElementById("booking-form");
  const submitBtn = document.getElementById("submit-btn");
  const status = document.getElementById("form-status");
  const consent = document.getElementById("consent");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "status-msg";

    const formData = new FormData(form);
    const subjects = formData.getAll("subject");
    const phone = (formData.get("parent_phone") || "").trim();
    const preferredDate = formData.get("preferred_date");
    const preferredTimeOfDay = getTimePickerValue(preferredTimePicker);

    if (subjects.length === 0) {
      status.textContent = "Please select at least one subject.";
      status.className = "status-msg error";
      return;
    }

    if (!/^0\d{9}$/.test(phone)) {
      status.textContent = "Please enter a valid Australian mobile number, e.g. 0412 345 678.";
      status.className = "status-msg error";
      return;
    }

    if (!consent.checked) {
      status.textContent = "Please agree to the Terms & Conditions and Privacy Policy to continue.";
      status.className = "status-msg error";
      return;
    }

    let preferredTime = null;
    if (preferredDate && preferredTimeOfDay) {
      preferredTime = `${preferredDate}T${preferredTimeOfDay}`;
    } else if (preferredDate) {
      preferredTime = preferredDate;
    } else if (preferredTimeOfDay) {
      preferredTime = preferredTimeOfDay;
    }

    const payload = {
      child_name: formData.get("child_name"),
      year_level: formData.get("year_level"),
      subject: subjects,
      preferred_time: preferredTime,
      parent_name: formData.get("parent_name"),
      parent_phone: phone || null,
      parent_email: formData.get("parent_email"),
      message: formData.get("message") || null,
    };

    submitBtn.disabled = true;
    status.textContent = "Submitting...";

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
      status.className = "status-msg success";
    } catch (err) {
      status.textContent = "Something went wrong. Please try again or contact us directly.";
      status.className = "status-msg error";
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
