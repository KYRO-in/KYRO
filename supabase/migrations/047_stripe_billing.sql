-- ============================================================
-- Kayyro: Stripe subscriptions (Gulf, UK and Europe customers pay in AED)
--
-- Razorpay stays for businesses in India. Stripe is the second payment
-- provider, so an organization can have either a Razorpay or a Stripe
-- subscription.
--
-- 1) organizations: stripe_customer_id, stripe_subscription_id
-- 2) billing_events: which provider sent the event, the Stripe subscription,
--    and the provider's own event id (so a retried webhook is logged once)
-- 3) the two new billing columns are server-only, like the Razorpay ones
--    (an admin can never give themselves a plan from the browser)
-- 4) schema version 47
--
-- Run after 046. Additive, data-safe and safe to re-run.
-- ============================================================

alter table public.organizations add column if not exists stripe_customer_id text;
alter table public.organizations add column if not exists stripe_subscription_id text;

create index if not exists organizations_stripe_customer_idx
  on public.organizations (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists organizations_stripe_subscription_idx
  on public.organizations (stripe_subscription_id) where stripe_subscription_id is not null;

alter table public.billing_events add column if not exists provider text not null default 'razorpay';
alter table public.billing_events add column if not exists stripe_subscription_id text;
alter table public.billing_events add column if not exists provider_event_id text;

alter table public.billing_events drop constraint if exists billing_events_provider_check;
alter table public.billing_events add constraint billing_events_provider_check
  check (provider in ('razorpay', 'stripe'));

-- One row per Stripe event id; Razorpay rows keep a null id
create unique index if not exists billing_events_provider_event_key
  on public.billing_events (provider, provider_event_id) where provider_event_id is not null;

-- ---------- billing columns are server-only (adds the Stripe ones to 039's list) ----------
create or replace function public.protect_org_billing_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  col text;
  locked text[] := array[
    'plan',
    'subscription_status',
    'trial_ends_at',
    'current_period_end',
    'cancel_at_period_end',
    'razorpay_customer_id',
    'razorpay_subscription_id',
    'stripe_customer_id',
    'stripe_subscription_id'
  ];
begin
  -- Only signed-in / anonymous API callers are restricted. The service role
  -- (server routes, webhooks), the SQL editor and SECURITY DEFINER functions
  -- run as other database roles and pass through.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  foreach col in array locked loop
    if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
      raise exception 'Billing details can only be changed through Kayyro billing (%).', col
        using errcode = '42501';
    end if;
  end loop;

  if new.id is distinct from old.id then
    raise exception 'Organization id cannot be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------- schema version ----------
create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 47 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
