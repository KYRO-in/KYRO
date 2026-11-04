import {
  MESSAGE_STEPS,
  WHATSAPP_TEMPLATES,
  containsForbiddenWording,
  renderEmail,
  renderWhatsApp,
  type CollectVars,
} from "./templates";
import { addDaysIso, balanceDue, collectStatus, getPaidSummary, type CollectInvoice } from "./status";
import { oneTapLink } from "./whatsapp";
import { collectEmailHtml } from "./email-html";

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

const vars: CollectVars = {
  customer: "Ahmed",
  business: "Al Noor Trading",
  invoiceNumber: "INV-1042",
  amount: 3150,
  currency: "AED",
  dueDate: "2026-11-03",
  invoiceUrl: "https://kayyro.com/i/7KQ2XA",
  payUrl: "https://pay.example.com/alnoor",
  optOutUrl: "https://kayyro.com/u/abc",
};

// ---------- Templates: the facts always come from code ----------
for (const step of MESSAGE_STEPS) {
  for (const lang of ["en", "ar"] as const) {
    for (const tone of [0, 50, 100]) {
      const e = renderEmail(step, lang, tone, vars);
      const all = `${e.subject}\n${e.text}`;
      check(
        all.includes("INV-1042") && all.includes("AED 3,150.00") && all.includes(vars.invoiceUrl) && all.includes(vars.payUrl!) && all.includes(vars.optOutUrl),
        `email ${step}/${lang}/tone ${tone}: number, amount, links and opt-out are inserted`
      );
      check(!containsForbiddenWording(all), `email ${step}/${lang}/tone ${tone}: no threats, legal wording or fake urgency`);
      check(!/\{\{|\{[a-z]+\}/.test(all), `email ${step}/${lang}/tone ${tone}: no placeholder left unfilled`);
    }
    const w = renderWhatsApp(step, lang, vars);
    check(w.params.length === 8 && w.params[2] === "INV-1042" && w.params[3] === "AED 3,150.00", `WhatsApp ${step}/${lang}: 8 template variables in order`);
    check(w.text.includes(vars.optOutUrl) && !/\{\{\d\}\}/.test(w.text), `WhatsApp ${step}/${lang}: filled in, with the opt-out link`);
    check(!containsForbiddenWording(w.text), `WhatsApp ${step}/${lang}: polite wording`);
  }
}
check(WHATSAPP_TEMPLATES.length === MESSAGE_STEPS.length * 2, "one WhatsApp template per step in English and Arabic");
check(
  WHATSAPP_TEMPLATES.every((t) => /^[a-z0-9_]+$/.test(t.name) && (t.body.match(/\{\{\d\}\}/g) ?? []).length === 8),
  "WhatsApp template names are Meta-safe and every template uses all 8 variables"
);
const ar = renderEmail("polite", "ar", 30, vars);
check(/[؀-ۿ]/.test(ar.text) && ar.text.includes("3,150.00"), "Arabic email is in Arabic, with Western digits for the amount");
check(renderEmail("polite", "en", 30, { ...vars, payUrl: null }).text.includes(vars.invoiceUrl), "without a payment link the invoice link is still there");
const kwd = renderWhatsApp("due_today", "en", { ...vars, currency: "KWD", amount: 12.5 });
check(kwd.params[3] === "KWD 12.500", "Kuwaiti dinar amounts keep 3 decimals");
check(containsForbiddenWording("Pay immediately or we will take legal action"), "the politeness check catches threats");
check(containsForbiddenWording("سنلجأ إلى المحكمة"), "the politeness check catches Arabic threats");

// ---------- Email HTML ----------
const html = collectEmailHtml({ text: "Hello <b>Ahmed</b>\n\nhttps://kayyro.com/i/X", business: "Al Noor & Sons", lang: "ar" });
check(html.includes('dir="rtl"') && html.includes("&lt;b&gt;") && html.includes("Al Noor &amp; Sons"), "email HTML is right-to-left for Arabic and escapes text");
check(html.includes('<a href="https://kayyro.com/i/X"'), "links in the email are clickable");

// ---------- One-tap WhatsApp ----------
const link = oneTapLink("+971 50 123 4567", "Hello");
check(!!link && link.includes("971501234567") && link.includes("text=Hello"), "one-tap link opens the customer's chat with the text");
check(oneTapLink(null, "Hello") === null, "no phone, no link");

// ---------- Statuses and the Get Paid numbers ----------
const inv = (id: string, due: string, total: number, paid = 0, status = "issued"): CollectInvoice => ({
  id,
  customer_id: "c1",
  status,
  grand_total: total,
  amount_paid: paid,
  due_date: due,
  invoice_date: addDaysIso(due, -30),
});
const today = "2026-11-10";
const none = { disputed: new Set<string>(), promises: new Map<string, string>() };
check(collectStatus(inv("a", "2026-11-12", 100), today, none) === "upcoming", "status: upcoming before the due date");
check(collectStatus(inv("a", today, 100), today, none) === "due", "status: due on the due date");
check(collectStatus(inv("a", "2026-11-01", 100), today, none) === "overdue", "status: overdue after it");
check(collectStatus(inv("a", "2026-11-01", 100, 100, "paid"), today, none) === "paid", "status: paid");
check(collectStatus(inv("a", "2026-11-01", 100), today, { ...none, disputed: new Set(["a"]) }) === "disputed", "status: disputed wins over overdue");
check(collectStatus(inv("a", "2026-11-01", 100), today, { ...none, promises: new Map([["a", "2026-11-12"]]) }) === "promised", "status: promised until the promised day");
check(collectStatus(inv("a", "2026-11-01", 100), today, { ...none, promises: new Map([["a", "2026-11-08"]]) }) === "overdue", "status: a broken promise is overdue again");
check(balanceDue({ ...inv("a", today, 100, 30), credited: 20 }) === 50, "balance takes off payments and credit notes");
check(collectStatus({ ...inv("a", "2026-11-01", 100, 50), credited: 50 }, today, none) === "paid", "fully credited counts as paid");

const s = getPaidSummary({
  invoices: [inv("a", "2026-11-01", 100), inv("b", "2026-11-12", 200), inv("c", "2026-11-30", 50), inv("d", "2026-11-11", 80)],
  ctx: { disputed: new Set(["d"]), promises: new Map([["a", "2026-11-13"]]) },
  today,
  currency: "AED",
  payments: [
    { invoice_id: "x", amount: 40, payment_date: "2026-11-05" },
    { invoice_id: "y", amount: 60, payment_date: "2026-11-09" },
    { invoice_id: "z", amount: 70, payment_date: "2026-10-30" },
  ],
  remindersSent: [
    { invoice_id: "x", sent_at: "2026-11-01T06:00:00Z" },
    { invoice_id: "y", sent_at: "2026-10-20T06:00:00Z" },
    { invoice_id: "z", sent_at: "2026-10-29T06:00:00Z" },
  ],
});
check(s.unpaid === 430, `unpaid adds every open balance (${s.unpaid})`);
check(s.overdue === 0, `overdue leaves out promised and disputed invoices (${s.overdue})`);
check(s.expectedThisWeek === 300, `expected this week: due or promised in the next 7 days, not disputed (${s.expectedThisWeek})`);
check(s.collectedByCollect === 40, `collected by Collect: paid this month within 7 days of a reminder (${s.collectedByCollect})`);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall Kayyro Collect checks passed");
