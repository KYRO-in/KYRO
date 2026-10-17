"use client";

import { isDemoMode } from "@/lib/demo/mode";
import { demoDb } from "@/lib/demo/store";
import { downloadXlsx } from "@/lib/excel";
import { createClient } from "@/lib/supabase/client";

/** Every table that holds a business's own records, in a sensible reading order. */
const TABLES: Array<{ table: string; sheet: string }> = [
  { table: "organizations", sheet: "Business" },
  { table: "customers", sheet: "Customers" },
  { table: "products", sheet: "Products" },
  { table: "product_categories", sheet: "Categories" },
  { table: "invoices", sheet: "Invoices" },
  { table: "invoice_items", sheet: "Invoice lines" },
  { table: "payments", sheet: "Payments" },
  { table: "credit_notes", sheet: "Credit notes" },
  { table: "credit_note_items", sheet: "Credit note lines" },
  { table: "suppliers", sheet: "Suppliers" },
  { table: "purchases", sheet: "Purchases" },
  { table: "purchase_items", sheet: "Purchase lines" },
  { table: "stock_movements", sheet: "Stock movements" },
  { table: "warehouses", sheet: "Warehouses" },
  { table: "other_expenses", sheet: "Expenses" },
  { table: "recurring_invoices", sheet: "Recurring invoices" },
  { table: "invoice_emails", sheet: "Email log" },
  { table: "users", sheet: "Team" },
];

const PAGE = 1000;

/** Spreadsheet cells hold plain values: nested objects and arrays become JSON text. */
function flatten(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}

async function fetchTable(table: string): Promise<Record<string, unknown>[] | null> {
  const supabase = createClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) return rows.length ? rows : null; // table not in this database yet
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

function demoRows(table: string): Record<string, unknown>[] | null {
  const strip = <T extends object>(xs: T[]) =>
    xs.map((x) => {
      const rest = { ...(x as Record<string, unknown>) };
      for (const nested of ["customer", "product", "items", "user"]) delete rest[nested];
      return rest;
    });
  switch (table) {
    case "organizations":
      return [demoDb.getOrganization() as unknown as Record<string, unknown>];
    case "customers":
      return strip(demoDb.getCustomers());
    case "products":
      return strip(demoDb.getProducts());
    case "product_categories":
      return strip(demoDb.getProductCategories());
    case "invoices":
      return strip(demoDb.getInvoices());
    case "invoice_items":
      return strip(demoDb.getInvoices().flatMap((inv) => inv.items ?? []));
    case "payments":
      return strip(demoDb.getPayments());
    case "credit_notes":
      return strip(demoDb.getCreditNotes());
    case "suppliers":
      return strip(demoDb.getSuppliers());
    case "purchases":
      return strip(demoDb.getPurchases());
    case "stock_movements":
      return strip(demoDb.getMovements());
    case "warehouses":
      return strip(demoDb.getWarehouses());
    case "recurring_invoices":
      return strip(demoDb.getRecurringInvoices());
    case "invoice_emails":
      return strip(demoDb.getInvoiceEmails());
    case "users":
      return strip(demoDb.getUsers());
    default:
      return null;
  }
}

/**
 * Download every record of the business as one Excel workbook (one sheet per
 * table). Row Level Security means only this business's rows are returned.
 */
export async function downloadAllData(businessName: string, onProgress?: (label: string) => void) {
  const sheets: Array<{ name: string; rows: Record<string, unknown>[] }> = [];
  let total = 0;
  for (const { table, sheet } of TABLES) {
    onProgress?.(sheet);
    const rows = isDemoMode() ? demoRows(table) : await fetchTable(table);
    if (!rows) continue;
    sheets.push({ name: sheet, rows: rows.map(flatten) });
    total += rows.length;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = businessName.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "business";
  downloadXlsx(`Kayyro-${safe}-all-data-${stamp}.xlsx`, sheets);
  return { sheets: sheets.length, rows: total };
}
