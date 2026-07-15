# Coaching Centre OS — Project Rules

## What this is
A reusable booking + fee-reminder template for small tutoring/coaching
centres. This exact codebase gets cloned per client via GitHub's
"Use this template" — it is never rebuilt from scratch. Every client-specific
detail must live in centre.config.js, never hardcoded into a page.

## Hard rules — do not violate these
- Supabase: use direct REST fetch() calls ONLY. Never import or use the
  Supabase JS client library, in any file, for any reason.
- Auth: use Supabase Auth for the owner login. Do not create a custom
  admin_users table or hand-roll password hashing.
- Reusability: no client's name, logo, subject list, or branding may be
  hardcoded into any page. Everything client-specific reads from
  centre.config.js.
- Row Level Security must be enabled on every table. The anon key may
  only ever INSERT into trial_bookings — nothing else.
- Secrets (service_role key, Resend key) are used only inside
  /api serverless functions, never in frontend code, never committed
  to GitHub.

## Stack
Vanilla HTML/CSS/JS · Supabase (Postgres) · Vercel serverless functions
(Node.js) · Resend for email · Vercel Cron for scheduled jobs · deployed
via GitHub → Vercel.

## Folder structure
/public                       — everything Vercel serves as static files
  index.html, booking.js        — public trial-booking page
  terms.html, privacy.html      — placeholder consent pages linked from the booking form
  style.css, tokens.css         — page-specific styles + shared design tokens (colors, type, form controls)
  centre.config.js              — all client-specific settings
  manifest.js is served via /api/manifest (see below), not a static file here
  sw.js, pwa.js                 — service worker + PWA install/theming wiring for the admin dashboard
  time-picker.js                — shared time-of-day picker control used by booking and admin forms
  /icons                        — PWA app icons (icon-180/192/512.png), generated per client — see scripts/generate-icons.js
  /admin                        — owner dashboard (Supabase Auth login required)
    index.html, dashboard.html    — login + main dashboard (Trial Bookings, Students tabs)
    teacher.html, class.html,
    student.html, fee-document.html — detail/management pages for teachers, classes, a single student, and printable fee receipts/invoices
    admin.css, admin.js           — shared dashboard styles and logic (incl. Supabase REST calls, JWT refresh/retry)
/api                           — Vercel serverless functions (Node.js), service_role/Resend key access only
  notify-booking.js, send-reminders.js — existing booking notification + fee reminder cron
  manifest.js                    — generates the PWA manifest from centre.config.js on every request
  _supabase.js, _email.js        — shared request helpers
/scripts
  generate-icons.js             — regenerates public/icons/*.png from centre.config.js (name initial + brandColor); dependency-free, run after editing centre.config.js for a new client
centre.config.js               — see public/centre.config.js above (lives in /public so Vercel serves it)
schema.sql                     — table + RLS definitions, copy-paste per new client

## Out of scope for V1
No real payment gateway/card processing — fees are recorded manually
(unpaid/partial/paid, amount paid, payment method) and receipts are
generated as printable documents, not charged automatically. No
SMS/WhatsApp, no parent logins, no shared/multi-tenant database.

The template now also includes (built beyond the original V1 scope):
teacher records with document uploads, class scheduling with day/time
and capacity, class-teacher and class-student enrollment, and attendance
tracking per class session (present/absent/late). Student and teacher
document/photo uploads are stored in a Supabase storage bucket and
accessed via signed URLs, not public ones. The admin dashboard is also
installable as a PWA (manifest, service worker, home-screen icons).

## Design
- Build the admin dashboard mobile-first. Every admin page must work
  properly on a phone screen before being scaled up for desktop — the
  owner will mostly be checking bookings and marking fees paid from
  their phone, not a laptop.
