-- ============================================================
-- Kayyro: the product was renamed from its earlier name.
--
-- 1) The schema-version helper moves to its new name (the app calls
--    kayyro_schema_version); the old function is dropped.
-- 2) Brand defaults and any business still carrying the old brand name
--    switch to "Kayyro". Businesses that chose their own brand name keep it.
--
-- Run after 045. Safe to re-run.
-- ============================================================

create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 46 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

drop function if exists public.kyro_schema_version();

update public.organizations set brand_name = 'Kayyro' where brand_name = 'KYRO';

do $$
begin
  if to_regclass('public.company_settings') is not null then
    execute $q$alter table public.company_settings alter column brand_name set default 'Kayyro'$q$;
    execute $q$update public.company_settings set brand_name = 'Kayyro' where brand_name = 'KYRO'$q$;
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
