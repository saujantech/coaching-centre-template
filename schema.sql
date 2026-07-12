-- schema.sql
-- Copy-paste into a fresh Supabase project's SQL editor for each new client.
-- One Supabase project per client. Not shared, not multi-tenant.

create extension if not exists "pgcrypto";

-- ============================================================
-- students
-- ============================================================
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  year_level text not null,
  parent_name text not null,
  parent_phone text,
  parent_email text,
  enrolled_date date not null default current_date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- trial_bookings
-- ============================================================
create table if not exists trial_bookings (
  id uuid primary key default gen_random_uuid(),
  child_name text not null,
  year_level text not null,
  subject text[] not null,
  preferred_time text,
  parent_name text not null,
  parent_phone text not null,
  parent_email text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'declined')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- fees
-- ============================================================
create table if not exists fees (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  term_label text not null,
  amount numeric(10, 2) not null,
  due_date date not null,
  paid_status text not null default 'unpaid' check (paid_status in ('unpaid', 'paid')),
  paid_date date,
  reminders_sent integer not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fees_student_id_idx on fees(student_id);
create index if not exists fees_due_date_idx on fees(due_date);
create index if not exists trial_bookings_status_idx on trial_bookings(status);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table students enable row level security;
alter table trial_bookings enable row level security;
alter table fees enable row level security;

-- Public booking page: anonymous users may only INSERT a trial booking.
create policy "anon can submit trial bookings"
  on trial_bookings for insert
  to anon
  with check (true);

-- Owner (authenticated via Supabase Auth) has full access everywhere.
create policy "owner full access to students"
  on students for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to trial_bookings"
  on trial_bookings for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to fees"
  on fees for all
  to authenticated
  using (true)
  with check (true);

-- No policies are defined for the anon role on students or fees, and none
-- for update/delete on trial_bookings by anon — those fall through RLS's
-- default-deny, matching the "insert only" requirement.

-- Everything else (server-side jobs: fee reminders, booking notifications)
-- runs through the service_role key from Vercel serverless functions,
-- which bypasses RLS entirely.
