-- Migration: teacher login support (schema + RLS only, no UI changes yet)
-- Run this against an already-deployed client project's Supabase SQL
-- Editor to add teacher login to a project that predates it. A brand new
-- client project doesn't need this file — schema.sql already includes
-- everything here.
--
-- Everything here is idempotent EXCEPT the owner policies, which must be
-- dropped and recreated because `create policy` errors if a policy with
-- that name already exists — this project already has the old
-- "owner full access to ..." policies from the last schema sync.

-- ============================================================
-- 1. teachers.auth_user_id
-- ============================================================
alter table teachers add column if not exists auth_user_id uuid unique references auth.users(id);

-- teachers.login_enabled: owner-controlled switch, independent of
-- auth_user_id existing — see schema.sql for the full comment.
alter table teachers add column if not exists login_enabled boolean not null default false;

-- ============================================================
-- 2. Access-control helper functions
-- ============================================================
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
-- 3. Rewrite the owner policies to exclude teacher sessions
-- ============================================================
drop policy if exists "owner full access to students" on students;
create policy "owner full access to students"
  on students for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to trial_bookings" on trial_bookings;
create policy "owner full access to trial_bookings"
  on trial_bookings for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to fees" on fees;
create policy "owner full access to fees"
  on fees for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to student_documents" on student_documents;
create policy "owner full access to student_documents"
  on student_documents for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to teachers" on teachers;
create policy "owner full access to teachers"
  on teachers for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to teacher_documents" on teacher_documents;
create policy "owner full access to teacher_documents"
  on teacher_documents for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to classes" on classes;
create policy "owner full access to classes"
  on classes for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to class_enrollments" on class_enrollments;
create policy "owner full access to class_enrollments"
  on class_enrollments for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to class_teachers" on class_teachers;
create policy "owner full access to class_teachers"
  on class_teachers for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to attendance_records" on attendance_records;
create policy "owner full access to attendance_records"
  on attendance_records for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

drop policy if exists "owner full access to email_templates" on email_templates;
create policy "owner full access to email_templates"
  on email_templates for all
  to authenticated
  using (current_teacher_id() is null)
  with check (current_teacher_id() is null);

-- ============================================================
-- 4. New teacher policies
--    fees, email_templates, trial_bookings intentionally get none.
-- ============================================================
drop policy if exists "teacher can view assigned classes" on classes;
create policy "teacher can view assigned classes"
  on classes for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_assigned_to_class(classes.id)
  );

drop policy if exists "teacher can view own class assignments" on class_teachers;
create policy "teacher can view own class assignments"
  on class_teachers for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_id = current_teacher_id()
  );

-- Split into select/insert/update (rather than a single "for all" policy)
-- specifically to leave teachers with no delete access at the database
-- layer — the app's own UI only ever soft-deactivates an enrollment via
-- PATCH, never a hard delete, and CREATE POLICY's FOR clause only accepts
-- one command per policy, so "select, insert, update" isn't valid syntax
-- for a single policy the way "all" is.
drop policy if exists "teacher can manage enrollments for assigned classes" on class_enrollments;
drop policy if exists "teacher can view enrollments for assigned classes" on class_enrollments;
create policy "teacher can view enrollments for assigned classes"
  on class_enrollments for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_assigned_to_class(class_enrollments.class_id)
  );

drop policy if exists "teacher can insert enrollments for assigned classes" on class_enrollments;
create policy "teacher can insert enrollments for assigned classes"
  on class_enrollments for insert
  to authenticated
  with check (
    current_teacher_id() is not null
    and teacher_assigned_to_class(class_enrollments.class_id)
  );

drop policy if exists "teacher can update enrollments for assigned classes" on class_enrollments;
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

-- Same split as class_enrollments above, same reason: select/insert/update
-- only, no teacher-level delete at the database layer.
drop policy if exists "teacher can manage attendance for assigned classes" on attendance_records;
drop policy if exists "teacher can view attendance for assigned classes" on attendance_records;
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

drop policy if exists "teacher can insert attendance for assigned classes" on attendance_records;
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

drop policy if exists "teacher can update attendance for assigned classes" on attendance_records;
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

drop policy if exists "teacher can insert students" on students;
create policy "teacher can insert students"
  on students for insert
  to authenticated
  with check (current_teacher_id() is not null);

drop policy if exists "teacher can view students in their classes" on students;
create policy "teacher can view students in their classes"
  on students for select
  to authenticated
  using (
    current_teacher_id() is not null
    and teacher_can_access_student(students.id)
  );

drop policy if exists "teacher can update students in their classes" on students;
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

drop policy if exists "teacher can manage documents for their students" on student_documents;
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

drop policy if exists "teacher can view own record" on teachers;
create policy "teacher can view own record"
  on teachers for select
  to authenticated
  using (
    current_teacher_id() is not null
    and id = current_teacher_id()
  );

drop policy if exists "teacher can update own record" on teachers;
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

-- RLS is row-scoped, not column-scoped — see the full comment in
-- schema.sql. Without this, a teacher's own valid session could PATCH
-- their own row's login_enabled/auth_user_id directly, bypassing
-- api/manage-teacher-login.js entirely.
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

drop policy if exists "teacher can manage own documents" on teacher_documents;
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

-- ============================================================
-- 5. storage.objects policies on the student-files bucket
--    Objects live under students/{student_id}/... or
--    teachers/{teacher_id}/...; storage.foldername(name) splits the path
--    into folder segments so [1] is 'students'/'teachers' and [2] is the
--    id. The ~ regex guards the uuid cast so a malformed/unexpected path
--    just fails the policy instead of raising and breaking the query.
-- ============================================================
drop policy if exists "owner full access to student-files (select)" on storage.objects;
create policy "owner full access to student-files (select)"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'student-files' and current_teacher_id() is null);

drop policy if exists "owner full access to student-files (insert)" on storage.objects;
create policy "owner full access to student-files (insert)"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'student-files' and current_teacher_id() is null);

drop policy if exists "owner full access to student-files (update)" on storage.objects;
create policy "owner full access to student-files (update)"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'student-files' and current_teacher_id() is null)
  with check (bucket_id = 'student-files' and current_teacher_id() is null);

drop policy if exists "owner full access to student-files (delete)" on storage.objects;
create policy "owner full access to student-files (delete)"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'student-files' and current_teacher_id() is null);

drop policy if exists "teacher can access files for their students" on storage.objects;
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

drop policy if exists "teacher can access own teacher files" on storage.objects;
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

-- fees/email_templates/trial_bookings policies and the anon/service_role
-- paths are untouched by this migration.
