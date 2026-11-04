-- ============================================================
-- Kayyro Collect, phase 1: automatic payment reminders
--
-- 1) Invoices get a due date (customer payment terms, else the business
--    default, else 30 days). Existing invoices get invoice date + 30 days.
--    The due date stays editable on an issued invoice.
-- 2) Customers get payment terms, language, channel, "pause chasing",
--    a WhatsApp opt-in (with its date), an opt-out (set by the customer's
--    own link) and a private token for that link.
-- 3) New tables: collect_settings, reminder_steps, collection_messages,
--    collect_tasks, payment_promises, disputes, collect_channel_accounts.
-- 4) The scheduler (pg_cron -> /api/collect/run) plans reminders with
--    collect_plan(), and sends each one only after collect_claim():
--    - the invoice is re-checked at that moment (paid, cancelled, credited,
--      disputed, promised, paused, opted out => never sent);
--    - sending hours, working days, Ramadan hours, in the business's time zone;
--    - a unique index allows one message per invoice per channel per day;
--    - a claimed message can't be claimed again, so a double scheduler run
--      can't send twice.
-- 5) Plans: Pro and trials chase up to 100 invoices a month, Business has no
--    limit, Starter can't switch Kayyro Collect on.
--
-- Run after 048. Additive, data-safe and safe to re-run.
-- ============================================================

-- ---------- 1) Due dates ----------
alter table public.invoices add column if not exists due_date date;
create index if not exists invoices_org_due_idx on public.invoices (organization_id, due_date) where status in ('issued', 'partially_paid');

-- ---------- 2) Customers ----------
alter table public.customers add column if not exists payment_terms_days integer;
alter table public.customers add column if not exists preferred_language text not null default 'auto';
alter table public.customers add column if not exists preferred_channel text not null default 'both';
alter table public.customers add column if not exists collect_paused boolean not null default false;
alter table public.customers add column if not exists whatsapp_opt_in_at timestamptz;
alter table public.customers add column if not exists collect_opted_out_at timestamptz;
alter table public.customers add column if not exists collect_token text not null
  default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

alter table public.customers drop constraint if exists customers_payment_terms_check;
alter table public.customers add constraint customers_payment_terms_check
  check (payment_terms_days is null or payment_terms_days between 0 and 365);
alter table public.customers drop constraint if exists customers_preferred_language_check;
alter table public.customers add constraint customers_preferred_language_check
  check (preferred_language in ('auto', 'en', 'ar'));
alter table public.customers drop constraint if exists customers_preferred_channel_check;
alter table public.customers add constraint customers_preferred_channel_check
  check (preferred_channel in ('whatsapp', 'email', 'both'));
create unique index if not exists customers_collect_token_key on public.customers (collect_token);

-- Signed-in users can record an opt-out but never undo one (only the customer
-- decides), and can't change the private link token.
create or replace function public.protect_customer_collect_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.collect_token is distinct from old.collect_token then
    raise exception 'The customer''s reminder link cannot be changed.' using errcode = '42501';
  end if;
  if old.collect_opted_out_at is not null and new.collect_opted_out_at is distinct from old.collect_opted_out_at then
    raise exception 'This customer opted out of reminders. Only the customer can opt back in.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists zx_protect_customer_collect on public.customers;
create trigger zx_protect_customer_collect
  before update on public.customers
  for each row execute function public.protect_customer_collect_fields();

-- ---------- 3) Settings, steps, messages, tasks, promises, disputes ----------
create table if not exists public.collect_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  channel_email boolean not null default true,
  channel_whatsapp boolean not null default true,
  -- 0 = friendly, 100 = firm
  tone smallint not null default 30,
  -- 'auto' = each customer's own language
  language text not null default 'auto',
  send_start time not null default '09:00',
  send_end time not null default '18:00',
  -- ISO weekdays (1 = Monday ... 7 = Sunday); null = the country's working week
  working_days smallint[],
  -- null = the country's time zone
  time_zone text,
  ramadan_enabled boolean not null default false,
  ramadan_start date,
  ramadan_end date,
  ramadan_send_start time not null default '10:00',
  ramadan_send_end time not null default '15:00',
  approval_mode text not null default 'approve',
  default_terms_days integer not null default 30,
  -- false = only invoices issued after Kayyro Collect was switched on are chased
  include_existing boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.collect_settings drop constraint if exists collect_settings_values_check;
alter table public.collect_settings add constraint collect_settings_values_check check (
  tone between 0 and 100
  and language in ('auto', 'en', 'ar')
  and approval_mode in ('approve', 'auto')
  and default_terms_days between 0 and 365
  and send_end > send_start
  and ramadan_send_end > ramadan_send_start
  and (working_days is null or (cardinality(working_days) between 1 and 7 and working_days <@ array[1,2,3,4,5,6,7]::smallint[]))
  and (not ramadan_enabled or (ramadan_start is not null and ramadan_end is not null and ramadan_end >= ramadan_start))
);

create table if not exists public.reminder_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- days from the due date (-3 = three days before)
  offset_days integer not null,
  action text not null default 'message',
  step_key text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.reminder_steps drop constraint if exists reminder_steps_values_check;
alter table public.reminder_steps add constraint reminder_steps_values_check check (
  offset_days between -30 and 120
  and action in ('message', 'call_task')
  and step_key in ('before_due', 'due_today', 'polite', 'firm', 'call', 'final')
);
create unique index if not exists reminder_steps_org_offset_key on public.reminder_steps (organization_id, offset_days, action);

create table if not exists public.collection_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  step_id uuid references public.reminder_steps(id) on delete set null,
  step_key text,
  direction text not null default 'out',
  channel text not null,
  status text not null,
  -- the business-local day it was planned for
  local_date date not null,
  -- the business-local day it was sent (set when claimed)
  sent_on date,
  -- true = goes out by itself once worded; false = waits for the owner's approval
  auto_send boolean not null default false,
  -- true = the owner pressed "Remind now" (not part of the schedule or the monthly allowance)
  manual boolean not null default false,
  language text not null default 'en',
  subject text,
  body text,
  to_address text,
  wa_template text,
  wa_variables jsonb,
  provider text,
  provider_message_id text,
  error text,
  claim_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.collection_messages drop constraint if exists collection_messages_values_check;
alter table public.collection_messages add constraint collection_messages_values_check check (
  direction in ('out', 'in')
  and channel in ('whatsapp', 'email')
  and status in ('pending', 'awaiting_approval', 'ready', 'sending', 'sent', 'failed', 'skipped', 'cancelled', 'received')
  and language in ('en', 'ar')
);
-- A reminder step is planned once per invoice and channel (a double scheduler run plans nothing twice)
create unique index if not exists collection_messages_step_key
  on public.collection_messages (invoice_id, step_id, channel) where direction = 'out' and step_id is not null;
-- One message per invoice per channel per day
create unique index if not exists collection_messages_one_per_day
  on public.collection_messages (invoice_id, channel, sent_on) where direction = 'out' and sent_on is not null;
create index if not exists collection_messages_org_idx on public.collection_messages (organization_id, created_at desc);
create index if not exists collection_messages_ready_idx on public.collection_messages (status) where status in ('pending', 'ready', 'sending');
create index if not exists collection_messages_customer_idx on public.collection_messages (customer_id, created_at desc);

create table if not exists public.collect_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  step_id uuid references public.reminder_steps(id) on delete set null,
  kind text not null,
  status text not null default 'open',
  title text not null,
  note text,
  due_date date,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
alter table public.collect_tasks drop constraint if exists collect_tasks_values_check;
alter table public.collect_tasks add constraint collect_tasks_values_check check (
  kind in ('call', 'dispute', 'paid_claim', 'promise', 'extension', 'wrong_contact', 'other', 'limit')
  and status in ('open', 'done', 'dismissed')
);
create unique index if not exists collect_tasks_step_key on public.collect_tasks (invoice_id, step_id) where step_id is not null;
create index if not exists collect_tasks_org_idx on public.collect_tasks (organization_id, status, created_at desc);

create table if not exists public.payment_promises (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  promised_date date not null,
  amount numeric(14,3),
  source text not null default 'manual',
  status text not null default 'open',
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.payment_promises drop constraint if exists payment_promises_values_check;
alter table public.payment_promises add constraint payment_promises_values_check check (
  source in ('manual', 'reply', 'payment_page') and status in ('open', 'kept', 'broken', 'cancelled')
  and (amount is null or amount > 0)
);
create index if not exists payment_promises_invoice_idx on public.payment_promises (invoice_id, status);

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  source text not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
alter table public.disputes drop constraint if exists disputes_values_check;
alter table public.disputes add constraint disputes_values_check check (
  status in ('open', 'resolved') and source in ('manual', 'reply') and length(btrim(reason)) between 1 and 500
);
create index if not exists disputes_invoice_idx on public.disputes (invoice_id, status);

-- A connected WhatsApp sender (360dialog). Server-only: no signed-in user can read it.
create table if not exists public.collect_channel_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default '360dialog',
  phone_number text,
  api_key text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.collect_channel_accounts drop constraint if exists collect_channel_accounts_provider_check;
alter table public.collect_channel_accounts add constraint collect_channel_accounts_provider_check check (provider in ('360dialog'));

-- ---------- Row level security ----------
alter table public.collect_settings enable row level security;
alter table public.reminder_steps enable row level security;
alter table public.collection_messages enable row level security;
alter table public.collect_tasks enable row level security;
alter table public.payment_promises enable row level security;
alter table public.disputes enable row level security;
alter table public.collect_channel_accounts enable row level security;
revoke all on public.collect_channel_accounts from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['collect_settings', 'reminder_steps', 'collection_messages', 'collect_tasks', 'payment_promises', 'disputes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = public.current_org_id())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', 'zz_mfa_required', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      'zz_mfa_required', t
    );
  end loop;
  -- Messages, tasks, promises and disputes change only through the functions below
  foreach t in array array['collection_messages', 'collect_tasks', 'payment_promises', 'disputes'] loop
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Settings and the schedule: admins of the business
drop policy if exists "collect_settings_update_admin" on public.collect_settings;
create policy "collect_settings_update_admin" on public.collect_settings
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());
revoke insert, delete on public.collect_settings from anon, authenticated;

drop policy if exists "reminder_steps_write_admin" on public.reminder_steps;
create policy "reminder_steps_write_admin" on public.reminder_steps
  for all to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

-- ---------- Plans ----------
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
    -- Kayyro Collect: invoices chased per month (trial = Pro, so it can be tried)
    when p_resource = 'collect_invoices' then
      case coalesce(p_plan, 'free') when 'business' then null when 'pro' then 100 when 'starter' then 0 else 100 end
  end;
$$;

create or replace function public.collect_plan_allows(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when coalesce(o.subscription_status, 'trialing') in ('past_due', 'cancelled') then false
      when o.plan in ('pro', 'business') then true
      when coalesce(o.subscription_status, 'trialing') = 'trialing' and coalesce(o.plan, 'free') = 'free'
        then o.trial_ends_at is null or o.trial_ends_at > now()
      else false
    end
    from public.organizations o where o.id = p_org
  ), false)
$$;

-- ---------- Country defaults ----------
create or replace function public.collect_country_time_zone(p_country text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case upper(coalesce(p_country, 'AE'))
    when 'AE' then 'Asia/Dubai'
    when 'SA' then 'Asia/Riyadh'
    when 'BH' then 'Asia/Bahrain'
    when 'OM' then 'Asia/Muscat'
    when 'QA' then 'Asia/Qatar'
    when 'KW' then 'Asia/Kuwait'
    when 'GB' then 'Europe/London'
    when 'IN' then 'Asia/Kolkata'
    when 'IE' then 'Europe/Dublin'
    when 'PT' then 'Europe/Lisbon'
    when 'FI' then 'Europe/Helsinki'
    when 'EE' then 'Europe/Tallinn'
    when 'LV' then 'Europe/Riga'
    when 'LT' then 'Europe/Vilnius'
    when 'BG' then 'Europe/Sofia'
    when 'RO' then 'Europe/Bucharest'
    when 'GR' then 'Europe/Athens'
    when 'CY' then 'Asia/Nicosia'
    when 'AT' then 'Europe/Vienna' when 'BE' then 'Europe/Brussels' when 'HR' then 'Europe/Zagreb'
    when 'CZ' then 'Europe/Prague' when 'DK' then 'Europe/Copenhagen' when 'FR' then 'Europe/Paris'
    when 'DE' then 'Europe/Berlin' when 'HU' then 'Europe/Budapest' when 'IT' then 'Europe/Rome'
    when 'LU' then 'Europe/Luxembourg' when 'MT' then 'Europe/Malta' when 'NL' then 'Europe/Amsterdam'
    when 'PL' then 'Europe/Warsaw' when 'SK' then 'Europe/Bratislava' when 'SI' then 'Europe/Ljubljana'
    when 'ES' then 'Europe/Madrid' when 'SE' then 'Europe/Stockholm'
    else 'Asia/Dubai'
  end
$$;

-- The working week (ISO weekdays). UAE, UK and EU: Monday-Friday.
-- Saudi Arabia, Bahrain, Oman, Qatar, Kuwait: Sunday-Thursday. India: Monday-Saturday.
create or replace function public.collect_country_working_days(p_country text)
returns smallint[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when upper(coalesce(p_country, 'AE')) in ('SA', 'BH', 'OM', 'QA', 'KW') then array[7, 1, 2, 3, 4]::smallint[]
    when upper(coalesce(p_country, 'AE')) = 'IN' then array[1, 2, 3, 4, 5, 6]::smallint[]
    else array[1, 2, 3, 4, 5]::smallint[]
  end
$$;

-- A time zone name the database understands (else the change is refused)
create or replace function public.collect_settings_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.time_zone is not null then
    begin
      perform now() at time zone new.time_zone;
    exception when others then
      raise exception 'Unknown time zone: %', new.time_zone using errcode = '22023';
    end;
  end if;
  if new.enabled and not coalesce(old.enabled, false) then
    if not public.collect_plan_allows(new.organization_id) then
      raise exception 'Kayyro Collect is part of the Pro and Business plans. Upgrade in Settings -> Billing.' using errcode = '42501';
    end if;
    new.enabled_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists collect_settings_validate on public.collect_settings;
create trigger collect_settings_validate
  before insert or update on public.collect_settings
  for each row execute function public.collect_settings_validate();

-- ---------- The business's clock ----------
create or replace function public.collect_clock(p_org uuid, p_now timestamptz default now())
returns table (
  local_ts timestamp,
  local_date date,
  iso_dow integer,
  window_start time,
  window_end time,
  working_day boolean,
  in_window boolean,
  time_zone text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.collect_settings%rowtype;
  v_country text;
  v_tz text;
  v_days smallint[];
  v_start time;
  v_end time;
  v_local timestamp;
  v_dow integer;
begin
  select * into s from public.collect_settings where organization_id = p_org;
  select country into v_country from public.organizations where id = p_org;
  v_tz := coalesce(s.time_zone, public.collect_country_time_zone(v_country));
  v_local := p_now at time zone v_tz;
  v_dow := extract(isodow from v_local)::integer;
  v_days := coalesce(s.working_days, public.collect_country_working_days(v_country));
  v_start := coalesce(s.send_start, '09:00'::time);
  v_end := coalesce(s.send_end, '18:00'::time);
  if coalesce(s.ramadan_enabled, false) and v_local::date between s.ramadan_start and s.ramadan_end then
    v_start := s.ramadan_send_start;
    v_end := s.ramadan_send_end;
  end if;
  return query select
    v_local,
    v_local::date,
    v_dow,
    v_start,
    v_end,
    v_dow::smallint = any (v_days),
    v_dow::smallint = any (v_days) and v_local::time >= v_start and v_local::time < v_end,
    v_tz;
end;
$$;

-- ---------- Can this invoice be chased right now? ----------
create or replace function public.collect_invoice_balance(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(
    0,
    i.grand_total - coalesce(i.amount_paid, 0) - coalesce((
      select sum(c.grand_total) from public.credit_notes c
      where c.invoice_id = i.id and c.status <> 'cancelled'
    ), 0)
  )
  from public.invoices i where i.id = p_invoice
$$;

-- null = may be chased; otherwise why not
-- Never, for any message: a missing, cancelled, paid or disputed invoice, or a customer who opted out
create or replace function public.collect_hard_block_reason(p_invoice uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  v_opted timestamptz;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then return 'missing'; end if;
  if i.status = 'cancelled' then return 'cancelled'; end if;
  if i.status = 'paid' then return 'paid'; end if;
  if public.collect_invoice_balance(i.id) <= 0.0005 then return 'paid'; end if;
  select collect_opted_out_at into v_opted from public.customers where id = i.customer_id;
  if not found then return 'missing'; end if;
  if v_opted is not null then return 'opted_out'; end if;
  if exists (select 1 from public.disputes d where d.invoice_id = i.id and d.status = 'open') then
    return 'disputed';
  end if;
  return null;
end;
$$;

create or replace function public.collect_block_reason(p_invoice uuid, p_now timestamptz default now())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  c public.customers%rowtype;
  s public.collect_settings%rowtype;
  v_today date;
  v_hard text;
begin
  v_hard := public.collect_hard_block_reason(p_invoice);
  if v_hard is not null then return v_hard; end if;
  select * into i from public.invoices where id = p_invoice;

  select * into s from public.collect_settings where organization_id = i.organization_id;
  if not found or not s.enabled then return 'collect_off'; end if;
  if not public.collect_plan_allows(i.organization_id) then return 'plan'; end if;

  select * into c from public.customers where id = i.customer_id;
  if not found then return 'missing'; end if;
  if c.collect_paused then return 'customer_paused'; end if;
  if c.collect_opted_out_at is not null then return 'opted_out'; end if;

  if exists (select 1 from public.disputes d where d.invoice_id = i.id and d.status = 'open') then
    return 'disputed';
  end if;
  select local_date into v_today from public.collect_clock(i.organization_id, p_now);
  if exists (
    select 1 from public.payment_promises p
    where p.invoice_id = i.id and p.status = 'open' and p.promised_date > v_today
  ) then
    return 'promised';
  end if;
  if not s.include_existing and s.enabled_at is not null and i.created_at < s.enabled_at then
    return 'before_enabled';
  end if;
  if i.due_date is null then return 'no_due_date'; end if;
  return null;
end;
$$;

create or replace function public.collect_message_block(p_manual boolean, p_invoice uuid, p_now timestamptz default now())
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_manual then public.collect_hard_block_reason(p_invoice)
              else public.collect_block_reason(p_invoice, p_now) end;
$$;

-- ---------- Plan the day's reminders (scheduler) ----------
create or replace function public.collect_plan(p_org uuid default null, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
  clk record;
  inv record;
  st public.reminder_steps%rowtype;
  c public.customers%rowtype;
  v_limit integer;
  v_used integer;
  v_wa_auto boolean;
  v_lang text;
  v_ch text;
  v_status text;
  v_planned integer := 0;
  v_rows integer;
begin
  for s in
    select cs.*, o.plan
    from public.collect_settings cs
    join public.organizations o on o.id = cs.organization_id
    where cs.enabled and (p_org is null or cs.organization_id = p_org)
  loop
    -- Anything already queued that must not go out any more is cancelled
    update public.collection_messages m
      set status = 'cancelled', error = public.collect_message_block(m.manual, m.invoice_id, p_now), updated_at = now()
      where m.organization_id = s.organization_id
        and m.direction = 'out'
        and m.status in ('pending', 'awaiting_approval', 'ready')
        and public.collect_message_block(m.manual, m.invoice_id, p_now) is not null;

    if not public.collect_plan_allows(s.organization_id) then continue; end if;
    select * into clk from public.collect_clock(s.organization_id, p_now);
    -- Nothing is planned on the business's weekend
    if not clk.working_day then continue; end if;

    v_limit := public.plan_limit(s.plan, 'collect_invoices');
    select count(distinct m.invoice_id) into v_used
      from public.collection_messages m
      where m.organization_id = s.organization_id and m.direction = 'out' and not m.manual
        and m.status not in ('cancelled', 'skipped')
        and m.local_date >= date_trunc('month', clk.local_date)::date;
    v_wa_auto := exists (
      select 1 from public.collect_channel_accounts a where a.organization_id = s.organization_id and a.active
    );

    for inv in
      select i.id, i.customer_id, i.due_date
      from public.invoices i
      where i.organization_id = s.organization_id
        and i.status in ('issued', 'partially_paid')
        and i.due_date is not null
      order by i.due_date
    loop
      if public.collect_block_reason(inv.id, p_now) is not null then continue; end if;

      -- The latest step that has come due (missed older steps are not sent in a burst)
      select * into st from public.reminder_steps r
        where r.organization_id = s.organization_id and r.active
          and inv.due_date + r.offset_days <= clk.local_date
        order by r.offset_days desc
        limit 1;
      if not found then continue; end if;

      select * into c from public.customers where id = inv.customer_id;

      if st.action = 'call_task' then
        insert into public.collect_tasks (organization_id, invoice_id, customer_id, step_id, kind, title, due_date)
        values (s.organization_id, inv.id, inv.customer_id, st.id, 'call', 'Call ' || c.name, clk.local_date)
        on conflict do nothing;
        continue;
      end if;

      if exists (
        select 1 from public.collection_messages m
        where m.invoice_id = inv.id and m.step_id = st.id and m.direction = 'out'
      ) then
        continue;
      end if;

      -- Monthly allowance: a new invoice can't be chased once the limit is reached
      if v_limit is not null and not exists (
        select 1 from public.collection_messages m
        where m.invoice_id = inv.id and m.direction = 'out' and not m.manual
          and m.status not in ('cancelled', 'skipped')
          and m.local_date >= date_trunc('month', clk.local_date)::date
      ) then
        if v_used >= v_limit then
          if not exists (
            select 1 from public.collect_tasks t
            where t.organization_id = s.organization_id and t.kind = 'limit' and t.status = 'open'
              and t.created_at >= date_trunc('month', clk.local_ts)
          ) then
            insert into public.collect_tasks (organization_id, kind, title, due_date)
            values (s.organization_id, 'limit',
              'Monthly limit reached: ' || v_limit || ' invoices chased. Upgrade to Business for unlimited chasing.',
              clk.local_date);
          end if;
          continue;
        end if;
        v_used := v_used + 1;
      end if;

      v_lang := case
        when s.language in ('en', 'ar') then s.language
        when c.preferred_language in ('en', 'ar') then c.preferred_language
        else 'en'
      end;

      foreach v_ch in array array['email', 'whatsapp'] loop
        if v_ch = 'email' and not (s.channel_email and c.preferred_channel in ('email', 'both')
           and coalesce(btrim(c.email), '') like '%_@_%') then
          continue;
        end if;
        if v_ch = 'whatsapp' and not (s.channel_whatsapp and c.preferred_channel in ('whatsapp', 'both')
           and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 8) then
          continue;
        end if;
        -- Automatic only with approval off; WhatsApp also needs a connected sender and the customer's opt-in
        v_status := case
          when s.approval_mode = 'auto'
               and (v_ch = 'email' or (v_wa_auto and c.whatsapp_opt_in_at is not null)) then 'auto'
          else 'approve'
        end;
        insert into public.collection_messages (
          organization_id, invoice_id, customer_id, step_id, step_key, direction, channel, status,
          auto_send, local_date, language, to_address
        ) values (
          s.organization_id, inv.id, inv.customer_id, st.id, st.step_key, 'out', v_ch,
          -- the app writes the wording (status 'pending' until then)
          'pending', v_status = 'auto', clk.local_date, v_lang,
          case when v_ch = 'email' then btrim(c.email) else c.phone end
        )
        on conflict do nothing;
        get diagnostics v_rows = row_count;
        v_planned := v_planned + v_rows;
      end loop;
    end loop;
  end loop;
  return v_planned;
end;
$$;

-- The app wrote the wording: the message moves to the approval queue or to sending
create or replace function public.collect_set_wording(
  p_id uuid, p_subject text, p_body text, p_wa_template text, p_wa_variables jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.collection_messages
    set subject = p_subject,
        body = p_body,
        wa_template = p_wa_template,
        wa_variables = p_wa_variables,
        status = case when auto_send then 'ready' else 'awaiting_approval' end,
        updated_at = now()
    where id = p_id and status = 'pending';
end;
$$;

-- ---------- Claim, then send ----------
-- Returns the message only if it may be sent now; nobody else can claim it after this.
create or replace function public.collect_claim(p_id uuid, p_now timestamptz default now())
returns setof public.collection_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  clk record;
  v_reason text;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found or m.direction <> 'out' or m.status <> 'ready' then
    return;
  end if;
  v_reason := public.collect_message_block(m.manual, m.invoice_id, p_now);
  if v_reason is not null then
    update public.collection_messages set status = 'cancelled', error = v_reason, updated_at = now() where id = p_id;
    return;
  end if;
  select * into clk from public.collect_clock(m.organization_id, p_now);
  if not clk.in_window then
    return;
  end if;
  begin
    update public.collection_messages
      set status = 'sending', claim_token = gen_random_uuid(), claimed_at = p_now, sent_on = clk.local_date, updated_at = now()
      where id = p_id and status = 'ready'
      returning * into m;
  exception when unique_violation then
    -- Already messaged on this channel today: try again tomorrow
    return;
  end;
  return next m;
end;
$$;

create or replace function public.collect_finish(
  p_id uuid, p_token uuid, p_ok boolean, p_provider text, p_provider_message_id text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.collection_messages
    set status = case when p_ok then 'sent' else 'failed' end,
        sent_at = case when p_ok then now() else null end,
        -- a failed send does not use up the day
        sent_on = case when p_ok then sent_on else null end,
        provider = p_provider,
        provider_message_id = p_provider_message_id,
        error = case when p_ok then null else left(p_error, 500) end,
        updated_at = now()
    where id = p_id and claim_token = p_token and status = 'sending';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- ---------- What the owner does in the app ----------
create or replace function public.collect_require_admin(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_org is distinct from public.current_org_id() or not public.is_admin() then
    raise exception 'Only an admin of this business can do this.' using errcode = '42501';
  end if;
end;
$$;

-- Creates the settings and the default schedule on first use
create or replace function public.collect_ensure_settings()
returns public.collect_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  s public.collect_settings%rowtype;
begin
  if v_org is null then
    raise exception 'No organization for current user' using errcode = '42501';
  end if;
  insert into public.collect_settings (organization_id) values (v_org) on conflict do nothing;
  insert into public.reminder_steps (organization_id, offset_days, action, step_key) values
    (v_org, -3, 'message', 'before_due'),
    (v_org, 0, 'message', 'due_today'),
    (v_org, 3, 'message', 'polite'),
    (v_org, 7, 'message', 'firm'),
    (v_org, 15, 'call_task', 'call'),
    (v_org, 30, 'message', 'final')
  on conflict do nothing;
  select * into s from public.collect_settings where organization_id = v_org;
  return s;
end;
$$;

-- Approve (optionally with edited wording). Email and connected WhatsApp go out at the next run.
create or replace function public.collect_approve(p_id uuid, p_subject text default null, p_body text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  v_reason text;
  v_wa_auto boolean;
  v_opted boolean;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(m.organization_id);
  if m.status <> 'awaiting_approval' then
    raise exception 'This message is no longer waiting for approval.' using errcode = '22023';
  end if;
  v_reason := public.collect_message_block(m.manual, m.invoice_id);
  if v_reason is not null then
    update public.collection_messages set status = 'cancelled', error = v_reason, updated_at = now() where id = p_id;
    return 'cancelled';
  end if;
  if m.channel = 'whatsapp' then
    v_wa_auto := exists (select 1 from public.collect_channel_accounts a where a.organization_id = m.organization_id and a.active);
    select whatsapp_opt_in_at is not null into v_opted from public.customers where id = m.customer_id;
    if not (v_wa_auto and v_opted) then
      -- Sent from the owner's own WhatsApp: use collect_mark_sent_by_hand after tapping Send
      raise exception 'Send this one from your WhatsApp with the Send button.' using errcode = '22023';
    end if;
  end if;
  update public.collection_messages
    set status = 'ready',
        subject = coalesce(nullif(btrim(p_subject), ''), subject),
        body = coalesce(nullif(btrim(p_body), ''), body),
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    where id = p_id;
  return 'ready';
end;
$$;

-- The owner sent it from their own WhatsApp (one-tap): record it, once per day
create or replace function public.collect_mark_sent_by_hand(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
  v_reason text;
  v_today date;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(m.organization_id);
  if m.status not in ('awaiting_approval', 'ready', 'failed') then
    raise exception 'This message can''t be sent again.' using errcode = '22023';
  end if;
  v_reason := public.collect_message_block(m.manual, m.invoice_id);
  if v_reason is not null then
    update public.collection_messages set status = 'cancelled', error = v_reason, updated_at = now() where id = p_id;
    return 'cancelled';
  end if;
  select local_date into v_today from public.collect_clock(m.organization_id);
  begin
    update public.collection_messages
      set status = 'sent', sent_on = v_today, sent_at = now(), provider = 'one_tap',
          approved_by = auth.uid(), approved_at = now(), error = null, updated_at = now()
      where id = p_id;
  exception when unique_violation then
    raise exception 'This invoice already had a % message today.', m.channel using errcode = '23505';
  end;
  return 'sent';
end;
$$;

-- "Remind now" from the app (every plan). Creates one message for the invoice and channel;
-- the app writes the wording, then it is sent by the owner (WhatsApp one-tap) or by email.
create or replace function public.collect_manual_reminder(p_invoice uuid, p_channel text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  c public.customers%rowtype;
  s public.collect_settings%rowtype;
  clk record;
  v_reason text;
  v_id uuid;
  v_to text;
  v_step text;
  v_days integer;
  v_lang text;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(i.organization_id);
  if p_channel not in ('email', 'whatsapp') then
    raise exception 'Unknown channel' using errcode = '22023';
  end if;
  v_reason := public.collect_hard_block_reason(p_invoice);
  if v_reason is not null then
    raise exception '%', case v_reason
      when 'paid' then 'This invoice is already paid.'
      when 'cancelled' then 'This invoice is cancelled.'
      when 'disputed' then 'This invoice is disputed. Resolve the dispute before reminding.'
      when 'opted_out' then 'This customer asked not to get payment reminders.'
      else 'This invoice can''t be reminded.' end
      using errcode = '22023';
  end if;
  select * into c from public.customers where id = i.customer_id;
  if p_channel = 'email' then
    v_to := nullif(btrim(coalesce(c.email, '')), '');
    if v_to is null or v_to not like '%_@_%' then
      raise exception 'Add an email address for this customer first.' using errcode = '22023';
    end if;
  else
    v_to := c.phone;
    if length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) < 8 then
      raise exception 'Add a WhatsApp number for this customer first.' using errcode = '22023';
    end if;
  end if;
  select * into clk from public.collect_clock(i.organization_id);
  if exists (
    select 1 from public.collection_messages m
    where m.invoice_id = p_invoice and m.channel = p_channel and m.direction = 'out'
      and (m.sent_on = clk.local_date or m.status = 'sending')
  ) then
    raise exception 'This invoice already had a % reminder today.', p_channel using errcode = '23505';
  end if;
  -- One open draft per invoice and channel: reuse it
  select id into v_id from public.collection_messages m
    where m.invoice_id = p_invoice and m.channel = p_channel and m.direction = 'out' and m.manual
      and m.status in ('pending', 'awaiting_approval', 'ready', 'failed')
    order by m.created_at desc
    limit 1;
  if v_id is not null then
    update public.collection_messages set status = 'pending', error = null, claim_token = null,
      to_address = v_to, local_date = clk.local_date, updated_at = now()
      where id = v_id;
    return v_id;
  end if;

  v_days := clk.local_date - coalesce(i.due_date, i.invoice_date + 30);
  v_step := case
    when v_days < 0 then 'before_due'
    when v_days = 0 then 'due_today'
    when v_days < 7 then 'polite'
    when v_days < 30 then 'firm'
    else 'final'
  end;
  select * into s from public.collect_settings where organization_id = i.organization_id;
  v_lang := case
    when s.language in ('en', 'ar') then s.language
    when c.preferred_language in ('en', 'ar') then c.preferred_language
    else 'en'
  end;
  insert into public.collection_messages (
    organization_id, invoice_id, customer_id, step_key, direction, channel, status,
    auto_send, manual, local_date, language, to_address
  ) values (
    i.organization_id, i.id, i.customer_id, v_step, 'out', p_channel, 'pending',
    false, true, clk.local_date, v_lang, v_to
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.collect_skip(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(m.organization_id);
  if m.status not in ('pending', 'awaiting_approval', 'ready', 'failed') then
    raise exception 'This message can''t be skipped any more.' using errcode = '22023';
  end if;
  update public.collection_messages set status = 'skipped', updated_at = now() where id = p_id;
end;
$$;

create or replace function public.collect_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.collection_messages%rowtype;
begin
  select * into m from public.collection_messages where id = p_id for update;
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(m.organization_id);
  if m.status <> 'failed' then
    raise exception 'Only a failed message can be retried.' using errcode = '22023';
  end if;
  update public.collection_messages set status = 'ready', error = null, claim_token = null, updated_at = now() where id = p_id;
end;
$$;

-- Disputes, promises and tasks, recorded by the owner
create or replace function public.collect_open_dispute(p_invoice uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  v_id uuid;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found or i.organization_id is distinct from public.current_org_id() then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if public.is_read_only() then
    raise exception 'Accountant access is read-only.' using errcode = '42501';
  end if;
  insert into public.disputes (organization_id, invoice_id, customer_id, reason, created_by)
  values (i.organization_id, i.id, i.customer_id, btrim(p_reason), auth.uid())
  returning id into v_id;
  insert into public.collect_tasks (organization_id, invoice_id, customer_id, kind, title, note, due_date)
  values (i.organization_id, i.id, i.customer_id, 'dispute', 'Dispute on ' || i.invoice_number, btrim(p_reason), current_date);
  -- Nothing queued for this invoice goes out while it is disputed
  update public.collection_messages set status = 'cancelled', error = 'disputed', updated_at = now()
    where invoice_id = i.id and direction = 'out' and status in ('pending', 'awaiting_approval', 'ready');
  return v_id;
end;
$$;

create or replace function public.collect_resolve_dispute(p_dispute uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.disputes%rowtype;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found then raise exception 'Dispute not found' using errcode = 'P0002'; end if;
  perform public.collect_require_admin(d.organization_id);
  update public.disputes set status = 'resolved', resolved_at = now(), resolved_by = auth.uid() where id = p_dispute;
  update public.collect_tasks set status = 'done', resolved_at = now(), resolved_by = auth.uid()
    where invoice_id = d.invoice_id and kind = 'dispute' and status = 'open';
end;
$$;

create or replace function public.collect_add_promise(p_invoice uuid, p_date date, p_amount numeric default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.invoices%rowtype;
  v_id uuid;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found or i.organization_id is distinct from public.current_org_id() then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if public.is_read_only() then
    raise exception 'Accountant access is read-only.' using errcode = '42501';
  end if;
  if p_date < current_date - 1 or p_date > current_date + 365 then
    raise exception 'Pick a date within the next year.' using errcode = '22023';
  end if;
  update public.payment_promises set status = 'cancelled' where invoice_id = i.id and status = 'open';
  insert into public.payment_promises (organization_id, invoice_id, customer_id, promised_date, amount, note, created_by)
  values (i.organization_id, i.id, i.customer_id, p_date, p_amount, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.collect_resolve_task(p_task uuid, p_status text default 'done')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.collect_tasks%rowtype;
begin
  select * into t from public.collect_tasks where id = p_task for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if t.organization_id is distinct from public.current_org_id() or public.is_read_only() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status not in ('done', 'dismissed') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  update public.collect_tasks set status = p_status, resolved_at = now(), resolved_by = auth.uid() where id = p_task;
end;
$$;

-- The customer's own opt-out link (server only)
create or replace function public.collect_opt_out(p_token text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.customers
    set collect_opted_out_at = coalesce(collect_opted_out_at, now())
    where collect_token = p_token
    returning id into v_id;
  if v_id is null then return null; end if;
  update public.collection_messages set status = 'cancelled', error = 'opted_out', updated_at = now()
    where customer_id = v_id and direction = 'out' and status in ('pending', 'awaiting_approval', 'ready');
  return 'opted_out';
end;
$$;

-- Whether this business has a WhatsApp Business sender connected (the key itself stays server-side)
create or replace function public.collect_whatsapp_connected()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.collect_channel_accounts a
    where a.organization_id = public.current_org_id() and a.active
  );
$$;

-- ---------- Grants ----------
do $$
declare
  f text;
begin
  -- Server only (scheduler, sender, opt-out link)
  foreach f in array array[
    'collect_plan(uuid, timestamptz)', 'collect_set_wording(uuid, text, text, text, jsonb)',
    'collect_claim(uuid, timestamptz)', 'collect_finish(uuid, uuid, boolean, text, text, text)',
    'collect_opt_out(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Signed-in users (each function checks the business and the role)
  foreach f in array array[
    'collect_ensure_settings()', 'collect_approve(uuid, text, text)', 'collect_mark_sent_by_hand(uuid)',
    'collect_skip(uuid)', 'collect_retry(uuid)', 'collect_open_dispute(uuid, text)',
    'collect_resolve_dispute(uuid)', 'collect_add_promise(uuid, date, numeric, text)',
    'collect_resolve_task(uuid, text)', 'collect_clock(uuid, timestamptz)',
    'collect_block_reason(uuid, timestamptz)', 'collect_invoice_balance(uuid)', 'collect_plan_allows(uuid)',
    'collect_hard_block_reason(uuid)', 'collect_message_block(boolean, uuid, timestamptz)',
    'collect_manual_reminder(uuid, text)', 'collect_whatsapp_connected()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['collect_require_admin(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------- Due-date default and backfill ----------
create or replace function public.set_invoice_due_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.due_date is null then
    new.due_date := new.invoice_date + coalesce(
      (select c.payment_terms_days from public.customers c where c.id = new.customer_id),
      (select s.default_terms_days from public.collect_settings s where s.organization_id = new.organization_id),
      30
    );
  end if;
  return new;
end;
$$;
revoke execute on function public.set_invoice_due_date() from public, anon, authenticated;
drop trigger if exists aa_invoice_due_date on public.invoices;
create trigger aa_invoice_due_date
  before insert on public.invoices
  for each row execute function public.set_invoice_due_date();

-- Existing invoices: invoice date + 30 days (without writing 'changed' entries to the audit log)
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'zz_audit_log' and tgrelid = 'public.invoices'::regclass) then
    alter table public.invoices disable trigger zz_audit_log;
    update public.invoices set due_date = invoice_date + 30 where due_date is null;
    alter table public.invoices enable trigger zz_audit_log;
  else
    update public.invoices set due_date = invoice_date + 30 where due_date is null;
  end if;
end $$;

-- The due date stays editable on an issued invoice (adds it to 048's list)
create or replace function public.lock_invoices()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  k text;
  allowed text[] := array['status', 'cancelled_reason', 'short_code', 'tax_country', 'tax_treatment', 'tax_split', 'place_of_supply', 'due_date'];
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Invoices are created through Kayyro''s invoice screen.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'An issued invoice cannot be deleted. Cancel it or issue a credit note.' using errcode = '42501';
  end if;

  for k in select jsonb_object_keys(to_jsonb(new)) loop
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) and not (k = any (allowed)) then
      raise exception 'Invoice amounts, lines and payments can only be changed through Kayyro (%).', k using errcode = '42501';
    end if;
  end loop;

  if old.status = 'cancelled' and (new.status, new.cancelled_reason, new.due_date) is distinct from (old.status, old.cancelled_reason, old.due_date) then
    raise exception 'A cancelled invoice cannot be reopened.' using errcode = '42501';
  end if;
  if new.due_date is distinct from old.due_date and (new.due_date is null or new.due_date < old.invoice_date) then
    raise exception 'The due date can''t be before the invoice date.' using errcode = '22023';
  end if;
  if new.short_code is distinct from old.short_code and old.short_code is not null then
    raise exception 'The invoice link cannot be changed.' using errcode = '42501';
  end if;
  if (new.tax_country, new.tax_treatment, new.tax_split, new.place_of_supply)
       is distinct from (old.tax_country, old.tax_treatment, old.tax_split, old.place_of_supply)
     and greatest(old.created_at, coalesce(old.edited_at, old.created_at)) < now() - interval '15 minutes' then
    raise exception 'The tax details of an issued invoice cannot be changed.' using errcode = '42501';
  end if;
  if new.cancelled_reason is distinct from old.cancelled_reason and new.status <> 'cancelled' then
    raise exception 'A cancellation reason needs a cancelled invoice.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and new.status <> 'cancelled' then
    if new.status = 'paid' then
      if coalesce(old.amount_paid, 0) < coalesce(old.grand_total, 0) - 0.005 then
        raise exception 'Record a payment to mark this invoice paid.' using errcode = '42501';
      end if;
    elsif new.status = 'partially_paid' then
      if not (coalesce(old.amount_paid, 0) > 0 and coalesce(old.amount_paid, 0) < coalesce(old.grand_total, 0)) then
        raise exception 'The status must match what has been paid.' using errcode = '42501';
      end if;
    elsif new.status = 'issued' then
      if coalesce(old.amount_paid, 0) > 0 then
        raise exception 'The status must match what has been paid.' using errcode = '42501';
      end if;
    else
      raise exception 'That invoice status can''t be set here.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Stop chasing the moment an invoice is paid, cancelled or credited
create or replace function public.collect_stop_on_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice uuid;
begin
  if tg_table_name = 'invoices' then
    v_invoice := new.id;
  else
    v_invoice := new.invoice_id;
  end if;
  if v_invoice is null then return null; end if;
  if public.collect_invoice_balance(v_invoice) <= 0.0005
     or exists (select 1 from public.invoices i where i.id = v_invoice and i.status in ('paid', 'cancelled')) then
    update public.collection_messages set status = 'cancelled', error = 'closed', updated_at = now()
      where invoice_id = v_invoice and direction = 'out' and status in ('pending', 'awaiting_approval', 'ready');
    update public.collect_tasks set status = 'done', resolved_at = now()
      where invoice_id = v_invoice and status = 'open' and kind in ('call', 'paid_claim', 'promise');
    update public.payment_promises set status = 'kept' where invoice_id = v_invoice and status = 'open';
  end if;
  return null;
end;
$$;
revoke execute on function public.collect_stop_on_close() from public, anon, authenticated;
drop trigger if exists zz_collect_stop_invoice on public.invoices;
create trigger zz_collect_stop_invoice
  after update of status, amount_paid on public.invoices
  for each row execute function public.collect_stop_on_close();
drop trigger if exists zz_collect_stop_credit on public.credit_notes;
create trigger zz_collect_stop_credit
  after insert or update on public.credit_notes
  for each row execute function public.collect_stop_on_close();

-- ---------- schema version ----------
create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 49 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
