-- ============================================================
-- Kayyro: financial records can't be altered behind the app's back
--
-- Security review 2026-10-29, findings H2 and H3.
--
-- 1) Totals are checked by the database. Every invoice line must add up
--    (quantity x price, tax from the rate, line total = value + tax) and the
--    invoice header must equal the sum of its lines. Purchases and credit
--    notes get the same line check and a header check. Prices, values and
--    tax can no longer be negative.
-- 2) Issued documents are locked for signed-in users (browser / API):
--    - invoices: amounts, customer, date, number and lines can only change
--      through Kayyro's own invoice functions. A user may still cancel an
--      invoice, set its status to match what has been paid, assign its
--      short link once, and stamp its tax details right after saving.
--      Invoices can't be deleted (cancel or issue a credit note instead).
--    - invoice lines and payments: only through Kayyro's functions.
--    - purchases and credit notes: created as before; afterwards they can't be
--      edited or deleted, and lines can only be added by their creator in the
--      first 10 minutes (while the app is saving them).
--    - stock history: entries can't be deleted; only an admin or the person
--      who made a manual entry may edit its quantity, notes or batch details,
--      and never an entry that belongs to an invoice, purchase or credit note.
-- 3) audit_log: every change or removal of an invoice, payment, purchase,
--    credit note or stock entry is recorded with who did it, before and after.
--    Admins of the business can read it.
--
-- Kayyro's own database functions (create/update invoice, record payment) and
-- the server (service role) are not restricted by the locks in 2); the checks
-- in 1) apply to everyone.
--
-- Run after 047. Additive, data-safe (existing rows are not re-checked until
-- they are next changed) and safe to re-run.
-- ============================================================

-- ---------- 1) Totals ----------

-- Why a document line is wrong, or null when it is fine. Tolerances cover the
-- app's rounding (2 or 3 decimals, India's equal CGST/SGST halves).
create or replace function public.document_line_problem(
  p_qty numeric, p_price numeric, p_taxable numeric, p_rate numeric, p_tax numeric, p_total numeric
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_qty is null or p_qty <= 0 then 'quantity must be more than zero'
    when coalesce(p_price, 0) < 0 then 'price cannot be negative'
    when coalesce(p_taxable, 0) < 0 or coalesce(p_tax, 0) < 0 or coalesce(p_total, 0) < 0 then 'amounts cannot be negative'
    when coalesce(p_rate, 0) < 0 or coalesce(p_rate, 0) > 100 then 'tax rate must be between 0 and 100'
    when abs(coalesce(p_tax, 0) - coalesce(p_taxable, 0) * coalesce(p_rate, 0) / 100) > 0.02 then 'tax does not match the tax rate'
    when abs(coalesce(p_total, 0) - (coalesce(p_taxable, 0) + coalesce(p_tax, 0))) > 0.011 then 'line total does not add up'
    when abs(coalesce(p_taxable, 0) - p_qty * coalesce(p_price, 0)) > 0.011
     and abs(coalesce(p_total, 0) - p_qty * coalesce(p_price, 0)) > 0.011 then 'line amount does not match quantity x price'
    else null
  end
$$;

-- Header: grand total = subtotal + tax + round-off, nothing negative
create or replace function public.document_header_problem(
  p_subtotal numeric, p_tax numeric, p_round numeric, p_grand numeric
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_subtotal, 0) < 0 or coalesce(p_tax, 0) < 0 or coalesce(p_grand, 0) < 0 then 'amounts cannot be negative'
    when abs(coalesce(p_round, 0)) > 1 then 'round-off cannot be more than 1'
    when abs(coalesce(p_grand, 0) - (coalesce(p_subtotal, 0) + coalesce(p_tax, 0) + coalesce(p_round, 0))) > 0.011
      then 'grand total does not add up'
    else null
  end
$$;

create or replace function public.validate_invoice_totals(p_invoice uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  inv public.invoices%rowtype;
  it record;
  n integer;
  s_taxable numeric;
  s_tax numeric;
  bad text;
begin
  select * into inv from public.invoices where id = p_invoice;
  if not found or inv.status = 'cancelled' then
    return;
  end if;

  select count(*), coalesce(sum(taxable_value), 0), coalesce(sum(vat_amount), 0)
    into n, s_taxable, s_tax
  from public.invoice_items where invoice_id = p_invoice;
  if n = 0 then
    raise exception 'Invoice % has no lines.', inv.invoice_number using errcode = '23514';
  end if;

  for it in select * from public.invoice_items where invoice_id = p_invoice loop
    bad := public.document_line_problem(it.quantity, it.unit_price, it.taxable_value, it.vat_rate, it.vat_amount, it.line_total);
    if bad is not null then
      raise exception 'Invoice %: %.', inv.invoice_number, bad using errcode = '23514';
    end if;
  end loop;

  if abs(coalesce(inv.subtotal, 0) - s_taxable) > 0.011 or abs(coalesce(inv.total_vat, 0) - s_tax) > 0.011 then
    raise exception 'Invoice %: totals do not match its lines.', inv.invoice_number using errcode = '23514';
  end if;
  bad := public.document_header_problem(inv.subtotal, inv.total_vat, inv.round_off, inv.grand_total);
  if bad is not null then
    raise exception 'Invoice %: %.', inv.invoice_number, bad using errcode = '23514';
  end if;
end;
$$;

create or replace function public.check_invoice_totals_trigger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'invoices' then
    perform public.validate_invoice_totals(new.id);
  elsif tg_op = 'DELETE' then
    perform public.validate_invoice_totals(old.invoice_id);
  else
    perform public.validate_invoice_totals(new.invoice_id);
  end if;
  return null;
end;
$$;

-- Checked when the transaction commits, so a whole invoice (header + lines) is
-- judged as one. Existing invoices are only checked when their amounts change.
drop trigger if exists zz_invoice_totals_check on public.invoices;
create constraint trigger zz_invoice_totals_check
  after insert or update of subtotal, total_vat, round_off, grand_total on public.invoices
  deferrable initially deferred
  for each row execute function public.check_invoice_totals_trigger();

drop trigger if exists zz_invoice_items_totals_check on public.invoice_items;
create constraint trigger zz_invoice_items_totals_check
  after insert or update or delete on public.invoice_items
  deferrable initially deferred
  for each row execute function public.check_invoice_totals_trigger();

-- Purchases and credit notes: each line and the header on their own
create or replace function public.check_document_line()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  bad text;
begin
  if tg_table_name = 'purchase_items' then
    bad := public.document_line_problem(new.quantity, new.unit_cost, new.taxable_value, new.vat_rate, new.vat_amount, new.line_total);
  else
    bad := public.document_line_problem(new.quantity, new.unit_price, new.taxable_value, new.vat_rate, new.vat_amount, new.line_total);
  end if;
  if bad is not null then
    raise exception 'This line is not valid: %.', bad using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.check_document_header()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  bad text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  bad := public.document_header_problem(new.subtotal, new.total_vat, new.round_off, new.grand_total);
  if bad is not null then
    raise exception 'This document is not valid: %.', bad using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_purchase_items_check on public.purchase_items;
create trigger zz_purchase_items_check
  before insert or update on public.purchase_items
  for each row execute function public.check_document_line();
drop trigger if exists zz_credit_note_items_check on public.credit_note_items;
create trigger zz_credit_note_items_check
  before insert or update on public.credit_note_items
  for each row execute function public.check_document_line();
drop trigger if exists zz_purchases_check on public.purchases;
create trigger zz_purchases_check
  before insert or update of subtotal, total_vat, round_off, grand_total on public.purchases
  for each row execute function public.check_document_header();
drop trigger if exists zz_credit_notes_check on public.credit_notes;
create trigger zz_credit_notes_check
  before insert or update of subtotal, total_vat, round_off, grand_total on public.credit_notes
  for each row execute function public.check_document_header();

-- ---------- 2) Locks for signed-in users ----------
-- current_user is 'authenticated' / 'anon' for browser and API calls. Kayyro's
-- SECURITY DEFINER functions and the server run as other roles and pass.

create or replace function public.lock_invoices()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  k text;
  allowed text[] := array['status', 'cancelled_reason', 'short_code', 'tax_country', 'tax_treatment', 'tax_split', 'place_of_supply'];
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

  if old.status = 'cancelled' and (new.status, new.cancelled_reason) is distinct from (old.status, old.cancelled_reason) then
    raise exception 'A cancelled invoice cannot be reopened.' using errcode = '42501';
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

drop trigger if exists zx_lock_invoices on public.invoices;
create trigger zx_lock_invoices
  before insert or update or delete on public.invoices
  for each row execute function public.lock_invoices();

-- Invoice lines and payments: only through Kayyro's functions
create or replace function public.lock_via_functions_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'payments' then
    raise exception 'Payments are recorded through Kayyro''s Record payment.' using errcode = '42501';
  end if;
  raise exception 'Invoice lines can only be changed by editing the invoice in Kayyro.' using errcode = '42501';
end;
$$;

drop trigger if exists zx_lock_invoice_items on public.invoice_items;
create trigger zx_lock_invoice_items
  before insert or update or delete on public.invoice_items
  for each row execute function public.lock_via_functions_only();
drop trigger if exists zx_lock_payments on public.payments;
create trigger zx_lock_payments
  before insert or update or delete on public.payments
  for each row execute function public.lock_via_functions_only();

-- Purchases and credit notes: no edits or deletes once saved
create or replace function public.lock_saved_documents()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or tg_op = 'INSERT' then
    return coalesce(new, old);
  end if;
  raise exception 'A saved % cannot be changed or deleted. Issue a new document to correct it.',
    case when tg_table_name = 'purchases' then 'purchase' else 'credit note' end
    using errcode = '42501';
end;
$$;

drop trigger if exists zx_lock_purchases on public.purchases;
create trigger zx_lock_purchases
  before insert or update or delete on public.purchases
  for each row execute function public.lock_saved_documents();
drop trigger if exists zx_lock_credit_notes on public.credit_notes;
create trigger zx_lock_credit_notes
  before insert or update or delete on public.credit_notes
  for each row execute function public.lock_saved_documents();

-- Their lines: added by the document's creator while it is being saved
create or replace function public.lock_document_lines()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_creator uuid;
  v_created timestamptz;
  v_found boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Saved document lines cannot be changed or deleted. Issue a new document to correct it.' using errcode = '42501';
  end if;

  if tg_table_name = 'purchase_items' then
    select created_by, created_at, true into v_creator, v_created, v_found
    from public.purchases where id = new.purchase_id and organization_id = new.organization_id;
  else
    select created_by, created_at, true into v_creator, v_created, v_found
    from public.credit_notes where id = new.credit_note_id and organization_id = new.organization_id;
  end if;

  if not coalesce(v_found, false)
     or (v_creator is not null and v_creator is distinct from auth.uid())
     or v_created < now() - interval '10 minutes' then
    raise exception 'Lines can only be added while the document is being created.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists zx_lock_purchase_items on public.purchase_items;
create trigger zx_lock_purchase_items
  before insert or update or delete on public.purchase_items
  for each row execute function public.lock_document_lines();
drop trigger if exists zx_lock_credit_note_items on public.credit_note_items;
create trigger zx_lock_credit_note_items
  before insert or update or delete on public.credit_note_items
  for each row execute function public.lock_document_lines();

-- Stock history
create or replace function public.lock_stock_movements()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ref text;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Stock history cannot be deleted. Add an adjustment instead.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if not (public.is_admin() or old.created_by = auth.uid()) then
      raise exception 'Only an admin or the person who made this stock entry can edit it.' using errcode = '42501';
    end if;
    if (new.product_id, new.movement_type, new.warehouse_id, new.organization_id, new.created_by, new.created_at)
         is distinct from (old.product_id, old.movement_type, old.warehouse_id, old.organization_id, old.created_by, old.created_at) then
      raise exception 'Only the quantity, notes and batch details of a stock entry can be edited.' using errcode = '42501';
    end if;
    v_ref := nullif(trim(coalesce(old.reference, '')), '');
    if coalesce(old.reason, '') like 'Invoice %'
       or (v_ref is not null and (
            exists (select 1 from public.invoices where organization_id = old.organization_id and invoice_number = v_ref)
         or exists (select 1 from public.purchases where organization_id = old.organization_id and purchase_number = v_ref)
         or exists (select 1 from public.credit_notes where organization_id = old.organization_id and credit_note_number = v_ref))) then
      raise exception 'This stock entry belongs to an invoice, purchase or credit note. Change that document instead.' using errcode = '42501';
    end if;
    new.edited_by := auth.uid();
    new.edited_at := now();
  else
    if new.created_by is not null and new.created_by is distinct from auth.uid() then
      raise exception 'Stock entries are recorded under your own name.' using errcode = '42501';
    end if;
  end if;

  if (new.movement_type = 'in' and coalesce(new.quantity, 0) <= 0)
     or (new.movement_type = 'out' and coalesce(new.quantity, 0) >= 0) then
    raise exception 'Stock in must be a positive quantity and stock out a negative one.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists zx_lock_stock_movements on public.stock_movements;
create trigger zx_lock_stock_movements
  before insert or update or delete on public.stock_movements
  for each row execute function public.lock_stock_movements();

-- ---------- 3) Audit log ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  changed_by uuid,
  old_row jsonb,
  new_row jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_org_idx on public.audit_log (organization_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists "audit_log_select_admin" on public.audit_log;
create policy "audit_log_select_admin" on public.audit_log
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());
drop policy if exists "zz_mfa_required" on public.audit_log;
create policy "zz_mfa_required" on public.audit_log
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  insert into public.audit_log (organization_id, table_name, row_id, action, changed_by, old_row, new_row)
  values (
    nullif(v_row ->> 'organization_id', '')::uuid,
    tg_table_name,
    nullif(v_row ->> 'id', '')::uuid,
    lower(tg_op),
    auth.uid(),
    v_old,
    v_new
  );
  return null;
end;
$$;
revoke execute on function public.write_audit_log() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'payments', 'purchases', 'credit_notes', 'stock_movements'] loop
    execute format('drop trigger if exists zz_audit_log on public.%I', t);
    execute format(
      'create trigger zz_audit_log after update or delete on public.%I for each row execute function public.write_audit_log()',
      t
    );
  end loop;
end $$;

-- ---------- schema version ----------
create or replace function public.kayyro_schema_version()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 48 $$;
revoke execute on function public.kayyro_schema_version() from public, anon;
grant execute on function public.kayyro_schema_version() to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
