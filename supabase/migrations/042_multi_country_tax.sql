-- ============================================================
-- Kayyro: every country's tax
--
-- Paste into the Supabase SQL Editor once. Additive, data-safe and safe to
-- re-run. Nothing is deleted and existing amounts keep their exact value.
--
-- 1) Money columns hold 3 decimals, for currencies with 1000 minor units:
--    Bahraini dinar, Omani rial, Kuwaiti dinar. (numeric(14,2) becomes
--    numeric(15,3): every existing value fits and is unchanged.)
-- 2) Invoices and credit notes remember the tax rules they were issued under:
--    tax_country, tax_treatment (local sale / reverse charge / export),
--    tax_split (India: CGST+SGST or IGST) and the printed place of supply.
--    Purchases remember the country and India's input-tax split.
-- 3) record_payment keeps 3-decimal amounts (a dinar invoice paid in full is
--    "paid", not left 0.005 short).
-- 4) public.kayyro_schema_version() lets the app check this migration ran.
-- ============================================================

-- ---------- 1) 3-decimal money ----------
do $$
declare
  col record;
begin
  for col in
    select c.table_name, c.column_name, c.numeric_precision
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.data_type = 'numeric'
      and c.numeric_scale = 2
      -- percentages and tax rates stay as they are
      and c.column_name !~ '(rate|percent|purity)$'
      and c.column_name not in ('vat_rate', 'gst_rate')
  loop
    begin
      execute format(
        'alter table public.%I alter column %I type numeric(%s, 3)',
        col.table_name,
        col.column_name,
        col.numeric_precision + 1
      );
    exception when others then
      raise notice 'kept %.% at 2 decimals: %', col.table_name, col.column_name, sqlerrm;
    end;
  end loop;
end $$;

-- ---------- 2) Tax rules stamped on documents ----------
alter table public.invoices
  add column if not exists tax_country text,
  add column if not exists tax_treatment text not null default 'domestic',
  add column if not exists tax_split text not null default 'single',
  add column if not exists place_of_supply text;

alter table public.credit_notes
  add column if not exists tax_country text,
  add column if not exists tax_treatment text not null default 'domestic',
  add column if not exists tax_split text not null default 'single',
  add column if not exists place_of_supply text;

alter table public.purchases
  add column if not exists tax_country text,
  add column if not exists tax_split text not null default 'single';

do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'credit_notes'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_tax_treatment_check');
    execute format(
      'alter table public.%I add constraint %I check (tax_treatment in (''domestic'', ''reverse_charge'', ''export''))',
      t, t || '_tax_treatment_check'
    );
  end loop;
  foreach t in array array['invoices', 'credit_notes', 'purchases'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_tax_split_check');
    execute format(
      'alter table public.%I add constraint %I check (tax_split in (''single'', ''cgst_sgst'', ''igst''))',
      t, t || '_tax_split_check'
    );
  end loop;
end $$;

-- Documents issued before this migration were issued under their
-- organization's country at the time (UAE for every existing business).
update public.invoices i
set tax_country = coalesce(o.country, 'AE')
from public.organizations o
where i.organization_id = o.id and i.tax_country is null and i.currency is distinct from 'INR';

update public.credit_notes c
set tax_country = coalesce(o.country, 'AE')
from public.organizations o
where c.organization_id = o.id and c.tax_country is null and c.currency is distinct from 'INR';

update public.purchases p
set tax_country = coalesce(o.country, 'AE')
from public.organizations o
where p.organization_id = o.id and p.tax_country is null and p.currency is distinct from 'INR';

comment on column public.invoices.tax_country is 'Country whose tax rules the invoice was issued under (ISO 3166-1 alpha-2).';
comment on column public.invoices.tax_treatment is 'domestic | reverse_charge | export';
comment on column public.invoices.tax_split is 'single (VAT) | cgst_sgst | igst (India GST)';
comment on column public.invoices.place_of_supply is 'Printed place of supply, e.g. Dubai or Karnataka (29).';
comment on column public.organizations.country is 'ISO 3166-1 alpha-2 country of the tax registration.';
comment on column public.organizations.tax_id is 'Tax registration number (TRN, VAT number, GSTIN...).';
comment on column public.organizations.state is 'Emirate / state / region (free text).';

create index if not exists invoices_tax_treatment_idx
  on public.invoices (organization_id, tax_treatment)
  where tax_treatment <> 'domestic';

-- ---------- 3) Payments keep 3 decimals ----------
create or replace function public.record_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_customer_id uuid;
  v_invoice_id uuid;
  v_amount numeric(15, 3);
  v_payment_date date;
  v_payment_mode text;
  v_notes text;
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_new_paid numeric(15, 3);
  v_new_status text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_org is null then
    raise exception 'No organization for current user';
  end if;

  v_customer_id := (payload->>'customer_id')::uuid;
  v_invoice_id := nullif(payload->>'invoice_id', '')::uuid;
  v_amount := round((payload->>'amount')::numeric, 3);
  v_payment_date := coalesce((payload->>'payment_date')::date, current_date);
  v_payment_mode := coalesce(nullif(payload->>'payment_mode', ''), 'cash');
  v_notes := nullif(payload->>'notes', '');

  if v_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'amount must be > 0';
  end if;
  if v_payment_mode not in ('cash', 'bank_transfer', 'upi', 'cheque', 'card') then
    raise exception 'Invalid payment_mode';
  end if;

  if not exists (
    select 1 from public.customers
    where id = v_customer_id and organization_id = v_org
  ) then
    raise exception 'Customer not found';
  end if;

  if v_invoice_id is not null then
    select * into v_invoice
    from public.invoices
    where id = v_invoice_id and organization_id = v_org
    for update;
    if not found then
      raise exception 'Invoice not found';
    end if;
    if v_invoice.customer_id <> v_customer_id then
      raise exception 'Invoice does not belong to this customer';
    end if;
    if v_invoice.status = 'cancelled' then
      raise exception 'Cannot record payment on a cancelled invoice';
    end if;
  end if;

  insert into public.payments (
    organization_id, customer_id, invoice_id, amount,
    payment_date, payment_mode, notes, created_by
  ) values (
    v_org, v_customer_id, v_invoice_id, v_amount,
    v_payment_date, v_payment_mode, v_notes,
    coalesce(nullif(payload->>'created_by', '')::uuid, v_user_id)
  )
  returning * into v_payment;

  if v_invoice_id is not null then
    v_new_paid := round(coalesce(v_invoice.amount_paid, 0) + v_amount, 3);
    if v_new_paid >= v_invoice.grand_total then
      v_new_paid := v_invoice.grand_total;
      v_new_status := 'paid';
    elsif v_new_paid > 0 then
      v_new_status := 'partially_paid';
    else
      v_new_status := 'issued';
    end if;

    update public.invoices
    set amount_paid = v_new_paid,
        status = v_new_status
    where id = v_invoice_id;
  end if;

  return to_jsonb(v_payment);
end;
$$;

revoke execute on function public.record_payment(jsonb) from public, anon;
grant execute on function public.record_payment(jsonb) to authenticated, service_role;

-- ---------- 4) Schema version ----------
create or replace function public.kayyro_schema_version()
returns integer
language sql
stable
set search_path = public, pg_temp
as $$ select 42 $$;

revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
