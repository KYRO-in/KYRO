-- ============================================================
-- Kayyro: security hardening
--
-- 1) Billing fields on organizations can only be changed by the server
--    (service role: signup, Razorpay webhook). An admin can still edit every
--    other business setting, but can no longer give themselves a paid plan
--    or extend their trial from the browser.
-- 2) rate_limits table + rate_limit_hit() for API rate limiting that works
--    across serverless instances. Service role only.
-- 3) Every SECURITY DEFINER function in public gets a fixed search_path and
--    can no longer be executed by anonymous (signed-out) callers.
-- 4) Signature images can no longer be listed by anyone on the internet.
-- 5) New organizations default to the Kayyro invoice prefix.
--
-- Additive, data-safe and safe to re-run.
-- ============================================================

-- ---------- 1) Billing columns are server-only ----------
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
    'razorpay_subscription_id'
  ];
begin
  -- Only signed-in / anonymous API callers are restricted. The service role
  -- (server routes, webhook), the SQL editor and SECURITY DEFINER functions
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

drop trigger if exists organizations_protect_billing on public.organizations;
create trigger organizations_protect_billing
  before update on public.organizations
  for each row execute function public.protect_org_billing_columns();

-- Users can never move themselves (or a teammate) to another organization,
-- and a profile id is permanent. Migration 023 lets every user update their
-- own row (to mark the onboarding tour as seen); without this guard a staff
-- member could also set role = 'admin' on themselves. Non-admins may now only
-- change their own name and onboarding flag.
create or replace function public.protect_user_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  self_editable text[] := array['full_name', 'has_seen_onboarding', 'updated_at'];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.id is distinct from old.id then
    raise exception 'User id cannot be changed.' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A user cannot be moved to another organization.' using errcode = '42501';
  end if;
  if not public.is_admin()
     and (to_jsonb(new) - self_editable) is distinct from (to_jsonb(old) - self_editable) then
    raise exception 'Only an admin can change roles and access.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists users_protect_identity on public.users;
create trigger users_protect_identity
  before update on public.users
  for each row execute function public.protect_user_identity();

-- ---------- 2) Rate limiting (fixed window, service role only) ----------
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) may touch it.
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, hit_count integer, retry_after integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window integer := greatest(1, p_window_seconds);
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (left(p_key, 200), v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Opportunistic cleanup of old windows
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return query select
    v_hits <= p_limit,
    v_hits,
    greatest(0, ceil(extract(epoch from (v_start + make_interval(secs => v_window) - now()))))::integer;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------- 3) SECURITY DEFINER functions: fixed search_path, no anon ----------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prokind = 'f'
  loop
    if fn.proconfig is null
       or not exists (select 1 from unnest(fn.proconfig) c where c like 'search_path=%') then
      execute format('alter function %s set search_path = public, extensions, pg_temp', fn.sig);
    end if;

    execute format('revoke execute on function %s from public, anon', fn.sig);
    if fn.proname <> 'rate_limit_hit' then
      execute format('grant execute on function %s to authenticated, service_role', fn.sig);
    end if;
  end loop;
end $$;

-- Functions created later by the postgres role are not executable by anon by default.
alter default privileges in schema public revoke execute on functions from anon;

-- ---------- 4) Signatures bucket: no public listing ----------
-- The bucket stays public, so the signature URL printed on invoices keeps
-- working. But the old "anyone can select" policy also let anyone LIST every
-- organization's signature file through the Storage API. Reading through the
-- API is now limited to your own organization's folder.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "signatures_select_public" on storage.objects';
    execute 'drop policy if exists "signatures_select_own_org" on storage.objects';
    execute $p$create policy "signatures_select_own_org" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'signatures'
        and (storage.foldername(name))[1] = public.current_org_id()::text
      )$p$;
  end if;
end $$;

-- ---------- 5) Kayyro invoice prefix for new organizations ----------
alter table public.organizations alter column invoice_prefix set default 'KY';

select pg_notify('pgrst', 'reload schema');
