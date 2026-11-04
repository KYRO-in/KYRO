/**
 * Kayyro Collect sample data for demo mode (in memory, built from the demo
 * invoices so every screen can be previewed without a database).
 */
import { demoDb } from "@/lib/demo/store";
import { addDaysIso, daysBetween } from "@/lib/collect/status";
import { renderEmail, renderWhatsApp, type CollectStepKey } from "@/lib/collect/templates";
import { oneTapLink } from "@/lib/collect/whatsapp";
import type { CustomerRisk } from "@/lib/collect/insights";
import type {
  CollectionMessage,
  CollectSettings,
  CollectTask,
  Dispute,
  PaymentClaim,
  PaymentPromise,
  ReplyIntentName,
  ReminderStep,
} from "@/lib/types";

const ORG = "demo-org";
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

type DemoState = {
  settings: CollectSettings;
  steps: ReminderStep[];
  messages: CollectionMessage[];
  tasks: CollectTask[];
  promises: PaymentPromise[];
  disputes: Dispute[];
  claims: PaymentClaim[];
};

let state: DemoState | null = null;

function seed(): DemoState {
  const settings: CollectSettings = {
    organization_id: ORG,
    enabled: true,
    enabled_at: now(),
    channel_email: true,
    channel_whatsapp: true,
    tone: 30,
    language: "auto",
    send_start: "09:00",
    send_end: "18:00",
    working_days: null,
    time_zone: null,
    ramadan_enabled: false,
    ramadan_start: null,
    ramadan_end: null,
    ramadan_send_start: "10:00",
    ramadan_send_end: "15:00",
    approval_mode: "approve",
    default_terms_days: 30,
    include_existing: true,
    ai_replies: true,
    summary_enabled: false,
    summary_channel: "email",
    summary_to: null,
    summary_time: "09:00",
    updated_at: now(),
  };
  const steps: ReminderStep[] = (
    [
      [-3, "message", "before_due"],
      [0, "message", "due_today"],
      [3, "message", "polite"],
      [7, "message", "firm"],
      [15, "call_task", "call"],
      [30, "message", "final"],
    ] as const
  ).map(([offset, action, key]) => ({
    id: nextId("step"),
    organization_id: ORG,
    offset_days: offset,
    action,
    step_key: key,
    active: true,
  }));

  const company = demoDb.getCompany();
  const business = company.brand_name || company.company_name || "Demo Trading LLC";
  const open = demoDb
    .getInvoices()
    .filter((i) => i.status !== "paid" && i.status !== "cancelled" && Number(i.grand_total) - Number(i.amount_paid ?? 0) > 0)
    .slice(0, 5);

  const messages: CollectionMessage[] = [];
  const tasks: CollectTask[] = [];
  const promises: PaymentPromise[] = [];
  const claims: PaymentClaim[] = [];
  open.forEach((inv, n) => {
    const due = inv.due_date ?? addDaysIso(inv.invoice_date, 30);
    const late = daysBetween(due, today());
    const step: CollectStepKey = late < 0 ? "before_due" : late === 0 ? "due_today" : late < 7 ? "polite" : late < 30 ? "firm" : "final";
    const vars = {
      customer: inv.customer?.name ?? "Customer",
      business,
      invoiceNumber: inv.invoice_number,
      amount: Number(inv.grand_total) - Number(inv.amount_paid ?? 0),
      currency: inv.currency || "AED",
      dueDate: due,
      invoiceUrl: "https://example.com/i/demo",
      payUrl: null,
      optOutUrl: "https://example.com/u/demo",
    };
    const base = {
      organization_id: ORG,
      invoice_id: inv.id,
      customer_id: inv.customer_id,
      step_id: null,
      step_key: step,
      direction: "out" as const,
      local_date: today(),
      sent_on: null,
      auto_send: false,
      manual: false,
      language: "en" as const,
      wa_template: null,
      wa_variables: null,
      provider: null,
      error: null,
      sent_at: null,
      created_at: now(),
    };
    if (n < 2) {
      const e = renderEmail(step, "en", 30, vars);
      messages.push({
        ...base,
        id: nextId("msg"),
        channel: "email",
        status: "awaiting_approval",
        subject: e.subject,
        body: e.text,
        to_address: inv.customer?.email || "accounts@example.com",
      });
      const w = renderWhatsApp(step, "en", vars);
      messages.push({
        ...base,
        id: nextId("msg"),
        channel: "whatsapp",
        status: "awaiting_approval",
        subject: null,
        body: w.text,
        to_address: inv.customer?.phone || "+971500000000",
        wa_template: w.template,
        wa_variables: w.params,
      });
    } else if (n === 2) {
      const w = renderWhatsApp("before_due", "en", vars);
      messages.push({
        ...base,
        id: nextId("msg"),
        step_key: "before_due",
        channel: "whatsapp",
        status: "sent",
        subject: null,
        body: w.text,
        to_address: inv.customer?.phone || "+971500000000",
        sent_on: addDaysIso(today(), -3),
        sent_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        provider: "one_tap",
      });
      promises.push({
        id: nextId("promise"),
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        promised_date: addDaysIso(today(), 3),
        amount: null,
        status: "open",
        created_at: now(),
      });
    } else if (n === 4) {
      // A customer who says it's paid, from the payment page
      const claimId = nextId("claim");
      claims.push({
        id: claimId,
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        source: "payment_page",
        note: "Paid by bank transfer, ref FT26310882",
        file_path: null,
        file_type: null,
        status: "pending",
        created_at: now(),
      });
      tasks.push({
        id: nextId("task"),
        organization_id: ORG,
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        kind: "paid_claim",
        status: "open",
        title: `${inv.customer?.name ?? "Customer"} says ${inv.invoice_number} is paid`,
        note: "Paid by bank transfer, ref FT26310882",
        due_date: today(),
        created_at: now(),
        claim_id: claimId,
      });
    } else {
      tasks.push({
        id: nextId("task"),
        organization_id: ORG,
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        kind: "call",
        status: "open",
        title: `Call ${inv.customer?.name ?? "the customer"}`,
        note: null,
        due_date: today(),
        created_at: now(),
      });
    }
  });
  return { settings, steps, messages, tasks, promises, disputes: [], claims };
}

function db(): DemoState {
  if (!state) state = seed();
  return state;
}

export const collectDemo = {
  settings: () => db().settings,
  steps: () => [...db().steps].sort((a, b) => a.offset_days - b.offset_days),
  messages: () => [...db().messages].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  tasks: () => db().tasks.filter((t) => t.status === "open"),
  promises: () => db().promises.filter((p) => p.status === "open"),
  disputes: () => db().disputes.filter((d) => d.status === "open"),
  claims: () => db().claims.filter((c) => c.status === "pending"),
  saveSettings(patch: Partial<CollectSettings>) {
    db().settings = { ...db().settings, ...patch, updated_at: now() };
    return db().settings;
  },
  saveSteps(steps: Pick<ReminderStep, "offset_days" | "action" | "step_key" | "active">[]) {
    db().steps = steps.map((s) => ({ ...s, id: nextId("step"), organization_id: ORG }));
  },
  setStatus(id: string, status: CollectionMessage["status"], patch: Partial<CollectionMessage> = {}) {
    const m = db().messages.find((x) => x.id === id);
    if (!m) throw new Error("Message not found");
    Object.assign(m, patch, { status });
    if (status === "sent") {
      m.sent_at = now();
      m.sent_on = today();
    }
    return status;
  },
  addMessage(m: Omit<CollectionMessage, "id" | "organization_id" | "created_at">) {
    const row = { ...m, id: nextId("msg"), organization_id: ORG, created_at: now() };
    db().messages.unshift(row);
    return row;
  },
  addPromise(invoiceId: string, customerId: string | null, date: string) {
    db().promises.push({
      id: nextId("promise"),
      invoice_id: invoiceId,
      customer_id: customerId,
      promised_date: date,
      amount: null,
      status: "open",
      created_at: now(),
    });
    db().messages.forEach((m) => {
      if (m.invoice_id === invoiceId && ["pending", "awaiting_approval", "ready"].includes(m.status)) m.status = "cancelled";
    });
  },
  openDispute(invoiceId: string, customerId: string | null, reason: string) {
    db().disputes.push({ id: nextId("dispute"), invoice_id: invoiceId, customer_id: customerId, reason, status: "open", created_at: now() });
    db().messages.forEach((m) => {
      if (m.invoice_id === invoiceId && ["pending", "awaiting_approval", "ready"].includes(m.status)) m.status = "cancelled";
    });
  },
  resolveDispute(id: string) {
    const d = db().disputes.find((x) => x.id === id);
    if (d) d.status = "resolved";
  },
  resolveTask(id: string, status: "done" | "dismissed") {
    const t = db().tasks.find((x) => x.id === id);
    if (t) t.status = status;
  },
  /** Demo risk levels (the live app gets them from the database, collect_customer_risk). */
  risk(): CustomerRisk[] {
    const byCustomer = new Map<string, CustomerRisk>();
    const t = today();
    for (const inv of demoDb.getInvoices()) {
      if (inv.status === "cancelled" || !inv.customer) continue;
      const row =
        byCustomer.get(inv.customer_id) ??
        ({
          customer_id: inv.customer_id,
          customer_name: inv.customer.name,
          open_balance: 0,
          overdue_amount: 0,
          oldest_overdue_days: 0,
          avg_days_late: null,
          paid_invoices: 0,
          broken_promises: 0,
          level: "low",
        } satisfies CustomerRisk);
      const bal = Number(inv.grand_total) - Number(inv.amount_paid ?? 0);
      const due = inv.due_date ?? addDaysIso(inv.invoice_date, 30);
      if (inv.status === "paid") row.paid_invoices++;
      else if (bal > 0) {
        row.open_balance += bal;
        if (due < t) {
          row.overdue_amount += bal;
          row.oldest_overdue_days = Math.max(row.oldest_overdue_days, daysBetween(due, t));
        }
      }
      byCustomer.set(inv.customer_id, row);
    }
    return [...byCustomer.values()].map((r) => {
      const score =
        (r.oldest_overdue_days > 60 ? 2 : r.oldest_overdue_days > 14 ? 1 : 0) +
        (r.overdue_amount > 0 && r.overdue_amount >= 0.5 * r.open_balance && r.oldest_overdue_days > 7 ? 1 : 0);
      return { ...r, level: score >= 4 ? "high" : score >= 2 ? "medium" : "low" };
    });
  },
  resolveClaim(id: string, status: "confirmed" | "rejected") {
    const c = db().claims.find((x) => x.id === id);
    if (!c) throw new Error("Claim not found");
    c.status = status;
    db().tasks.forEach((t) => {
      if (t.claim_id === id || (t.kind === "paid_claim" && t.invoice_id === c.invoice_id)) t.status = "done";
    });
    return status;
  },
  /** Demo stand-in for the AI: a few keywords, then the same actions as the database. */
  logReply(invoiceId: string, channel: "email" | "whatsapp", text: string) {
    const inv = demoDb.getInvoices().find((i) => i.id === invoiceId);
    if (!inv) throw new Error("Invoice not found");
    const t = text.toLowerCase();
    const intent: ReplyIntentName = /paid|transferred|sent the money|دفعت|حولت/.test(t)
      ? "already_paid"
      : /will pay|pay on|pay by|tomorrow|thursday|sunday|سأدفع|بكرة/.test(t)
        ? "promise_to_pay"
        : /wrong|not ordered|didn't receive|خطأ/.test(t)
          ? "dispute"
          : /copy|resend|send the invoice|نسخة/.test(t)
            ? "request_invoice_copy"
            : "other";
    const promiseDate = intent === "promise_to_pay" ? addDaysIso(today(), 2) : null;
    const confidence = intent === "other" ? 0.4 : 0.86;
    const summaries: Record<ReplyIntentName, string> = {
      already_paid: "Says it is already paid",
      promise_to_pay: "Promises to pay in two days",
      dispute: "Disputes the invoice",
      request_invoice_copy: "Asks for a copy",
      request_extension: "Asks for more time",
      wrong_contact: "Wrong contact",
      other: "Unclear reply",
    };
    const summary = summaries[intent];
    const language: "en" | "ar" = /[؀-ۿ]/.test(text) ? "ar" : "en";
    const base = {
      invoice_id: inv.id,
      customer_id: inv.customer_id,
      step_id: null,
      channel,
      local_date: today(),
      sent_on: null,
      auto_send: false,
      manual: false,
      language,
      subject: null,
      wa_template: null,
      wa_variables: null,
      error: null,
      kind: "reply" as const,
    };
    const inbound = this.addMessage({
      ...base,
      step_key: null,
      direction: "in",
      status: "received",
      body: text,
      to_address: null,
      provider: "manual",
      sent_at: now(),
      intent,
      intent_confidence: confidence,
      intent_summary: summary,
      intent_promise_date: promiseDate,
      intent_status: intent === "other" ? "needs_you" : "applied",
    });
    const name = inv.customer?.name ?? "Customer";
    const task = (kind: CollectTask["kind"], title: string, note: string, claimId?: string) =>
      db().tasks.push({
        id: nextId("task"),
        organization_id: ORG,
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        kind,
        status: "open",
        title,
        note,
        due_date: today(),
        created_at: now(),
        message_id: inbound.id,
        claim_id: claimId ?? null,
      });
    if (intent === "other") {
      task("other", `${name} replied`, text.slice(0, 300));
      return { action: "needs_you", intent, confidence, summary, promiseDate, answer: null };
    }
    if (intent === "promise_to_pay" && promiseDate) this.addPromise(inv.id, inv.customer_id, promiseDate);
    if (intent === "dispute") this.openDispute(inv.id, inv.customer_id, summary);
    if (intent === "already_paid") {
      const claimId = nextId("claim");
      db().claims.push({
        id: claimId,
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        source: "reply",
        note: text.slice(0, 500),
        file_path: null,
        file_type: null,
        status: "pending",
        created_at: now(),
      });
      task("paid_claim", `${name} says ${inv.invoice_number} is paid`, summary, claimId);
    }
    const step = intent === "already_paid" ? "ask_proof" : intent === "promise_to_pay" ? "promise_ack" : intent === "request_invoice_copy" ? "invoice_copy" : null;
    if (!step) return { action: intent, intent, confidence, summary, promiseDate, answer: null };
    const company = demoDb.getCompany();
    const vars = {
      customer: name,
      business: company.brand_name || company.company_name || "Demo Trading LLC",
      invoiceNumber: inv.invoice_number,
      amount: Number(inv.grand_total) - Number(inv.amount_paid ?? 0),
      currency: inv.currency || "AED",
      dueDate: inv.due_date ?? addDaysIso(inv.invoice_date, 30),
      invoiceUrl: "https://example.com/i/demo",
      payUrl: "https://example.com/pay/demo",
      optOutUrl: "https://example.com/u/demo",
      promiseDate,
    };
    const to = channel === "email" ? inv.customer?.email || "accounts@example.com" : inv.customer?.phone || "+971500000000";
    const body = channel === "email" ? renderEmail(step, language, 30, vars).text : renderWhatsApp(step, language, vars).text;
    const answer = this.addMessage({
      ...base,
      step_key: step,
      direction: "out",
      status: "awaiting_approval",
      body,
      to_address: to,
      provider: null,
      sent_at: null,
      reply_to_id: inbound.id,
    });
    return {
      action: intent,
      intent,
      confidence,
      summary,
      promiseDate,
      answer: { id: answer.id, channel, status: answer.status, to, subject: null, body, link: channel === "whatsapp" ? oneTapLink(to, body) : null },
    };
  },
};
