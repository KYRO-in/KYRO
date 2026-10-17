-- ============================================================
-- Kayyro: staff attendance with photos, and the AI assistant's monthly allowance
--
-- 1) employees: the people who work in the shop. They do not need an app login.
--    Each has a 4-digit PIN (hashed by the server, kept in employee_secrets
--    where no signed-in user can read it) and a private check-in link for
--    their own phone.
-- 2) attendance: every check-in and check-out, with the selfie taken at that
--    moment and, from a phone, where it was taken. Kiosk and phone punches are
--    written by the server after the PIN is checked; admins can add or remove
--    manual corrections.
-- 3) attendance storage bucket (private): {organization_id}/punches/... and
--    {organization_id}/profiles/{employee_id}.jpg
-- 4) Plan limits gain employees: trial and Starter 5, Pro 15, Business unlimited.
-- 5) ai_usage: questions asked to Ask Kayyro per month, for the plan allowance
--    (trial/Starter/Pro/Business: 30/100/400/1500; in India 20/50/200/600).
--
-- Run after 042. Additive, data-safe and safe to re-run.
-- ============================================================

-- ---------- 1) Employees ----------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  job_title text,
  phone text,
  -- Shift times are wall-clock times in the shop; used to mark late arrivals
  shift_start time,
  shift_end time,
  -- Lets the employee check in from their own phone with the private link
  allow_phone boolean not null default true,
  checkin_token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  photo_path text,
  has_pin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.employees drop constraint if exists employees_full_name_check;
alter table public.employees add constraint employees_full_name_check
  check (length(btrim(full_name)) between 1 and 80);
alter table public.employees drop constraint if exists employees_job_title_check;
alter table public.employees add constraint employees_job_title_check
  check (job_title is null or length(job_title) <= 60);
alter table public.employees drop constraint if exists employees_phone_check;
alter table public.employees add constraint employees_phone_check
  check (phone is null or length(phone) <= 30);

create unique index if not exists employees_checkin_token_key on public.employees (checkin_token);
create index if not exists employees_org_idx on public.employees (organization_id, active);

alter table public.employees enable row level security;

drop policy if exists "employees_select" on public.employees;
drop policy if exists "employees_insert" on public.employees;
drop policy if exists "employees_update" on public.employees;
drop policy if exists "employees_delete" on public.employees;

create policy "employees_select" on public.employees
  for select to authenticated using (organization_id = public.current_org_id());
create policy "employees_insert" on public.employees
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_admin());
create policy "employees_update" on public.employees
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());
create policy "employees_delete" on public.employees
  for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

-- The PIN hash lives apart from employees so no signed-in user can ever read it.
-- RLS is on with no policies: only the server (service role) touches this table.
create table if not exists public.employee_secrets (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.employee_secrets enable row level security;
revoke all on public.employee_secrets from anon, authenticated;

-- ---------- 2) Attendance ----------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null,
  at timestamptz not null default now(),
  source text not null default 'kiosk',
  photo_path text,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.attendance drop constraint if exists attendance_kind_check;
alter table public.attendance add constraint attendance_kind_check check (kind in ('in', 'out'));
alter table public.attendance drop constraint if exists attendance_source_check;
alter table public.attendance add constraint attendance_source_check
  check (source in ('kiosk', 'phone', 'manual'));
alter table public.attendance drop constraint if exists attendance_note_check;
alter table public.attendance add constraint attendance_note_check
  check (note is null or length(note) <= 200);
alter table public.attendance drop constraint if exists attendance_location_check;
alter table public.attendance add constraint attendance_location_check
  check (
    (latitude is null or latitude between -90 and 90)
    and (longitude is null or longitude between -180 and 180)
  );

create index if not exists attendance_org_at_idx on public.attendance (organization_id, at desc);
create index if not exists attendance_employee_at_idx on public.attendance (employee_id, at desc);

alter table public.attendance enable row level security;

drop policy if exists "attendance_select" on public.attendance;
drop policy if exists "attendance_insert_manual" on public.attendance;
drop policy if exists "attendance_update" on public.attendance;
drop policy if exists "attendance_delete" on public.attendance;

create policy "attendance_select" on public.attendance
  for select to authenticated using (organization_id = public.current_org_id());
-- Signed-in admins may only add manual corrections; photo punches come from the server
create policy "attendance_insert_manual" on public.attendance
  for insert to authenticated
  with check (
    organization_id = public.current_org_id()
    and public.is_admin()
    and source = 'manual'
    and photo_path is null
    and exists (
      select 1 from public.employees e
      where e.id = employee_id and e.organization_id = public.current_org_id()
    )
  );
create policy "attendance_delete" on public.attendance
  for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

-- An employee row must belong to the same business as its punches
create or replace function public.attendance_same_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.organization_id = new.organization_id
  ) then
    raise exception 'Employee not found in this business' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.attendance_same_org() from public, anon;

drop trigger if exists attendance_same_org on public.attendance;
create trigger attendance_same_org
  before insert on public.attendance
  for each row execute function public.attendance_same_org();

-- Read-only accountants cannot change employees or attendance
drop trigger if exists zz_read_only_guard on public.employees;
create trigger zz_read_only_guard
  before insert or update or delete on public.employees
  for each row execute function public.block_read_only_writes();
drop trigger if exists zz_read_only_guard on public.attendance;
create trigger zz_read_only_guard
  before insert or update or delete on public.attendance
  for each row execute function public.block_read_only_writes();

-- Server-only punch: works out in/out from the last punch today (in the shop's
-- local day, passed by the caller) and records it in one step.
create or replace function public.attendance_punch(
  p_employee uuid,
  p_source text,
  p_photo_path text,
  p_day_start timestamptz,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy double precision default null,
  p_created_by uuid default null
)
returns public.attendance
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp public.employees;
  v_last text;
  v_row public.attendance;
begin
  select * into v_emp from public.employees where id = p_employee for update;
  if not found or not v_emp.active then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;

  select kind into v_last
  from public.attendance
  where employee_id = p_employee and at >= p_day_start
  order by at desc
  limit 1;

  insert into public.attendance (
    organization_id, employee_id, kind, source, photo_path,
    latitude, longitude, accuracy_m, created_by
  ) values (
    v_emp.organization_id, p_employee,
    case when v_last = 'in' then 'out' else 'in' end,
    p_source, p_photo_path, p_latitude, p_longitude, p_accuracy, p_created_by
  )
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.attendance_punch(uuid, text, text, timestamptz, double precision, double precision, double precision, uuid) from public, anon, authenticated;
grant execute on function public.attendance_punch(uuid, text, text, timestamptz, double precision, double precision, double precision, uuid) to service_role;

-- ---------- 3) Private photo bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance', 'attendance', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attendance_photos_select_own_org" on storage.objects;
drop policy if exists "attendance_profiles_insert_admin" on storage.objects;
drop policy if exists "attendance_profiles_update_admin" on storage.objects;
drop policy if exists "attendance_profiles_delete_admin" on storage.objects;

create policy "attendance_photos_select_own_org" on storage.objects
  for select to authenticated
  using (bucket_id = 'attendance' and (storage.foldername(name))[1] = public.current_org_id()::text);

-- Admins manage reference photos only; punch photos are written by the server
create policy "attendance_profiles_insert_admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attendance'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = 'profiles'
    and public.is_admin()
  );
create policy "attendance_profiles_update_admin" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attendance'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = 'profiles'
    and public.is_admin()
  )
  with check (
    bucket_id = 'attendance'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = 'profiles'
    and public.is_admin()
  );
create policy "attendance_profiles_delete_admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attendance'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and (storage.foldername(name))[2] = 'profiles'
    and public.is_admin()
  );

-- ---------- 4) Plan limits: employees ----------
create or replace function public.plan_limit(p_plan text, p_resource text)
returns integer
language sql
immutable
as $$
  select case
    when p_resource = 'invoices' then
      case coalesce(p_plan, 'free') when 'business' then null when 'pro' then 300 else 50 end
    when p_resource = 'products' then
      case coalesce(p_plan, 'free') when 'business' then null when 'pro' then null else 100 end
    when p_resource = 'employees' then
      case coalesce(p_plan, 'free') when 'business' then null when 'pro' then 15 else 5 end
    when p_resource = 'ai_questions' then
      case coalesce(p_plan, 'free') when 'business' then 1500 when 'pro' then 400 when 'starter' then 100 else 30 end
    -- India pays in rupees, so its allowance is smaller (each answer costs the same)
    when p_resource = 'ai_questions_in' then
      case coalesce(p_plan, 'free') when 'business' then 600 when 'pro' then 200 when 'starter' then 50 else 20 end
  end;
$$;

create or replace function public.enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_status text;
  v_trial_end timestamptz;
  v_max integer;
  v_count integer;
  v_month date;
begin
  -- Only limit people using the app; server jobs (service role) are not limited
  if auth.uid() is null then
    return new;
  end if;

  select plan, subscription_status, trial_ends_at
    into v_plan, v_status, v_trial_end
  from public.organizations where id = new.organization_id;

  if v_status = 'cancelled' then
    raise exception 'Your subscription is cancelled. Choose a plan in Settings → Billing to keep creating records.'
      using errcode = 'P0001';
  end if;
  if v_status = 'past_due' then
    raise exception 'Your last payment did not go through. Update billing in Settings → Billing to keep creating records.'
      using errcode = 'P0001';
  end if;
  if coalesce(v_status, 'trialing') = 'trialing' and v_trial_end is not null and v_trial_end < now() then
    raise exception 'Your free trial has ended. Choose a plan in Settings → Billing to keep creating records.'
      using errcode = 'P0001';
  end if;

  if tg_table_name = 'invoices' then
    v_max := public.plan_limit(v_plan, 'invoices');
    if v_max is not null then
      v_month := date_trunc('month', coalesce(new.invoice_date, current_date))::date;
      select count(*) into v_count
      from public.invoices
      where organization_id = new.organization_id
        and invoice_date >= v_month
        and invoice_date < (v_month + interval '1 month')
        and status <> 'cancelled';
      if v_count >= v_max then
        raise exception 'You have reached your plan''s limit of % invoices this month. Upgrade in Settings → Billing to continue.', v_max
          using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'products' then
    if coalesce(new.is_active, true) and (tg_op = 'INSERT' or not coalesce(old.is_active, false)) then
      v_max := public.plan_limit(v_plan, 'products');
      if v_max is not null then
        select count(*) into v_count
        from public.products
        where organization_id = new.organization_id and is_active;
        if v_count >= v_max then
          raise exception 'You have reached your plan''s limit of % active products. Upgrade in Settings → Billing to continue.', v_max
            using errcode = 'P0001';
        end if;
      end if;
    end if;
  elsif tg_table_name = 'employees' then
    if coalesce(new.active, true) and (tg_op = 'INSERT' or not coalesce(old.active, false)) then
      v_max := public.plan_limit(v_plan, 'employees');
      if v_max is not null then
        select count(*) into v_count
        from public.employees
        where organization_id = new.organization_id and active;
        if v_count >= v_max then
          raise exception 'Your plan includes % active employees. Upgrade in Settings → Billing to add more.', v_max
            using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_plan_limits() from public, anon;

drop trigger if exists employees_plan_limits on public.employees;
create trigger employees_plan_limits
  before insert or update of active on public.employees
  for each row execute function public.enforce_plan_limits();

-- ---------- 5) Ask Kayyro allowance ----------
create table if not exists public.ai_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  questions integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, month)
);
alter table public.ai_usage enable row level security;

drop policy if exists "ai_usage_select" on public.ai_usage;
create policy "ai_usage_select" on public.ai_usage
  for select to authenticated using (organization_id = public.current_org_id());
revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- Server-only: count one question if the month's allowance allows it.
create or replace function public.ai_usage_take(p_org uuid)
returns table (allowed boolean, used integer, max_questions integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_country text;
  v_max integer;
  v_month date := date_trunc('month', now())::date;
  v_used integer;
begin
  select plan, country into v_plan, v_country from public.organizations where id = p_org;
  v_max := public.plan_limit(v_plan, case when upper(coalesce(v_country, '')) = 'IN' then 'ai_questions_in' else 'ai_questions' end);

  insert into public.ai_usage (organization_id, month) values (p_org, v_month)
  on conflict (organization_id, month) do nothing;

  select questions into v_used from public.ai_usage
  where organization_id = p_org and month = v_month
  for update;

  if v_max is not null and v_used >= v_max then
    return query select false, v_used, v_max;
    return;
  end if;

  update public.ai_usage set questions = questions + 1, updated_at = now()
  where organization_id = p_org and month = v_month
  returning questions into v_used;
  return query select true, v_used, v_max;
end;
$$;
revoke execute on function public.ai_usage_take(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_take(uuid) to service_role;

create or replace function public.ai_usage_tokens(p_org uuid, p_input bigint, p_output bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.ai_usage
  set input_tokens = input_tokens + greatest(p_input, 0),
      output_tokens = output_tokens + greatest(p_output, 0),
      updated_at = now()
  where organization_id = p_org and month = date_trunc('month', now())::date;
$$;
revoke execute on function public.ai_usage_tokens(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_usage_tokens(uuid, bigint, bigint) to service_role;

-- ---------- Schema version ----------
create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
as $$ select 43 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
