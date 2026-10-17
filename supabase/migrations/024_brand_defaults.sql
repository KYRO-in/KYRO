  -- Display-brand defaults only (no schema rename). Safe for new rows.
  -- Existing orgs keep their own invoice_prefix; brand_name updated only if still the old product default.

  alter table public.organizations
    alter column invoice_prefix set default 'KY';

  update public.organizations
  set brand_name = 'Kayyro'
  where brand_name = 'AURA Clean';

  -- company_settings may still exist in older installs
  do $$
  begin
    if to_regclass('public.company_settings') is not null then
      execute $q$alter table public.company_settings alter column brand_name set default 'Kayyro'$q$;
      execute $q$alter table public.company_settings alter column invoice_prefix set default 'KY'$q$;
      execute $q$update public.company_settings set brand_name = 'Kayyro' where brand_name = 'AURA Clean'$q$;
    end if;
  end $$;

  notify pgrst, 'reload schema';
