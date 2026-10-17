-- ============================================================
-- Kayyro: finish the rename in databases created before it
--
-- Older migrations left two leftovers from earlier product names:
--   - create_invoice_atomic falls back to the prefix "NF" when the app sends
--     none (the app always sends the business's own prefix, so this is only
--     a safety net)
--   - the legacy company_settings table defaulted to an old brand and "AB"
-- Both now default to Kayyro / "KY". Nothing else in the function changes.
--
-- Run after 044. Safe to re-run.
-- ============================================================

do $$
declare
  v_def text;
begin
  if to_regprocedure('public.create_invoice_atomic(jsonb)') is null then
    return;
  end if;
  v_def := pg_get_functiondef('public.create_invoice_atomic(jsonb)'::regprocedure);
  if position('''NF''' in v_def) > 0 or position('''AB''' in v_def) > 0 then
    -- CREATE OR REPLACE keeps the function's grants and owner
    execute replace(replace(v_def, '''NF''', '''KY'''), '''AB''', '''KY''');
  end if;
end $$;

do $$
begin
  if to_regclass('public.company_settings') is not null then
    execute $q$alter table public.company_settings alter column brand_name set default 'Kayyro'$q$;
    execute $q$alter table public.company_settings alter column invoice_prefix set default 'KY'$q$;
  end if;
end $$;

alter table public.organizations alter column invoice_prefix set default 'KY';

select pg_notify('pgrst', 'reload schema');
