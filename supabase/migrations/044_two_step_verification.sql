-- ============================================================
-- Kayyro: two-step verification (2FA) enforced in the database
--
-- Someone who turned on 2FA must have entered their authenticator code in
-- this session (Supabase marks the session "aal2") before any business data
-- can be read or changed. Without this, a stolen password alone could still
-- reach the data through the API, even though the app asks for the code.
--
-- Accounts without 2FA are not affected.
-- Run after 043. Additive and safe to re-run.
-- ============================================================

create or replace function public.mfa_satisfied()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_factor boolean := false;
begin
  if auth.uid() is null then
    return true; -- server jobs (service role) and signed-out requests are handled elsewhere
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then
    return true;
  end if;
  if to_regclass('auth.mfa_factors') is null then
    return true;
  end if;
  execute 'select exists (select 1 from auth.mfa_factors where user_id = $1 and status = ''verified'')'
    into v_has_factor
    using auth.uid();
  return not v_has_factor;
end;
$$;

revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

-- A restrictive policy is ANDed with every other policy on the table.
-- "(select ...)" makes Postgres check it once per query, not once per row.
do $$
declare
  t record;
begin
  for t in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      -- users stays reachable so the app can load the profile and show the code screen
      and c.relname not in ('users')
  loop
    execute format('drop policy if exists %I on public.%I', 'zz_mfa_required', t.table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      'zz_mfa_required', t.table_name
    );
  end loop;
end $$;

create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
as $$ select 44 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
