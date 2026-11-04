/**
 * Kayyro Collect message templates (fixed wording, no AI).
 *
 * The wording is fixed per step, language and tone. Everything factual -
 * customer, business, invoice number, amount, currency, due date and links -
 * is inserted by code from the invoice, never written by hand or by AI.
 *
 * Rules every template follows: sent in the business's own name, always
 * polite, no threats, no legal wording, no fake urgency, and an opt-out.
 */
import { currencyDecimals } from "@/lib/utils";

/** Reminders sent on the schedule ("promise_day" on the day a customer promised to pay). */
export type ReminderStepKey = "before_due" | "due_today" | "polite" | "firm" | "final" | "promise_day";
/** Answers to a customer's reply. On WhatsApp these go out inside the 24-hour reply window, so they need no template. */
export type ReplyStepKey = "ask_proof" | "promise_ack" | "invoice_copy";
export type CollectStepKey = ReminderStepKey | ReplyStepKey;
export type CollectLang = "en" | "ar";
export type ToneBand = "friendly" | "balanced" | "firm";

export const MESSAGE_STEPS: ReminderStepKey[] = ["before_due", "due_today", "polite", "firm", "final", "promise_day"];
export const REPLY_STEPS: ReplyStepKey[] = ["ask_proof", "promise_ack", "invoice_copy"];

export function isReplyStep(step: string | null | undefined): step is ReplyStepKey {
  return REPLY_STEPS.includes(step as ReplyStepKey);
}

export type CollectVars = {
  customer: string;
  business: string;
  invoiceNumber: string;
  /** e.g. 1,234.50 */
  amount: number;
  currency: string;
  /** ISO date YYYY-MM-DD */
  dueDate: string;
  invoiceUrl: string;
  payUrl: string | null;
  optOutUrl: string;
  /** ISO date the customer promised to pay (answers to a promise) */
  promiseDate?: string | null;
};

/** The Friendly ↔ Firm slider (0-100) in three bands. */
export function toneBand(tone: number): ToneBand {
  if (tone < 34) return "friendly";
  if (tone > 66) return "firm";
  return "balanced";
}

export function formatAmount(amount: number, currency: string): string {
  const d = currencyDecimals(currency);
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function formatDueDate(iso: string, lang: CollectLang): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const locale = lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

type Filled = {
  customer: string;
  business: string;
  number: string;
  amount: string;
  due: string;
  invoiceUrl: string;
  payUrl: string;
  optOutUrl: string;
  promise: string;
};

function fill(vars: CollectVars, lang: CollectLang): Filled {
  return {
    customer: vars.customer.trim() || (lang === "ar" ? "عميلنا العزيز" : "there"),
    business: vars.business.trim(),
    number: vars.invoiceNumber,
    amount: formatAmount(vars.amount, vars.currency),
    due: formatDueDate(vars.dueDate, lang),
    invoiceUrl: vars.invoiceUrl,
    payUrl: vars.payUrl || vars.invoiceUrl,
    optOutUrl: vars.optOutUrl,
    promise: vars.promiseDate ? formatDueDate(vars.promiseDate, lang) : "",
  };
}

// ---------- WhatsApp (pre-approved templates, one per step and language) ----------
// Variables, in order: {{1}} customer, {{2}} business, {{3}} invoice number,
// {{4}} amount with currency, {{5}} due date, {{6}} invoice (PDF) link,
// {{7}} payment link, {{8}} opt-out link.

type WaTemplate = { name: string; language: CollectLang; step: CollectStepKey; body: string };

const WA: Record<ReminderStepKey, Record<CollectLang, string>> = {
  promise_day: {
    en: "Hello {{1}}, this is {{2}}. Thank you for letting us know you would pay invoice {{3}} for {{4}} (due on {{5}}) today. Here are the details, in case they help.\nInvoice: {{6}}\nPay here: {{7}}\nIf you have already paid, thank you, and please ignore this message.\nTo stop these reminders: {{8}}",
    ar: "مرحباً {{1}}، معكم {{2}}. شكراً لإبلاغنا بأنكم ستدفعون الفاتورة رقم {{3}} بمبلغ {{4}} (المستحقة بتاريخ {{5}}) اليوم. إليكم التفاصيل للتسهيل.\nالفاتورة: {{6}}\nللدفع: {{7}}\nإذا كنتم قد دفعتم بالفعل، فشكراً لكم ويرجى تجاهل هذه الرسالة.\nلإيقاف هذه التذكيرات: {{8}}",
  },
  before_due: {
    en: "Hello {{1}}, this is {{2}}. A friendly heads-up: invoice {{3}} for {{4}} is due on {{5}}.\nInvoice: {{6}}\nPay here: {{7}}\nThank you for your business.\nTo stop these reminders: {{8}}",
    ar: "مرحباً {{1}}، معكم {{2}}. تذكير ودّي: الفاتورة رقم {{3}} بمبلغ {{4}} مستحقة بتاريخ {{5}}.\nالفاتورة: {{6}}\nللدفع: {{7}}\nشكراً لتعاملكم معنا.\nلإيقاف هذه التذكيرات: {{8}}",
  },
  due_today: {
    en: "Hello {{1}}, this is {{2}}. Invoice {{3}} for {{4}} is due today ({{5}}).\nInvoice: {{6}}\nPay here: {{7}}\nIf you have already paid, please ignore this message. Thank you.\nTo stop these reminders: {{8}}",
    ar: "مرحباً {{1}}، معكم {{2}}. الفاتورة رقم {{3}} بمبلغ {{4}} مستحقة اليوم ({{5}}).\nالفاتورة: {{6}}\nللدفع: {{7}}\nإذا كنتم قد دفعتم بالفعل، يرجى تجاهل هذه الرسالة. شكراً لكم.\nلإيقاف هذه التذكيرات: {{8}}",
  },
  polite: {
    en: "Hello {{1}}, this is {{2}}. A gentle reminder that invoice {{3}} for {{4}} was due on {{5}} and is still open.\nInvoice: {{6}}\nPay here: {{7}}\nIf you have already paid, thank you, and please ignore this message.\nTo stop these reminders: {{8}}",
    ar: "مرحباً {{1}}، معكم {{2}}. نود تذكيركم بلطف بأن الفاتورة رقم {{3}} بمبلغ {{4}} كانت مستحقة بتاريخ {{5}} وما زالت مفتوحة.\nالفاتورة: {{6}}\nللدفع: {{7}}\nإذا كنتم قد دفعتم بالفعل، فشكراً لكم ويرجى تجاهل هذه الرسالة.\nلإيقاف هذه التذكيرات: {{8}}",
  },
  firm: {
    en: "Hello {{1}}, this is {{2}}. Invoice {{3}} for {{4}} was due on {{5}} and we haven't received payment yet. Could you please arrange payment, or let us know when to expect it?\nInvoice: {{6}}\nPay here: {{7}}\nTo stop these reminders: {{8}}",
    ar: "مرحباً {{1}}، معكم {{2}}. الفاتورة رقم {{3}} بمبلغ {{4}} كانت مستحقة بتاريخ {{5}} ولم نستلم الدفعة بعد. هل يمكنكم ترتيب الدفع، أو إخبارنا بموعد الدفع المتوقع؟\nالفاتورة: {{6}}\nللدفع: {{7}}\nلإيقاف هذه التذكيرات: {{8}}",
  },
  final: {
    en: "Hello {{1}}, this is {{2}}. This is our last reminder for invoice {{3}} for {{4}}, due on {{5}}. Please arrange payment or reply to this message so we can help.\nInvoice: {{6}}\nPay here: {{7}}\nTo stop these reminders: {{8}}",
    ar: "مرحباً {{1}}، معكم {{2}}. هذا آخر تذكير منا بخصوص الفاتورة رقم {{3}} بمبلغ {{4}} المستحقة بتاريخ {{5}}. يرجى ترتيب الدفع أو الرد على هذه الرسالة لنتمكن من مساعدتكم.\nالفاتورة: {{6}}\nللدفع: {{7}}\nلإيقاف هذه التذكيرات: {{8}}",
  },
};

/** The template set to submit to Meta (through 360dialog), category UTILITY. */
export const WHATSAPP_TEMPLATES: WaTemplate[] = MESSAGE_STEPS.flatMap((step) =>
  (["en", "ar"] as const).map((language) => ({
    name: `kayyro_reminder_${step}`,
    language,
    step,
    body: WA[step][language],
  }))
);

export function whatsappTemplateName(step: ReminderStepKey): string {
  return `kayyro_reminder_${step}`;
}

export function whatsappParams(vars: CollectVars, lang: CollectLang): string[] {
  const f = fill(vars, lang);
  return [f.customer, f.business, f.number, f.amount, f.due, f.invoiceUrl, f.payUrl, f.optOutUrl];
}

const WA_REPLY: Record<ReplyStepKey, Record<CollectLang, string>> = {
  ask_proof: {
    en: "Thank you, {customer}. To update our records for invoice {number}, could you share the payment receipt or transfer reference? You can upload it here: {payUrl}\n{business}",
    ar: "شكراً لكم {customer}. لتحديث سجلاتنا للفاتورة رقم {number}، هل يمكنكم مشاركة إيصال الدفع أو مرجع التحويل؟ يمكنكم رفعه هنا: {payUrl}\n{business}",
  },
  promise_ack: {
    en: "Thank you, {customer}. Noted for {promise} for invoice {number} ({amount}). Pay here when ready: {payUrl}\n{business}",
    ar: "شكراً لكم {customer}. تم تسجيل موعد الدفع {promise} للفاتورة رقم {number} ({amount}). للدفع عند الجاهزية: {payUrl}\n{business}",
  },
  invoice_copy: {
    en: "Of course, {customer}. Here is invoice {number} for {amount}, due on {due}: {invoiceUrl}\nPay here: {payUrl}\n{business}",
    ar: "بكل سرور {customer}. هذه الفاتورة رقم {number} بمبلغ {amount} المستحقة بتاريخ {due}: {invoiceUrl}\nللدفع: {payUrl}\n{business}",
  },
};

/**
 * The WhatsApp text with its variables filled in. Reminders use an approved
 * template (sent by hand, or by the API with `template` and `params`);
 * answers to a reply are plain text (`template` is null).
 */
export function renderWhatsApp(step: CollectStepKey, lang: CollectLang, vars: CollectVars) {
  if (isReplyStep(step)) {
    return { text: put(WA_REPLY[step][lang], fill(vars, lang)), template: null, params: [] as string[] };
  }
  const params = whatsappParams(vars, lang);
  const text = WA[step][lang].replace(/\{\{(\d)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
  return { text, template: whatsappTemplateName(step), params };
}

// ---------- Email (fixed wording per step, tone and language) ----------

type EmailCopy = { subject: string; opening: Record<ToneBand, string> };

const same = (text: string): Record<ToneBand, string> => ({ friendly: text, balanced: text, firm: text });

const EMAIL: Record<CollectStepKey, Record<CollectLang, EmailCopy>> = {
  promise_day: {
    en: {
      subject: "Invoice {number}: today is the day you planned to pay",
      opening: same("Thank you for letting us know you would pay invoice {number} for {amount} today. Here are the details, in case they help. If you have already paid, thank you, and please ignore this email."),
    },
    ar: {
      subject: "الفاتورة {number}: اليوم موعد الدفع الذي حددتموه",
      opening: same("شكراً لإبلاغنا بأنكم ستدفعون الفاتورة رقم {number} بمبلغ {amount} اليوم. إليكم التفاصيل للتسهيل. إذا كنتم قد دفعتم بالفعل، فشكراً لكم ويرجى تجاهل هذه الرسالة."),
    },
  },
  ask_proof: {
    en: {
      subject: "Re: invoice {number}",
      opening: same("Thank you for letting us know. To update our records for invoice {number}, could you share the payment receipt or the transfer reference? You can upload it on the payment page below."),
    },
    ar: {
      subject: "رد: الفاتورة {number}",
      opening: same("شكراً لإبلاغنا. لتحديث سجلاتنا للفاتورة رقم {number}، هل يمكنكم مشاركة إيصال الدفع أو مرجع التحويل؟ يمكنكم رفعه من صفحة الدفع أدناه."),
    },
  },
  promise_ack: {
    en: {
      subject: "Re: invoice {number}",
      opening: same("Thank you for letting us know. We have noted {promise} for invoice {number} ({amount})."),
    },
    ar: {
      subject: "رد: الفاتورة {number}",
      opening: same("شكراً لإبلاغنا. تم تسجيل موعد الدفع {promise} للفاتورة رقم {number} ({amount})."),
    },
  },
  invoice_copy: {
    en: {
      subject: "Invoice {number}",
      opening: same("As requested, here is invoice {number} for {amount}, due on {due}."),
    },
    ar: {
      subject: "الفاتورة {number}",
      opening: same("كما طلبتم، هذه الفاتورة رقم {number} بمبلغ {amount} المستحقة بتاريخ {due}."),
    },
  },
  before_due: {
    en: {
      subject: "Invoice {number} is due on {due}",
      opening: {
        friendly: "Just a friendly heads-up that invoice {number} for {amount} is due on {due}. Thank you for your business!",
        balanced: "This is a reminder that invoice {number} for {amount} is due on {due}.",
        firm: "Please note that invoice {number} for {amount} is due on {due}. Kindly arrange payment by then.",
      },
    },
    ar: {
      subject: "الفاتورة {number} مستحقة بتاريخ {due}",
      opening: {
        friendly: "تذكير ودّي بأن الفاتورة رقم {number} بمبلغ {amount} مستحقة بتاريخ {due}. شكراً لتعاملكم معنا!",
        balanced: "نود تذكيركم بأن الفاتورة رقم {number} بمبلغ {amount} مستحقة بتاريخ {due}.",
        firm: "يرجى العلم بأن الفاتورة رقم {number} بمبلغ {amount} مستحقة بتاريخ {due}. نرجو ترتيب الدفع قبل هذا الموعد.",
      },
    },
  },
  due_today: {
    en: {
      subject: "Invoice {number} is due today",
      opening: {
        friendly: "Invoice {number} for {amount} is due today. If you've already paid, thank you - please ignore this email.",
        balanced: "Invoice {number} for {amount} is due today, {due}. If you have already paid, please ignore this email.",
        firm: "Invoice {number} for {amount} is due today, {due}. Please arrange payment today.",
      },
    },
    ar: {
      subject: "الفاتورة {number} مستحقة اليوم",
      opening: {
        friendly: "الفاتورة رقم {number} بمبلغ {amount} مستحقة اليوم. إذا كنتم قد دفعتم بالفعل، فشكراً لكم ويرجى تجاهل هذه الرسالة.",
        balanced: "الفاتورة رقم {number} بمبلغ {amount} مستحقة اليوم، {due}. إذا كنتم قد دفعتم بالفعل، يرجى تجاهل هذه الرسالة.",
        firm: "الفاتورة رقم {number} بمبلغ {amount} مستحقة اليوم، {due}. نرجو ترتيب الدفع اليوم.",
      },
    },
  },
  polite: {
    en: {
      subject: "Reminder: invoice {number}",
      opening: {
        friendly: "A gentle reminder that invoice {number} for {amount} was due on {due}. It may simply have slipped through - no worries.",
        balanced: "A reminder that invoice {number} for {amount} was due on {due} and is still open.",
        firm: "Invoice {number} for {amount} was due on {due} and is still unpaid. Please arrange payment at your earliest convenience.",
      },
    },
    ar: {
      subject: "تذكير: الفاتورة {number}",
      opening: {
        friendly: "تذكير لطيف بأن الفاتورة رقم {number} بمبلغ {amount} كانت مستحقة بتاريخ {due}. ربما فاتتكم، لا بأس.",
        balanced: "نذكّركم بأن الفاتورة رقم {number} بمبلغ {amount} كانت مستحقة بتاريخ {due} وما زالت مفتوحة.",
        firm: "الفاتورة رقم {number} بمبلغ {amount} كانت مستحقة بتاريخ {due} وما زالت غير مدفوعة. نرجو ترتيب الدفع في أقرب وقت ممكن.",
      },
    },
  },
  firm: {
    en: {
      subject: "Invoice {number} is overdue",
      opening: {
        friendly: "We noticed invoice {number} for {amount}, due on {due}, is still open. Could you let us know when we can expect payment?",
        balanced: "Invoice {number} for {amount} was due on {due} and we haven't received payment yet. Could you please arrange payment, or let us know when to expect it?",
        firm: "Invoice {number} for {amount} was due on {due} and remains unpaid. Please arrange payment now, or reply with the date you will pay.",
      },
    },
    ar: {
      subject: "الفاتورة {number} متأخرة",
      opening: {
        friendly: "لاحظنا أن الفاتورة رقم {number} بمبلغ {amount} المستحقة بتاريخ {due} ما زالت مفتوحة. هل يمكنكم إخبارنا بموعد الدفع المتوقع؟",
        balanced: "الفاتورة رقم {number} بمبلغ {amount} كانت مستحقة بتاريخ {due} ولم نستلم الدفعة بعد. هل يمكنكم ترتيب الدفع، أو إخبارنا بموعده المتوقع؟",
        firm: "الفاتورة رقم {number} بمبلغ {amount} كانت مستحقة بتاريخ {due} وما زالت غير مدفوعة. نرجو ترتيب الدفع الآن، أو الرد بتاريخ الدفع.",
      },
    },
  },
  final: {
    en: {
      subject: "Last reminder: invoice {number}",
      opening: {
        friendly: "This is our last reminder about invoice {number} for {amount}, due on {due}. If something is holding it up, just reply and we'll help.",
        balanced: "This is our last reminder about invoice {number} for {amount}, due on {due}. Please arrange payment, or reply so we can sort it out together.",
        firm: "This is our last reminder about invoice {number} for {amount}, due on {due}. Please arrange payment now, or reply to discuss it with us.",
      },
    },
    ar: {
      subject: "التذكير الأخير: الفاتورة {number}",
      opening: {
        friendly: "هذا آخر تذكير منا بخصوص الفاتورة رقم {number} بمبلغ {amount} المستحقة بتاريخ {due}. إذا كان هناك ما يؤخرها، فقط ردّوا علينا وسنساعدكم.",
        balanced: "هذا آخر تذكير منا بخصوص الفاتورة رقم {number} بمبلغ {amount} المستحقة بتاريخ {due}. يرجى ترتيب الدفع، أو الرد علينا لنجد حلاً معاً.",
        firm: "هذا آخر تذكير منا بخصوص الفاتورة رقم {number} بمبلغ {amount} المستحقة بتاريخ {due}. يرجى ترتيب الدفع الآن، أو الرد لمناقشة الأمر معنا.",
      },
    },
  },
};

const EMAIL_FRAME: Record<CollectLang, { greeting: string; invoice: string; pay: string; thanks: string; optOut: string }> = {
  en: {
    greeting: "Dear {customer},",
    invoice: "View the invoice: {invoiceUrl}",
    pay: "Pay online, or tell us you've paid: {payUrl}",
    thanks: "Thank you,\n{business}",
    optOut: "Don't want these reminders? {optOutUrl}",
  },
  ar: {
    greeting: "عزيزنا {customer}،",
    invoice: "عرض الفاتورة: {invoiceUrl}",
    pay: "للدفع عبر الإنترنت أو إبلاغنا بأنكم دفعتم: {payUrl}",
    thanks: "مع الشكر،\n{business}",
    optOut: "لا تريدون هذه التذكيرات؟ {optOutUrl}",
  },
};

function put(template: string, f: Filled): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in f ? f[key as keyof Filled] : `{${key}}`));
}

export function renderEmail(step: CollectStepKey, lang: CollectLang, tone: number, vars: CollectVars) {
  const f = fill(vars, lang);
  const copy = EMAIL[step][lang];
  const frame = EMAIL_FRAME[lang];
  const lines = [
    put(frame.greeting, f),
    "",
    put(copy.opening[toneBand(tone)], f),
    "",
    put(frame.invoice, f),
  ];
  if (vars.payUrl) lines.push(put(frame.pay, f));
  lines.push("", put(frame.thanks, f), "", put(frame.optOut, f));
  return { subject: `${put(copy.subject, f)} · ${f.business}`, text: lines.join("\n") };
}

/** Words a reminder must never contain (checked in tests and before any AI wording is used). */
export const FORBIDDEN_WORDS = [
  /\blegal\b/i, /\bcourt\b/i, /\blawyer/i, /\blawsuit/i, /\bpolice\b/i, /\bdebt collect/i, /\bcollection agency/i,
  /\bblacklist/i, /\bpenalt/i, /\bimmediately\b/i, /\burgent/i, /\bconsequences?\b/i,
  /محكمة/, /محامي/, /قانوني/, /شرطة/, /عقوبة/, /فوراً/, /عاجل/,
];

export function containsForbiddenWording(text: string): boolean {
  return FORBIDDEN_WORDS.some((re) => re.test(text));
}
