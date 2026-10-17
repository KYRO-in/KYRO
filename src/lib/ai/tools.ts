import type { AiTool } from "@/lib/ai/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import { roundMoney } from "@/lib/utils";

/**
 * Read-only tools for Ask Kayyro. Every query runs with the signed-in user's
 * Supabase session, so row level security keeps each business to its own data.
 */

type Json = Record<string, unknown>;

const DATE = { type: "string", description: "Date as YYYY-MM-DD" } as const;

export const AI_TOOLS: AiTool[] = [
  {
    name: "sales_summary",
    description:
      "Sales between two dates (inclusive): number of invoices, sales before tax, tax, total, amount collected, amount still owed, cancelled count, and totals per day. Use for questions about sales, revenue, turnover or tax collected.",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "top_products",
    description:
      "Best-selling products between two dates, ranked by sales value, with quantity sold. Use for 'what sells most', 'best sellers', 'which product earned most'.",
    input_schema: {
      type: "object",
      properties: {
        from: DATE,
        to: DATE,
        limit: { type: "integer", description: "How many to return, 1-25" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "top_customers",
    description: "Customers ranked by how much they bought between two dates.",
    input_schema: {
      type: "object",
      properties: {
        from: DATE,
        to: DATE,
        limit: { type: "integer", description: "How many to return, 1-25" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "money_owed",
    description:
      "Customers who still owe money on unpaid or part-paid invoices, largest balance first, with the oldest unpaid invoice date. Use for 'who owes me', 'outstanding', 'udhaar', 'receivables'.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many customers to return, 1-25" } },
      additionalProperties: false,
    },
  },
  {
    name: "stock_levels",
    description:
      "Products that are low or out of stock (at or below their reorder level), or every product's stock when mode is 'all'.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["low", "all"] },
        limit: { type: "integer", description: "How many products to return, 1-50" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "find_products",
    description: "Search products by name, SKU or barcode. Returns price, tax rate, stock and unit.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "find_customers",
    description:
      "Search customers by name, phone or email. Returns contact details, total bought and what they still owe.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "find_invoices",
    description:
      "Look up invoices by invoice number or customer name, newest first. Returns number, date, customer, total, paid and status.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Invoice number or part of a customer name" },
        limit: { type: "integer", description: "1-20" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "purchases_and_expenses",
    description:
      "Spending between two dates: purchases from suppliers (with tax paid) and business expenses by category (rent, salary, utilities...). Use for costs, spending, profit questions.",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "payments_received",
    description: "Money received from customers between two dates, split by payment method (cash, card, bank transfer...).",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "attendance_summary",
    description:
      "Staff attendance between two dates: for each employee, days present, first check-in times, late arrivals and hours worked. Use for 'who was late', 'who is in today', 'hours worked'.",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
];

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clampInt = (v: unknown, def: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def;
};
/** Strip characters that have meaning inside a PostgREST filter. */
const searchTerm = (v: unknown) =>
  String(v ?? "")
    .replace(/[%,()*\\:"']/g, " ")
    .trim()
    .slice(0, 60);

const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

function range(input: Json) {
  if (!isDate(input.from) || !isDate(input.to)) throw new Error("from and to must be YYYY-MM-DD dates");
  if (input.from > input.to) return { from: input.to, to: input.from };
  return { from: input.from, to: input.to };
}

/** Page through a query; PostgREST returns at most 1,000 rows per request. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cap = 20000
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  const page = 1000;
  for (let start = 0; start < cap; start += page) {
    const { data, error } = await build(start, start + page - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < page) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const money = (n: number) => roundMoney(n);

type InvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string;
  subtotal: number;
  total_vat: number;
  grand_total: number;
  amount_paid: number | null;
  status: string;
  currency: string | null;
};

async function invoicesBetween(sb: SupabaseClient, from: string, to: string) {
  return fetchAll<InvoiceRow>((a, b) =>
    sb
      .from("invoices")
      .select("id, invoice_number, invoice_date, customer_id, subtotal, total_vat, grand_total, amount_paid, status, currency")
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .order("invoice_date")
      .range(a, b)
  );
}

async function customerNames(sb: SupabaseClient, ids: string[]) {
  const map = new Map<string, { name: string; phone: string | null }>();
  const unique = Array.from(new Set(ids)).slice(0, 500);
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await sb.from("customers").select("id, name, phone").in("id", unique.slice(i, i + 100));
    for (const c of data ?? []) map.set(c.id, { name: c.name, phone: c.phone });
  }
  return map;
}

async function stockMap(sb: SupabaseClient) {
  const { rows } = await fetchAll<{ product_id: string; current_stock: number }>((a, b) =>
    sb.from("product_stock").select("product_id, current_stock").range(a, b)
  );
  return new Map(rows.map((r) => [r.product_id, Number(r.current_stock)]));
}

type Handler = (sb: SupabaseClient, input: Json, ctx: { timeZone: string }) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  async sales_summary(sb, input) {
    const { from, to } = range(input);
    const { rows, truncated } = await invoicesBetween(sb, from, to);
    const live = rows.filter((r) => r.status !== "cancelled");
    const byDay = new Map<string, { invoices: number; total: number }>();
    let subtotal = 0;
    let tax = 0;
    let total = 0;
    let collected = 0;
    for (const r of live) {
      subtotal += Number(r.subtotal);
      tax += Number(r.total_vat);
      total += Number(r.grand_total);
      collected += Math.min(Number(r.amount_paid ?? 0), Number(r.grand_total));
      const d = byDay.get(r.invoice_date) ?? { invoices: 0, total: 0 };
      d.invoices += 1;
      d.total += Number(r.grand_total);
      byDay.set(r.invoice_date, d);
    }
    const days = Array.from(byDay, ([date, d]) => ({ date, invoices: d.invoices, total: money(d.total) }));
    return {
      from,
      to,
      invoices: live.length,
      cancelled: rows.length - live.length,
      sales_before_tax: money(subtotal),
      tax: money(tax),
      total_sales: money(total),
      collected: money(collected),
      still_owed: money(total - collected),
      average_invoice: live.length ? money(total / live.length) : 0,
      currencies: Array.from(new Set(live.map((r) => r.currency).filter(Boolean))),
      per_day: days.length > 62 ? undefined : days,
      best_day: days.reduce<(typeof days)[number] | null>((b, d) => (!b || d.total > b.total ? d : b), null),
      truncated,
    };
  },

  async top_products(sb, input) {
    const { from, to } = range(input);
    const limit = clampInt(input.limit, 10, 25);
    const { rows: invoices } = await invoicesBetween(sb, from, to);
    const live = invoices.filter((r) => r.status !== "cancelled").map((r) => r.id);
    const totals = new Map<string, { qty: number; sales: number; unit: string | null }>();
    for (let i = 0; i < live.length; i += 150) {
      const { rows } = await fetchAll<{ product_id: string | null; quantity: number; line_total: number; unit: string | null }>((a, b) =>
        sb
          .from("invoice_items")
          .select("product_id, quantity, line_total, unit")
          .in("invoice_id", live.slice(i, i + 150))
          .range(a, b)
      );
      for (const it of rows) {
        if (!it.product_id) continue;
        const t = totals.get(it.product_id) ?? { qty: 0, sales: 0, unit: it.unit };
        t.qty += Number(it.quantity);
        t.sales += Number(it.line_total);
        totals.set(it.product_id, t);
      }
    }
    const ranked = Array.from(totals, ([id, t]) => ({ id, ...t }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, limit);
    const { data: products } = ranked.length
      ? await sb.from("products").select("id, name, variant").in("id", ranked.map((r) => r.id))
      : { data: [] };
    const names = new Map((products ?? []).map((p) => [p.id, p.variant ? `${p.name} (${p.variant})` : p.name]));
    return {
      from,
      to,
      products: ranked.map((r) => ({
        product: names.get(r.id) ?? "Unknown product",
        quantity_sold: Math.round(r.qty * 1000) / 1000,
        unit: r.unit ?? "pcs",
        sales_incl_tax: money(r.sales),
      })),
    };
  },

  async top_customers(sb, input) {
    const { from, to } = range(input);
    const limit = clampInt(input.limit, 10, 25);
    const { rows } = await invoicesBetween(sb, from, to);
    const totals = new Map<string, { invoices: number; total: number; owed: number }>();
    for (const r of rows) {
      if (r.status === "cancelled") continue;
      const t = totals.get(r.customer_id) ?? { invoices: 0, total: 0, owed: 0 };
      t.invoices += 1;
      t.total += Number(r.grand_total);
      t.owed += Math.max(0, Number(r.grand_total) - Number(r.amount_paid ?? 0));
      totals.set(r.customer_id, t);
    }
    const ranked = Array.from(totals, ([id, t]) => ({ id, ...t }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
    const names = await customerNames(sb, ranked.map((r) => r.id));
    return {
      from,
      to,
      customers: ranked.map((r) => ({
        customer: names.get(r.id)?.name ?? "Unknown",
        invoices: r.invoices,
        bought: money(r.total),
        still_owes: money(r.owed),
      })),
    };
  },

  async money_owed(sb, input) {
    const limit = clampInt(input.limit, 10, 25);
    const { rows } = await fetchAll<InvoiceRow>((a, b) =>
      sb
        .from("invoices")
        .select("id, invoice_number, invoice_date, customer_id, subtotal, total_vat, grand_total, amount_paid, status, currency")
        .in("status", ["issued", "partially_paid"])
        .order("invoice_date")
        .range(a, b)
    );
    const owed = new Map<string, { balance: number; invoices: number; oldest: string }>();
    for (const r of rows) {
      if (r.status === "cancelled") continue;
      const bal = Number(r.grand_total) - Number(r.amount_paid ?? 0);
      if (bal <= 0.0005) continue;
      const t = owed.get(r.customer_id) ?? { balance: 0, invoices: 0, oldest: r.invoice_date };
      t.balance += bal;
      t.invoices += 1;
      if (r.invoice_date < t.oldest) t.oldest = r.invoice_date;
      owed.set(r.customer_id, t);
    }
    const all = Array.from(owed, ([id, t]) => ({ id, ...t })).sort((a, b) => b.balance - a.balance);
    const top = all.slice(0, limit);
    const names = await customerNames(sb, top.map((r) => r.id));
    return {
      customers_owing: all.length,
      total_owed: money(all.reduce((s, r) => s + r.balance, 0)),
      customers: top.map((r) => ({
        customer: names.get(r.id)?.name ?? "Unknown",
        phone: names.get(r.id)?.phone ?? null,
        owes: money(r.balance),
        unpaid_invoices: r.invoices,
        oldest_unpaid_invoice_date: r.oldest,
      })),
    };
  },

  async stock_levels(sb, input) {
    const mode = input.mode === "all" ? "all" : "low";
    const limit = clampInt(input.limit, 25, 50);
    const { rows: products } = await fetchAll<{
      id: string;
      name: string;
      variant: string | null;
      unit: string | null;
      reorder_threshold: number | null;
      is_service: boolean | null;
    }>((a, b) =>
      sb
        .from("products")
        .select("id, name, variant, unit, reorder_threshold, is_service")
        .eq("is_active", true)
        .order("name")
        .range(a, b)
    );
    const stock = await stockMap(sb);
    const list = products
      .filter((p) => !p.is_service)
      .map((p) => ({
        product: p.variant ? `${p.name} (${p.variant})` : p.name,
        in_stock: stock.get(p.id) ?? 0,
        reorder_level: Number(p.reorder_threshold ?? 0),
        unit: p.unit ?? "pcs",
      }));
    const low = list.filter((p) => p.in_stock <= p.reorder_level).sort((a, b) => a.in_stock - b.in_stock);
    return mode === "low"
      ? { low_or_out_of_stock: low.length, out_of_stock: low.filter((p) => p.in_stock <= 0).length, products: low.slice(0, limit) }
      : { products_tracked: list.length, products: list.slice(0, limit) };
  },

  async find_products(sb, input) {
    const q = searchTerm(input.query);
    if (!q) return { products: [] };
    const { data, error } = await sb
      .from("products")
      .select("id, name, variant, sku, barcode, base_price, vat_rate, unit, is_active, is_service")
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`)
      .limit(15);
    if (error) throw new Error(error.message);
    const stock = await stockMap(sb);
    return {
      products: (data ?? []).map((p) => ({
        product: p.variant ? `${p.name} (${p.variant})` : p.name,
        sku: p.sku,
        price: Number(p.base_price),
        tax_rate_percent: Number(p.vat_rate ?? 0),
        unit: p.unit ?? "pcs",
        in_stock: p.is_service ? "service" : (stock.get(p.id) ?? 0),
        active: p.is_active,
      })),
    };
  },

  async find_customers(sb, input) {
    const q = searchTerm(input.query);
    if (!q) return { customers: [] };
    const { data, error } = await sb
      .from("customers")
      .select("id, name, phone, email, country, tax_id")
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((c) => c.id);
    const { data: invs } = ids.length
      ? await sb.from("invoices").select("customer_id, grand_total, amount_paid, status, invoice_date").in("customer_id", ids).limit(5000)
      : { data: [] };
    return {
      customers: (data ?? []).map((c) => {
        const mine = (invs ?? []).filter((i) => i.customer_id === c.id && i.status !== "cancelled");
        return {
          customer: c.name,
          phone: c.phone,
          email: c.email,
          country: c.country,
          tax_number: c.tax_id,
          invoices: mine.length,
          bought: money(mine.reduce((s, i) => s + Number(i.grand_total), 0)),
          owes: money(mine.reduce((s, i) => s + Math.max(0, Number(i.grand_total) - Number(i.amount_paid ?? 0)), 0)),
          last_invoice: mine.map((i) => i.invoice_date).sort().pop() ?? null,
        };
      }),
    };
  },

  async find_invoices(sb, input) {
    const q = searchTerm(input.query);
    const limit = clampInt(input.limit, 10, 20);
    if (!q) return { invoices: [] };
    const { data: byNumber } = await sb
      .from("invoices")
      .select("id, invoice_number, invoice_date, customer_id, grand_total, amount_paid, status, currency")
      .ilike("invoice_number", `%${q}%`)
      .order("invoice_date", { ascending: false })
      .limit(limit);
    let rows = byNumber ?? [];
    if (!rows.length) {
      const { data: custs } = await sb.from("customers").select("id").ilike("name", `%${q}%`).limit(20);
      const ids = (custs ?? []).map((c) => c.id);
      if (ids.length) {
        const { data } = await sb
          .from("invoices")
          .select("id, invoice_number, invoice_date, customer_id, grand_total, amount_paid, status, currency")
          .in("customer_id", ids)
          .order("invoice_date", { ascending: false })
          .limit(limit);
        rows = data ?? [];
      }
    }
    const names = await customerNames(sb, rows.map((r) => r.customer_id));
    return {
      invoices: rows.map((r) => ({
        number: r.invoice_number,
        date: r.invoice_date,
        customer: names.get(r.customer_id)?.name ?? "Unknown",
        total: Number(r.grand_total),
        paid: Number(r.amount_paid ?? 0),
        status: r.status,
        currency: r.currency,
      })),
    };
  },

  async purchases_and_expenses(sb, input) {
    const { from, to } = range(input);
    const { rows: purchases } = await fetchAll<{ grand_total: number; total_vat: number; status: string; supplier_id: string }>((a, b) =>
      sb
        .from("purchases")
        .select("grand_total, total_vat, status, supplier_id")
        .gte("purchase_date", from)
        .lte("purchase_date", to)
        .range(a, b)
    ).catch(() => ({ rows: [], truncated: false }));
    const { rows: expenses } = await fetchAll<{ category: string; amount: number }>((a, b) =>
      sb
        .from("business_data_entries")
        .select("category, amount")
        .gte("entry_date", from)
        .lte("entry_date", to)
        .range(a, b)
    ).catch(() => ({ rows: [], truncated: false }));
    const live = purchases.filter((p) => p.status !== "cancelled");
    const byCat = new Map<string, number>();
    for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount));
    return {
      from,
      to,
      purchases: live.length,
      purchases_total: money(live.reduce((s, p) => s + Number(p.grand_total), 0)),
      tax_paid_on_purchases: money(live.reduce((s, p) => s + Number(p.total_vat), 0)),
      expenses_total: money(expenses.reduce((s, e) => s + Number(e.amount), 0)),
      expenses_by_category: Array.from(byCat, ([category, amount]) => ({ category, amount: money(amount) })).sort(
        (a, b) => b.amount - a.amount
      ),
    };
  },

  async payments_received(sb, input) {
    const { from, to } = range(input);
    const { rows } = await fetchAll<{ amount: number; payment_mode: string | null }>((a, b) =>
      sb
        .from("payments")
        .select("amount, payment_mode")
        .gte("payment_date", from)
        .lte("payment_date", to)
        .range(a, b)
    );
    const byMode = new Map<string, number>();
    for (const p of rows) byMode.set(p.payment_mode ?? "other", (byMode.get(p.payment_mode ?? "other") ?? 0) + Number(p.amount));
    return {
      from,
      to,
      payments: rows.length,
      total_received: money(rows.reduce((s, p) => s + Number(p.amount), 0)),
      by_method: Array.from(byMode, ([method, amount]) => ({ method, amount: money(amount) })),
    };
  },

  async attendance_summary(sb, input, ctx) {
    const { from, to } = range(input);
    const { data: employees, error } = await sb
      .from("employees")
      .select("id, full_name, job_title, shift_start, active")
      .order("full_name");
    if (error) return { note: "Staff attendance is not set up yet (run migration 043)." };
    // Pad a day either side so every local day is covered whatever the time zone
    const { rows: punches } = await fetchAll<{ employee_id: string; kind: string; at: string }>((a, b) =>
      sb
        .from("attendance")
        .select("employee_id, kind, at")
        .gte("at", `${from}T00:00:00Z`)
        .lt("at", `${nextDay(nextDay(to))}T00:00:00Z`)
        .order("at")
        .range(a, b)
    );
    const { summariseAttendance } = await import("@/lib/attendance");
    const summary = summariseAttendance(employees ?? [], punches, { from, to, timeZone: ctx.timeZone });
    return { from, to, time_zone: ctx.timeZone, employees: summary };
  },
};

/** Run one tool call. Errors come back as text so the model can explain or retry. */
export async function runAiTool(
  sb: SupabaseClient,
  name: string,
  input: unknown,
  ctx: { timeZone: string }
): Promise<{ content: string; isError: boolean }> {
  const handler = handlers[name];
  if (!handler) return { content: `Unknown tool ${name}`, isError: true };
  try {
    const result = await handler(sb, (input && typeof input === "object" ? input : {}) as Json, ctx);
    const text = JSON.stringify(result);
    return { content: text.length > 60000 ? `${text.slice(0, 60000)}…(cut short)` : text, isError: false };
  } catch (e) {
    return { content: `Could not read that: ${(e as Error).message}`, isError: true };
  }
}
