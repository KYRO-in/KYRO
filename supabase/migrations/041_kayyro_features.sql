-- ============================================================
-- Kayyro: invoice options, accountant role, plan limits, recurring invoices
--
-- 1) Organization options: Arabic business name, invoice language
--    (English or English + Arabic), online payment link, document numbering
--    (calendar year or April-March) and account-deletion requests.
-- 2) Document numbers follow the organization's numbering choice.
--    Businesses that already issued invoices keep April-March so their series
--    continues; everyone else numbers by calendar year (KY/2026/0001).
-- 3) Accountant role: can see everything in their business, change nothing.
--    Enforced in the database, including inside invoice functions.
-- 4) Plan limits enforced in the database (invoices per month, active
--    products, expired trial / cancelled / past-due subscriptions).
-- 5) recurring_invoices: invoices that repeat weekly, monthly, quarterly or
--    yearly.
--
-- Run after 039. Additive, data-safe and safe to re-run.
-- ============================================================

-- ---------- 1) Organization options ----------
alter table public.organizations
  add column if not exists name_ar text,
  add column if not exists invoice_language text not null default 'en',
  add column if not exists payment_link_url text,
  add column if not exists numbering_period text,
  add column if not exists deletion_requested_at timestamptz;

-- Existing businesses that already numbered invoices keep their April-March series
update public.organizations o
set numbering_period = case
  when exists (select 1 from public.invoice_sequences s where s.organization_id = o.id) then 'april'
  else 'calendar'
end
where o.numbering_period is null;

alter table public.organizations alter column numbering_period set default 'calendar';
alter table public.organizations alter column numbering_period set not null;

alter table public.organizations drop constraint if exists organizations_invoice_language_check;
alter table public.organizations add constraint organizations_invoice_language_check
  check (invoice_language in ('en', 'en_ar'));

alter table public.organizations drop constraint if exists organizations_numbering_period_check;
alter table public.organizations add constraint organizations_numbering_period_check
  check (numbering_period in ('calendar', 'april'));

-- Payment links are printed on invoices and emails: plain https only
alter table public.organizations drop constraint if exists organizations_payment_link_url_check;
alter table public.organizations add constraint organizations_payment_link_url_check
  check (payment_link_url is null or (payment_link_url ~* '^https://[^\s]+$' and length(payment_link_url) <= 500));

alter table public.organizations drop constraint if exists organizations_name_ar_check;
alter table public.organizations add constraint organizations_name_ar_check
  check (name_ar is null or length(name_ar) <= 120);

comment on column public.organizations.numbering_period is 'Document numbering: calendar (KY/2026/0001) or april (KY/2026-27/0001).';
comment on column public.organizations.invoice_language is 'Invoice PDF language: en or en_ar (English with Arabic labels).';

-- ---------- 2) Numbering follows the organization's choice ----------
-- p_style 'long' -> 2026-27 (invoices); 'short' -> 26-27 (purchases, credit notes)
create or replace function public.org_document_period(p_org uuid, p_style text default 'long')
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_period text;
  y integer := extract(year from current_date)::integer;
  start_y integer;
begin
  select numbering_period into v_period from public.organizations where id = p_org;
  if coalesce(v_period, 'calendar') = 'calendar' then
    return y::text;
  end if;
  start_y := case when extract(month from current_date) >= 4 then y else y - 1 end;
  if p_style = 'short' then
    return right(start_y::text, 2) || '-' || right((start_y + 1)::text, 2);
  end if;
  return start_y::text || '-' || right((start_y + 1)::text, 2);
end;
$$;

create or replace function public.next_invoice_number(prefix text default 'KY')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  fy text;
  next_num integer;
begin
  if v_org is null then
    raise exception 'No organization for current user';
  end if;
  fy := public.org_document_period(v_org, 'long');

  insert into public.invoice_sequences (organization_id, financial_year, last_number)
  values (v_org, fy, 1)
  on conflict (organization_id, financial_year)
  do update set last_number = public.invoice_sequences.last_number + 1
  returning last_number into next_num;

  return prefix || '/' || fy || '/' || lpad(next_num::text, 4, '0');
end;
$$;

create or replace function public.next_purchase_number(p_prefix text default 'PO')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  v_fy text;
  v_n integer;
begin
  if v_org is null then
    raise exception 'No organization for current user';
  end if;
  v_fy := public.org_document_period(v_org, 'short');

  insert into public.purchase_sequences (organization_id, financial_year, last_number)
  values (v_org, v_fy, 1)
  on conflict (organization_id, financial_year) do update
    set last_number = public.purchase_sequences.last_number + 1
  returning last_number into v_n;

  return p_prefix || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function public.next_credit_note_number(p_prefix text default 'CN')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.current_org_id();
  v_fy text;
  v_n integer;
begin
  if v_org is null then
    raise exception 'No organization for current user';
  end if;
  v_fy := public.org_document_period(v_org, 'short');

  insert into public.credit_note_sequences (organization_id, financial_year, last_number)
  values (v_org, v_fy, 1)
  on conflict (organization_id, financial_year) do update
    set last_number = public.credit_note_sequences.last_number + 1
  returning last_number into v_n;

  return p_prefix || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;

revoke execute on function public.org_document_period(uuid, text) from public, anon;
grant execute on function public.org_document_period(uuid, text) to authenticated, service_role;
revoke execute on function public.next_invoice_number(text) from public, anon;
revoke execute on function public.next_purchase_number(text) from public, anon;
revoke execute on function public.next_credit_note_number(text) from public, anon;
grant execute on function public.next_invoice_number(text) to authenticated, service_role;
grant execute on function public.next_purchase_number(text) to authenticated, service_role;
grant execute on function public.next_credit_note_number(text) to authenticated, service_role;

-- ---------- 3) Accountant role (read-only) ----------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.users'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.users drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.users add constraint users_role_check
  check (role in ('admin', 'staff', 'accountant'));

create or replace function public.is_read_only()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'accountant'
  );
$$;

revoke execute on function public.is_read_only() from public, anon;
grant execute on function public.is_read_only() to authenticated, service_role;

-- Fires for direct table writes AND writes made inside SECURITY DEFINER
-- functions (create_invoice_atomic etc.), because it looks at who is signed in.
create or replace function public.block_read_only_writes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and public.is_read_only() then
    raise exception 'Accountant access is read-only. Ask an admin to make this change.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Every business table (anything with organization_id) plus organizations.
-- users is left out so accountants can still finish the onboarding tour
-- (039 already limits what non-admins can change there).
do $$
declare
  t record;
begin
  for t in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'organization_id'
      and tb.table_type = 'BASE TABLE'
      and c.table_name not in ('users', 'billing_events', 'rate_limits')
    union
    select 'organizations'
  loop
    execute format('drop trigger if exists %I on public.%I', 'zz_read_only_guard', t.table_name);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.block_read_only_writes()',
      'zz_read_only_guard', t.table_name
    );
  end loop;
end $$;

-- ---------- 4) Plan limits in the database ----------
-- Mirrors src/lib/billing/plans.ts: trial/free and Starter 50 invoices a month
-- and 100 active products, Pro 300 invoices, Business unlimited.
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
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_plan_limits() from public, anon;

drop trigger if exists invoices_plan_limits on public.invoices;
create trigger invoices_plan_limits
  before insert on public.invoices
  for each row execute function public.enforce_plan_limits();

drop trigger if exists products_plan_limits on public.products;
create trigger products_plan_limits
  before insert or update of is_active on public.products
  for each row execute function public.enforce_plan_limits();

-- ---------- 5) Recurring invoices ----------
create table if not exists public.recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_invoice_id uuid references public.invoices(id) on delete set null,
  name text not null default '',
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_run_date date not null,
  end_date date,
  items jsonb not null default '[]'::jsonb,
  prices_include_vat boolean not null default false,
  warehouse_id uuid,
  notes text,
  active boolean not null default true,
  last_invoice_id uuid references public.invoices(id) on delete set null,
  last_run_at timestamptz,
  run_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_items_is_array check (jsonb_typeof(items) = 'array')
);

create index if not exists recurring_invoices_org_next_idx
  on public.recurring_invoices (organization_id, active, next_run_date);

alter table public.recurring_invoices enable row level security;

drop policy if exists "recurring_select" on public.recurring_invoices;
drop policy if exists "recurring_insert" on public.recurring_invoices;
drop policy if exists "recurring_update" on public.recurring_invoices;
drop policy if exists "recurring_delete" on public.recurring_invoices;

create policy "recurring_select" on public.recurring_invoices
  for select to authenticated using (organization_id = public.current_org_id());
create policy "recurring_insert" on public.recurring_invoices
  for insert to authenticated with check (organization_id = public.current_org_id());
create policy "recurring_update" on public.recurring_invoices
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "recurring_delete" on public.recurring_invoices
  for delete to authenticated using (organization_id = public.current_org_id());

drop trigger if exists zz_read_only_guard on public.recurring_invoices;
create trigger zz_read_only_guard
  before insert or update or delete on public.recurring_invoices
  for each row execute function public.block_read_only_writes();

select pg_notify('pgrst', 'reload schema');
