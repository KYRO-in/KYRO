-- ============================================================
-- 051: Kayyro Collect, phase 3 - insights
--
--   * A late-payer risk level per customer (low / medium / high), from rules:
--     average days late on paid invoices (last 12 months), broken promises
--     (last 6 months), and what is overdue now (how old, and how much of
--     what they owe).
--   * What is expected in the coming days (promise date, otherwise due date).
--   * A daily summary to the owner (Business plan), at 09:00 on working days
--     by default, by email or WhatsApp. Sent at most once a day.
-- Requires 049 and 050. Safe to run twice.
-- ============================================================

-- ---------- 1) Settings ----------
alter table public.collect_settings add column if not exists summary_enabled boolean not null default false;
alter table public.collect_settings add column if not exists summary_channel text not null default 'email';
-- null = the business's own email (or phone for WhatsApp)
alter table public.collect_settings add column if not exists summary_to text;
alter table public.collect_settings add column if not exists summary_time time not null default '09:00';
alter table public.collect_settings add column if not exists last_summary_on date;

alter table public.collect_settings drop constraint if exists collect_settings_summary_check;
alter table public.collect_settings add constraint collect_settings_summary_check check (
  summary_channel in ('email', 'whatsapp')
  and (summary_to is null or length(summary_to) <= 200)
);

-- Risk badges and the daily summary are on the Business plan
create or replace function public.collect_insights_allows(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select o.plan = 'business' and coalesce(o.subscription_status, 'trialing') not in ('past_due', 'cancelled')
    from public.organizations o where o.id = p_org
  ), false)
$$;

create or replace function public.collect_summary_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.summary_enabled and not coalesce(old.summary_enabled, false) then
    if not public.collect_insights_allows(new.organization_id) then
      raise exception 'The daily summary is part of the Business plan. Upgrade in Settings -> Billing.' using errcode = '42501';
    end if;
  end if;
  new.summary_to := nullif(btrim(coalesce(new.summary_to, '')), '');
  if new.summary_to is not null then
    if new.summary_channel = 'email' and new.summary_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Enter a valid email address for the daily summary.' using errcode = '22023';
    end if;
    if new.summary_channel = 'whatsapp' and length(regexp_replace(new.summary_to, '\D', '', 'g')) < 8 then
      raise exception 'Enter a valid WhatsApp number for the daily summary.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.collect_summary_validate() from public, anon, authenticated;
drop trigger if exists collect_summary_validate on public.collect_settings;
create trigger collect_summary_validate
  before insert or update on public.collect_settings
  for each row execute function public.collect_summary_validate();

-- ---------- 2) Late-payer risk ----------
-- The rules, in one place (the app shows the reasons from the same numbers)
create or replace function public.collect_risk_level(
  p_avg_days_late numeric, p_broken_promises integer, p_oldest_overdue_days integer,
  p_overdue numeric, p_open_balance numeric
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when score >= 4 then 'high' when score >= 2 then 'medium' else 'low' end
  from (
    select
      (case when coalesce(p_avg_days_late, 0) > 30 then 2 when coalesce(p_avg_days_late, 0) > 7 then 1 else 0 end)
      + (case when coalesce(p_broken_promises, 0) >= 2 then 2 when coalesce(p_broken_promises, 0) = 1 then 1 else 0 end)
      + (case when coalesce(p_oldest_overdue_days, 0) > 60 then 2 when coalesce(p_oldest_overdue_days, 0) > 14 then 1 else 0 end)
      + (case when coalesce(p_overdue, 0) > 0 and coalesce(p_open_balance, 0) > 0
                   and p_overdue >= 0.5 * p_open_balance and coalesce(p_oldest_overdue_days, 0) > 7 then 1 else 0 end)
      as score
  ) x
$$;

-- Which business a caller may read: signed-in users only their own; the server says which
create or replace function public.collect_caller_org(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when auth.uid() is not null then public.current_org_id() else p_org end
$$;

create or replace function public.collect_customer_risk(p_org uuid default null)
returns table (
  customer_id uuid,
  customer_name text,
  open_balance numeric,
  overdue_amount numeric,
  oldest_overdue_days integer,
  avg_days_late numeric,
  paid_invoices integer,
  broken_promises integer,
  level text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.collect_caller_org(p_org);
  v_today date;
begin
  if v_org is null then return; end if;
  select local_date into v_today from public.collect_clock(v_org);
  return query
  with open_inv as (
    select i.customer_id as cid, public.collect_invoice_balance(i.id) as bal, i.due_date
    from public.invoices i
    where i.organization_id = v_org and i.status in ('issued', 'partially_paid')
  ),
  paid as (
    select i.customer_id as cid,
           greatest(0, (select max(p.payment_date) from public.payments p where p.invoice_id = i.id) - i.due_date) as late
    from public.invoices i
    where i.organization_id = v_org and i.status = 'paid' and i.due_date is not null
      and i.invoice_date > v_today - 365
  ),
  broken as (
    select pp.customer_id as cid, count(*)::integer as n
    from public.payment_promises pp
    where pp.organization_id = v_org and pp.status = 'broken' and pp.created_at > now() - interval '180 days'
    group by pp.customer_id
  ),
  agg as (
    select
      c.id as cid,
      c.name::text as cname,
      coalesce((select sum(o.bal) from open_inv o where o.cid = c.id and o.bal > 0.0005), 0) as open_bal,
      coalesce((select sum(o.bal) from open_inv o where o.cid = c.id and o.bal > 0.0005 and o.due_date < v_today), 0) as overdue,
      coalesce((select max(v_today - o.due_date) from open_inv o where o.cid = c.id and o.bal > 0.0005 and o.due_date < v_today), 0)::integer as oldest,
      (select round(avg(p.late), 1) from paid p where p.cid = c.id and p.late is not null) as avg_late,
      (select count(*) from paid p where p.cid = c.id)::integer as paid_n,
      coalesce((select b.n from broken b where b.cid = c.id), 0) as broken_n
    from public.customers c
    where c.organization_id = v_org
  )
  select a.cid, a.cname, round(a.open_bal, 3), round(a.overdue, 3), a.oldest, a.avg_late, a.paid_n, a.broken_n,
         public.collect_risk_level(a.avg_late, a.broken_n, a.oldest, a.overdue, a.open_bal)
  from agg a
  where a.open_bal > 0 or a.paid_n > 0 or a.broken_n > 0;
end;
$$;

-- ---------- 3) What is expected in the coming days ----------
create or replace function public.collect_expected(p_org uuid default null, p_days integer default 7)
returns table (
  invoice_id uuid,
  invoice_number text,
  customer_id uuid,
  customer_name text,
  expected_on date,
  balance numeric,
  promised boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.collect_caller_org(p_org);
  v_today date;
begin
  if v_org is null then return; end if;
  select local_date into v_today from public.collect_clock(v_org);
  return query
  select x.id, x.invoice_number, x.customer_id, x.cname, x.expected_on, x.bal, x.promised
  from (
    select i.id, i.invoice_number::text, i.customer_id, c.name::text as cname,
           coalesce(pp.promised_date, i.due_date) as expected_on,
           round(public.collect_invoice_balance(i.id), 3) as bal,
           pp.promised_date is not null as promised
    from public.invoices i
    join public.customers c on c.id = i.customer_id
    left join lateral (
      select p.promised_date from public.payment_promises p
      where p.invoice_id = i.id and p.status = 'open' and p.promised_date >= v_today
      order by p.created_at desc limit 1
    ) pp on true
    where i.organization_id = v_org
      and i.status in ('issued', 'partially_paid')
      and not exists (select 1 from public.disputes d where d.invoice_id = i.id and d.status = 'open')
  ) x
  where x.bal > 0.0005
    and x.expected_on between v_today and v_today + greatest(1, least(coalesce(p_days, 7), 90)) - 1
  order by x.expected_on, x.bal desc;
end;
$$;

-- ---------- 4) The daily summary ----------
create or replace function public.collect_daily_summary_data(p_org uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date;
  v_currency text;
  v_collected numeric;
  v_month numeric;
  v_needs integer;
  v_expected numeric;
  v_overdue numeric;
  v_top jsonb;
begin
  select local_date into v_today from public.collect_clock(p_org, p_now);
  select coalesce(currency, 'AED') into v_currency from public.organizations where id = p_org;
  select coalesce(sum(amount), 0) into v_collected from public.payments
    where organization_id = p_org and payment_date = v_today - 1;
  select coalesce(sum(amount), 0) into v_month from public.payments
    where organization_id = p_org and payment_date >= date_trunc('month', v_today)::date and payment_date <= v_today;
  select count(distinct who) into v_needs from (
    select coalesce(t.customer_id::text, t.id::text) as who from public.collect_tasks t
      where t.organization_id = p_org and t.status = 'open' and t.kind <> 'limit'
    union
    select coalesce(m.customer_id::text, m.id::text) from public.collection_messages m
      where m.organization_id = p_org and m.direction = 'out' and m.status in ('awaiting_approval', 'failed')
  ) n;
  select coalesce(sum(e.balance), 0) into v_expected from public.collect_expected(p_org, 7) e;
  select coalesce(sum(public.collect_invoice_balance(i.id)), 0) into v_overdue from public.invoices i
    where i.organization_id = p_org and i.status in ('issued', 'partially_paid') and i.due_date < v_today;
  select coalesce(jsonb_agg(t.title order by t.created_at), '[]'::jsonb) into v_top from (
    select title, created_at from public.collect_tasks
    where organization_id = p_org and status = 'open' and kind <> 'limit'
    order by created_at limit 3
  ) t;
  return jsonb_build_object(
    'date', v_today,
    'currency', v_currency,
    'collected_yesterday', round(v_collected, 3),
    'collected_month', round(v_month, 3),
    'needs_you', v_needs,
    'expected_week', round(v_expected, 3),
    'overdue', round(v_overdue, 3),
    'top', v_top
  );
end;
$$;

-- Claim today's summary (once per business per day, at or after the summary time, on working days)
create or replace function public.collect_claim_summary(p_org uuid, p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.collect_settings%rowtype;
  clk record;
begin
  select * into s from public.collect_settings where organization_id = p_org for update;
  if not found or not s.summary_enabled then return false; end if;
  if not public.collect_insights_allows(p_org) then return false; end if;
  select * into clk from public.collect_clock(p_org, p_now);
  if not clk.working_day or clk.local_ts::time < s.summary_time then return false; end if;
  if s.last_summary_on is not null and s.last_summary_on >= clk.local_date then return false; end if;
  update public.collect_settings set last_summary_on = clk.local_date where organization_id = p_org;
  return true;
end;
$$;

-- ---------- 5) Grants ----------
do $$
declare
  f text;
begin
  foreach f in array array[
    'collect_daily_summary_data(uuid, timestamptz)',
    'collect_claim_summary(uuid, timestamptz)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Signed-in users read their own business only (collect_caller_org)
  foreach f in array array[
    'collect_customer_risk(uuid)',
    'collect_expected(uuid, integer)',
    'collect_insights_allows(uuid)',
    'collect_risk_level(numeric, integer, integer, numeric, numeric)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public.collect_caller_org(uuid) from public, anon, authenticated';
end $$;

-- ---------- schema version ----------
create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 51 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
