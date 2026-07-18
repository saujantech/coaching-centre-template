/**
 * centre.config.js
 *
 * Every client-specific value lives here. No other file in this project
 * should hardcode a centre name, subject list, colour, or contact detail.
 * To reconfigure this template for a new client, edit only this file
 * (plus schema.sql and environment variables).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CENTRE_CONFIG = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  return {
    // --- Branding ---
    centreName: "Your Coaching Centre",
    logoUrl: "/assets/logo.png",
    brandColor: "#2563eb",
    tagline: "Helping students reach their potential",

    // The centre's actual deployed URL (no trailing slash) — used server-
    // side (e.g. api/manage-teacher-login.js) wherever a fully-qualified
    // link back into the app is needed, such as an auth redirect_to. Kept
    // as a fixed, owner-controlled config value rather than read off the
    // incoming request (e.g. req.headers.host), since a request header is
    // caller-supplied and shouldn't be trusted for something this
    // sensitive.
    siteUrl: "https://your-site.vercel.app",

    // --- Contact ---
    contactEmail: "owner@example.com",
    contactPhone: "+61 400 000 000",
    ownerNotificationEmail: "owner@example.com",
    fromEmail: "bookings@example.com", // must be a Resend-verified sending domain

    // --- Academic ---
    subjects: ["Maths", "English", "Science", "Chemistry", "Physics"],
    yearLevels: [
      "Year 3", "Year 4", "Year 5", "Year 6", "Year 7", "Year 8",
      "Year 9", "Year 10", "Year 11", "Year 12"
    ],

    // --- Locale ---
    timezone: "Australia/Sydney",
    currency: "AUD",
    currencySymbol: "$",

    // --- Fee reminders ---
    reminderDaysBeforeDue: [7, 3, 1], // send a reminder when due_date is this many days away
    reminderDaysAfterOverdue: [1, 7], // and again after these many days overdue

    // --- Supabase (public/anon values only — safe to expose client-side) ---
    supabaseUrl: "https://YOUR-PROJECT.supabase.co",
    supabaseAnonKey: "YOUR-SUPABASE-ANON-KEY",
  };
});
