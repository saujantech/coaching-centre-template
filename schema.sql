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
  receipt_url text, -- storage object path in the student-files bucket (students/{id}/receipts/...), not a public URL
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

-- teachers.auth_user_id: links a teacher record to a Supabase Auth user so
-- that teacher can log in with their own credentials, distinct from the
-- owner's account. Nullable — a teacher record with no auth_user_id has no
-- login of its own; the owner manages them entirely through the dashboard.
-- Added via alter table (rather than inline above) so this same statement
-- doubles as the exact migration to run against an already-deployed
-- project that predates teacher login.
alter table teachers add column if not exists auth_user_id uuid unique references auth.users(id);

-- teachers.login_enabled: owner-controlled switch for whether this
-- teacher can currently log in, independent of auth_user_id existing.
-- current_teacher_id() below requires this to be true (alongside
-- status = 'active'), so revoking access here takes effect immediately
-- without needing to touch/delete the underlying Supabase Auth user —
-- re-enabling later just flips this back on, no new account needed.
-- Defaults to false: creating a teacher record never implicitly grants
-- them login until the owner explicitly turns it on.
alter table teachers add column if not exists login_enabled boolean not null default false;

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

-- fees.class_id: optional link from a fee to the class it's for (e.g.
-- "Term 3 Maths fee" vs. just "Term 3 fee"). Added via alter table rather
-- than inline on the fees create table above, since fees is defined
-- earlier in this script than classes and a forward reference to a
-- not-yet-created table would fail on a fresh database.
alter table fees add column if not exists class_id uuid references classes(id);

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

-- ============================================================
-- email_templates
-- ============================================================
create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body text not null, -- may contain {{student_name}}, {{parent_name}}, {{centre_name}} placeholders, resolved client-side before sending
  created_at timestamptz not null default now()
);

create index if not exists fees_student_id_idx on fees(student_id);
create index if not exists fees_due_date_idx on fees(due_date);
create index if not exists fees_class_id_idx on fees(class_id);
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
-- Access-control helper functions
-- ============================================================
-- current_teacher_id(): the teacher record matching the logged-in
-- session's auth.uid(), or null if this session is the owner (no
-- teachers row references this auth user). Every policy below branches
-- on this to distinguish "owner" (null) from "a specific teacher"
-- (non-null). Requires both status = 'active' and login_enabled = true —
-- the owner can revoke a teacher's access instantly via login_enabled
-- without changing their active/inactive status (which has its own,
-- separate meaning elsewhere in the app), or vice versa.
--
-- security definer + a locked search_path so it runs with the
-- function-owner's privileges and reads the teachers table directly,
-- bypassing that table's own RLS. Without this, calling
-- current_teacher_id() from inside a policy ON teachers would recurse
-- through RLS on the very table the function is trying to read.
create or replace function current_teacher_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from teachers where auth_user_id = auth.uid() and status = 'active' and login_enabled = true;
$$;

revoke execute on function current_teacher_id() from public;
grant execute on function current_teacher_id() to authenticated;

-- teacher_assigned_to_class(): true if the calling teacher has an active
-- class_teachers row for the given class. Also security definer, for the
-- same reason — used inside policies on class_teachers/classes/
-- class_enrollments/attendance_records and must not recurse through
-- their RLS.
create or replace function teacher_assigned_to_class(p_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from class_teachers ct
    where ct.class_id = p_class_id
      and ct.teacher_id = current_teacher_id()
      and ct.status = 'active'
  );
$$;

revoke execute on function teacher_assigned_to_class(uuid) from public;
grant execute on function teacher_assigned_to_class(uuid) to authenticated;

-- teacher_can_access_student(): true if the given student has an active
-- enrollment in a class the calling teacher is actively assigned to.
-- Shared by the students and student_documents policies below so both
-- stay in sync with a single definition of "a teacher's student."
create or replace function teacher_can_access_student(p_student_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from class_enrollments ce
    where ce.student_id = p_student_id
      and ce.status = 'active'
      and teacher_assigned_to_class(ce.class_id)
  );
$$;

revoke execute on function teacher_can_access_student(uuid) from public;
grant execute on function teacher_can_access_student(uuid) to authenticated;

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
alter table email_templates enable row level security;

-- Public booking page: anonymous users may only INSERT a trial booking.
create policy "anon can submit trial bookings"
  on trial_bookings for insert
  to anon
  with check (true);

-- ------------------------------------------------------------
-- Owner access: every "owner full access" policy now additionally
-- requires current_teacher_id() is null — i.e. the logged-in session
-- isn't a teacher. A teacher session simply doesn't match these
-- policies at all; it falls through to the narrower teacher policies
-- (or to RLS's default-deny, on tables with no teacher policy).
-- ------------------------------------------------------------
create policy "owner full access to students"
  on students for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to trial_bookings"
  on trial_bookings for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to fees"
  on fees for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to student_documents"
  on student_documents for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to teachers"
  on teachers for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to teacher_documents"
  on teacher_documents for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to classes"
  on classes for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to class_enrollments"
  on class_enrollments for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to class_teachers"
  on class_teachers for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to attendance_records"
  on attendance_records for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

create policy "owner full access to email_templates"
  on email_templates for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

-- ------------------------------------------------------------
-- Teacher access — narrower than the owner's, scoped table by table.
-- fees, email_templates, and trial_bookings deliberately have no
-- teacher policy at all: a teacher session gets nothing on those three,
-- falling through to RLS's default-deny.
-- ------------------------------------------------------------

-- classes: teachers may view only classes they're actively assigned to.
-- No insert/update/delete for teachers.
create policy "teacher can view assigned classes"
  on classes for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_assigned_to_class(classes.id)
  );

-- class_teachers: teachers may view only their own assignment rows.
-- No write access.
create policy "teacher can view own class assignments"
  on class_teachers for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_id = current_teacher_id()
  );

-- class_enrollments: teachers may view/create/update enrollment rows for
-- classes they're actively assigned to, but never delete one outright —
-- split into three single-command policies (rather than one "for all")
-- specifically to leave out delete; CREATE POLICY's FOR clause only
-- accepts one command per policy, so this can't be expressed as a single
-- "select, insert, update" policy the way "all" can.
create policy "teacher can view enrollments for assigned classes"
  on class_enrollments for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_assigned_to_class(class_enrollments.class_id)
  );

create policy "teacher can insert enrollments for assigned classes"
  on class_enrollments for insert
  to authenticated
  with check (
    current_teacher_id() is not null
    and teacher_assigned_to_class(class_enrollments.class_id)
  );

create policy "teacher can update enrollments for assigned classes"
  on class_enrollments for update
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_assigned_to_class(class_enrollments.class_id)
  )
  with check (
    current_teacher_id() is not null
    and teacher_assigned_to_class(class_enrollments.class_id)
  );

-- attendance_records: teachers may view/create/update attendance rows for
-- classes they're actively assigned to, and only for a student who is
-- actually actively enrolled in that same class — without this, a
-- teacher could mark attendance for any student in a class they teach,
-- even one who was never enrolled there (or whose enrollment lapsed).
-- Same select/insert/update split as class_enrollments above, same
-- reason: no teacher-level delete at the database layer.
create policy "teacher can view attendance for assigned classes"
  on attendance_records for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_assigned_to_class(attendance_records.class_id)
    and exists (
      select 1 from class_enrollments ce
      where ce.class_id = attendance_records.class_id
        and ce.student_id = attendance_records.student_id
        and ce.status = 'active'
    )
  );

create policy "teacher can insert attendance for assigned classes"
  on attendance_records for insert
  to authenticated
  with check (
    current_teacher_id() is not null
    and teacher_assigned_to_class(attendance_records.class_id)
    and exists (
      select 1 from class_enrollments ce
      where ce.class_id = attendance_records.class_id
        and ce.student_id = attendance_records.student_id
        and ce.status = 'active'
    )
  );

create policy "teacher can update attendance for assigned classes"
  on attendance_records for update
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_assigned_to_class(attendance_records.class_id)
    and exists (
      select 1 from class_enrollments ce
      where ce.class_id = attendance_records.class_id
        and ce.student_id = attendance_records.student_id
        and ce.status = 'active'
    )
  )
  with check (
    current_teacher_id() is not null
    and teacher_assigned_to_class(attendance_records.class_id)
    and exists (
      select 1 from class_enrollments ce
      where ce.class_id = attendance_records.class_id
        and ce.student_id = attendance_records.student_id
        and ce.status = 'active'
    )
  );

-- students: any authenticated teacher may insert a new student freely
-- (there's no class to scope a brand-new student to yet). Select/update
-- are scoped to students with an active enrollment in one of the
-- teacher's actively-assigned classes. No delete policy for teachers.
create policy "teacher can insert students"
  on students for insert
  to authenticated
  with check (current_teacher_id() is not null);

create policy "teacher can view students in their classes"
  on students for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_can_access_student(students.id)
  );

create policy "teacher can update students in their classes"
  on students for update
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_can_access_student(students.id)
  )
  with check (
    current_teacher_id() is not null
    and teacher_can_access_student(students.id)
  );

-- student_documents: same scoping as students — a teacher may manage
-- only documents belonging to a student in one of their classes.
create policy "teacher can manage documents for their students"
  on student_documents for all
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_can_access_student(student_documents.student_id)
  )
  with check (
    current_teacher_id() is not null
    and teacher_can_access_student(student_documents.student_id)
  );

-- teachers: a teacher may view and update only their own row, never
-- another teacher's.
create policy "teacher can view own record"
  on teachers for select
  to authenticated
  using (
    current_teacher_id() is not null
    and id = current_teacher_id()
  );

create policy "teacher can update own record"
  on teachers for update
  to authenticated
  using (
    current_teacher_id() is not null
    and id = current_teacher_id()
  )
  with check (
    current_teacher_id() is not null
    and id = current_teacher_id()
  );

-- RLS is row-scoped, not column-scoped: the policy directly above only
-- constrains WHICH ROW a teacher can update (id = current_teacher_id()),
-- not which columns of it — so as written, a teacher's own valid session
-- could PATCH /rest/v1/teachers?id=eq.<their own id> with
-- {"login_enabled": true} or {"auth_user_id": "..."} and have it succeed,
-- bypassing api/manage-teacher-login.js and its service_role-only checks
-- entirely. Both columns are meant to be exclusively owner/service_role-
-- controlled. A BEFORE UPDATE trigger is used to close this rather than
-- trying to express "these two columns must stay equal to their current
-- value" inside the policy's WITH CHECK itself, since plain RLS clauses
-- have no clean way to compare a proposed new value against the row's
-- existing (pre-update) one. Triggers still run even for writes that
-- bypass RLS entirely (e.g. the service_role key), so
-- auth.role() = 'service_role' is what actually lets
-- manage-teacher-login.js's own writes through.
create or replace function reject_teacher_login_column_changes()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    if new.login_enabled is distinct from old.login_enabled
       or new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'login_enabled and auth_user_id can only be changed by the owner, via the app';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists teachers_protect_login_columns on teachers;
create trigger teachers_protect_login_columns
  before update on teachers
  for each row
  execute function reject_teacher_login_column_changes();

-- teacher_documents: a teacher may manage only their own documents.
create policy "teacher can manage own documents"
  on teacher_documents for all
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_id = current_teacher_id()
  )
  with check (
    current_teacher_id() is not null
    and teacher_id = current_teacher_id()
  );

-- No policies are defined for the anon role on students, fees,
-- student_documents, teachers, teacher_documents, classes,
-- class_enrollments, class_teachers, attendance_records, or
-- email_templates, and none for update/delete on trial_bookings by
-- anon — those fall through RLS's default-deny, matching the
-- "insert only" requirement.

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
--
-- Every object in this bucket lives under students/{student_id}/... or
-- teachers/{teacher_id}/... (see the profile_photo_url/file_url column
-- comments above) — storage.foldername(name) splits the object path into
-- its folder segments, so foldername(name)[1] is 'students'/'teachers'
-- and foldername(name)[2] is the id. The ~ check guards the cast to uuid:
-- a malformed or unexpected path fails the regex and the policy simply
-- denies access, rather than the uuid cast raising and breaking the query.
--
-- Owner (current_teacher_id() is null) keeps full access to everything,
-- same as every other table in this file.
create policy "owner full access to student-files (select)"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'student-files' and current_teacher_id() is null);

create policy "owner full access to student-files (insert)"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'student-files' and current_teacher_id() is null);

create policy "owner full access to student-files (update)"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'student-files' and current_teacher_id() is null)
  with check (bucket_id = 'student-files' and current_teacher_id() is null);

create policy "owner full access to student-files (delete)"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'student-files' and current_teacher_id() is null);

-- Teacher: only objects under students/{id}/... for a student they can
-- access (same scoping as the student_documents table policy).
create policy "teacher can access files for their students"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'student-files'
    and current_teacher_id() is not null
    and (storage.foldername(name))[1] = 'students'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and teacher_can_access_student(((storage.foldername(name))[2])::uuid)
  )
  with check (
    bucket_id = 'student-files'
    and current_teacher_id() is not null
    and (storage.foldername(name))[1] = 'students'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and teacher_can_access_student(((storage.foldername(name))[2])::uuid)
  );

-- Teacher: only objects under teachers/{id}/... where {id} is their own.
create policy "teacher can access own teacher files"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'student-files'
    and current_teacher_id() is not null
    and (storage.foldername(name))[1] = 'teachers'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and ((storage.foldername(name))[2])::uuid = current_teacher_id()
  )
  with check (
    bucket_id = 'student-files'
    and current_teacher_id() is not null
    and (storage.foldername(name))[1] = 'teachers'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and ((storage.foldername(name))[2])::uuid = current_teacher_id()
  );
