/**
 * Adversarial multi-tenant isolation test (anon key + user JWTs).
 *
 * Creates Test Org A and Test Org B, seeds B with product/customer/invoice,
 * then authenticates as A and attacks B's IDs.
 *
 * Exit 0 = every cross-tenant attempt blocked.
 * Exit 1 = setup failure.
 * Exit 2 = LEAK (isolation broken) — do not onboard customers.
 *
 * Requires: npm run dev (APP_URL) and .env.local
 *   node scripts/tenant-isolation-test.mjs
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) throw new Error("Missing .env.local");
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnvLocal();

const APP = process.env.APP_URL ?? "http://127.0.0.1:3001";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const PASSWORD = "IsoTest1!A";

function authed(accessToken, refreshToken) {
  const sb = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  return { sb, accessToken, refreshToken };
}

/** Test accounts are created with the service role (sign-up itself now needs email confirmation). */
async function signup(business_name, email) {
  if (!SERVICE) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to create test accounts");
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `${business_name} Owner` },
  });
  if (userErr || !created.user) throw new Error(`Signup ${business_name}: ${userErr?.message}`);
  const slug = `${business_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: business_name, slug, brand_name: business_name, state: "", email, plan: "free", subscription_status: "trialing" })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`Org ${business_name}: ${orgErr?.message}`);
  await admin.from("warehouses").insert({ name: "Main warehouse", code: `MAIN-${slug}`.slice(0, 40), is_default: true, is_active: true, organization_id: org.id });
  const { error: profileErr } = await admin
    .from("users")
    .upsert({ id: created.user.id, full_name: `${business_name} Owner`, role: "admin", organization_id: org.id }, { onConflict: "id" });
  if (profileErr) throw new Error(`Profile ${business_name}: ${profileErr.message}`);
  return org.id;
}

async function signIn(email) {
  const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`Sign-in ${email}: ${error?.message}`);
  return data.session;
}

function blocked(ok, detail) {
  return { ok, detail };
}

async function main() {
  const stamp = Date.now().toString(36);
  const emailA = `iso-a-${stamp}@example.com`;
  const emailB = `iso-b-${stamp}@example.com`;
  const failures = [];
  const passes = [];

  console.log("Kayyro tenant isolation test");
  console.log(`App ${APP}`);
  console.log(`A ${emailA}`);
  console.log(`B ${emailB}`);

  const ping = await fetch(`${APP}/login`).catch(() => null);
  if (!ping) {
    console.error("Dev server not reachable. Start with: npm run dev");
    process.exit(1);
  }

  const orgA = await signup("Test Org A", emailA);
  const orgB = await signup("Test Org B", emailB);
  if (orgA === orgB) throw new Error("Both signups received the same organization_id");

  const sessA = await signIn(emailA);
  const sessB = await signIn(emailB);
  const a = authed(sessA.access_token, sessA.refresh_token);
  const b = authed(sessB.access_token, sessB.refresh_token);
  await a.sb.auth.setSession({
    access_token: sessA.access_token,
    refresh_token: sessA.refresh_token,
  });
  await b.sb.auth.setSession({
    access_token: sessB.access_token,
    refresh_token: sessB.refresh_token,
  });

  const { data: profileA } = await a.sb.from("users").select("id, organization_id").single();
  const { data: profileB } = await b.sb.from("users").select("id, organization_id").single();
  if (profileA?.organization_id !== orgA || profileB?.organization_id !== orgB) {
    throw new Error(`Org binding mismatch A=${profileA?.organization_id} B=${profileB?.organization_id}`);
  }

  async function seed(client, orgId, userId, label) {
    const { data: product, error: pErr } = await client.sb
      .from("products")
      .insert({
        name: `${label} Product`,
        category: "Dishwash",
        sku: `SKU-${label}-${stamp}`,
        pack_size: "1 L",
        hsn_code: "3402",
        base_price: 100,
        gst_rate: 18,
        reorder_threshold: 1,
        is_active: true,
        organization_id: orgId,
      })
      .select("id")
      .single();
    if (pErr || !product) throw new Error(`${label} product: ${pErr?.message}`);

    const { data: customer, error: cErr } = await client.sb
      .from("customers")
      .insert({
        name: `${label} Customer`,
        phone: "9000000001",
        billing_address: "Street",
        state: "Dubai",
        customer_type: "b2c",
        organization_id: orgId,
      })
      .select("id")
      .single();
    if (cErr || !customer) throw new Error(`${label} customer: ${cErr?.message}`);

    const { data: wh } = await client.sb
      .from("warehouses")
      .select("id")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle();

    const { error: stockErr } = await client.sb.from("stock_movements").insert({
      product_id: product.id,
      warehouse_id: wh?.id ?? null,
      quantity: 20,
      movement_type: "in",
      reference: "iso-seed",
      reason: "iso-seed",
      created_by: userId,
      organization_id: orgId,
    });
    if (stockErr) throw new Error(`${label} stock: ${stockErr.message}`);

    const { data: invRpc, error: invErr } = await client.sb.rpc("create_invoice_atomic", {
      payload: {
        prefix: "AB",
        customer_id: customer.id,
        invoice_date: new Date().toISOString().slice(0, 10),
        notes: `${label} secret invoice`,
        created_by: userId,
        warehouse_id: wh?.id ?? null,
        subtotal: 100,
        total_cgst: 9,
        total_sgst: 9,
        total_igst: 0,
        round_off: 0,
        grand_total: 118,
        items: [
          {
            product_id: product.id,
            hsn_code: "3402",
            quantity: 1,
            unit_price: 100,
            price_overridden: false,
            taxable_value: 100,
            gst_rate: 18,
            cgst_amount: 9,
            sgst_amount: 9,
            igst_amount: 0,
            line_total: 118,
          },
        ],
      },
    });
    if (invErr) throw new Error(`${label} invoice: ${invErr.message}`);
    const invoice =
      invRpc && typeof invRpc === "object" && !Array.isArray(invRpc)
        ? invRpc
        : Array.isArray(invRpc)
          ? invRpc[0]
          : null;
    if (!invoice?.id) throw new Error(`${label} invoice RPC: ${JSON.stringify(invRpc)}`);
    return { product, customer, invoice, warehouseId: wh?.id ?? null };
  }

  console.log("Seeding both orgs…");
  await seed(a, orgA, profileA.id, "OrgA");
  const victim = await seed(b, orgB, profileB.id, "OrgB");
  console.log(`Victim B product=${victim.product.id} customer=${victim.customer.id} invoice=${victim.invoice.id}`);

  function check(name, leaked, extra = "") {
    if (leaked) {
      failures.push(`${name}: ${extra}`);
      console.log(`LEAK  ${name}  ${extra}`);
    } else {
      passes.push(name);
      console.log(`BLOCK ${name}`);
    }
  }

  // Authenticate as Org A, attack Org B IDs
  {
    const { data } = await a.sb.from("products").select("id").eq("id", victim.product.id).maybeSingle();
    check("read product by id", Boolean(data));
  }
  {
    const { data } = await a.sb.from("products").select("id").eq("organization_id", orgB);
    check("list products filter org B", (data?.length ?? 0) > 0, `rows=${data?.length ?? 0}`);
  }
  {
    const { data, error } = await a.sb
      .from("products")
      .update({ name: "HACKED BY A" })
      .eq("id", victim.product.id)
      .select();
    check("update product", (data?.length ?? 0) > 0, error?.message ?? "");
  }
  {
    const { data } = await a.sb.from("products").delete().eq("id", victim.product.id).select();
    check("delete product", (data?.length ?? 0) > 0);
  }

  {
    const { data } = await a.sb.from("customers").select("id").eq("id", victim.customer.id).maybeSingle();
    check("read customer by id", Boolean(data));
  }
  {
    const { data } = await a.sb
      .from("customers")
      .update({ name: "HACKED" })
      .eq("id", victim.customer.id)
      .select();
    check("update customer", (data?.length ?? 0) > 0);
  }
  {
    const { data } = await a.sb.from("customers").delete().eq("id", victim.customer.id).select();
    check("delete customer", (data?.length ?? 0) > 0);
  }

  {
    const { data } = await a.sb.from("invoices").select("id, notes").eq("id", victim.invoice.id).maybeSingle();
    check("read invoice by id", Boolean(data));
  }
  {
    const rest = await fetch(
      `${URL}/rest/v1/invoices?id=eq.${victim.invoice.id}&select=id,notes`,
      {
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${sessA.access_token}`,
        },
      }
    );
    const body = await rest.json();
    check("REST GET invoice by id", Array.isArray(body) && body.length > 0, `http=${rest.status}`);
  }
  {
    const { data } = await a.sb
      .from("invoices")
      .update({ notes: "HACKED" })
      .eq("id", victim.invoice.id)
      .select();
    check("update invoice", (data?.length ?? 0) > 0);
  }
  {
    const { data } = await a.sb.from("invoices").delete().eq("id", victim.invoice.id).select();
    check("delete invoice", (data?.length ?? 0) > 0);
  }

  {
    const { data } = await a.sb
      .from("invoice_items")
      .select("id")
      .eq("invoice_id", victim.invoice.id);
    check("read invoice_items", (data?.length ?? 0) > 0);
  }
  {
    const { data } = await a.sb.from("organizations").select("id, name").eq("id", orgB).maybeSingle();
    check("read organization B row", Boolean(data));
  }
  {
    const { data } = await a.sb.from("users").select("id, organization_id");
    const leaked = (data ?? []).filter((r) => r.organization_id === orgB || r.id === profileB.id);
    check("read users of org B", leaked.length > 0);
  }
  {
    const { data, error } = await a.sb.from("products").insert({
      name: "Planted in B",
      category: "Dishwash",
      sku: `PLANT-${stamp}`,
      pack_size: "1",
      hsn_code: "3402",
      base_price: 1,
      gst_rate: 18,
      reorder_threshold: 0,
      is_active: true,
      organization_id: orgB,
    }).select();
    check("insert product with org B id", (data?.length ?? 0) > 0, error?.message ?? "");
  }
  {
    const { data, error } = await a.sb.rpc("create_invoice_atomic", {
      payload: {
        prefix: "AB",
        customer_id: victim.customer.id,
        invoice_date: new Date().toISOString().slice(0, 10),
        notes: "cross-tenant rpc",
        created_by: profileA.id,
        warehouse_id: null,
        subtotal: 100,
        total_cgst: 9,
        total_sgst: 9,
        total_igst: 0,
        round_off: 0,
        grand_total: 118,
        items: [
          {
            product_id: victim.product.id,
            hsn_code: "3402",
            quantity: 1,
            unit_price: 100,
            price_overridden: false,
            taxable_value: 100,
            gst_rate: 18,
            cgst_amount: 9,
            sgst_amount: 9,
            igst_amount: 0,
            line_total: 118,
          },
        ],
      },
    });
    const created = Boolean(data && !error && (data.id || (Array.isArray(data) && data[0]?.id)));
    check("create_invoice_atomic using B customer/product", created, error?.message ?? "");
  }

  if (SERVICE) {
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const { data: still } = await admin
      .from("products")
      .select("id, name")
      .eq("id", victim.product.id)
      .maybeSingle();
    if (!still) {
      failures.push("sanity: B product missing after attacks (delete may have succeeded)");
    } else if (still.name === "HACKED BY A") {
      failures.push("sanity: B product name was mutated by A");
    }
  }

  console.log("\n---");
  console.log(`Blocked ${passes.length}`);
  console.log(`Leaked  ${failures.length}`);
  if (failures.length) {
    console.log("\nISOLATION FAILED — do not onboard customers:");
    for (const f of failures) console.log(` - ${f}`);
    process.exit(2);
  }
  console.log("\nAll cross-tenant read/update/delete/insert probes were blocked.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
