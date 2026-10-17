-- =====================================================
-- EXTENSION
-- =====================================================
create extension if not exists "pgcrypto";

-- =====================================================
-- CORE MULTI TENANT
-- =====================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  timezone text default 'Asia/Jakarta',
  exam_warning_limit int default 3,
  auto_submit_on_warning boolean default true,
  created_at timestamptz default now(),
  unique (organization_id)
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  avatar_url text,
  identity_number text,
  created_at timestamptz default now()
);

-- =====================================================
-- SESSION VARIABLE: set before admin updates to bypass immutability
-- =====================================================
create or replace function profiles_set_session()
returns void as $$
begin
  perform set_config('app.is_admin', 'true', true);
end;
$$ language plpgsql;

-- =====================================================
-- IMMUTABILITY: full_name and identity_number can be changed
-- by admin via server actions that set session variable.
-- =====================================================

create or replace function profiles_immutable_fields()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
    -- Allow changes if session variable is set (admin bypass)
    if current_setting('app.is_admin', true) = 'true' then
      return new;
    end if;
    -- Otherwise block changes to these critical identity fields
    if old.full_name is distinct from new.full_name then
      raise exception 'Cannot modify full_name after user creation. Contact system administrator.';
    end if;
    if old.identity_number is distinct from new.identity_number then
      raise exception 'Cannot modify identity_number (NISN/NIP) after user creation. Contact system administrator.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_immutability on profiles;
create trigger profiles_immutability
  before update on profiles
  for each row execute function profiles_immutable_fields();

create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  is_active boolean default true,
  joined_at timestamptz default now(),
  unique (organization_id, user_id)
);

-- =====================================================
-- RBAC
-- =====================================================

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  scope text check (scope in ('platform','organization')) not null,
  created_at timestamptz default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid references roles(id) on delete cascade,
  permission_id uuid references permissions(id) on delete cascade,
  unique (role_id, permission_id)
);

create table if not exists member_roles (
  id uuid primary key default gen_random_uuid(),
  organization_member_id uuid references organization_members(id) on delete cascade,
  role_id uuid references roles(id) on delete cascade,
  unique (organization_member_id, role_id)
);

-- =====================================================
-- SUBSCRIPTION
-- =====================================================

create table if not exists subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  max_users int,
  max_concurrent_users int,
  max_storage_mb int,
  price numeric,
  duration_days int,
  created_at timestamptz default now()
);

create table if not exists organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  plan_id uuid references subscription_plans(id),
  start_date date,
  end_date date,
  status text check (status in ('active','expired','cancelled')),
  created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  subscription_id uuid references organization_subscriptions(id),
  amount numeric,
  payment_method text,
  status text,
  external_reference text,
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- =====================================================
-- ASSESSMENT INVENTORY
-- =====================================================

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  type text check (type in ('reguler', 'tambahan')) default 'reguler',
  created_at timestamptz default now()
);

create table if not exists question_banks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  title text not null,
  description text,
  created_by uuid references profiles(id),
  is_published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists bank_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  bank_id uuid references question_banks(id) on delete cascade,
  type text check (type in ('mcq', 'mcq_complex', 'true_false', 'matching', 'categorization', 'short_answer', 'essay', 'sjt', 'ordering')),
  question_text text not null,
  difficulty text check (difficulty in ('easy','medium','hard')),
  score_default int default 1,
  created_at timestamptz default now()
);

create table if not exists bank_question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references bank_questions(id) on delete cascade,
  option_text text not null,
  is_correct boolean default false,
  weight numeric default 1
);

-- =====================================================
-- EXAM SYSTEM
-- =====================================================

create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  question_bank_id uuid references question_banks(id) on delete set null,
  subject_id uuid references subjects(id),
  title text not null,
  description text,
  exam_type text default 'daily',
  duration_minutes int not null,
  status text check (status in ('draft','scheduled','active','ended','archived','finished')) default 'draft',
  randomize_questions boolean default true,
  randomize_options boolean default true,
  start_time timestamptz,
  end_time timestamptz,
  is_published boolean default false,
  show_results boolean default false,
  metadata jsonb default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists exam_schedules (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete cascade,
  start_time timestamptz,
  end_time timestamptz
);

create table if not exists exam_question_sources (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete cascade,
  bank_id uuid references question_banks(id),
  difficulty text,
  question_count int
);

create table if not exists class_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (class_id, user_id)
);

create table if not exists exam_targets (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete cascade,
  class_id uuid references classes(id) on delete cascade,
  created_at timestamptz default now(),
  unique (exam_id, class_id)
);

create table if not exists exam_participants (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete cascade,
  user_id uuid references profiles(id),
  created_at timestamptz default now(),
  unique (exam_id, user_id)
);

-- =====================================================
-- ATTEMPT SYSTEM
-- =====================================================

create table if not exists exam_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  exam_id uuid references exams(id) on delete cascade,
  user_id uuid references profiles(id),
  started_at timestamptz,
  personal_end_time timestamptz,
  finished_at timestamptz,
  status text check (status in ('in_progress','submitted','auto_submitted')),
  total_score numeric,
  needs_manual_grading boolean default false,
  tab_switch_count int default 0,
  warning_count int default 0,
  ip_address text,
    device_fingerprint text,
    last_seen_at timestamptz,
    created_at timestamptz default now()
);

create table if not exists exam_attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references exam_attempts(id) on delete cascade,
  question_id uuid references bank_questions(id),
  order_number int
);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references exam_attempts(id) on delete cascade,
  question_id uuid references bank_questions(id),
  selected_option_id uuid references bank_question_options(id),
  essay_answer text,
  score numeric,
  is_correct boolean,
  is_doubtful boolean default false,
  created_at timestamptz default now(),
  unique (attempt_id, question_id)
);

-- =====================================================
-- SECURITY & PROCTORING
-- =====================================================

create table if not exists attempt_security_logs (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references exam_attempts(id) on delete cascade,
  event_type text,
  metadata jsonb,
  created_at timestamptz default now()
);

create unique index if not exists security_logs_client_event_unique
  on attempt_security_logs(attempt_id, (metadata->>'client_event_id'))
  where metadata ? 'client_event_id';

create table if not exists proctoring_snapshots (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references exam_attempts(id) on delete cascade,
  image_url text,
  captured_at timestamptz default now()
);

-- =====================================================
-- CERTIFICATE
-- =====================================================

create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  exam_id uuid references exams(id),
  user_id uuid references profiles(id),
  certificate_number text unique,
  file_url text,
  verification_code text unique,
  issued_at timestamptz default now()
);

-- =====================================================
-- PAS / PAT PERIOD MANAGEMENT
-- =====================================================

-- Master table: Subjects (Mata Pelajaran)
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  code text,
  color text default '#6366f1',
  created_at timestamptz default now()
);

-- PAS Period (Rumah PAS/PAT)
create table if not exists pas_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  type text check (type in ('pas','pat','pts','pkn','am')) default 'pas',
  school_year text not null,
  semester text check (semester in ('ganjil','genap')) not null,
  start_date date not null,
  end_date date not null,
  is_locked boolean default false,
  committee_chair_name text,
  committee_chair_nip text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- PAS Subjects (Mapel dalam Rumah PAS)
create table if not exists pas_subjects (
  id uuid primary key default gen_random_uuid(),
  pas_period_id uuid references pas_periods(id) on delete cascade,
  subject_id uuid references subjects(id) on delete cascade,
  bank_id uuid references question_banks(id),
  duration_minutes int default 90,
  total_questions int default 40,
  passing_score numeric default 70,
  difficulty_target text check (difficulty_target in ('easy','medium','hard','mixed')) default 'mixed',
  created_at timestamptz default now(),
  unique (pas_period_id, subject_id)
);

-- PAS Sessions (Sesi Ujian)
create table if not exists pas_sessions (
  id uuid primary key default gen_random_uuid(),
  pas_period_id uuid references pas_periods(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz default now(),
  unique (pas_period_id, name)
);

-- PAS Class Schedules (Jadwal per Kelas — bank soal langsung ke kelas)
create table if not exists pas_class_schedules (
  id uuid primary key default gen_random_uuid(),
  pas_period_id uuid references pas_periods(id) on delete cascade,
  bank_id uuid references question_banks(id),
  subject_id uuid references subjects(id),
  class_id uuid references classes(id) on delete cascade,
  exam_id uuid references exams(id),
  scheduled_date date not null,
  session_id uuid references pas_sessions(id) on delete set null,
  scheduled_time time not null,
  window_end_time time not null,
  duration_minutes int default 90,
  room text,
  status text check (status in ('scheduled','active','finished','cancelled')) default 'scheduled',
  created_at timestamptz default now(),
  unique (pas_period_id, bank_id, class_id)
);

-- =====================================================
-- INDEX STRATEGY
-- =====================================================

create index if not exists idx_org_members_user on organization_members(user_id);
create index if not exists idx_org_members_org on organization_members(organization_id);
create index if not exists idx_exam_org on exams(organization_id);
create index if not exists idx_attempt_exam_user on exam_attempts(exam_id, user_id);
create index if not exists idx_attempt_status on exam_attempts(status);
  create index if not exists idx_attempt_active on exam_attempts(exam_id) where status = 'in_progress';
  create unique index if not exists exam_attempts_one_active_per_user_exam
    on exam_attempts(exam_id, user_id) where status = 'in_progress';
create index if not exists idx_answers_attempt on answers(attempt_id);
create index if not exists idx_bank_questions_bank on bank_questions(bank_id);
create index if not exists idx_bank_questions_difficulty on bank_questions(difficulty);
create index if not exists idx_pas_periods_org on pas_periods(organization_id);
create index if not exists idx_pas_subjects_period on pas_subjects(pas_period_id);
create index if not exists idx_pas_schedules_period on pas_class_schedules(pas_period_id);
create index if not exists idx_pas_schedules_bank on pas_class_schedules(bank_id);
create index if not exists idx_pas_schedules_class on pas_class_schedules(class_id);
create index if not exists idx_pas_schedules_subject on pas_class_schedules(subject_id);
create index if not exists idx_exams_subject on exams(subject_id);
create index if not exists idx_subjects_org on subjects(organization_id);

-- =====================================================
-- HELPER: PLATFORM ADMIN CHECK
-- True if user has NO organization membership (i.e., platform owner).
-- False for all org members (proktor, guru, siswa, etc.).
-- =====================================================

create or replace function is_platform_admin()
returns boolean as $$
begin
  -- Platform admin = user NOT in any organization
  return not exists (
    select 1 from organization_members where user_id = auth.uid()
  );
end;
$$ language plpgsql stable;

-- =====================================================
-- SERVER TIME (authoritative, not device time)
-- =====================================================
create or replace function now()
returns timestamptz as $$
begin
  return now();
end;
$$ language plpgsql stable;

-- =====================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================

alter table organizations enable row level security;
alter table organization_settings enable row level security;
alter table organization_members enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table member_roles enable row level security;
alter table question_banks enable row level security;
alter table bank_questions enable row level security;
alter table bank_question_options enable row level security;
alter table exams enable row level security;
alter table exam_schedules enable row level security;
alter table exam_question_sources enable row level security;
alter table exam_targets enable row level security;
alter table exam_participants enable row level security;
alter table exam_attempts enable row level security;
alter table exam_attempt_questions enable row level security;
alter table answers enable row level security;
alter table attempt_security_logs enable row level security;
alter table proctoring_snapshots enable row level security;
alter table certificates enable row level security;
alter table subjects enable row level security;
alter table pas_periods enable row level security;
alter table pas_subjects enable row level security;
alter table pas_class_schedules enable row level security;

-- =====================================================
-- RLS POLICIES (drop existing first for idempotency)
-- =====================================================

-- ROLES (read-only for all authenticated)
drop policy if exists "roles_select" on roles;
create policy "roles_select" on roles for select using (true);

-- PERMISSIONS (read-only for all authenticated)
drop policy if exists "permissions_select" on permissions;
create policy "permissions_select" on permissions for select using (true);

-- ROLE_PERMISSIONS (read-only for all authenticated)
drop policy if exists "role_permissions_select" on role_permissions;
create policy "role_permissions_select" on role_permissions for select using (true);

-- MEMBER_ROLES (all authenticated users can read - needed for role detection)
drop policy if exists "member_roles_select" on member_roles;
drop policy if exists "member_roles_isolation" on member_roles;
drop policy if exists "member_roles_user_select" on member_roles;
create policy "member_roles_select" on member_roles for select using (true);

-- ORGANIZATION MEMBERS (all authenticated users can read their own membership)
drop policy if exists "org_members_select" on organization_members;
drop policy if exists "member_of_org" on organization_members;
create policy "org_members_select" on organization_members for select using (true);

-- ORGANIZATIONS (admins can manage all, members can only read their org)
drop policy if exists "org_select" on organizations;
create policy "org_select" on organizations for select using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = organizations.id
  )
);

drop policy if exists "org_insert" on organizations;
create policy "org_insert" on organizations for insert with check (is_platform_admin());

drop policy if exists "org_update" on organizations;
create policy "org_update" on organizations for update using (is_platform_admin());

drop policy if exists "org_delete" on organizations;
create policy "org_delete" on organizations for delete using (is_platform_admin());

-- EXAMS
drop policy if exists "exam_isolation" on exams;
create policy "exam_isolation" on exams for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = exams.organization_id
  )
);

-- EXAM TARGETS
drop policy if exists "exam_target_isolation" on exam_targets;
create policy "exam_target_isolation" on exam_targets for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    join exams e on e.organization_id = om.organization_id
    where om.user_id = auth.uid() and e.id = exam_targets.exam_id
  )
);

-- EXAM PARTICIPANTS
drop policy if exists "exam_participant_isolation" on exam_participants;
create policy "exam_participant_isolation" on exam_participants for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    join exams e on e.organization_id = om.organization_id
    where om.user_id = auth.uid() and e.id = exam_participants.exam_id
  )
);

-- EXAM ATTEMPTS
drop policy if exists "exam_attempt_isolation" on exam_attempts;
create policy "exam_attempt_isolation" on exam_attempts for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid() and om.organization_id = exam_attempts.organization_id
  )
  OR exam_attempts.user_id = auth.uid()
);

-- QUESTION BANKS
drop policy if exists "bank_select" on question_banks;
create policy "bank_select" on question_banks for select using (
  is_platform_admin() OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid() and om.organization_id = question_banks.organization_id
  )
);

drop policy if exists "bank_insert" on question_banks;
create policy "bank_insert" on question_banks for insert with check (
  is_platform_admin() OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid() and om.organization_id = question_banks.organization_id
  )
);

drop policy if exists "bank_update" on question_banks;
create policy "bank_update" on question_banks for update using (
  is_platform_admin() OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid() and om.organization_id = question_banks.organization_id
  )
);

drop policy if exists "bank_delete" on question_banks;
create policy "bank_delete" on question_banks for delete using (
  is_platform_admin() OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid() and om.organization_id = question_banks.organization_id
  )
);

-- BANK QUESTIONS
drop policy if exists "bank_questions_isolation" on bank_questions;
create policy "bank_questions_isolation" on bank_questions for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = bank_questions.organization_id
  )
);

-- ATTEMPT (SELECT)
drop policy if exists "attempt_select" on exam_attempts;
create policy "attempt_select" on exam_attempts for select using (
  is_platform_admin()
  OR user_id = auth.uid()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = exam_attempts.organization_id
  )
);

-- ATTEMPT (INSERT)
drop policy if exists "attempt_insert" on exam_attempts;
create policy "attempt_insert" on exam_attempts for insert with check (
  user_id = auth.uid()
);

-- ANSWERS
drop policy if exists "answers_policy" on answers;
create policy "answers_policy" on answers for all using (
  is_platform_admin()
  OR exists (
    select 1 from exam_attempts ea
    where ea.id = answers.attempt_id
    and (
      ea.user_id = auth.uid()
      OR exists (
        select 1 from organization_members om
        where om.user_id = auth.uid()
        and om.organization_id = ea.organization_id
      )
    )
  )
);

-- CERTIFICATES
drop policy if exists "certificate_policy" on certificates;
create policy "certificate_policy" on certificates for select using (
  is_platform_admin()
  OR user_id = auth.uid()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = certificates.organization_id
  )
);

-- SUBJECTS
drop policy if exists "subjects_isolation" on subjects;
create policy "subjects_isolation" on subjects for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = subjects.organization_id
  )
);

-- PAS PERIODS
drop policy if exists "pas_periods_isolation" on pas_periods;
create policy "pas_periods_isolation" on pas_periods for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = pas_periods.organization_id
  )
);

-- PAS SUBJECTS
drop policy if exists "pas_subjects_isolation" on pas_subjects;
create policy "pas_subjects_isolation" on pas_subjects for all using (
  is_platform_admin()
  OR exists (
    select 1 from pas_periods pp
    join organization_members om on om.organization_id = pp.organization_id
    where om.user_id = auth.uid()
    and pp.id = pas_subjects.pas_period_id
  )
);

-- PAS CLASS SCHEDULES
drop policy if exists "pas_class_schedules_isolation" on pas_class_schedules;
create policy "pas_class_schedules_isolation" on pas_class_schedules for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    join pas_periods pp on pp.organization_id = om.organization_id
    where om.user_id = auth.uid()
    and pp.id = pas_class_schedules.pas_period_id
  )
);

-- =====================================================
-- SEED ROLES & PERMISSIONS
-- =====================================================

insert into roles (name, scope) values
('Admin','platform'),
('Proktor','organization'),
('Guru','organization'),
('Pengawas','organization'),
('Siswa','organization')
on conflict do nothing;

insert into permissions (name) values
('manage_organization'),
('manage_members'),
('create_exam'),
('edit_exam'),
('publish_exam'),
('delete_exam'),
('monitor_exam'),
('grade_exam'),
('view_reports'),
('take_exam'),
('manage_subscription')
on conflict do nothing;

-- Admin (platform) → all permissions
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r, permissions p
where r.name = 'Admin'
on conflict do nothing;

-- Proktor
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.name in (
  'manage_members','create_exam','edit_exam','publish_exam','monitor_exam','view_reports'
)
where r.name = 'Proktor'
on conflict do nothing;

-- Guru
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.name in (
  'create_exam','edit_exam','publish_exam','grade_exam'
)
where r.name = 'Guru'
on conflict do nothing;

-- Pengawas
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.name in (
  'monitor_exam','view_reports'
)
where r.name = 'Pengawas'
on conflict do nothing;

-- Siswa
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.name in (
  'take_exam'
)
where r.name = 'Siswa'
on conflict do nothing;

-- =====================================================
-- MIGRATION: Add columns for exam publishing flow
-- Run this on existing databases that don't have these columns
-- =====================================================

alter table exams add column if not exists is_published boolean default false;
alter table exams add column if not exists show_results boolean default false;
alter table exams add column if not exists metadata jsonb default '{}';
alter table exams add column if not exists exam_type text check (exam_type in ('daily','pas','pat','pts','pkn','am','lainnya','assignment','tryout','quiz')) default 'pas';
alter table exams add column if not exists description text;
alter table exams drop constraint if exists exams_status_check;
alter table exams add constraint exams_status_check check (status in ('draft','scheduled','active','ended','archived','finished'));
alter table exam_attempts add column if not exists needs_manual_grading boolean default false;
alter table exam_attempts add column if not exists personal_end_time timestamptz;
alter table answers add column if not exists is_doubtful boolean default false;
alter table question_banks add column if not exists is_published boolean default false;
alter table question_banks add column if not exists tags text[] default '{}';
alter table pas_class_schedules add column if not exists window_end_time time default '23:59';

-- =====================================================
-- CUSTOM LABELS (proctor-defined, org-scoped)
-- =====================================================
create table if not exists organization_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade not null,
  name text not null,
  color text default '#6366f1',
  created_at timestamptz default now(),
  unique (organization_id, name)
);

alter table organization_labels enable row level security;

drop policy if exists "labels_select" on organization_labels;
create policy "labels_select" on organization_labels for select using (
  is_platform_admin()
  or exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = organization_labels.organization_id
  )
);

drop policy if exists "labels_insert" on organization_labels;
create policy "labels_insert" on organization_labels for insert with check (
  is_platform_admin()
  or exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = organization_labels.organization_id
    and exists (
      select 1 from member_roles mr
      join roles r on r.id = mr.role_id
      where mr.organization_member_id = om.id and r.name = 'Proktor'
    )
  )
);

drop policy if exists "labels_delete" on organization_labels;
create policy "labels_delete" on organization_labels for delete using (
  is_platform_admin()
  or exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = organization_labels.organization_id
    and exists (
      select 1 from member_roles mr
      join roles r on r.id = mr.role_id
      where mr.organization_member_id = om.id and r.name = 'Proktor'
    )
  )
);

-- =====================================================
-- STIMULUS (Shared reading texts/media for questions)
-- =====================================================

create table if not exists question_stimuli (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  bank_id uuid references question_banks(id) on delete cascade,
  title text,
  content text not null,
  created_at timestamptz default now()
);

alter table bank_questions add column if not exists stimulus_id uuid references question_stimuli(id) on delete set null;

-- RLS for Stimulus
alter table question_stimuli enable row level security;

drop policy if exists "stimuli_isolation" on question_stimuli;
create policy "stimuli_isolation" on question_stimuli for all using (
  is_platform_admin()
  OR exists (
    select 1 from organization_members om
    where om.user_id = auth.uid()
    and om.organization_id = question_stimuli.organization_id
  )
);

