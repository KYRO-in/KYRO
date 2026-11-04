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

// ---------- Stripe billing (047) ----------
{
  await db.exec(fs.readFileSync(path.join(DIR, "047_stripe_billing.sql"), "utf8"));
  const v = await one(`select public.kayyro_schema_version() as v`);
  check(v.v >= 47, "047 sets schema version 47");
  const cols = await one(`select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='organizations' and column_name in ('stripe_customer_id','stripe_subscription_id')`);
  check(cols.n === 2, "047 adds the two Stripe columns to organizations");

  r = await asUser(ids.adminA, `update public.organizations set stripe_subscription_id='sub_fake' where id=$1`, [orgA.id]);
  check(!r.ok && /Billing details/.test(r.msg), "an admin cannot set a Stripe subscription on their own business");
  r = await asUser(ids.adminA, `update public.organizations set stripe_customer_id='cus_fake' where id=$1`, [orgA.id]);
  check(!r.ok && /Billing details/.test(r.msg), "an admin cannot set a Stripe customer on their own business");
  r = await asUser(ids.adminA, `update public.organizations set plan='starter' where id=$1`, [orgA.id]);
  check(!r.ok && /Billing details/.test(r.msg), "the plan is still locked after 047");
  r = await asUser(ids.adminA, `update public.organizations set brand_name='A Trading 2' where id=$1 returning id`, [orgA.id]);
  check(r.ok && r.rows.length === 1, "an admin can still edit ordinary business settings");

  // The server (webhook) can write them
  await db.query(`update public.organizations set stripe_customer_id='cus_1', stripe_subscription_id='sub_1', plan='pro', subscription_status='active' where id=$1`, [orgA.id]);
  const o = await one(`select stripe_subscription_id, plan from public.organizations where id=$1`, [orgA.id]);
  check(o.stripe_subscription_id === 'sub_1' && o.plan === 'pro', "the server can store a Stripe subscription");

  // Billing log: a Stripe event id is stored once; Razorpay rows (no event id) are unaffected
  await db.query(`insert into public.billing_events (organization_id, event_type, provider, stripe_subscription_id, provider_event_id) values ($1,'customer.subscription.updated','stripe','sub_1','evt_1')`, [orgA.id]);
  let dup = true;
  try {
    await db.query(`insert into public.billing_events (organization_id, event_type, provider, stripe_subscription_id, provider_event_id) values ($1,'customer.subscription.updated','stripe','sub_1','evt_1')`, [orgA.id]);
    dup = false;
  } catch {}
  check(dup, "a retried Stripe event id is logged only once");
  await db.query(`insert into public.billing_events (organization_id, event_type, razorpay_subscription_id) values ($1,'subscription.activated','sub_rzp')`, [orgA.id]);
  await db.query(`insert into public.billing_events (organization_id, event_type, razorpay_subscription_id) values ($1,'subscription.charged','sub_rzp')`, [orgA.id]);
  const rz = await one(`select count(*)::int as n from public.billing_events where provider='razorpay' and organization_id=$1`, [orgA.id]);
  check(rz.n >= 2, "Razorpay events still log as before");
  let bad = true;
  try {
    await db.query(`insert into public.billing_events (organization_id, event_type, provider) values ($1,'x','paypal')`, [orgA.id]);
    bad = false;
  } catch {}
  check(bad, "only razorpay or stripe are accepted as a provider");

  // leave the business as the later tests expect it
  await db.query(`update public.organizations set stripe_customer_id=null, stripe_subscription_id=null, plan='business', subscription_status='active' where id=$1`, [orgA.id]);
}

// ---------- financial records are protected (048) ----------
{
  await db.exec(fs.readFileSync(path.join(DIR, "048_protect_financial_records.sql"), "utf8"));
  const v = await one(`select public.kayyro_schema_version() as v`);
  check(v.v >= 48, "048 sets schema version 48");

  // Totals: the database checks what the browser sends
  const bad = (over, itemOver = {}) => {
    const p = JSON.parse(invoicePayload(1, "2026-10-21"));
    Object.assign(p, over);
    Object.assign(p.items[0], itemOver);
    return JSON.stringify(p);
  };
  const create = (payload) => asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [payload]);
  r = await create(bad({ grand_total: 1 }));
  check(!r.ok && /does not add up|do not match/.test(r.msg), `a grand total that does not add up is refused (${r.msg ?? "accepted"})`);
  r = await create(bad({ total_vat: 0, grand_total: 4 }, { vat_amount: 0, line_total: 4 }));
  check(!r.ok && /tax does not match/.test(r.msg), `zero VAT on a 5% line is refused (${r.msg ?? "accepted"})`);
  r = await create(bad({ subtotal: -100, total_vat: -5, grand_total: -105 }, { unit_price: -100, taxable_value: -100, vat_amount: -5, line_total: -105 }));
  check(!r.ok && /negative/.test(r.msg), `a negative price is refused (${r.msg ?? "accepted"})`);
  r = await create(bad({ subtotal: 2, total_vat: 0.1, grand_total: 2.1 }, { taxable_value: 2, vat_amount: 0.1, line_total: 2.1 }));
  check(!r.ok && /quantity x price/.test(r.msg), `a line worth less than quantity x price is refused (${r.msg ?? "accepted"})`);
  r = await create(bad({ round_off: 5, grand_total: 9.2 }));
  check(!r.ok && /round-off/.test(r.msg), `a large round-off is refused (${r.msg ?? "accepted"})`);
  // Prices that include VAT, and India's equal CGST/SGST halves, still pass
  r = await create(bad({ prices_include_vat: true, subtotal: 3.81, total_vat: 0.19, grand_total: 4 }, { taxable_value: 3.81, vat_amount: 0.19, line_total: 4 }));
  check(r.ok, `a VAT-inclusive invoice saves (${r.msg ?? "ok"})`);
  r = await create(bad({ subtotal: 4, total_vat: 0.72, grand_total: 4.72 }, { vat_rate: 18, vat_amount: 0.72, line_total: 4.72 }));
  check(r.ok, `an 18% GST invoice saves (${r.msg ?? "ok"})`);
  r = await create(invoicePayload(2, "2026-10-21"));
  check(r.ok, `a normal invoice still saves (${r.msg ?? "ok"})`);
  const goodId = r.ok ? r.rows[0].r.id : null;

  // Staff can no longer change an issued invoice behind the app
  r = await asUser(ids.staffA, `update public.invoices set grand_total = 1 where id=$1`, [goodId]);
  check(!r.ok && /only be changed through Kayyro/.test(r.msg), "staff cannot change an issued invoice total");
  r = await asUser(ids.adminA, `update public.invoices set customer_id = $2 where id=$1`, [goodId, custA.id]);
  check(r.ok, "setting a field to the value it already has is harmless");
  r = await asUser(ids.staffA, `update public.invoices set status = 'paid' where id=$1`, [goodId]);
  check(!r.ok && /Record a payment/.test(r.msg), "an unpaid invoice cannot be marked paid without a payment");
  r = await asUser(ids.staffA, `update public.invoices set amount_paid = 8.4 where id=$1`, [goodId]);
  check(!r.ok, "the paid amount cannot be set directly");
  r = await asUser(ids.adminA, `delete from public.invoices where id=$1`, [goodId]);
  check(!r.ok && /cannot be deleted/.test(r.msg), "even an admin cannot delete an issued invoice");
  r = await asUser(ids.staffA, `insert into public.invoice_items (invoice_id, product_id, quantity, unit_price, taxable_value, vat_rate, vat_amount, line_total, organization_id) values ($1,$2,1,0,0,0,0,0,$3)`, [goodId, prodA.id, orgA.id]);
  check(!r.ok, "nobody can add a line to an issued invoice directly");
  r = await asUser(ids.adminA, `update public.invoice_items set unit_price = 0 where invoice_id=$1`, [goodId]);
  check(!r.ok, "nobody can change an invoice line directly");
  r = await asUser(ids.staffA, `insert into public.invoices (invoice_number, customer_id, invoice_date, subtotal, grand_total, organization_id) values ('X/1',$1,'2026-10-21',0,0,$2)`, [custA.id, orgA.id]);
  check(!r.ok, "invoices cannot be inserted directly");

  // Payments: only through Record payment
  r = await asUser(ids.staffA, `insert into public.payments (organization_id, customer_id, invoice_id, amount, payment_mode) values ($1,$2,$3,8.4,'cash')`, [orgA.id, custA.id, goodId]);
  check(!r.ok && /Record payment/.test(r.msg), "a payment cannot be inserted directly");
  r = await asUser(ids.staffA, `select public.record_payment($1::jsonb) as p`, [JSON.stringify({ customer_id: custA.id, invoice_id: goodId, amount: 8.4 })]);
  const afterPay = await one(`select status, amount_paid from public.invoices where id=$1`, [goodId]);
  check(r.ok && afterPay.status === "paid", `Record payment still marks the invoice paid (${r.msg ?? afterPay.status})`);
  r = await asUser(ids.adminA, `update public.payments set amount = 1 where invoice_id=$1`, [goodId]);
  check(!r.ok, "a recorded payment cannot be changed");
  r = await asUser(ids.adminA, `delete from public.payments where invoice_id=$1`, [goodId]);
  check(!r.ok, "a recorded payment cannot be deleted");

  // What staff can still do on an invoice
  r = await create(invoicePayload(1, "2026-10-22"));
  const cancelId = r.ok ? r.rows[0].r.id : null;
  r = await asUser(ids.staffA, `update public.invoices set short_code='ABCDEFGH' where id=$1 and short_code is null returning id`, [cancelId]);
  check(r.ok && r.rows.length === 1, "the short link code can be set once");
  r = await asUser(ids.staffA, `update public.invoices set short_code='HIJKLMNP' where id=$1`, [cancelId]);
  check(!r.ok, "the short link code cannot be changed afterwards");
  r = await asUser(ids.staffA, `update public.invoices set status='cancelled', cancelled_reason='wrong customer' where id=$1 returning id`, [cancelId]);
  check(r.ok && r.rows.length === 1, `staff can still cancel an invoice (${r.msg ?? "ok"})`);
  r = await asUser(ids.adminA, `update public.invoices set status='issued', cancelled_reason=null where id=$1`, [cancelId]);
  check(!r.ok && /cannot be reopened/.test(r.msg), "a cancelled invoice cannot be reopened");

  // Editing an invoice through Kayyro's edit function still works, and is checked
  const edit = (qty, over = {}) => {
    const p = JSON.parse(invoicePayload(qty, "2026-10-21"));
    Object.assign(p, over);
    return JSON.stringify(p);
  };
  r = await create(invoicePayload(1, "2026-10-23"));
  const editId = r.ok ? r.rows[0].r.id : null;
  r = await asUser(ids.adminA, `select public.update_invoice_atomic($1, $2::jsonb) as r`, [editId, edit(3)]);
  const edited = await one(`select grand_total from public.invoices where id=$1`, [editId]);
  check(r.ok && Number(edited.grand_total) === 12.6, `editing an invoice through Kayyro still works (${r.msg ?? edited.grand_total})`);
  r = await asUser(ids.adminA, `select public.update_invoice_atomic($1, $2::jsonb) as r`, [editId, edit(3, { grand_total: 2 })]);
  check(!r.ok && /does not add up|do not match/.test(r.msg), `an edit with wrong totals is refused (${r.msg ?? "accepted"})`);

  // Stock history
  r = await asUser(ids.staffA, `insert into public.stock_movements (product_id, movement_type, quantity, reference, reason, created_by, warehouse_id, organization_id) values ($1,'in',5,'GRN-1','Delivery',$2,$3,$4) returning id`, [prodA.id, ids.staffA, whA.id, orgA.id]);
  check(r.ok, `staff can still record stock in (${r.msg ?? "ok"})`);
  const myMove = r.ok ? r.rows[0].id : null;
  r = await asUser(ids.staffA, `update public.stock_movements set quantity=6, reason='Delivery (recount)' where id=$1 returning edited_by`, [myMove]);
  check(r.ok && r.rows[0]?.edited_by === ids.staffA, `staff can correct their own manual entry, and it is stamped (${r.msg ?? "ok"})`);
  r = await asUser(ids.staffA, `update public.stock_movements set quantity=-6 where id=$1`, [myMove]);
  check(!r.ok, "stock in cannot be turned negative");
  r = await asUser(ids.staffA, `insert into public.stock_movements (product_id, movement_type, quantity, reason, created_by, warehouse_id, organization_id) values ($1,'in',5,'x',$2,$3,$4)`, [prodA.id, ids.adminA, whA.id, orgA.id]);
  check(!r.ok, "staff cannot record stock under someone else's name");
  const saleMove = await one(`select id from public.stock_movements where organization_id=$1 and reason like 'Invoice %' limit 1`, [orgA.id]);
  r = await asUser(ids.adminA, `update public.stock_movements set quantity=-0.5 where id=$1`, [saleMove.id]);
  check(!r.ok && /belongs to an invoice/.test(r.msg), "a sale's stock entry cannot be edited, even by an admin");
  r = await asUser(ids.staffA, `update public.stock_movements set quantity=quantity where id=$1`, [saleMove.id]);
  check(!r.ok, "staff cannot edit someone else's stock entry");
  r = await asUser(ids.adminA, `delete from public.stock_movements where id=$1 returning id`, [myMove]);
  check(!r.ok || r.rows.length === 0, "stock history cannot be deleted");
  const stillThere = await one(`select count(*)::int as n from public.stock_movements where id=$1`, [myMove]);
  check(stillThere.n === 1, "the stock entry is still there");

  // Purchases and credit notes
  const sup = await one(`insert into public.suppliers (name, organization_id) values ('Supplier A', $1) returning id`, [orgA.id]);
  r = await asUser(ids.staffA, `insert into public.purchases (purchase_number, supplier_id, warehouse_id, purchase_date, subtotal, total_vat, round_off, grand_total, status, created_by, organization_id) values ('PO-1',$1,$2,'2026-10-21',10,0.5,0,10.5,'received',$3,$4) returning id`, [sup.id, whA.id, ids.staffA, orgA.id]);
  check(r.ok, `staff can still save a purchase (${r.msg ?? "ok"})`);
  const poId = r.ok ? r.rows[0].id : null;
  r = await asUser(ids.staffA, `insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, taxable_value, vat_rate, vat_amount, line_total, organization_id) values ($1,$2,5,2,10,5,0.5,10.5,$3)`, [poId, prodA.id, orgA.id]);
  check(r.ok, `and its lines (${r.msg ?? "ok"})`);
  r = await asUser(ids.staffA, `insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, taxable_value, vat_rate, vat_amount, line_total, organization_id) values ($1,$2,5,2,10,5,9,19,$3)`, [poId, prodA.id, orgA.id]);
  check(!r.ok && /tax does not match/.test(r.msg), "a purchase line claiming too much input VAT is refused");
  r = await asUser(ids.adminA, `insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, taxable_value, vat_rate, vat_amount, line_total, organization_id) values ($1,$2,1,2,2,5,0.1,2.1,$3)`, [poId, prodA.id, orgA.id]);
  check(!r.ok, "someone else cannot add lines to a saved purchase");
  r = await asUser(ids.staffA, `update public.purchases set total_vat=5, grand_total=15 where id=$1`, [poId]);
  check(!r.ok, "a saved purchase cannot be changed");
  r = await asUser(ids.adminA, `delete from public.purchases where id=$1`, [poId]);
  check(!r.ok, "a saved purchase cannot be deleted");
  r = await asUser(ids.staffA, `insert into public.purchases (purchase_number, supplier_id, warehouse_id, purchase_date, subtotal, total_vat, round_off, grand_total, status, created_by, organization_id) values ('PO-2',$1,$2,'2026-10-21',10,0.5,0,99,'received',$3,$4)`, [sup.id, whA.id, ids.staffA, orgA.id]);
  check(!r.ok && /does not add up/.test(r.msg), "a purchase whose total does not add up is refused");
  r = await asUser(ids.staffA, `insert into public.credit_notes (credit_note_number, invoice_id, customer_id, warehouse_id, credit_date, subtotal, total_vat, round_off, grand_total, reason, status, created_by, organization_id) values ('CN-1',$1,$2,$3,'2026-10-21',4,0.2,0,4.2,'return','issued',$4,$5) returning id`, [goodId, custA.id, whA.id, ids.staffA, orgA.id]);
  check(r.ok, `staff can still issue a credit note (${r.msg ?? "ok"})`);
  const cnId = r.ok ? r.rows[0].id : null;
  r = await asUser(ids.staffA, `insert into public.credit_note_items (credit_note_id, product_id, quantity, unit_price, taxable_value, vat_rate, vat_amount, line_total, organization_id) values ($1,$2,1,4,4,5,0.2,4.2,$3)`, [cnId, prodA.id, orgA.id]);
  check(r.ok, `and its lines (${r.msg ?? "ok"})`);
  r = await asUser(ids.staffA, `update public.credit_notes set grand_total=400 where id=$1`, [cnId]);
  check(!r.ok, "a saved credit note cannot be changed");

  // Audit log: who changed what, visible to admins only
  const log = await one(`select count(*)::int as n from public.audit_log where organization_id=$1 and table_name='stock_movements' and action='update' and changed_by=$2`, [orgA.id, ids.staffA]);
  check(log.n >= 1, "the stock correction is in the audit log with who made it");
  const cancelLog = await one(`select old_row->>'status' as before, new_row->>'status' as after from public.audit_log where row_id=$1 and table_name='invoices' and new_row->>'status'='cancelled' order by id desc limit 1`, [cancelId]);
  check(cancelLog?.before === "issued" && cancelLog?.after === "cancelled", "cancelling an invoice is logged with before and after");
  r = await asUser(ids.adminA, `select count(*)::int as n from public.audit_log`);
  check(r.ok && r.rows[0].n >= 2, "an admin can read the audit log");
  r = await asUser(ids.staffA, `select count(*)::int as n from public.audit_log`);
  check(r.ok && r.rows[0].n === 0, "staff cannot read the audit log");
  r = await asUser(ids.adminB, `select count(*)::int as n from public.audit_log`);
  check(r.ok && r.rows[0].n === 0, "another business cannot read the audit log");
  r = await asUser(ids.adminA, `delete from public.audit_log returning id`);
  check(!r.ok || r.rows.length === 0, "nobody can delete the audit log");
  r = await asUser(ids.adminA, `insert into public.audit_log (table_name, action) values ('x','y')`);
  check(!r.ok, "nobody can write fake audit entries");
}

// ---------- one invoice per GCC country (database) ----------
{
  const GCC = [
    ["AE", "AED", 5, 24.69, 1.23, 25.92],
    ["SA", "SAR", 15, 24.69, 3.7, 28.39],
    ["BH", "BHD", 10, 24.69, 2.469, 27.159],
    ["OM", "OMR", 5, 24.69, 1.235, 25.925],
    ["QA", "QAR", 0, 24.69, 0, 24.69],
    ["KW", "KWD", 0, 24.69, 0, 24.69],
  ];
  for (const [code, currency, rate, sub, vat, total] of GCC) {
    await db.query(`update public.organizations set country=$2, currency=$3 where id=$1`, [orgA.id, code, currency]);
    const p = JSON.parse(invoicePayload(1, "2026-11-03"));
    Object.assign(p, { subtotal: sub, total_vat: vat, grand_total: total });
    Object.assign(p.items[0], { quantity: 2, unit_price: 12.345, taxable_value: sub, vat_rate: rate, vat_amount: vat, line_total: total });
    r = await asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [JSON.stringify(p)]);
    const id = r.ok ? r.rows[0].r.id : null;
    const inv = id ? await one(`select currency, subtotal, total_vat, grand_total from public.invoices where id=$1`, [id]) : null;
    check(
      !!inv && inv.currency === currency && Number(inv.total_vat) === vat && Number(inv.grand_total) === total,
      `${code}: an invoice saves in ${currency} with ${rate}% VAT (${inv ? `${inv.subtotal} + ${inv.total_vat} = ${inv.grand_total} ${inv.currency}` : r.msg})`
    );
  }
  await db.query(`update public.organizations set country='AE', currency='AED' where id=$1`, [orgA.id]);
}

// ---------- Kayyro Collect (049) ----------
{
  await db.exec(fs.readFileSync(path.join(DIR, "049_kayyro_collect.sql"), "utf8"));
  const v = await one(`select public.kayyro_schema_version() as v`);
  check(v.v >= 49, "049 sets schema version 49");
  // Times are UTC; Business A is in the UAE (Asia/Dubai = UTC+4, Monday-Friday, 09:00-18:00)
  const FRI_10 = "2026-11-06T06:00:00Z"; // Friday 10:00 Dubai
  const SAT_10 = "2026-11-07T06:00:00Z"; // Saturday
  const MON_10 = "2026-11-09T06:00:00Z"; // Monday 10:00
  const MON_20 = "2026-11-09T16:00:00Z"; // Monday 20:00
  const svc = (sql, params) => attempt(() => db.query(sql, params)); // the server (scheduler)

  r = await asUser(ids.adminA, `select (public.collect_ensure_settings()).organization_id as o`);
  check(r.ok, `an admin opens Kayyro Collect settings (${r.msg ?? "ok"})`);
  const steps = await q(`select offset_days, action, step_key from public.reminder_steps where organization_id=$1 order by offset_days`, [orgA.id]);
  check(steps.map((s) => `${s.offset_days}:${s.step_key}`).join(",") === "-3:before_due,0:due_today,3:polite,7:firm,15:call,30:final", "the default schedule: -3, 0, +3, +7, +15 (call), +30");
  r = await asUser(ids.staffA, `update public.collect_settings set enabled=true where organization_id=$1 returning 1`, [orgA.id]);
  check(r.ok && r.rows.length === 0, "staff cannot switch Kayyro Collect on");
  r = await asUser(ids.adminA, `update public.collect_settings set enabled=true, approval_mode='auto' where organization_id=$1 returning enabled_at`, [orgA.id]);
  check(r.ok && r.rows[0]?.enabled_at, `an admin switches it on, automatic sending (${r.msg ?? "ok"})`);
  r = await asUser(ids.adminA, `update public.collect_settings set time_zone='Mars/Base' where organization_id=$1`, [orgA.id]);
  check(!r.ok, "an unknown time zone is refused");

  // A customer with email and WhatsApp, 10-day terms
  const cust = await one(
    `insert into public.customers (name, state, customer_type, organization_id, email, phone, payment_terms_days) values ('Gulf Traders','Dubai','b2b',$1,'pay@gulf.test','+971 50 123 4567',10) returning id, collect_token`,
    [orgA.id]
  );
  const payloadFor = (date) => {
    const p = JSON.parse(invoicePayload(1, date));
    p.customer_id = cust.id;
    return JSON.stringify(p);
  };
  r = await asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [payloadFor("2026-10-30")]);
  const invId = r.ok ? r.rows[0].r.id : null;
  const inv = await one(`select due_date::text as d from public.invoices where id=$1`, [invId]);
  check(inv?.d === "2026-11-09", `the due date follows the customer's 10-day terms (${inv?.d ?? r.msg})`);

  // Plan on Friday (3 days before due): one email and one WhatsApp message
  r = await svc(`select public.collect_plan($1, $2) as n`, [orgA.id, FRI_10]);
  check(r.ok && r.rows[0].n === 2, `3 days before due: an email and a WhatsApp reminder are planned (${r.ok ? r.rows[0].n : r.msg})`);
  r = await svc(`select public.collect_plan($1, $2) as n`, [orgA.id, FRI_10]);
  check(r.ok && r.rows[0].n === 0, "a second scheduler run plans nothing twice");
  const planned = await q(`select id, channel, status, auto_send, step_key from public.collection_messages where invoice_id=$1 order by channel`, [invId]);
  check(planned.every((m) => m.status === "pending" && m.step_key === "before_due"), "they wait for their wording (fixed templates, written by the app)");
  for (const m of planned) await db.query(`select public.collect_set_wording($1, 'Subject', 'Body', null, null)`, [m.id]);
  const email = await one(`select id, status from public.collection_messages where invoice_id=$1 and channel='email'`, [invId]);
  const wa = await one(`select id, status from public.collection_messages where invoice_id=$1 and channel='whatsapp'`, [invId]);
  check(email.status === "ready", "automatic mode: the email is ready to send");
  check(wa.status === "awaiting_approval", "WhatsApp waits for the owner (no WhatsApp sender connected, no opt-in)");

  // Claim, then send: only once
  r = await svc(`select id, claim_token from public.collect_claim($1, $2)`, [email.id, FRI_10]);
  const claim = r.ok ? r.rows[0] : null;
  check(!!claim?.claim_token, "the scheduler claims the email inside sending hours");
  r = await svc(`select id from public.collect_claim($1, $2)`, [email.id, FRI_10]);
  check(r.ok && r.rows.length === 0, "a second run can't claim the same message (no double send)");
  r = await svc(`select public.collect_finish($1, $2, true, 'resend', 're_123', null) as ok`, [email.id, claim.claim_token]);
  check(r.ok && r.rows[0].ok === true, "the send is recorded once");
  r = await svc(`select public.collect_finish($1, gen_random_uuid(), true, 'resend', 'x', null) as ok`, [email.id]);
  check(r.ok && r.rows[0].ok === false, "a wrong claim token can't overwrite it");

  // One message per invoice per channel per day
  await db.query(
    `insert into public.collection_messages (organization_id, invoice_id, customer_id, direction, channel, status, local_date, language, body)
     values ($1,$2,$3,'out','email','ready','2026-11-06','en','Second email the same day')`,
    [orgA.id, invId, cust.id]
  );
  const second = await one(`select id from public.collection_messages where invoice_id=$1 and body='Second email the same day'`, [invId]);
  r = await svc(`select id from public.collect_claim($1, $2)`, [second.id, FRI_10]);
  check(r.ok && r.rows.length === 0, "a second email to the same invoice the same day is held back");
  r = await attempt(() => db.query(`update public.collection_messages set sent_on='2026-11-06', status='sent' where id=$1`, [second.id]));
  check(!r.ok && /duplicate|unique/i.test(r.msg), "the database refuses two sent emails for one invoice on one day (unique constraint)");
  await db.query(`update public.collection_messages set status='skipped' where id=$1`, [second.id]);

  // Hours and weekends
  r = await svc(`select working_day, in_window from public.collect_clock($1, $2)`, [orgA.id, SAT_10]);
  check(r.ok && r.rows[0].working_day === false, "Saturday is the UAE weekend");
  r = await svc(`select public.collect_plan($1, $2) as n`, [orgA.id, SAT_10]);
  check(r.ok && r.rows[0].n === 0, "nothing is planned on the weekend");
  r = await svc(`select in_window from public.collect_clock($1, $2)`, [orgA.id, MON_20]);
  check(r.ok && r.rows[0].in_window === false, "20:00 is outside sending hours");
  const sa = await one(`select public.collect_country_working_days('SA')::text as d, public.collect_country_working_days('IN')::text as i, public.collect_country_working_days('GB')::text as g`);
  check(sa.d === "{7,1,2,3,4}" && sa.i === "{1,2,3,4,5,6}" && sa.g === "{1,2,3,4,5}", "weekends: Saudi Fri-Sat, India Sun, UK Sat-Sun");
  await db.query(`update public.collect_settings set working_days='{1,2,3,4,5,6,7}' where organization_id=$1`, [orgA.id]);
  r = await svc(`select working_day from public.collect_clock($1, $2)`, [orgA.id, SAT_10]);
  check(r.ok && r.rows[0].working_day === true, "a business can override its working days");
  await db.query(`update public.collect_settings set working_days=null, ramadan_enabled=true, ramadan_start='2026-11-01', ramadan_end='2026-11-30', ramadan_send_start='10:00', ramadan_send_end='15:00' where organization_id=$1`, [orgA.id]);
  r = await svc(`select window_start::text as s, window_end::text as e, in_window from public.collect_clock($1, '2026-11-09T11:30:00Z')`, [orgA.id]);
  check(r.ok && r.rows[0].s === "10:00:00" && r.rows[0].e === "15:00:00" && r.rows[0].in_window === false, "Ramadan hours (10:00-15:00): 15:30 is outside");
  await db.query(`update public.collect_settings set ramadan_enabled=false where organization_id=$1`, [orgA.id]);

  // Due day (Monday): the next step
  r = await svc(`select public.collect_plan($1, $2) as n`, [orgA.id, MON_10]);
  check(r.ok && r.rows[0].n === 2, `on the due date the "due today" reminder is planned (${r.ok ? r.rows[0].n : r.msg})`);

  // WhatsApp sent by hand from the owner's phone, once a day
  r = await asUser(ids.adminA, `select public.collect_approve($1) as s`, [wa.id]);
  check(!r.ok && /WhatsApp/.test(r.msg), "without a WhatsApp sender, approving asks the owner to send it from their WhatsApp");
  r = await asUser(ids.staffA, `select public.collect_mark_sent_by_hand($1) as s`, [wa.id]);
  check(!r.ok, "staff can't send reminders in the business's name");
  r = await asUser(ids.adminA, `select public.collect_mark_sent_by_hand($1) as s`, [wa.id]);
  check(r.ok && r.rows[0].s === "sent", `the owner sends it from their phone and it is logged (${r.msg ?? "ok"})`);

  // Stop the moment it is paid, disputed, paused, opted out or promised
  const queued = () => one(`select count(*)::int as n from public.collection_messages where invoice_id=$1 and status in ('pending','awaiting_approval','ready')`, [invId]);
  check((await queued()).n === 2, "two Monday reminders are queued");
  r = await asUser(ids.staffA, `select public.collect_open_dispute($1, 'Wrong quantity') as id`, [invId]);
  check(r.ok, `staff can record a dispute (${r.msg ?? "ok"})`);
  check((await queued()).n === 0, "a dispute cancels everything queued for that invoice");
  r = await svc(`select public.collect_block_reason($1, $2) as b`, [invId, MON_10]);
  check(r.rows[0].b === "disputed", "and blocks chasing");
  const dsp = await one(`select id from public.disputes where invoice_id=$1`, [invId]);
  r = await asUser(ids.staffA, `select public.collect_resolve_dispute($1)`, [dsp.id]);
  check(!r.ok, "only an admin resolves a dispute");
  r = await asUser(ids.adminA, `select public.collect_resolve_dispute($1)`, [dsp.id]);
  check(r.ok, "an admin resolves it");

  r = await asUser(ids.staffA, `select public.collect_add_promise($1, '2026-11-12') as id`, [invId]);
  r = await svc(`select public.collect_block_reason($1, $2) as b`, [invId, MON_10]);
  check(r.rows[0].b === "promised", "a promise to pay on Thursday pauses chasing until then");
  r = await svc(`select public.collect_block_reason($1, '2026-11-12T06:00:00Z') as b`, [invId]);
  check(r.rows[0].b === null, "on the promised day chasing resumes");
  await db.query(`update public.payment_promises set status='cancelled' where invoice_id=$1`, [invId]);

  r = await asUser(ids.staffA, `update public.customers set collect_paused=true where id=$1 returning 1`, [cust.id]);
  r = await svc(`select public.collect_block_reason($1, $2) as b`, [invId, MON_10]);
  check(r.rows[0].b === "customer_paused", "a paused (VIP) customer is never chased");
  await db.query(`update public.customers set collect_paused=false where id=$1`, [cust.id]);

  r = await asUser(ids.staffA, `update public.customers set collect_token='hijack' where id=$1`, [cust.id]);
  check(!r.ok, "nobody can change a customer's private reminder link");
  r = await svc(`select public.collect_opt_out($1) as s`, [cust.collect_token]);
  check(r.ok && r.rows[0].s === "opted_out", "the customer's opt-out link works");
  r = await asUser(ids.adminA, `update public.customers set collect_opted_out_at=null where id=$1`, [cust.id]);
  check(!r.ok && /opted out/.test(r.msg), "only the customer can opt back in");
  r = await svc(`select public.collect_block_reason($1, $2) as b`, [invId, MON_10]);
  check(r.rows[0].b === "opted_out", "an opted-out customer is never chased");
  r = await as("anon", null, () => attempt(() => db.query(`select public.collect_opt_out($1)`, [cust.collect_token])));
  check(!r.ok, "the opt-out function runs on the server only");
  await db.query(`update public.customers set collect_opted_out_at=null where id=$1`, [cust.id]);

  // Paid: chasing stops at once
  await db.query(`update public.collection_messages set status='ready', error=null where invoice_id=$1 and step_key='due_today'`, [invId]);
  r = await asUser(ids.staffA, `select public.record_payment($1::jsonb) as p`, [JSON.stringify({ customer_id: cust.id, invoice_id: invId, amount: 4.2 })]);
  check(r.ok, `the customer pays (${r.msg ?? "ok"})`);
  check((await queued()).n === 0, "paying cancels every queued reminder");
  const anyReady = await one(`select id from public.collection_messages where invoice_id=$1 and step_key='due_today' and channel='email'`, [invId]);
  await db.query(`update public.collection_messages set status='ready' where id=$1`, [anyReady.id]);
  r = await svc(`select id from public.collect_claim($1, $2)`, [anyReady.id, MON_10]);
  const after = await one(`select status, error from public.collection_messages where id=$1`, [anyReady.id]);
  check(r.rows.length === 0 && after.status === "cancelled" && after.error === "paid", "a reminder for a paid invoice is never sent, even if it was queued");

  // +15 days: a call task, once
  r = await asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [payloadFor("2026-10-15")]);
  const late = r.ok ? r.rows[0].r.id : null;
  await svc(`select public.collect_plan($1, $2)`, [orgA.id, MON_10]);
  await svc(`select public.collect_plan($1, $2)`, [orgA.id, MON_10]);
  const calls = await one(`select count(*)::int as n from public.collect_tasks where invoice_id=$1 and kind='call'`, [late]);
  check(calls.n === 1, "15 days late: one \"Call this customer\" task (not repeated)");

  // Who can see and do what
  r = await asUser(ids.adminB, `select count(*)::int as n from public.collection_messages`);
  check(r.ok && r.rows[0].n === 0, "another business sees none of these messages");
  r = await asUser(ids.staffA, `insert into public.collection_messages (organization_id, channel, status, local_date) values ($1,'email','ready','2026-11-09')`, [orgA.id]);
  check(!r.ok, "nobody can queue a message directly");
  r = await asUser(ids.adminA, `select public.collect_plan(null, now())`);
  check(!r.ok, "signed-in users can't run the scheduler");
  r = await asUser(ids.adminA, `select * from public.collect_channel_accounts`);
  check(!r.ok, "nobody can read the WhatsApp sender's key");
  r = await asUser(ids.adminA, `select public.collect_whatsapp_connected() as c`);
  check(r.ok && r.rows[0].c === false, "the app can see whether WhatsApp Business is connected (not the key)");
  r = await asUser(ids.staffA, `update public.invoices set due_date='2026-12-01' where id=$1 returning 1`, [late]);
  check(r.ok && r.rows.length === 1, "the due date of an issued invoice can be changed");
  r = await asUser(ids.staffA, `update public.invoices set due_date='2026-01-01' where id=$1`, [late]);
  check(!r.ok, "but not to before the invoice date");

  // "Remind now" works on any plan and with Collect switched off, but never for a paid invoice
  await db.query(`update public.collect_settings set enabled=false where organization_id=$1`, [orgA.id]);
  r = await asUser(ids.staffA, `select public.collect_manual_reminder($1, 'email') as id`, [late]);
  check(!r.ok, "staff can't send a reminder in the business's name");
  r = await asUser(ids.adminA, `select public.collect_manual_reminder($1, 'email') as id`, [late]);
  const manualId = r.ok ? r.rows[0].id : null;
  check(!!manualId, `an admin presses "Remind now" (${r.msg ?? "ok"})`);
  const manual = await one(`select manual, status, step_key, to_address from public.collection_messages where id=$1`, [manualId]);
  check(manual?.manual === true && manual.status === "pending" && manual.to_address === "pay@gulf.test", "it is logged as a manual email to the customer");
  r = await asUser(ids.adminA, `select public.collect_manual_reminder($1, 'email') as id`, [late]);
  check(r.ok && r.rows[0].id === manualId, "pressing it twice reuses the same draft");
  await db.query(`select public.collect_set_wording($1, 'Subject', 'Body', null, null)`, [manualId]);
  r = await asUser(ids.adminA, `select public.collect_approve($1) as s`, [manualId]);
  check(r.ok && r.rows[0].s === "ready", `approved, it is sent even with Collect off (${r.msg ?? "ok"})`);
  r = await svc(`select id, claim_token from public.collect_claim($1, $2)`, [manualId, MON_10]);
  check(r.ok && !!r.rows[0]?.claim_token, "the sender claims it inside sending hours");
  await svc(`select public.collect_finish($1, $2, true, 'resend', 're_m', null)`, [manualId, r.rows[0]?.claim_token]);
  await db.query(`update public.collection_messages set sent_on=(select local_date from public.collect_clock($1)) where id=$2`, [orgA.id, manualId]);
  r = await asUser(ids.adminA, `select public.collect_manual_reminder($1, 'email') as id`, [late]);
  check(!r.ok && /already had/.test(r.msg), "only one email reminder per invoice per day");
  r = await asUser(ids.adminA, `select public.collect_manual_reminder($1, 'whatsapp') as id`, [late]);
  const manualWa = r.ok ? r.rows[0].id : null;
  await db.query(`select public.collect_set_wording($1, null, 'Body', 'kayyro_reminder_firm', '[]'::jsonb)`, [manualWa]);
  r = await asUser(ids.adminA, `select public.collect_mark_sent_by_hand($1) as s`, [manualWa]);
  check(r.ok && r.rows[0].s === "sent", `a WhatsApp reminder sent from the owner's phone is logged (${r.msg ?? "ok"})`);
  r = await asUser(ids.adminA, `select public.collect_manual_reminder($1, 'email') as id`, [invId]);
  check(!r.ok && /already paid/.test(r.msg), "no reminder for a paid invoice");
  const used = await one(`select count(*)::int as n from public.collection_messages where organization_id=$1 and manual`, [orgA.id]);
  check(used.n === 2, "manual reminders are kept apart from the monthly allowance");

  // Plans
  const lim = await one(`select public.plan_limit('pro','collect_invoices') as p, public.plan_limit('business','collect_invoices') as b, public.plan_limit('starter','collect_invoices') as s`);
  check(lim.p === 100 && lim.b === null && lim.s === 0, "plans: Pro 100 invoices a month, Business unlimited, Starter none");
  await db.query(`update public.organizations set plan='starter', subscription_status='active' where id=$1`, [orgB.id]);
  await asUser(ids.adminB, `select public.collect_ensure_settings()`);
  r = await asUser(ids.adminB, `update public.collect_settings set enabled=true where organization_id=$1`, [orgB.id]);
  check(!r.ok && /Pro and Business/.test(r.msg), "a Starter business can't switch Kayyro Collect on");
  await db.query(`update public.collect_settings set enabled=false where organization_id=$1`, [orgA.id]);
}

// ---------- Kayyro Collect phase 2: replies and the payment page (050) ----------
{
  // The 049 block re-ran 049, which brings back its older functions
  await db.exec(fs.readFileSync(path.join(DIR, "050_collect_replies_payments.sql"), "utf8"));
  const v = await one(`select public.kayyro_schema_version() as v`);
  check(v.v >= 50, "050 sets schema version 50");
  const svc = (sql, params) => attempt(() => db.query(sql, params));
  const today = (await one(`select local_date::text as d from public.collect_clock($1)`, [orgA.id])).d;
  const plus = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  await db.query(`update public.collect_settings set enabled=true, approval_mode='approve' where organization_id=$1`, [orgA.id]);

  const cust = await one(
    `insert into public.customers (name, state, customer_type, organization_id, email, phone, payment_terms_days) values ('Desert Supplies','Dubai','b2b',$1,'ap@desert.test','+971 55 765 4321',10) returning id`,
    [orgA.id]
  );
  const newInvoice = async (date) => {
    const p = JSON.parse(invoicePayload(1, date));
    p.customer_id = cust.id;
    const r = await asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [JSON.stringify(p)]);
    return r.ok ? r.rows[0].r.id : null;
  };
  const inv1 = await newInvoice("2026-10-20");
  const tok = await one(`select collect_pay_token as t from public.invoices where id=$1`, [inv1]);
  check(/^[a-f0-9]{64}$/.test(tok?.t ?? ""), "every invoice has a private payment page link");
  let r = await asUser(ids.staffA, `update public.invoices set collect_pay_token='guess' where id=$1`, [inv1]);
  check(!r.ok, "nobody can change an invoice's payment link");

  // A WhatsApp reply, matched to the customer by phone number, stored once
  r = await svc(`select public.collect_record_inbound($1,'whatsapp','971557654321',null,'Will pay on Thursday inshallah','360dialog','wamid.1') as id`, [orgA.id]);
  const in1 = r.ok ? r.rows[0].id : null;
  const row1 = await one(`select customer_id, invoice_id, intent_status, kind from public.collection_messages where id=$1`, [in1]);
  check(row1?.customer_id === cust.id && row1.invoice_id === inv1 && row1.intent_status === "pending", `a WhatsApp reply is matched to the customer and invoice (${r.msg ?? "ok"})`);
  r = await svc(`select public.collect_record_inbound($1,'whatsapp','971557654321',null,'Will pay on Thursday inshallah','360dialog','wamid.1') as id`, [orgA.id]);
  check(r.ok && r.rows[0].id === in1, "a webhook retry doesn't store the reply twice");

  // Promise to pay: saved, chasing paused, "noted" answer queued
  r = await svc(`select public.collect_apply_intent($1,'promise_to_pay',0.92,$2,'Will pay Thursday') as a`, [in1, plus(3)]);
  check(r.ok && r.rows[0].a === "promise_to_pay", `a clear promise is acted on (${r.msg ?? r.rows[0].a})`);
  const prom = await one(`select promised_date::text as d, source from public.payment_promises where invoice_id=$1 and status='open'`, [inv1]);
  check(prom?.d === plus(3) && prom.source === "reply", "the promise date is saved from the reply");
  const ack = await one(`select status, kind, step_key, channel, to_address from public.collection_messages where reply_to_id=$1`, [in1]);
  check(ack?.kind === "reply" && ack.step_key === "promise_ack" && ack.channel === "whatsapp" && ack.status === "pending", "a \"noted for Thursday\" answer is queued on WhatsApp");
  r = await svc(`select public.collect_block_reason($1) as b`, [inv1]);
  check(r.rows[0].b === "promised", "reminders pause until the promised day");
  r = await svc(`select public.collect_apply_intent($1,'dispute',0.99,null,'x') as a`, [in1]);
  check(r.rows[0].a === "applied", "a reply is acted on only once");
  r = await svc(`select public.collect_record_inbound($1,'whatsapp','971557654321',null,'I will pay next year','360dialog','wamid.1b') as id`, [orgA.id]);
  r = await svc(`select public.collect_apply_intent($1,'promise_to_pay',0.9,$2,'next year') as a`, [r.rows[0].id, plus(200)]);
  check(r.rows[0].a === "needs_you", "a promise more than 90 days away goes to \"Needs you\"");

  // Low confidence: never acted on automatically
  r = await svc(`select public.collect_record_inbound($1,'whatsapp','+971 55 765 4321',null,'hmm ok','360dialog','wamid.2') as id`, [orgA.id]);
  const in2 = r.rows[0].id;
  r = await svc(`select public.collect_apply_intent($1,'already_paid',0.5,null,'Maybe paid') as a`, [in2]);
  const t2 = await one(`select kind, status from public.collect_tasks where message_id=$1`, [in2]);
  const noClaim = await one(`select count(*)::int as n from public.payment_claims where invoice_id=$1`, [inv1]);
  check(r.rows[0].a === "needs_you" && t2?.kind === "paid_claim" && noClaim.n === 0, "below 0.7 confidence it goes to \"Needs you\" and nothing happens by itself");

  // Already paid: chasing stops, proof is asked for, the owner decides
  r = await svc(`select public.collect_record_inbound($1,'whatsapp','971557654321',null,'We paid this yesterday by bank transfer','360dialog','wamid.3') as id`, [orgA.id]);
  const in3 = r.rows[0].id;
  r = await svc(`select public.collect_apply_intent($1,'already_paid',0.95,null,'Paid yesterday by transfer') as a`, [in3]);
  const claim = await one(`select id, status, source from public.payment_claims where invoice_id=$1`, [inv1]);
  check(r.rows[0].a === "already_paid" && claim?.status === "pending" && claim.source === "reply", "\"already paid\" opens a claim for the owner");
  r = await svc(`select public.collect_hard_block_reason($1) as b`, [inv1]);
  check(r.rows[0].b === "paid_claim", "and stops reminders until the owner confirms");
  const proof = await one(`select step_key from public.collection_messages where reply_to_id=$1`, [in3]);
  check(proof?.step_key === "ask_proof", "the customer is asked for proof of payment");

  // An answer doesn't use up the day's single reminder
  const ackId = (await one(`select id from public.collection_messages where reply_to_id=$1`, [in1])).id;
  await db.query(`update public.collection_messages set status='sent', sent_on=$2, sent_at=now() where id=$1`, [ackId, today]);
  r = await svc(
    `insert into public.collection_messages (organization_id, invoice_id, customer_id, direction, channel, status, local_date, sent_on, language, body)
     values ($1,$2,$3,'out','whatsapp','sent',$4,$4,'en','reminder')`,
    [orgA.id, inv1, cust.id, today]
  );
  check(r.ok, `a reminder and an answer can both go out on one day (${r.msg ?? "ok"})`);

  r = await asUser(ids.staffA, `select public.collect_resolve_claim($1,'rejected')`, [claim.id]);
  check(!r.ok, "only an admin confirms or rejects a payment claim");
  r = await asUser(ids.adminA, `select public.collect_resolve_claim($1,'rejected') as s`, [claim.id]);
  r = await svc(`select public.collect_hard_block_reason($1) as b`, [inv1]);
  check(r.rows[0].b === null, "a rejected claim lets chasing resume");

  // The payment page: "I already paid" with proof
  r = await svc(`select public.collect_submit_paid_claim($1,'Paid by bank transfer',$2,'application/pdf',120000) as id`, [tok.t, `${orgA.id}/${inv1}/receipt.pdf`]);
  const pageClaim = r.ok ? r.rows[0].id : null;
  check(!!pageClaim, `the customer uploads proof from the payment page (${r.msg ?? "ok"})`);
  r = await svc(`select public.collect_submit_paid_claim($1,null,$2,'application/pdf',100)`, [tok.t, `${orgB.id}/x/receipt.pdf`]);
  check(!r.ok, "a file outside the business's own folder is refused");
  r = await svc(`select public.collect_submit_paid_claim($1,null,$2,'text/html',100)`, [tok.t, `${orgA.id}/${inv1}/x.html`]);
  check(!r.ok, "only images and PDFs are accepted");
  r = await svc(`select public.collect_submit_paid_claim('nope',null,null,null,null) as id`);
  check(r.ok && r.rows[0].id === null, "an unknown payment link does nothing");
  r = await asUser(ids.adminB, `select count(*)::int as n from public.payment_claims`);
  check(r.ok && r.rows[0].n === 0, "another business can't see these claims");
  r = await as("anon", null, () => attempt(() => db.query(`select public.collect_submit_paid_claim($1,null,null,null,null)`, [tok.t])));
  check(!r.ok, "claims are submitted through the server only");

  r = await asUser(ids.adminA, `select public.collect_resolve_claim($1,'confirmed') as s`, [pageClaim]);
  const paid1 = await one(`select status from public.invoices where id=$1`, [inv1]);
  check(r.ok && paid1.status === "paid", `confirming the proof records the payment and marks the invoice paid (${r.msg ?? "ok"})`);
  const openTasks = await one(`select count(*)::int as n from public.collect_tasks where invoice_id=$1 and kind='paid_claim' and status='open'`, [inv1]);
  check(openTasks.n === 0, "the \"says it's paid\" tasks are closed");

  // A payment gateway: recorded once, invoice paid automatically
  const inv2 = await newInvoice("2026-10-22");
  const total2 = await one(`select grand_total::text as g, currency from public.invoices where id=$1`, [inv2]);
  r = await svc(`select public.collect_record_gateway_payment('tap','chg_001',$1,$2,'usd')`, [inv2, total2.g]);
  check(!r.ok && /Currency/.test(r.msg), "a payment in the wrong currency is refused");
  r = await svc(`select public.collect_record_gateway_payment('tap','chg_001',$1,$2,$3) as s`, [inv2, total2.g, total2.currency || "AED"]);
  check(r.ok && r.rows[0].s === "recorded", `a gateway payment is recorded (${r.msg ?? "ok"})`);
  r = await svc(`select public.collect_record_gateway_payment('tap','chg_001',$1,$2,$3) as s`, [inv2, total2.g, total2.currency || "AED"]);
  check(r.ok && r.rows[0].s === "duplicate", "the same gateway notification twice records one payment");
  const p2 = await one(`select count(*)::int as n, (select status from public.invoices where id=$1) as st from public.payments where invoice_id=$1`, [inv2]);
  check(p2.n === 1 && p2.st === "paid", "the invoice is marked paid automatically");
  r = await asUser(ids.adminA, `select public.collect_record_gateway_payment('tap','chg_x',$1,1,'AED')`, [inv2]);
  check(!r.ok, "signed-in users can't record gateway payments");

  // Dispute and invoice copy from a reply
  const inv3 = await newInvoice("2026-10-25");
  r = await svc(`select public.collect_record_inbound($1,'email','AP@desert.test','Re: invoice','Can you send the invoice again please?','resend','em_1') as id`, [orgA.id]);
  const in4 = r.rows[0].id;
  const row4 = await one(`select customer_id, invoice_id from public.collection_messages where id=$1`, [in4]);
  check(row4.customer_id === cust.id && row4.invoice_id === inv3, "an email reply is matched by address (any capitals)");
  await svc(`select public.collect_apply_intent($1,'request_invoice_copy',0.9,null,'Wants a copy')`, [in4]);
  const copy = await one(`select step_key, channel, to_address from public.collection_messages where reply_to_id=$1`, [in4]);
  check(copy?.step_key === "invoice_copy" && copy.channel === "email" && copy.to_address === "AP@desert.test", "an invoice copy is queued by email");
  r = await svc(`select public.collect_record_inbound($1,'email','ap@desert.test','Re: invoice','The quantity on this invoice is wrong, we only got 8 boxes','resend','em_2') as id`, [orgA.id]);
  await svc(`select public.collect_apply_intent($1,'dispute',0.88,null,'Says only 8 boxes arrived')`, [r.rows[0].id]);
  const d3 = await one(`select reason, source from public.disputes where invoice_id=$1 and status='open'`, [inv3]);
  r = await svc(`select public.collect_block_reason($1) as b`, [inv3]);
  check(d3?.source === "reply" && d3.reason === "Says only 8 boxes arrived" && r.rows[0].b === "disputed", "a dispute in a reply stops chasing and goes to \"Needs you\"");

  // Unknown sender, and replies the owner pastes in
  r = await svc(`select public.collect_record_inbound($1,'whatsapp','+44 7700 900123',null,'Who is this?','360dialog','wamid.9') as id`, [orgA.id]);
  await svc(`select public.collect_apply_intent($1,'other',0.9,null,'Asks who this is')`, [r.rows[0].id]);
  const unk = await one(`select kind, invoice_id from public.collect_tasks where message_id=$1`, [r.rows[0].id]);
  check(unk?.kind === "other" && unk.invoice_id === null, "a message from an unknown number goes to \"Needs you\"");
  r = await asUser(ids.staffA, `select public.collect_log_reply($1,'whatsapp','Paying Sunday') as id`, [inv3]);
  check(r.ok && !!r.rows[0].id, `staff can log a reply that came to their phone (${r.msg ?? "ok"})`);
  r = await asUser(ids.acctA, `select public.collect_log_reply($1,'whatsapp','Paying Sunday') as id`, [inv3]);
  check(!r.ok, "an accountant can't");
  r = await asUser(ids.adminB, `select public.collect_log_reply($1,'whatsapp','x') as id`, [inv3]);
  check(!r.ok, "another business can't log replies on this invoice");
  r = await asUser(ids.adminA, `select public.collect_apply_intent($1,'other',1,null,'x')`, [in4]);
  check(!r.ok, "only the server applies the AI's reading");

  // The promised day, a broken promise, and out-of-date reminders
  const inv4 = await newInvoice("2026-10-20");
  r = await asUser(ids.staffA, `select public.collect_add_promise($1,'2026-11-09')`, [inv4]);
  check(r.ok, `a promise for Monday 9 November (${r.msg ?? "ok"})`);
  await svc(`select public.collect_plan($1,'2026-11-09T06:00:00Z')`, [orgA.id]);
  const pd = await q(`select channel from public.collection_messages where invoice_id=$1 and step_key='promise_day'`, [inv4]);
  check(pd.length === 2, `on the promised day one reminder per channel goes out that morning (${pd.length})`);
  await svc(`select public.collect_plan($1,'2026-11-09T07:00:00Z')`, [orgA.id]);
  const pd2 = await one(`select count(*)::int as n from public.collection_messages where invoice_id=$1 and step_key='promise_day'`, [inv4]);
  check(pd2.n === 2, "and only once");
  await svc(`select public.collect_plan($1,'2026-11-11T06:00:00Z')`, [orgA.id]);
  const broken = await one(`select status from public.payment_promises where invoice_id=$1 order by created_at desc limit 1`, [inv4]);
  check(broken.status === "broken", "a promised day that passes unpaid marks the promise broken");
  const expired = await one(`select status, error from public.collection_messages where invoice_id=$1 and step_key='promise_day' limit 1`, [inv4]);
  check(expired.status === "cancelled" && expired.error === "expired", "a reminder left unsent for more than a day expires");
  await db.query(`update public.collect_settings set enabled=false where organization_id=$1`, [orgA.id]);
}

// ---------- Kayyro Collect phase 3: risk, expected payments, daily summary (051) ----------
{
  // The 050 block re-ran 050, which sets the version back
  await db.exec(fs.readFileSync(path.join(DIR, "051_collect_insights.sql"), "utf8"));
  const v = await one(`select public.kayyro_schema_version() as v`);
  check(v.v >= 51, "051 sets schema version 51");
  const svc = (sql, params) => attempt(() => db.query(sql, params));
  const mkCustomer = (name) =>
    one(`insert into public.customers (name, state, customer_type, organization_id, email, phone, payment_terms_days) values ($1,'Dubai','b2b',$2,$3,'+971 50 999 0000',10) returning id`, [name, orgA.id, `${name.toLowerCase().replace(/\W/g, "")}@test.example`]);
  const mkInvoice = async (customerId, date) => {
    const p = JSON.parse(invoicePayload(1, date));
    p.customer_id = customerId;
    const r = await asUser(ids.staffA, `select public.create_invoice_atomic($1::jsonb) as r`, [JSON.stringify(p)]);
    return r.ok ? r.rows[0].r.id : null;
  };
  const pay = async (customerId, invoiceId, date) => {
    const inv = await one(`select grand_total::text as g from public.invoices where id=$1`, [invoiceId]);
    return asUser(ids.staffA, `select public.record_payment($1::jsonb)`, [
      JSON.stringify({ customer_id: customerId, invoice_id: invoiceId, amount: Number(inv.g), payment_date: date }),
    ]);
  };

  // A customer who pays late, broke two promises and is overdue now
  const late = await mkCustomer("Late Payer Co");
  const lp1 = await mkInvoice(late.id, "2026-09-01"); // due 11 Sep
  let r = await pay(late.id, lp1, "2026-10-20"); // 39 days late
  check(r.ok, `a late payment is recorded (${r.msg ?? "ok"})`);
  const lp2 = await mkInvoice(late.id, "2026-08-01"); // due 11 Aug, still open
  await db.query(
    `insert into public.payment_promises (organization_id, invoice_id, customer_id, promised_date, status) values ($1,$2,$3,'2026-08-20','broken'), ($1,$2,$3,'2026-09-05','broken')`,
    [orgA.id, lp2, late.id]
  );
  // A customer who pays on time
  const good = await mkCustomer("Good Payer Co");
  const gp1 = await mkInvoice(good.id, "2026-10-01");
  await pay(good.id, gp1, "2026-10-05");

  r = await asUser(ids.staffA, `select customer_id, level, avg_days_late::float as avg, broken_promises, oldest_overdue_days from public.collect_customer_risk()`);
  const lateRow = r.rows?.find((x) => x.customer_id === late.id);
  const goodRow = r.rows?.find((x) => x.customer_id === good.id);
  check(r.ok && lateRow?.level === "high" && lateRow.avg === 39 && lateRow.broken_promises === 2 && lateRow.oldest_overdue_days > 60, `a slow payer with broken promises and an old overdue invoice is high risk (${JSON.stringify(lateRow ?? r.msg)})`);
  check(goodRow?.level === "low" && goodRow.avg === 0, "a customer who pays on time is low risk");
  const lv = await one(`select public.collect_risk_level(10, 0, 20, 100, 1000) as a, public.collect_risk_level(0, 1, 0, 0, 0) as b, public.collect_risk_level(null, null, null, null, null) as c`);
  check(lv.a === "medium" && lv.b === "low" && lv.c === "low", "the rules: 10 days late on average + 20 days overdue is medium; one broken promise alone is low");
  r = await asUser(ids.adminB, `select customer_id from public.collect_customer_risk($1)`, [orgA.id]);
  check(r.ok && !r.rows.some((x) => x.customer_id === late.id || x.customer_id === good.id), "another business can't read these risk levels, even by asking for them");

  // Expected in the next days: promised date first, then due date; disputed invoices left out
  const gp2 = await mkInvoice(good.id, "2026-10-28"); // due 7 Nov
  await asUser(ids.staffA, `select public.collect_add_promise($1, (select local_date + 2 from public.collect_clock($2)))`, [gp2, orgA.id]);
  const gp3 = await mkInvoice(good.id, "2026-10-28");
  await asUser(ids.staffA, `select public.collect_open_dispute($1, 'Damaged goods')`, [gp3]);
  r = await asUser(ids.staffA, `select invoice_id, promised from public.collect_expected(null, 7)`);
  const exp2 = r.rows?.find((x) => x.invoice_id === gp2);
  check(r.ok && exp2?.promised === true, `an invoice promised for this week is expected (${r.msg ?? "ok"})`);
  check(!r.rows.some((x) => x.invoice_id === gp3), "a disputed invoice is not counted as expected");

  // The daily summary: Business plan, once a day, from 09:00 on working days
  await db.query(`update public.organizations set plan='business', subscription_status='active' where id=$1`, [orgA.id]);
  r = await asUser(ids.adminA, `update public.collect_settings set summary_enabled=true, summary_channel='email', summary_to='not-an-email' where organization_id=$1`, [orgA.id]);
  check(!r.ok && /valid email/.test(r.msg), "an invalid summary address is refused");
  r = await asUser(ids.adminA, `update public.collect_settings set summary_enabled=true, summary_channel='email', summary_to=null, working_days=null where organization_id=$1 returning summary_enabled`, [orgA.id]);
  check(r.ok && r.rows[0]?.summary_enabled === true, `a Business admin switches the daily summary on (${r.msg ?? "ok"})`);
  r = await asUser(ids.adminB, `update public.collect_settings set summary_enabled=true where organization_id=$1`, [orgB.id]);
  check(!r.ok && /Business plan/.test(r.msg), "a Starter business can't");
  r = await svc(`select public.collect_claim_summary($1,'2027-03-15T03:00:00Z') as ok`, [orgA.id]); // Mon 07:00 Dubai
  check(r.ok && r.rows[0].ok === false, "not before 09:00");
  r = await svc(`select public.collect_claim_summary($1,'2027-03-13T06:00:00Z') as ok`, [orgA.id]); // Saturday
  check(r.rows[0].ok === false, "not on the weekend");
  r = await svc(`select public.collect_claim_summary($1,'2027-03-15T06:00:00Z') as ok`, [orgA.id]); // Mon 10:00
  check(r.rows[0].ok === true, "sent on a working day at 10:00");
  r = await svc(`select public.collect_claim_summary($1,'2027-03-15T09:00:00Z') as ok`, [orgA.id]);
  check(r.rows[0].ok === false, "and only once that day");
  await pay(good.id, gp2, "2027-03-14");
  r = await svc(`select public.collect_daily_summary_data($1,'2027-03-15T06:00:00Z') as d`, [orgA.id]);
  const d = r.rows?.[0]?.d;
  check(r.ok && Number(d.collected_yesterday) > 0 && typeof d.needs_you === "number" && "expected_week" in d && d.currency, `the summary has yesterday's collections, who needs you and what is expected (${r.msg ?? JSON.stringify(d)})`);
  r = await asUser(ids.adminA, `select public.collect_daily_summary_data($1)`, [orgA.id]);
  check(!r.ok, "the summary data is read by the server only");
  await db.query(`update public.collect_settings set summary_enabled=false where organization_id=$1`, [orgA.id]);
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
