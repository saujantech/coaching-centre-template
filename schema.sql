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
  profile_photo_url text, -- storage object path in the student-files bucket, not a public URL — access via a signed URL
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
  student_id uuid references students(id),
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
  paid_status text not null default 'unpaid' check (paid_status in ('unpaid', 'partial', 'paid')),
  amount_paid numeric(10, 2) not null default 0,
  payment_method text,
  notes text,
  receipt_url text, -- placeholder for future file-upload work; not used by any UI yet
  paid_date date,
  reminders_sent integer not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- student_documents
-- ============================================================
create table if not exists student_documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  file_name text not null,
  file_url text not null, -- storage object path in the student-files bucket, not a public URL
  file_type text not null,
  category text not null default 'document' check (category in ('photo', 'document')),
  uploaded_at timestamptz not null default now()
);

-- ============================================================
-- teachers
-- ============================================================
create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  bio text,
  profile_photo_url text, -- storage object path in the student-files bucket (teachers/{id}/...), not a public URL
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- teacher_documents
-- ============================================================
create table if not exists teacher_documents (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  file_name text not null,
  file_url text not null, -- storage object path in the student-files bucket, not a public URL
  file_type text not null,
  category text not null default 'document' check (category in ('photo', 'document')),
  uploaded_at timestamptz not null default now()
);

-- ============================================================
-- classes
-- ============================================================
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  class_name text, -- optional custom label, e.g. "Year 8 Maths — Advanced"; falls back to subject when blank
  notes text,
  day_of_week text[] not null check (
    day_of_week <@ array['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']::text[]
    and cardinality(day_of_week) > 0
  ),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  year_level text,
  capacity integer,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- class_teachers
-- ============================================================
create table if not exists class_teachers (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive')),
  assigned_at timestamptz not null default now(),
  unique (class_id, teacher_id)
);

-- ============================================================
-- class_enrollments
-- ============================================================
create table if not exists class_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'inactive')),
  unique (class_id, student_id)
);

-- ============================================================
-- attendance_records
-- ============================================================
create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late')),
  notes text,
  marked_at timestamptz not null default now(),
  unique (class_id, student_id, date)
);

create index if not exists fees_student_id_idx on fees(student_id);
create index if not exists fees_due_date_idx on fees(due_date);
create index if not exists trial_bookings_status_idx on trial_bookings(status);
create index if not exists trial_bookings_student_id_idx on trial_bookings(student_id);
create index if not exists student_documents_student_id_idx on student_documents(student_id);
create index if not exists teacher_documents_teacher_id_idx on teacher_documents(teacher_id);
create index if not exists class_enrollments_class_id_idx on class_enrollments(class_id);
create index if not exists class_enrollments_student_id_idx on class_enrollments(student_id);
create index if not exists class_teachers_class_id_idx on class_teachers(class_id);
create index if not exists class_teachers_teacher_id_idx on class_teachers(teacher_id);
create index if not exists attendance_records_class_id_idx on attendance_records(class_id);
create index if not exists attendance_records_student_id_idx on attendance_records(student_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table students enable row level security;
alter table trial_bookings enable row level security;
alter table fees enable row level security;
alter table student_documents enable row level security;
alter table teachers enable row level security;
alter table teacher_documents enable row level security;
alter table classes enable row level security;
alter table class_teachers enable row level security;
alter table class_enrollments enable row level security;
alter table attendance_records enable row level security;

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

create policy "owner full access to student_documents"
  on student_documents for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to teachers"
  on teachers for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to teacher_documents"
  on teacher_documents for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to classes"
  on classes for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to class_enrollments"
  on class_enrollments for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to class_teachers"
  on class_teachers for all
  to authenticated
  using (true)
  with check (true);

create policy "owner full access to attendance_records"
  on attendance_records for all
  to authenticated
  using (true)
  with check (true);

-- No policies are defined for the anon role on students, fees,
-- student_documents, teachers, teacher_documents, classes,
-- class_enrollments, class_teachers, or attendance_records, and none
-- for update/delete on trial_bookings by anon — those fall through
-- RLS's default-deny, matching the "insert only" requirement.

-- Everything else (server-side jobs: fee reminders, booking notifications)
-- runs through the service_role key from Vercel serverless functions,
-- which bypasses RLS entirely.

-- ============================================================
-- Storage: student-files bucket (profile photos + documents)
-- ============================================================
-- Private bucket — no anon/public access. The admin dashboard always
-- accesses files through a signed, time-limited URL generated via the
-- Storage API, never a permanent public link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-files',
  'student-files',
  false,
  5242880, -- 5MB, matches the client-side upload validation
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects has RLS enabled by default in Supabase — no need to
-- alter it here, unlike the app tables above.
create policy "owner full access to student-files (select)"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'student-files');

create policy "owner full access to student-files (insert)"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'student-files');

create policy "owner full access to student-files (update)"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'student-files')
  with check (bucket_id = 'student-files');

create policy "owner full access to student-files (delete)"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'student-files');
