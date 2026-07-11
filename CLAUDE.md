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
/public          — public booking page
/admin           — owner dashboard
/api             — serverless functions (reminders, notifications)
centre.config.js — all client-specific settings
schema.sql       — table + RLS definitions, copy-paste per new client

## Out of scope for V1
No real payment processing (paid/unpaid is a manual toggle), no
attendance tracking, no progress notes, no SMS/WhatsApp, no parent
logins, no shared/multi-tenant database.

## Design
- Build the admin dashboard mobile-first. Every admin page must work
  properly on a phone screen before being scaled up for desktop — the
  owner will mostly be checking bookings and marking fees paid from
  their phone, not a laptop.
