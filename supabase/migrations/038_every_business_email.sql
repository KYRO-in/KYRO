-- ============================================================
-- PASTE into Supabase SQL Editor (once), AFTER 037_vat_gcc.sql
-- Kayyro: every kind of business + email invoices
--
--   1) More business types (fresh produce, restaurants, hardware,
--      furniture & appliances, auto parts, wholesale, salons, perfumes)
--   2) Units of measure (kg, L, m, box...) on products and invoice lines
--   3) Decimal quantities (sell 1.25 kg) on stock, invoices, purchases,
--      credit notes. Existing whole-number rows convert losslessly.
--   4) Product categories with subcategories (per organization)
--   5) Email: invoice email log, last-emailed stamp, sender templates
--   6) Monthly sales goal for the dashboard
--   7) Invoice RPCs: numeric quantities + unit snapshot per line
-- Additive and data-safe. Safe to re-run.
-- ============================================================

-- ---------- 1) Business types ----------
alter table public.organizations drop constraint if exists organizations_business_type_check;
alter table public.organizations
  add constraint organizations_business_type_check
  check (business_type in (
    'grocery', 'fresh_produce', 'restaurant', 'mobile_shop', 'pharmacy',
    'cloth_shop', 'perfumes_cosmetics', 'hardware', 'furniture_appliances',
    'auto_parts', 'wholesale', 'salon_spa', 'service_freelancer',
    'jewellery', 'hotel', 'general'
  ));

-- ---------- 2) Units + subcategory ----------
alter table public.products
  add column if not exists unit text not null default 'pcs',
  add column if not exists subcategory text;

comment on column public.products.unit is
  'Unit of measure the price is per (pcs, kg, g, l, ml, m, sqm, box, carton, hour...).';
comment on column public.products.subcategory is
  'Optional subcategory inside products.category (free text, matches product_categories).';

alter table public.invoice_items add column if not exists unit text;
comment on column public.invoice_items.unit is 'Unit snapshot printed on the invoice line.';

-- ---------- 3) Decimal quantities ----------
-- Views depend on stock_movements.quantity, so they are rebuilt around the type change.
drop view if exists public.product_stock;
drop view if exists public.product_stock_by_warehouse;

alter table public.stock_movements
  alter column quantity type numeric(14, 3) using quantity::numeric(14, 3);
alter table public.invoice_items
  alter column quantity type numeric(14, 3) using quantity::numeric(14, 3);
alter table public.purchase_items
  alter column quantity type numeric(14, 3) using quantity::numeric(14, 3);
alter table public.credit_note_items
  alter column quantity type numeric(14, 3) using quantity::numeric(14, 3);

create view public.product_stock
with (security_invoker = true) as
select
  p.id as product_id,
  coalesce(sum(sm.quantity), 0)::numeric(14, 3) as current_stock
from public.products p
left join public.stock_movements sm on sm.product_id = p.id
group by p.id;

create view public.product_stock_by_warehouse
with (security_invoker = true) as
select
  product_id,
  warehouse_id,
  coalesce(sum(quantity), 0)::numeric(14, 3) as current_stock
from public.stock_movements
group by product_id, warehouse_id;

grant select on public.product_stock to authenticated;
grant select on public.product_stock_by_warehouse to authenticated;

alter table public.products
  alter column reorder_threshold type numeric(14, 3) using reorder_threshold::numeric(14, 3);

-- ---------- 4) Category tree ----------
create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  parent_id uuid references public.product_categories (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists product_categories_unique_name
  on public.product_categories (
    organization_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );
create index if not exists product_categories_org_idx
  on public.product_categories (organization_id, parent_id);

alter table public.product_categories enable row level security;

drop policy if exists "product_categories_select" on public.product_categories;
drop policy if exists "product_categories_insert" on public.product_categories;
drop policy if exists "product_categories_update" on public.product_categories;
drop policy if exists "product_categories_delete" on public.product_categories;

create policy "product_categories_select" on public.product_categories
  for select to authenticated
  using (organization_id = public.current_org_id());
create policy "product_categories_insert" on public.product_categories
  for insert to authenticated
  with check (organization_id = public.current_org_id());
create policy "product_categories_update" on public.product_categories
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "product_categories_delete" on public.product_categories
  for delete to authenticated
  using (organization_id = public.current_org_id());

-- ---------- 5) Email ----------
alter table public.invoices
  add column if not exists last_emailed_at timestamptz,
  add column if not exists email_count integer not null default 0;

alter table public.organizations
  add column if not exists email_subject_template text,
  add column if not exists email_body_template text,
  add column if not exists email_bcc_self boolean not null default false,
  add column if not exists monthly_sales_goal numeric(14, 2);

comment on column public.organizations.monthly_sales_goal is
  'Dashboard sales target for the current month (organization currency).';

create table if not exists public.invoice_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  kind text not null default 'invoice' check (kind in ('invoice', 'reminder')),
  to_email text not null,
  cc text,
  subject text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  provider text,
  provider_message_id text,
  error text,
  sent_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invoice_emails_org_idx on public.invoice_emails (organization_id, created_at desc);
create index if not exists invoice_emails_invoice_idx on public.invoice_emails (invoice_id);

alter table public.invoice_emails enable row level security;

drop policy if exists "invoice_emails_select" on public.invoice_emails;
drop policy if exists "invoice_emails_insert" on public.invoice_emails;

create policy "invoice_emails_select" on public.invoice_emails
  for select to authenticated
  using (organization_id = public.current_org_id());
create policy "invoice_emails_insert" on public.invoice_emails
  for insert to authenticated
  with check (organization_id = public.current_org_id());

-- ---------- 6) Invoice RPCs: numeric quantities + unit snapshot ----------
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
  v_qty numeric;
  v_stock numeric;
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
    v_qty := (v_item->>'quantity')::numeric;

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
        select coalesce(sum(sm.quantity), 0) into v_stock
        from public.stock_movements sm
        where sm.product_id = v_product_id
          and sm.warehouse_id = v_warehouse_id
          and sm.organization_id = v_org;
      else
        select coalesce(sum(sm.quantity), 0) into v_stock
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
      rate_locked_at_sale, rate_source, unit
    ) values (
      v_invoice_id,
      v_product_id,
      coalesce(v_item->>'hsn_code', ''),
      (v_item->>'quantity')::numeric,
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
      nullif(trim(coalesce(v_item->>'rate_source', '')), ''),
      coalesce(
        nullif(trim(coalesce(v_item->>'unit', '')), ''),
        (select p.unit from public.products p where p.id = v_product_id)
      )
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
        -abs((v_item->>'quantity')::numeric),
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
  v_qty numeric;
  v_stock numeric;
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
    v_qty := (v_item->>'quantity')::numeric;

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
        select coalesce(sum(sm.quantity), 0) into v_stock
        from public.stock_movements sm
        where sm.product_id = v_product_id
          and sm.warehouse_id = v_warehouse_id
          and sm.organization_id = v_org;
      else
        select coalesce(sum(sm.quantity), 0) into v_stock
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
      rate_locked_at_sale, rate_source, unit
    ) values (
      p_invoice_id,
      v_product_id,
      coalesce(v_item->>'hsn_code', ''),
      (v_item->>'quantity')::numeric,
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
      nullif(trim(coalesce(v_item->>'rate_source', '')), ''),
      coalesce(
        nullif(trim(coalesce(v_item->>'unit', '')), ''),
        (select p.unit from public.products p where p.id = v_product_id)
      )
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
        -abs((v_item->>'quantity')::numeric),
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
