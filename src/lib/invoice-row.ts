import type { Invoice } from "@/lib/types";
import { normalizeVatCategory } from "@/lib/vat";

/** A raw invoices row (with customer and items) as an Invoice, in the browser or on the server. */
export function mapInvoiceRow(data: Record<string, unknown>): Invoice {
  return {
    ...data,
    subtotal: Number(data.subtotal),
    total_vat: Number(data.total_vat),
    currency: String(data.currency ?? "INR"),
    round_off: Number(data.round_off),
    grand_total: Number(data.grand_total),
    amount_paid: Number(data.amount_paid ?? 0),
    items: ((data.items as Record<string, unknown>[]) ?? []).map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
      taxable_value: Number(it.taxable_value),
      vat_rate: Number(it.vat_rate),
      vat_amount: Number(it.vat_amount),
      vat_category: normalizeVatCategory(it.vat_category, Number(it.vat_rate)),
      line_total: Number(it.line_total),
    })),
  } as Invoice;
}
