/**
 * Kayyro Collect: one status per invoice, and the four "Get paid" numbers.
 * Pure functions (no database), shared by the pages and the tests.
 */

export type CollectStatus = "upcoming" | "due" | "overdue" | "promised" | "disputed" | "paid";

export type CollectInvoice = {
  id: string;
  customer_id: string;
  status: string;
  grand_total: number;
  amount_paid: number;
  /** Sum of credit notes against this invoice */
  credited?: number;
  due_date: string | null;
  invoice_date: string;
};

export type CollectContext = {
  /** Invoice ids with an open dispute */
  disputed: Set<string>;
  /** Open promise date per invoice */
  promises: Map<string, string>;
};

export function balanceDue(inv: CollectInvoice): number {
  return Math.max(0, Number(inv.grand_total) - Number(inv.amount_paid ?? 0) - Number(inv.credited ?? 0));
}

export function isOpen(inv: CollectInvoice): boolean {
  return inv.status !== "cancelled" && inv.status !== "paid" && balanceDue(inv) > 0.0005;
}

/** "YYYY-MM-DD" + n days */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** Exactly one status for every invoice that isn't cancelled. */
export function collectStatus(inv: CollectInvoice, today: string, ctx: CollectContext): CollectStatus {
  if (!isOpen(inv)) return "paid";
  if (ctx.disputed.has(inv.id)) return "disputed";
  const promised = ctx.promises.get(inv.id);
  if (promised && promised >= today) return "promised";
  const due = inv.due_date ?? addDaysIso(inv.invoice_date, 30);
  if (due > today) return "upcoming";
  if (due === today) return "due";
  return "overdue";
}

export type GetPaidSummary = {
  unpaid: number;
  overdue: number;
  expectedThisWeek: number;
  collectedByCollect: number;
  currency: string;
};

/** Monday-to-Sunday is not used: "this week" is today plus the next 6 days. */
export function weekEnd(today: string): string {
  return addDaysIso(today, 6);
}

export function getPaidSummary(input: {
  invoices: CollectInvoice[];
  ctx: CollectContext;
  today: string;
  currency: string;
  /** Payments this month: invoice id, amount and date */
  payments: { invoice_id: string | null; amount: number; payment_date: string }[];
  /** When each invoice got a reminder (sent messages) */
  remindersSent: { invoice_id: string | null; sent_at: string | null }[];
}): GetPaidSummary {
  const { invoices, ctx, today } = input;
  const end = weekEnd(today);
  let unpaid = 0;
  let overdue = 0;
  let expected = 0;
  for (const inv of invoices) {
    if (!isOpen(inv)) continue;
    const bal = balanceDue(inv);
    unpaid += bal;
    const status = collectStatus(inv, today, ctx);
    if (status === "overdue") overdue += bal;
    const promised = ctx.promises.get(inv.id);
    const due = inv.due_date ?? addDaysIso(inv.invoice_date, 30);
    const expectedOn = promised && promised >= today ? promised : due;
    if (status !== "disputed" && expectedOn >= today && expectedOn <= end) expected += bal;
  }

  // Collected by Kayyro Collect: paid within 7 days after a reminder on that invoice
  const sentByInvoice = new Map<string, string[]>();
  for (const m of input.remindersSent) {
    if (!m.invoice_id || !m.sent_at) continue;
    const day = m.sent_at.slice(0, 10);
    sentByInvoice.set(m.invoice_id, [...(sentByInvoice.get(m.invoice_id) ?? []), day]);
  }
  const monthStart = `${today.slice(0, 7)}-01`;
  let collected = 0;
  for (const p of input.payments) {
    if (!p.invoice_id || p.payment_date < monthStart || p.payment_date > today) continue;
    const days = sentByInvoice.get(p.invoice_id) ?? [];
    if (days.some((d) => d <= p.payment_date && daysBetween(d, p.payment_date) <= 7)) collected += Number(p.amount);
  }

  return { unpaid, overdue, expectedThisWeek: expected, collectedByCollect: collected, currency: input.currency };
}
