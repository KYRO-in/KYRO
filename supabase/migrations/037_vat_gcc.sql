-- ============================================================
-- PASTE into Supabase SQL Editor (once) — Kayyro VAT (UAE first)
--
-- Replaces India GST (CGST/SGST/IGST, GSTIN, HSN) with VAT.
-- Additive and data-safe:
--   * new VAT columns are added and backfilled from the GST columns
--   * old GST columns are KEPT (read-only history, no longer written)
--   * invoices/purchases/credit notes issued before this migration are
--     stamped currency = 'INR' so historical amounts still read correctly
--   * existing organizations move to country 'AE' / currency 'AED'
-- Safe to re-run.
-- ============================================================

-- ---------- 1) Organizations: country, currency, tax registration ----------
alter table public.organizations
  add column if not exists country text,
  add column if not exists currency text,
  add column if not exists tax_id text,
  add column if not exists prices_include_vat boolean not null default false;

update public.organizations set country = 'AE' where country is null;
update public.organizations set currency = 'AED' where currency is null;

alter table public.organizations alter column country set default 'AE';
alter table public.organizations alter column country set not null;
alter table public.organizations alter column currency set default 'AED';
alter table public.organizations alter column currency set not null;
alter table public.organizations alter column state set default '';
alter table public.organizations alter column invoice_prefix set default 'KY';

comment on column public.organizations.country is 'ISO 3166-1 alpha-2 country of the VAT registration (AE first).';
comment on column public.organizations.currency is 'ISO 4217 invoicing currency, e.g. AED.';
comment on column public.organizations.tax_id is 'VAT registration number (UAE: 15-digit TRN).';
comment on column public.organizations.state is 'Emirate / region (free text).';
comment on column public.organizations.gstin is 'DEPRECATED: India GSTIN, kept for history only.';

-- ---------- 2) Customers & suppliers: VAT number + country ----------
alter table public.customers
  add column if not exists tax_id text,
  add column if not exists country text not null default 'AE';
alter table public.customers alter column state set default '';

alter table public.suppliers
  add column if not exists tax_id text,
  add column if not exists country text not null default 'AE';
alter table public.suppliers alter column state set default '';

comment on column public.customers.tax_id is 'Customer VAT registration number (TRN), if VAT-registered.';
comment on column public.customers.gstin is 'DEPRECATED: India GSTIN, kept for history only.';
comment on column public.suppliers.tax_id is 'Supplier VAT registration number (TRN).';
comment on column public.suppliers.gstin is 'DEPRECATED: India GSTIN, kept for history only.';

-- ---------- 3) Catalog: products & hotel room types ----------
alter table public.products
  add column if not exists vat_rate numeric(5,2),
  add column if not exists vat_category text;

-- Existing catalog moves to the UAE standard rate; 0% GST items become zero-rated.
update public.products
set vat_rate = case when coalesce(gst_rate, 0) = 0 then 0 else 5 end
where vat_rate is null;
update public.products
set vat_category = case when coalesce(vat_rate, 0) = 0 then 'zero' else 'standard' end
where vat_category is null;

alter table public.products alter column vat_rate set default 5;
alter table public.products alter column vat_rate set not null;
alter table public.products alter column vat_category set default 'standard';
alter table public.products alter column vat_category set not null;
alter table public.products drop constraint if exists products_vat_category_check;
alter table public.products add constraint products_vat_category_check
  check (vat_category in ('standard', 'zero', 'exempt'));
alter table public.products drop constraint if exists products_vat_rate_check;
alter table public.products add constraint products_vat_rate_check
  check (vat_rate >= 0 and vat_rate <= 100);

-- Legacy GST columns: no longer written by the app
alter table public.products drop constraint if exists products_gst_rate_check;
alter table public.products alter column gst_rate drop not null;
alter table public.products alter column gst_rate set default 0;
alter table public.products alter column hsn_code set default '';

do $$ begin
  if to_regclass('public.room_types') is not null then
    alter table public.room_types add column if not exists vat_rate numeric(5,2);
    update public.room_types set vat_rate = 5 where vat_rate is null;
    alter table public.room_types alter column vat_rate set default 5;
    alter table public.room_types alter column vat_rate set not null;
    alter table public.room_types alter column gst_rate drop not null;
    alter table public.room_types alter column gst_rate set default 0;
  end if;
end $$;

-- ---------- 4) Document lines: invoice / purchase / credit note items ----------
alter table public.invoice_items
  add column if not exists vat_rate numeric(5,2),
  add column if not exists vat_amount numeric(14,2),
  add column if not exists vat_category text;

update public.invoice_items
set vat_rate = coalesce(gst_rate, 0),
    vat_amount = coalesce(cgst_amount, 0) + coalesce(sgst_amount, 0) + coalesce(igst_amount, 0),
    vat_category = case when coalesce(gst_rate, 0) = 0 then 'zero' else 'standard' end
where vat_amount is null;

alter table public.invoice_items alter column vat_rate set default 0;
alter table public.invoice_items alter column vat_rate set not null;
alter table public.invoice_items alter column vat_amount set default 0;
alter table public.invoice_items alter column vat_amount set not null;
alter table public.invoice_items alter column vat_category set default 'standard';
alter table public.invoice_items alter column vat_category set not null;
alter table public.invoice_items alter column gst_rate drop not null;
alter table public.invoice_items alter column gst_rate set default 0;
alter table public.invoice_items alter column hsn_code set default '';

alter table public.purchase_items
  add column if not exists vat_rate numeric(5,2),
  add column if not exists vat_amount numeric(14,2);

update public.purchase_items
set vat_rate = coalesce(gst_rate, 0),
    vat_amount = coalesce(cgst_amount, 0) + coalesce(sgst_amount, 0) + coalesce(igst_amount, 0)
where vat_amount is null;

alter table public.purchase_items alter column vat_rate set default 0;
alter table public.purchase_items alter column vat_rate set not null;
alter table public.purchase_items alter column vat_amount set default 0;
alter table public.purchase_items alter column vat_amount set not null;

alter table public.credit_note_items
  add column if not exists vat_rate numeric(5,2),
  add column if not exists vat_amount numeric(14,2);

update public.credit_note_items
set vat_rate = coalesce(gst_rate, 0),
    vat_amount = coalesce(cgst_amount, 0) + coalesce(sgst_amount, 0) + coalesce(igst_amount, 0)
where vat_amount is null;

alter table public.credit_note_items alter column vat_rate set default 0;
alter table public.credit_note_items alter column vat_rate set not null;
alter table public.credit_note_items alter column vat_amount set default 0;
alter table public.credit_note_items alter column vat_amount set not null;

-- ---------- 5) Document headers: total VAT + currency ----------
alter table public.invoices
  add column if not exists total_vat numeric(14,2),
  add column if not exists currency text,
  add column if not exists prices_include_vat boolean not null default false;

update public.invoices
set total_vat = coalesce(total_cgst, 0) + coalesce(total_sgst, 0) + coalesce(total_igst, 0)
where total_vat is null;
-- Everything issued before VAT was billed in rupees
update public.invoices set currency = 'INR' where currency is null;

alter table public.invoices alter column total_vat set default 0;
alter table public.invoices alter column total_vat set not null;
alter table public.invoices alter column currency set default 'AED';
alter table public.invoices alter column currency set not null;

alter table public.purchases
  add column if not exists total_vat numeric(14,2),
  add column if not exists currency text;

update public.purchases
set total_vat = coalesce(total_cgst, 0) + coalesce(total_sgst, 0) + coalesce(total_igst, 0)
where total_vat is null;
update public.purchases set currency = 'INR' where currency is null;

alter table public.purchases alter column total_vat set default 0;
alter table public.purchases alter column total_vat set not null;
alter table public.purchases alter column currency set default 'AED';
alter table public.purchases alter column currency set not null;

alter table public.credit_notes
  add column if not exists total_vat numeric(14,2),
  add column if not exists currency text;

update public.credit_notes
set total_vat = coalesce(total_cgst, 0) + coalesce(total_sgst, 0) + coalesce(total_igst, 0)
where total_vat is null;
update public.credit_notes set currency = 'INR' where currency is null;

alter table public.credit_notes alter column total_vat set default 0;
alter table public.credit_notes alter column total_vat set not null;
alter table public.credit_notes alter column currency set default 'AED';
alter table public.credit_notes alter column currency set not null;

-- ---------- 6) Jewellery live metal rates: tag currency (old rows were INR) ----------
do $$ begin
  if to_regclass('public.live_metal_rates') is not null then
    alter table public.live_metal_rates add column if not exists currency text;
    update public.live_metal_rates set currency = 'INR' where currency is null;
    alter table public.live_metal_rates alter column currency set default 'AED';
    alter table public.live_metal_rates alter column currency set not null;
    comment on column public.live_metal_rates.rate_per_gram_inr is
      'Rate per gram in the row currency (column name predates the AED switch).';
  end if;
end $$;

-- ---------- 7) Invoice RPCs: write VAT, stamp currency from the org ----------
create or replace function public.create_invoice_atomic(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_prefix text := coalesce(nullif(payload->>'prefix', ''), 'KY');
  v_currency text;
  v_customer_id uuid;
  v_invoice_date date;
  v_notes text;
  v_warehouse_id uuid;
  v_invoice_number text;
  v_invoice_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_booking_id uuid;
  v_qty integer;
  v_stock integer;
  v_product_name text;
  v_is_service boolean;
  v_invoice public.invoices%rowtype;
  v_rate_locked numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_org is null then
    raise exception 'No organization for current user';
  end if;

  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Invoice must have at least one line item';
  end if;

  select coalesce(o.currency, 'AED') into v_currency
  from public.organizations o where o.id = v_org;

  v_customer_id := (payload->>'customer_id')::uuid;
  v_invoice_date := coalesce((payload->>'invoice_date')::date, current_date);
  v_notes := nullif(payload->>'notes', '');
  v_warehouse_id := nullif(payload->>'warehouse_id', '')::uuid;

  if v_warehouse_id is null then
    select id into v_warehouse_id
    from public.warehouses
    where is_default = true and is_active = true and organization_id = v_org
    limit 1;
  else
    if not exists (
      select 1 from public.warehouses
      where id = v_warehouse_id and organization_id = v_org
    ) then
      raise exception 'Warehouse not found';
    end if;
  end if;

  if not exists (
    select 1 from public.customers
    where id = v_customer_id and organization_id = v_org
  ) then
    raise exception 'Customer not found';
  end if;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_booking_id := nullif(v_item->>'room_booking_id', '')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity on invoice line';
    end if;

    if v_booking_id is not null then
      if not exists (
        select 1 from public.room_bookings
        where id = v_booking_id and organization_id = v_org
      ) then
        raise exception 'Room booking not found: %', v_booking_id;
      end if;
      continue;
    end if;

    if v_product_id is null then
      raise exception 'Invoice line needs a product or room booking';
    end if;

    select p.name, coalesce(p.is_service, false)
      into v_product_name, v_is_service
    from public.products p
    where p.id = v_product_id and p.organization_id = v_org;
    if v_product_name is null then
      raise exception 'Product not found: %', v_product_id;
    end if;

    if not v_is_service then
      if v_warehouse_id is not null then
        select coalesce(sum(sm.quantity), 0)::integer into v_stock
        from public.stock_movements sm
        where sm.product_id = v_product_id
          and sm.warehouse_id = v_warehouse_id
          and sm.organization_id = v_org;
      else
        select coalesce(sum(sm.quantity), 0)::integer into v_stock
        from public.stock_movements sm
        where sm.product_id = v_product_id and sm.organization_id = v_org;
      end if;

      if v_stock < v_qty then
        raise exception 'Insufficient stock for % (have %, need %)',
          v_product_name, v_stock, v_qty;
      end if;
    end if;
  end loop;

  v_invoice_number := public.next_invoice_number(v_prefix);

  insert into public.invoices (
    invoice_number, customer_id, invoice_date,
    subtotal, total_vat, round_off, grand_total,
    currency, prices_include_vat,
    status, notes, created_by, warehouse_id, organization_id
  ) values (
    v_invoice_number, v_customer_id, v_invoice_date,
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'total_vat')::numeric, 0),
    coalesce((payload->>'round_off')::numeric, 0),
    coalesce((payload->>'grand_total')::numeric, 0),
    v_currency,
    coalesce((payload->>'prices_include_vat')::boolean, false),
    'issued', v_notes,
    coalesce(nullif(payload->>'created_by', '')::uuid, v_user_id),
    v_warehouse_id,
    v_org
  )
  returning * into v_invoice;

  v_invoice_id := v_invoice.id;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_booking_id := nullif(v_item->>'room_booking_id', '')::uuid;
    v_rate_locked := coalesce(
      nullif(v_item->>'rate_locked_at_sale', '')::numeric,
      nullif(v_item->>'metal_rate_used', '')::numeric
    );

    insert into public.invoice_items (
      invoice_id, product_id, hsn_code, quantity, unit_price, price_overridden,
      taxable_value, vat_rate, vat_amount, vat_category, gst_rate, line_total,
      organization_id, imei_serial, batch_number, variant_tag,
      metal_rate_used, gross_weight, net_weight, making_charge_amount, stone_value,
      jewellery_purity, jewellery_huid,
      check_in_date, check_out_date, guest_id_proof, room_booking_id,
      rate_locked_at_sale, rate_source
    ) values (
      v_invoice_id,
      v_product_id,
      coalesce(v_item->>'hsn_code', ''),
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'price_overridden')::boolean, false),
      (v_item->>'taxable_value')::numeric,
      coalesce((v_item->>'vat_rate')::numeric, 0),
      coalesce((v_item->>'vat_amount')::numeric, 0),
      coalesce(nullif(v_item->>'vat_category', ''), 'standard'),
      coalesce((v_item->>'vat_rate')::numeric, 0),
      (v_item->>'line_total')::numeric,
      v_org,
      nullif(trim(coalesce(v_item->>'imei_serial', '')), ''),
      nullif(trim(coalesce(v_item->>'batch_number', '')), ''),
      nullif(trim(coalesce(v_item->>'variant_tag', '')), ''),
      v_rate_locked,
      nullif(v_item->>'gross_weight', '')::numeric,
      nullif(v_item->>'net_weight', '')::numeric,
      nullif(v_item->>'making_charge_amount', '')::numeric,
      nullif(v_item->>'stone_value', '')::numeric,
      nullif(trim(coalesce(v_item->>'jewellery_purity', '')), ''),
      nullif(trim(coalesce(v_item->>'jewellery_huid', '')), ''),
      nullif(v_item->>'check_in_date', '')::date,
      nullif(v_item->>'check_out_date', '')::date,
      nullif(trim(coalesce(v_item->>'guest_id_proof', '')), ''),
      v_booking_id,
      v_rate_locked,
      nullif(trim(coalesce(v_item->>'rate_source', '')), '')
    );

    if v_booking_id is not null then
      update public.room_bookings
      set invoice_id = v_invoice_id
      where id = v_booking_id and organization_id = v_org;
      continue;
    end if;

    select coalesce(p.is_service, false) into v_is_service
    from public.products p
    where p.id = v_product_id and p.organization_id = v_org;

    if not coalesce(v_is_service, false) then
      insert into public.stock_movements (
        product_id, movement_type, quantity, reference, reason, created_by,
        warehouse_id, organization_id
      ) values (
        v_product_id,
        'out',
        -abs((v_item->>'quantity')::integer),
        v_invoice_number,
        'Invoice ' || v_invoice_number,
        coalesce(nullif(payload->>'created_by', '')::uuid, v_user_id),
        v_warehouse_id,
        v_org
      );
    end if;
  end loop;

  return to_jsonb(v_invoice);
end;
$$;

create or replace function public.update_invoice_atomic(
  p_invoice_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_invoice public.invoices%rowtype;
  v_customer_id uuid;
  v_invoice_date date;
  v_notes text;
  v_warehouse_id uuid;
  v_force boolean := coalesce((payload->>'force')::boolean, false);
  v_item jsonb;
  v_product_id uuid;
  v_booking_id uuid;
  v_qty integer;
  v_stock integer;
  v_product_name text;
  v_is_service boolean;
  v_rate_locked numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_org is null then
    raise exception 'No organization for current user';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and organization_id = v_org
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.status = 'cancelled' and not v_force then
    raise exception 'Cannot edit a cancelled invoice';
  end if;

  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Invoice must have at least one line item';
  end if;

  v_customer_id := (payload->>'customer_id')::uuid;
  v_invoice_date := coalesce((payload->>'invoice_date')::date, v_invoice.invoice_date);
  v_notes := nullif(payload->>'notes', '');
  v_warehouse_id := coalesce(
    nullif(payload->>'warehouse_id', '')::uuid,
    v_invoice.warehouse_id
  );

  if v_warehouse_id is not null and not exists (
    select 1 from public.warehouses
    where id = v_warehouse_id and organization_id = v_org
  ) then
    raise exception 'Warehouse not found';
  end if;

  if not exists (
    select 1 from public.customers
    where id = v_customer_id and organization_id = v_org
  ) then
    raise exception 'Customer not found';
  end if;

  delete from public.stock_movements
  where reference = v_invoice.invoice_number
    and organization_id = v_org
    and movement_type = 'out';

  update public.room_bookings
  set invoice_id = null
  where invoice_id = p_invoice_id and organization_id = v_org;

  delete from public.invoice_items where invoice_id = p_invoice_id;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_booking_id := nullif(v_item->>'room_booking_id', '')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity on invoice line';
    end if;

    if v_booking_id is not null then
      if not exists (
        select 1 from public.room_bookings
        where id = v_booking_id and organization_id = v_org
      ) then
        raise exception 'Room booking not found: %', v_booking_id;
      end if;
      continue;
    end if;

    if v_product_id is null then
      raise exception 'Invoice line needs a product or room booking';
    end if;

    select p.name, coalesce(p.is_service, false)
      into v_product_name, v_is_service
    from public.products p
    where p.id = v_product_id and p.organization_id = v_org;
    if v_product_name is null then
      raise exception 'Product not found: %', v_product_id;
    end if;

    if not v_is_service then
      if v_warehouse_id is not null then
        select coalesce(sum(sm.quantity), 0)::integer into v_stock
        from public.stock_movements sm
        where sm.product_id = v_product_id
          and sm.warehouse_id = v_warehouse_id
          and sm.organization_id = v_org;
      else
        select coalesce(sum(sm.quantity), 0)::integer into v_stock
        from public.stock_movements sm
        where sm.product_id = v_product_id and sm.organization_id = v_org;
      end if;

      if v_stock < v_qty then
        raise exception 'Insufficient stock for % (have %, need %)',
          v_product_name, v_stock, v_qty;
      end if;
    end if;
  end loop;

  -- Currency stays as stamped when the invoice was issued (old INR invoices stay INR).
  update public.invoices set
    customer_id = v_customer_id,
    invoice_date = v_invoice_date,
    notes = v_notes,
    warehouse_id = v_warehouse_id,
    subtotal = coalesce((payload->>'subtotal')::numeric, 0),
    total_vat = coalesce((payload->>'total_vat')::numeric, 0),
    total_cgst = 0,
    total_sgst = 0,
    total_igst = 0,
    prices_include_vat = coalesce((payload->>'prices_include_vat')::boolean, false),
    round_off = coalesce((payload->>'round_off')::numeric, 0),
    grand_total = coalesce((payload->>'grand_total')::numeric, 0),
    edited_at = now(),
    edited_by = coalesce(nullif(payload->>'edited_by', '')::uuid, v_user_id)
  where id = p_invoice_id and organization_id = v_org
  returning * into v_invoice;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_booking_id := nullif(v_item->>'room_booking_id', '')::uuid;
    v_rate_locked := coalesce(
      nullif(v_item->>'rate_locked_at_sale', '')::numeric,
      nullif(v_item->>'metal_rate_used', '')::numeric
    );

    insert into public.invoice_items (
      invoice_id, product_id, hsn_code, quantity, unit_price, price_overridden,
      taxable_value, vat_rate, vat_amount, vat_category, gst_rate, line_total,
      organization_id, imei_serial, batch_number, variant_tag,
      metal_rate_used, gross_weight, net_weight, making_charge_amount, stone_value,
      jewellery_purity, jewellery_huid,
      check_in_date, check_out_date, guest_id_proof, room_booking_id,
      rate_locked_at_sale, rate_source
    ) values (
      p_invoice_id,
      v_product_id,
      coalesce(v_item->>'hsn_code', ''),
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'price_overridden')::boolean, false),
      (v_item->>'taxable_value')::numeric,
      coalesce((v_item->>'vat_rate')::numeric, 0),
      coalesce((v_item->>'vat_amount')::numeric, 0),
      coalesce(nullif(v_item->>'vat_category', ''), 'standard'),
      coalesce((v_item->>'vat_rate')::numeric, 0),
      (v_item->>'line_total')::numeric,
      v_org,
      nullif(trim(coalesce(v_item->>'imei_serial', '')), ''),
      nullif(trim(coalesce(v_item->>'batch_number', '')), ''),
      nullif(trim(coalesce(v_item->>'variant_tag', '')), ''),
      v_rate_locked,
      nullif(v_item->>'gross_weight', '')::numeric,
      nullif(v_item->>'net_weight', '')::numeric,
      nullif(v_item->>'making_charge_amount', '')::numeric,
      nullif(v_item->>'stone_value', '')::numeric,
      nullif(trim(coalesce(v_item->>'jewellery_purity', '')), ''),
      nullif(trim(coalesce(v_item->>'jewellery_huid', '')), ''),
      nullif(v_item->>'check_in_date', '')::date,
      nullif(v_item->>'check_out_date', '')::date,
      nullif(trim(coalesce(v_item->>'guest_id_proof', '')), ''),
      v_booking_id,
      v_rate_locked,
      nullif(trim(coalesce(v_item->>'rate_source', '')), '')
    );

    if v_booking_id is not null then
      update public.room_bookings
      set invoice_id = p_invoice_id
      where id = v_booking_id and organization_id = v_org;
      continue;
    end if;

    select coalesce(p.is_service, false) into v_is_service
    from public.products p
    where p.id = v_product_id and p.organization_id = v_org;

    if not coalesce(v_is_service, false) then
      insert into public.stock_movements (
        product_id, movement_type, quantity, reference, reason, created_by,
        warehouse_id, organization_id
      ) values (
        v_product_id,
        'out',
        -abs((v_item->>'quantity')::integer),
        v_invoice.invoice_number,
        'Invoice ' || v_invoice.invoice_number,
        coalesce(nullif(payload->>'edited_by', '')::uuid, v_user_id),
        v_warehouse_id,
        v_org
      );
    end if;
  end loop;

  return to_jsonb(v_invoice);
end;
$$;

grant execute on function public.create_invoice_atomic(jsonb) to authenticated;
grant execute on function public.update_invoice_atomic(uuid, jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
