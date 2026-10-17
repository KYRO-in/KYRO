/**
 * Database test suite. Applies every migration to an in-memory Postgres
 * (PGlite) with Supabase-like roles and grants, then checks tenant isolation,
 * access control, billing protection, numbering, plan limits, the accountant
 * role and recurring invoices.
 *
 * Run: npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const db = new PGlite({ extensions: { pgcrypto, btree_gist } });

// ---------- Supabase stand-ins ----------
await db.exec(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
create schema if not exists extensions;
create schema if not exists auth;
grant usage on schema public, auth, extensions to anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
grant all on auth.users to supabase_auth_admin;
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$ select current_user::text $f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
grant execute on all functions in schema auth to anon, authenticated, service_role, supabase_auth_admin;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid,
  metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql as $f$ select string_to_array(name, '/') $f$;
`);

// ---------- migrations, in the order production received them ----------
// 002 seeds rows for real auth users and cannot run on an empty database.
const SKIP = new Set(["002_fix_users_rls.sql"]);
const numbered = fs.readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !SKIP.has(f)).sort();
const order = [];
for (const f of numbered) {
  order.push(f);
  if (f.startsWith("016_")) order.push("PASTE_017_018_019.sql");
}
let pending = [...order];
const lastError = {};
for (let pass = 1; pass <= 6 && pending.length; pass++) {
  const next = [];
  for (const f of pending) {
    try {
      await db.exec(fs.readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, ""));
    } catch (e) {
      lastError[f] = e.message.split("\n")[0];
      next.push(f);
    }
  }
  if (next.length === pending.length) break;
  pending = next;
}

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};
check(pending.length === 0, `all ${order.length} migrations apply${pending.length ? ` (failed: ${pending.map((f) => `${f}: ${lastError[f]}`).join("; ")})` : ""}`);

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
async function as(role, userId, fn) {
  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const attempt = async (fn) => {
  try {
    const r = await fn();
    return { ok: true, rows: r?.rows ?? [] };
  } catch (e) {
    return { ok: false, msg: e.message.split("\n")[0] };
  }
};
const asUser = (id, sql, params) => as("authenticated", id, () => attempt(() => db.query(sql, params)));

// ---------- schema inventory ----------
const noRls = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
check(noRls.length === 0, `every public table has row level security (${noRls.map((r) => r.relname).join(",") || "ok"})`);
const definerNoPath = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`);
check(definerNoPath.length === 0, `security definer functions pin search_path (${definerNoPath.map((r) => r.proname).join(",") || "ok"})`);
const anonDefiner = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
check(anonDefiner.length === 0, `signed-out users cannot run security definer functions (${anonDefiner.map((r) => r.proname).join(",") || "ok"})`);
const anonPolicies = await q(`select tablename, policyname from pg_policies where 'public' = any(roles) or 'anon' = any(roles)`);
check(anonPolicies.length === 0, `no policy grants anything to signed-out users (${anonPolicies.map((p) => p.policyname).join(",") || "ok"})`);

// ---------- fixtures ----------
const ids = {
  adminA: "00000000-0000-4000-8000-0000000000a1",
  staffA: "00000000-0000-4000-8000-0000000000a2",
  acctA: "00000000-0000-4000-8000-0000000000a3",
  adminB: "00000000-0000-4000-8000-0000000000b1",
};
const orgA = await one(`insert into public.organizations (name, slug, brand_name, state, business_type) values ('Org A','org-a','Org A','Dubai','grocery') returning id, invoice_prefix, numbering_period`);
const orgB = await one(`insert into public.organizations (name, slug, brand_name, state, business_type, invoice_prefix) values ('Org B','org-b','Org B','Dubai','grocery','OB') returning id`);
for (const [id, email] of [[ids.adminA, "a@a.test"], [ids.staffA, "s@a.test"], [ids.acctA, "c@a.test"], [ids.adminB, "b@b.test"]]) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
}
await db.query(
  `insert into public.users (id, full_name, role, organization_id) values
   ($1,'Admin A','admin',$2), ($3,'Staff A','staff',$2), ($4,'Accountant A','accountant',$2), ($5,'Admin B','admin',$6)`,
  [ids.adminA, orgA.id, ids.staffA, ids.acctA, ids.adminB, orgB.id]
);
check(orgA.invoice_prefix === "KY" && orgA.numbering_period === "calendar", `new business: prefix KY, calendar-year numbering (${orgA.invoice_prefix}, ${orgA.numbering_period})`);
const custB = await one(`insert into public.customers (name, state, customer_type, organization_id) values ('Secret B','Dubai','b2c',$1) returning id`, [orgB.id]);
const custA = await one(`insert into public.customers (name, state, customer_type, organization_id) values ('Walk-in','Dubai','b2c',$1) returning id`, [orgA.id]);
const whA = await one(`insert into public.warehouses (name, code, is_default, is_active, organization_id) values ('Main','MAIN-A',true,true,$1) returning id`, [orgA.id]);
const prodA = await one(
  `insert into public.products (name, category, sku, pack_size, base_price, vat_rate, vat_category, unit, organization_id) values ('Tomatoes','Veg','TOM','Loose',4,5,'standard','kg',$1) returning id`,
  [orgA.id]
);
await db.query(`insert into public.stock_movements (product_id, movement_type, quantity, reference, reason, created_by, warehouse_id, organization_id) values ($1,'in',1000,'Opening','Opening',$2,$3,$4)`, [prodA.id, ids.adminA, whA.id, orgA.id]);

const invoicePayload = (qty, date = "2026-10-07") => JSON.stringify({
  prefix: "KY", customer_id: custA.id, invoice_date: date, warehouse_id: whA.id,
  subtotal: qty * 4, total_vat: +(qty * 0.2).toFixed(2), round_off: 0, grand_total: +(qty * 4.2).toFixed(2),
  items: [{ product_id: prodA.id, quantity: qty, unit: "kg", unit_price: 4, price_overridden: false,
    taxable_value: qty * 4, vat_rate: 5, vat_amount: +(qty * 0.2).toFixed(2), vat_category: "standard", line_total: +(qty * 4.2).toFixed(2) }],
});
const createInvoice = (user, qty = 1, date) => asUser(user, `select public.create_invoice_atomic($1::jsonb) as r`, [invoicePayload(qty, date)]);
const year = new Date().getFullYear();

// ---------- tenant isolation ----------
let r = await asUser(ids.adminA, `select id from public.customers where id=$1`, [custB.id]);
check(r.ok && r.rows.length === 0, "a business cannot read another business's customers");
r = await asUser(ids.adminA, `update public.customers set name='x' where id=$1 returning id`, [custB.id]);
check(r.ok && r.rows.length === 0, "a business cannot edit another business's customers");
r = await asUser(ids.adminA, `insert into public.customers (name, state, customer_type, organization_id) values ('x','Dubai','b2c',$1)`, [orgB.id]);
check(!r.ok, "a business cannot add rows to another business");
r = await as("anon", null, () => attempt(() => db.query(`select id from public.customers`)));
check(!r.ok || r.rows.length === 0, "signed-out users read no customers");

// ---------- access control ----------
r = await asUser(ids.staffA, `update public.users set role='admin' where id=$1 returning id`, [ids.staffA]);
check(!r.ok || r.rows.length === 0, "staff cannot make themselves admin");
r = await asUser(ids.staffA, `update public.users set has_seen_onboarding=true where id=$1 returning id`, [ids.staffA]);
check(r.ok && r.rows.length === 1, "staff can still finish the onboarding tour");
r = await asUser(ids.adminA, `update public.users set organization_id=$1 where id=$2`, [orgB.id, ids.staffA]);
check(!r.ok, "nobody can move a user into another business");
r = await asUser(ids.adminA, `update public.organizations set plan='business', subscription_status='active' where id=$1`, [orgA.id]);
check(!r.ok && /Billing details/.test(r.msg), "an admin cannot give themselves a paid plan");
r = await asUser(ids.adminA, `update public.organizations set brand_name='A Trading', invoice_language='en_ar', name_ar='أ للتجارة' where id=$1 returning id`, [orgA.id]);
check(r.ok && r.rows.length === 1, `an admin can save invoice options (${r.msg ?? "ok"})`);
r = await asUser(ids.adminA, `update public.organizations set payment_link_url='javascript:alert(1)' where id=$1`, [orgA.id]);
check(!r.ok, "payment links must be https");
r = await asUser(ids.adminA, `update public.organizations set payment_link_url='https://buy.stripe.com/test_123' where id=$1 returning id`, [orgA.id]);
check(r.ok && r.rows.length === 1, "an https payment link is accepted");
r = await as("service_role", null, () => attempt(() => db.query(`select * from public.rate_limit_hit('k', 1, 60)`)));
check(r.ok, "the server can use the shared rate limiter");
r = await asUser(ids.adminA, `select * from public.rate_limit_hit('k', 1, 60)`);
check(!r.ok, "signed-in users cannot touch the rate limiter");

// ---------- numbering ----------
r = await createInvoice(ids.staffA, 2);
check(r.ok && r.rows[0].r.invoice_number === `KY/${year}/0001`, `calendar-year invoice number (${r.ok ? r.rows[0].r.invoice_number : r.msg})`);
const firstInvoiceId = r.ok ? r.rows[0].r.id : null;
await db.query(`update public.organizations set numbering_period='april' where id=$1`, [orgA.id]);
r = await createInvoice(ids.staffA, 1);
const aprilLabel = (() => {
  const d = new Date();
  const s = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${s}-${String(s + 1).slice(-2)}`;
})();
check(r.ok && r.rows[0].r.invoice_number === `KY/${aprilLabel}/0001`, `April-March number starts its own series (${r.ok ? r.rows[0].r.invoice_number : r.msg})`);
await db.query(`update public.organizations set numbering_period='calendar' where id=$1`, [orgA.id]);
r = await createInvoice(ids.staffA, 1);
check(r.ok && r.rows[0].r.invoice_number === `KY/${year}/0002`, `switching back continues the calendar series (${r.ok ? r.rows[0].r.invoice_number : r.msg})`);
r = await asUser(ids.adminA, `select public.next_purchase_number('PO') as n`);
check(r.ok && r.rows[0].n === `PO/${year}/0001`, `purchase numbers follow the setting (${r.ok ? r.rows[0].n : r.msg})`);

// ---------- accountant (read-only) ----------
r = await asUser(ids.acctA, `select count(*)::int as n from public.invoices`);
check(r.ok && r.rows[0].n === 3, "the accountant can see every invoice");
r = await createInvoice(ids.acctA, 1);
check(!r.ok && /read-only/.test(r.msg), `the accountant cannot create invoices, even through the invoice function (${r.msg ?? "ALLOWED"})`);
r = await asUser(ids.acctA, `update public.invoices set status='paid' where id=$1 returning id`, [firstInvoiceId]);
check(!r.ok, "the accountant cannot mark invoices paid");
r = await asUser(ids.acctA, `insert into public.customers (name, state, customer_type, organization_id) values ('x','Dubai','b2c',$1)`, [orgA.id]);
check(!r.ok, "the accountant cannot add customers");
r = await asUser(ids.acctA, `delete from public.products where id=$1`, [prodA.id]);
check(!r.ok || r.rows.length === 0, "the accountant cannot delete products");
r = await asUser(ids.acctA, `update public.users set has_seen_onboarding=true where id=$1 returning id`, [ids.acctA]);
check(r.ok && r.rows.length === 1, "the accountant can still finish the onboarding tour");
r = await asUser(ids.acctA, `update public.users set role='admin' where id=$1 returning id`, [ids.acctA]);
check(!r.ok || r.rows.length === 0, "the accountant cannot promote themselves");

// ---------- plan limits ----------
// Trial: 50 invoices a month. Use a past month so the counts above don't interfere.
let lastOk = true;
for (let i = 0; i < 50 && lastOk; i++) {
  lastOk = (await createInvoice(ids.staffA, 1, "2026-01-15")).ok;
}
check(lastOk, "the trial plan allows 50 invoices in a month");
r = await createInvoice(ids.staffA, 1, "2026-01-20");
check(!r.ok && /limit of 50 invoices/.test(r.msg), `the 51st invoice in that month is blocked (${r.msg ?? "ALLOWED"})`);
r = await createInvoice(ids.staffA, 1, "2026-02-03");
check(r.ok, "the next month starts fresh");
await db.query(`update public.organizations set trial_ends_at = now() - interval '1 day' where id=$1`, [orgA.id]);
r = await createInvoice(ids.staffA, 1);
check(!r.ok && /trial has ended/.test(r.msg), "an expired trial cannot create invoices");
r = await asUser(ids.staffA, `insert into public.products (name, category, sku, pack_size, base_price, vat_rate, organization_id) values ('P','C','P2','Unit',1,5,$1)`, [orgA.id]);
check(!r.ok && /trial has ended/.test(r.msg), "an expired trial cannot add products");
r = await asUser(ids.staffA, `update public.customers set name='Walk-in customer' where id=$1 returning id`, [custA.id]);
check(r.ok && r.rows.length === 1, "an expired trial can still edit and read existing records");
await db.query(`update public.organizations set plan='business', subscription_status='active', trial_ends_at=null where id=$1`, [orgA.id]);
r = await createInvoice(ids.staffA, 1, "2026-01-25");
check(r.ok, "the Business plan has no invoice limit");

// ---------- recurring invoices ----------
r = await asUser(ids.adminA, `insert into public.recurring_invoices (organization_id, customer_id, frequency, next_run_date, items)
  values ($1, $2, 'monthly', current_date, $3::jsonb) returning id`, [orgA.id, custA.id, JSON.stringify([{ product_id: prodA.id, quantity: 2, unit_price: 4 }])]);
check(r.ok && r.rows.length === 1, `an admin can set up a recurring invoice (${r.msg ?? "ok"})`);
const recId = r.ok ? r.rows[0].id : null;
r = await asUser(ids.adminB, `select id from public.recurring_invoices where id=$1`, [recId]);
check(r.ok && r.rows.length === 0, "another business cannot see it");
r = await asUser(ids.acctA, `update public.recurring_invoices set active=false where id=$1`, [recId]);
check(!r.ok, "the accountant cannot change it");
r = await asUser(ids.adminA, `insert into public.recurring_invoices (organization_id, customer_id, frequency, next_run_date, items) values ($1,$2,'daily',current_date,'[]')`, [orgA.id, custA.id]);
check(!r.ok, "only weekly, monthly, quarterly or yearly schedules are accepted");

// ---------- stock with decimal quantities still works ----------
const stock = await one(`select current_stock from public.product_stock where product_id=$1`, [prodA.id]);
check(Number(stock.current_stock) > 0, `stock view still works (${stock.current_stock})`);

// ---------- every country's tax (042) ----------
const narrow = await q(`select table_name || '.' || column_name as c from information_schema.columns
  where table_schema='public' and data_type='numeric' and numeric_scale=2
    and column_name ~ '(price|total|amount|subtotal|value|cost|paid|charge|balance)$'`);
check(narrow.length === 0, `money columns hold 3 decimals for dinars and rials (${narrow.map((x) => x.c).join(",") || "ok"})`);
const rateCol = await one(`select numeric_scale from information_schema.columns where table_schema='public' and table_name='products' and column_name='vat_rate'`);
check(Number(rateCol.numeric_scale) === 2, "tax rates keep their 2-decimal column");
await db.query(`update public.organizations set country='BH', currency='BHD' where id=$1`, [orgA.id]);
const bhdPayload = JSON.parse(invoicePayload(1, "2026-03-03"));
Object.assign(bhdPayload, { subtotal: 1.234, total_vat: 0.123, grand_total: 1.357 });
Object.assign(bhdPayload.items[0], { unit_price: 1.234, taxable_value: 1.234, vat_rate: 10, vat_amount: 0.123, line_total: 1.357 });
r = await asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [JSON.stringify(bhdPayload)]);
const bhdId = r.ok ? r.rows[0].r.id : null;
const bhd = bhdId ? await one(`select grand_total, currency from public.invoices where id=$1`, [bhdId]) : null;
check(!!bhd && Number(bhd.grand_total) === 1.357 && bhd.currency === "BHD", `a Bahrain invoice keeps 3 decimals (${bhd ? `${bhd.grand_total} ${bhd.currency}` : r.msg})`);
r = await asUser(ids.staffA, `update public.invoices set tax_country='BH', tax_treatment='export', tax_split='single', place_of_supply='Saudi Arabia' where id=$1 returning id`, [bhdId]);
check(r.ok && r.rows.length === 1, `staff can stamp the tax rules on a new invoice (${r.msg ?? "ok"})`);
r = await asUser(ids.staffA, `update public.invoices set tax_treatment='made_up' where id=$1`, [bhdId]);
check(!r.ok, "only local sale, reverse charge and export are accepted");
r = await asUser(ids.staffA, `select public.record_payment($1::jsonb) as p`, [JSON.stringify({ customer_id: custA.id, invoice_id: bhdId, amount: 1.357 })]);
const paid = bhdId ? await one(`select status, amount_paid from public.invoices where id=$1`, [bhdId]) : null;
check(r.ok && paid?.status === "paid" && Number(paid.amount_paid) === 1.357, `paying 1.357 BHD marks the invoice paid (${paid ? `${paid.status} ${paid.amount_paid}` : r.msg})`);
r = await asUser(ids.staffA, `select public.kayyro_schema_version() as v`);
check(r.ok && r.rows[0].v >= 42, "the app can tell migration 042 ran");
r = await asUser(ids.adminB, `select id from public.invoices where id=$1`, [bhdId]);
check(r.ok && r.rows.length === 0, "another business still cannot see the invoice");
await db.query(`update public.organizations set country='AE', currency='AED' where id=$1`, [orgA.id]);

// ---------- staff attendance and Ask Kayyro (043) ----------
r = await asUser(ids.staffA, `insert into public.employees (organization_id, full_name) values ($1, 'Ravi') returning id`, [orgA.id]);
check(!r.ok, "staff cannot add employees");
r = await asUser(ids.acctA, `insert into public.employees (organization_id, full_name) values ($1, 'Ravi') returning id`, [orgA.id]);
check(!r.ok, "accountants cannot add employees");
r = await asUser(ids.adminA, `insert into public.employees (organization_id, full_name, job_title) values ($1, 'Ravi', 'Cashier') returning id, checkin_token`, [orgA.id]);
const emp = r.ok ? r.rows[0] : null;
check(!!emp && emp.checkin_token.length === 64, `an admin can add an employee with a private check-in link (${r.msg ?? "ok"})`);
r = await asUser(ids.adminB, `select id from public.employees where id=$1`, [emp?.id]);
check(r.ok && r.rows.length === 0, "another business cannot see the employee");
r = await asUser(ids.adminB, `insert into public.employees (organization_id, full_name) values ($1, 'Spy') returning id`, [orgA.id]);
check(!r.ok, "an admin cannot add employees to another business");
await db.query(`insert into public.employee_secrets (employee_id, organization_id, pin_hash) values ($1, $2, 'scrypt$x$y')`, [emp.id, orgA.id]);
r = await asUser(ids.adminA, `select pin_hash from public.employee_secrets`);
check(!r.ok || r.rows.length === 0, "no signed-in user can read PIN hashes");
r = await asUser(ids.adminA, `insert into public.attendance (organization_id, employee_id, kind, source) values ($1, $2, 'in', 'kiosk')`, [orgA.id, emp.id]);
check(!r.ok, "signed-in users cannot fake a photo punch");
r = await asUser(ids.adminA, `insert into public.attendance (organization_id, employee_id, kind, source, note) values ($1, $2, 'in', 'manual', 'Forgot to check in') returning id`, [orgA.id, emp.id]);
check(r.ok, `an admin can add a manual correction (${r.msg ?? "ok"})`);
r = await asUser(ids.staffA, `insert into public.attendance (organization_id, employee_id, kind, source) values ($1, $2, 'in', 'manual')`, [orgA.id, emp.id]);
check(!r.ok, "staff cannot add manual corrections");
r = await asUser(ids.staffA, `select public.attendance_punch($1, 'kiosk', null, now() - interval '1 hour') as p`, [emp.id]);
check(!r.ok, "only the server can record a punch");
await db.query(`delete from public.attendance where employee_id=$1`, [emp.id]);
const p1 = await one(`select (public.attendance_punch($1, 'kiosk', 'x/punches/1.jpg', now() - interval '1 hour')).kind as k`, [emp.id]);
const p2 = await one(`select (public.attendance_punch($1, 'phone', 'x/punches/2.jpg', now() - interval '1 hour', 25.2, 55.3, 12)).kind as k`, [emp.id]);
check(p1.k === "in" && p2.k === "out", `punches alternate in and out (${p1.k}, ${p2.k})`);
r = await asUser(ids.staffA, `select count(*)::int as n from public.attendance where employee_id=$1`, [emp.id]);
check(r.ok && r.rows[0].n === 2, "staff of the same business can see attendance");
r = await asUser(ids.adminB, `select count(*)::int as n from public.attendance where employee_id=$1`, [emp.id]);
check(r.ok && r.rows[0].n === 0, "another business cannot see attendance");
await db.query(`update public.organizations set plan='free', subscription_status='trialing', trial_ends_at=now() + interval '7 days' where id=$1`, [orgA.id]);
for (let i = 0; i < 4; i++) await asUser(ids.adminA, `insert into public.employees (organization_id, full_name) values ($1, $2)`, [orgA.id, `Staff ${i}`]);
r = await asUser(ids.adminA, `insert into public.employees (organization_id, full_name) values ($1, 'Sixth') returning id`, [orgA.id]);
check(!r.ok && /employees/.test(r.msg), `the trial stops at 5 active employees (${r.msg ?? "allowed"})`);
const ai1 = await one(`select * from public.ai_usage_take($1)`, [orgA.id]);
check(ai1.allowed && ai1.used === 1 && ai1.max_questions === 30, `Ask Kayyro counts questions against the plan (${ai1.used}/${ai1.max_questions})`);
await db.query(`update public.ai_usage set questions = 30 where organization_id=$1`, [orgA.id]);
const ai2 = await one(`select * from public.ai_usage_take($1)`, [orgA.id]);
check(!ai2.allowed, "Ask Kayyro stops at the monthly allowance");
await db.query(`update public.organizations set country='IN', currency='INR' where id=$1`, [orgA.id]);
await db.query(`update public.ai_usage set questions = 19 where organization_id=$1`, [orgA.id]);
const ai3 = await one(`select * from public.ai_usage_take($1)`, [orgA.id]);
const ai4 = await one(`select * from public.ai_usage_take($1)`, [orgA.id]);
check(ai3.allowed && ai3.max_questions === 20 && !ai4.allowed, `India's trial allowance is 20 questions (${ai3.max_questions})`);
await db.query(`update public.organizations set country='AE', currency='AED' where id=$1`, [orgA.id]);
r = await asUser(ids.adminA, `select * from public.ai_usage_take($1)`, [orgA.id]);
check(!r.ok, "only the server can count AI questions");
await db.query(`update public.organizations set plan='business', subscription_status='active', trial_ends_at=null where id=$1`, [orgA.id]);
r = await asUser(ids.adminB, `select * from public.ai_usage where organization_id=$1`, [orgA.id]);
check(r.ok && r.rows.length === 0, "another business cannot see AI usage");

// ---------- two-step verification (044) ----------
await db.exec(`
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create or replace function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
`);
const seeInvoices = (aal) =>
  as("authenticated", ids.staffA, async () => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ aal })]);
    try {
      return (await db.query(`select count(*)::int as n from public.invoices`)).rows[0].n;
    } finally {
      await db.query(`select set_config('request.jwt.claims', '', false)`);
    }
  });
const before = await seeInvoices("aal1");
check(before > 0, `without 2FA, a password sign-in sees the business's invoices (${before})`);
await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')`, [ids.staffA]);
check((await seeInvoices("aal1")) === before, "a half-finished 2FA setup changes nothing");
await db.query(`update auth.mfa_factors set status = 'verified' where user_id = $1`, [ids.staffA]);
check((await seeInvoices("aal1")) === 0, "with 2FA on, a password alone sees no business data");
check((await seeInvoices("aal2")) === before, "after the authenticator code, the data is back");
r = await as("authenticated", ids.staffA, () => attempt(() => db.query(`select full_name from public.users where id=$1`, [ids.staffA])));
check(r.ok && r.rows.length === 1, "the app can still load the profile to ask for the code");
await db.query(`delete from auth.mfa_factors where user_id = $1`, [ids.staffA]);

// ---------- old prefix fallback is replaced (045) ----------
{
  const def = (await one(`select pg_get_functiondef('public.create_invoice_atomic(jsonb)'::regprocedure) as d`)).d;
  // Simulate a database created before the rename, then run 045 on it
  await db.exec(def.replace("'KY')", "'NF')"));
  await db.exec(fs.readFileSync(path.join(DIR, "045_kayyro_prefix_cleanup.sql"), "utf8"));
  const after = (await one(`select pg_get_functiondef('public.create_invoice_atomic(jsonb)'::regprocedure) as d`)).d;
  check(!after.includes("'NF'") && after.includes("'KY'"), "045 switches the invoice prefix fallback to KY");
  r = await asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [invoicePayload(1, "2026-03-04")]);
  check(r.ok, `invoices still save after 045 (${r.msg ?? "ok"})`);
}

// ---------- the rename (046) ----------
{
  await db.query(`create or replace function public.kyro_schema_version() returns integer language sql as 'select 1'`);
  await db.query(`update public.organizations set brand_name='KYRO' where id=$1`, [orgA.id]);
  await db.exec(fs.readFileSync(path.join(DIR, "046_kayyro_rename.sql"), "utf8"));
  const gone = await one(`select count(*)::int as n from pg_proc where proname='kyro_schema_version'`);
  check(gone.n === 0, "046 removes the old schema-version function");
  const v = await one(`select public.kayyro_schema_version() as v`);
  check(v.v >= 46, "046 sets the new schema version");
  const b = await one(`select brand_name from public.organizations where id=$1`, [orgA.id]);
  check(b.brand_name === "Kayyro", "046 moves the old brand name to Kayyro");
}

// ---------- re-running the latest migrations is safe ----------
for (const f of numbered.slice(-3)) {
  try {
    await db.exec(fs.readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, ""));
    check(true, `${f} is safe to run twice`);
  } catch (e) {
    check(false, `${f} re-run: ${e.message.split("\n")[0]}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall database checks passed");
process.exit(failures ? 1 : 0);
