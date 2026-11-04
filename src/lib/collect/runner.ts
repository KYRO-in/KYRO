/**
 * Kayyro Collect engine (server only, service role).
 *
 *   plan    collect_plan() picks the reminders due today (database rules)
 *   read    the AI sorts customers' replies; collect_apply_intent() acts on them
 *   word    fixed templates are filled in from the invoice (code, not AI)
 *   send    collect_claim() -> email / WhatsApp -> collect_finish()
 *   tell    the owner's daily summary, once a day (Business plan)
 *
 * The database re-checks every invoice when a message is claimed, so a
 * reminder is never sent for a paid, cancelled, credited or disputed invoice,
 * outside sending hours, twice in a day, or twice at all.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail as defaultSendEmail, type OutgoingEmail } from "@/lib/email/send";
import { getAppBaseUrl } from "@/lib/invoice-short-link";
import { collectEmailHtml } from "@/lib/collect/email-html";
import {
  containsForbiddenWording,
  formatAmount,
  renderEmail,
  renderWhatsApp,
  type CollectLang,
  type CollectStepKey,
  type CollectVars,
} from "@/lib/collect/templates";
import { Dialog360Sender, type WhatsAppSender } from "@/lib/collect/whatsapp";
import { replyAddress } from "@/lib/collect/inbound";
import { buildClassifyMessages, parseClassification, UNSURE, type Classification } from "@/lib/collect/classify";

import { aiConfigured, chatJson } from "@/lib/ai/provider";
import { rateLimit } from "@/lib/security/rate-limit";
import { sendDueSummaries } from "@/lib/collect/summary";

export type CollectDeps = {
  admin: SupabaseClient;
  now?: Date;
  baseUrl?: string;
  pdfLink?: (invoiceId: string) => Promise<string>;
  sendEmail?: (email: OutgoingEmail) => Promise<{ id: string | null }>;
  whatsappFor?: (organizationId: string) => Promise<WhatsAppSender | null>;
};

export type CollectReport = {
  planned: number;
  classified: number;
  summaries: number;
  worded: number;
  sent: number;
  failed: number;
  held: number;
  errors: string[];
};

type MessageRow = {
  id: string;
  organization_id: string;
  invoice_id: string;
  customer_id: string;
  step_key: CollectStepKey;
  channel: "email" | "whatsapp";
  language: CollectLang;
  subject: string | null;
  body: string | null;
  to_address: string | null;
  wa_template: string | null;
  wa_variables: string[] | null;
  kind?: "reminder" | "reply";
  reply_to_id?: string | null;
  claim_token?: string;
};

export function optOutPageUrl(base: string, token: string) {
  return `${base}/u/${token}`;
}

export function payPageUrl(base: string, token: string) {
  return `${base}/pay/${token}`;
}

export function optOutPostUrl(base: string, token: string) {
  return `${base}/api/collect/opt-out?t=${encodeURIComponent(token)}`;
}

async function defaultPdfLink(admin: SupabaseClient, invoiceId: string) {
  const { ensureInvoicePdfLink } = await import("@/lib/collect/invoice-pdf-server");
  return ensureInvoicePdfLink(admin, invoiceId);
}

async function defaultWhatsappFor(admin: SupabaseClient, organizationId: string): Promise<WhatsAppSender | null> {
  const { data } = await admin
    .from("collect_channel_accounts")
    .select("api_key, active")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data?.active && data.api_key ? new Dialog360Sender(String(data.api_key)) : null;
}

/** Everything a template needs, read from the database (amount = what is still owed). */
async function varsFor(deps: CollectDeps, m: MessageRow, base: string, pdfCache: Map<string, string>): Promise<CollectVars> {
  const { admin } = deps;
  const [{ data: inv }, { data: cust }, { data: org }, { data: balance }] = await Promise.all([
    admin.from("invoices").select("invoice_number, currency, due_date, invoice_date, collect_pay_token").eq("id", m.invoice_id).single(),
    admin.from("customers").select("name, collect_token").eq("id", m.customer_id).single(),
    admin.from("organizations").select("name, brand_name").eq("id", m.organization_id).single(),
    admin.rpc("collect_invoice_balance", { p_invoice: m.invoice_id }),
  ]);
  if (!inv || !cust || !org) throw new Error("Invoice, customer or business not found");
  let invoiceUrl = pdfCache.get(m.invoice_id);
  if (!invoiceUrl) {
    invoiceUrl = await (deps.pdfLink ? deps.pdfLink(m.invoice_id) : defaultPdfLink(admin, m.invoice_id));
    pdfCache.set(m.invoice_id, invoiceUrl);
  }
  // Every reminder links to the invoice's Kayyro payment page ("Pay now" and "I already paid")
  const payUrl = payPageUrl(base, String(inv.collect_pay_token));
  // An answer to a promise repeats the promised date
  let promiseDate: string | null = null;
  if (m.kind === "reply" && m.reply_to_id) {
    const { data: inbound } = await admin.from("collection_messages").select("intent_promise_date").eq("id", m.reply_to_id).maybeSingle();
    promiseDate = (inbound?.intent_promise_date as string | null) ?? null;
  }
  return {
    promiseDate,
    customer: String(cust.name ?? ""),
    business: String(org.brand_name || org.name || ""),
    invoiceNumber: String(inv.invoice_number),
    amount: Number(balance ?? 0),
    currency: String(inv.currency || "AED"),
    dueDate: String(inv.due_date ?? inv.invoice_date),
    invoiceUrl,
    payUrl,
    optOutUrl: optOutPageUrl(base, String(cust.collect_token)),
  };
}

/** Write the wording of one planned message (fixed templates, code-inserted facts), then queue it. */
async function wordOne(
  deps: CollectDeps,
  m: MessageRow,
  base: string,
  pdfCache: Map<string, string>,
  tones: Map<string, number>
): Promise<{ subject: string | null; body: string }> {
  const { admin } = deps;
  if (!tones.has(m.organization_id)) {
    const { data: s } = await admin.from("collect_settings").select("tone").eq("organization_id", m.organization_id).maybeSingle();
    tones.set(m.organization_id, Number(s?.tone ?? 30));
  }
  const vars = await varsFor(deps, m, base, pdfCache);
  let subject: string | null = null;
  let body: string;
  let waTemplate: string | null = null;
  let waParams: string[] | null = null;
  if (m.channel === "email") {
    const e = renderEmail(m.step_key, m.language, tones.get(m.organization_id) ?? 30, vars);
    subject = e.subject;
    body = e.text;
  } else {
    const w = renderWhatsApp(m.step_key, m.language, vars);
    body = w.text;
    waTemplate = w.template;
    waParams = w.params;
  }
  if (containsForbiddenWording(`${subject ?? ""}\n${body}`)) throw new Error("Wording failed the politeness check");
  const { error } = await admin.rpc("collect_set_wording", {
    p_id: m.id,
    p_subject: subject,
    p_body: body,
    p_wa_template: waTemplate,
    p_wa_variables: waParams,
  });
  if (error) throw error;
  return { subject, body };
}

const MESSAGE_COLUMNS = "id, organization_id, invoice_id, customer_id, step_key, channel, language, kind, reply_to_id";

/** Write the wording of every planned message, then queue it (approval or sending). */
export async function wordPending(deps: CollectDeps, report: CollectReport) {
  const { admin } = deps;
  const base = (deps.baseUrl || getAppBaseUrl()).replace(/\/$/, "");
  const { data: rows, error } = await admin
    .from("collection_messages")
    .select(MESSAGE_COLUMNS)
    .eq("status", "pending")
    .eq("direction", "out")
    .order("created_at")
    .limit(200);
  if (error) throw error;
  const pdfCache = new Map<string, string>();
  const tones = new Map<string, number>();
  for (const m of (rows ?? []) as MessageRow[]) {
    try {
      await wordOne(deps, m, base, pdfCache, tones);
      report.worded++;
    } catch (e) {
      const msg = (e as Error).message || "Could not prepare the message";
      report.errors.push(`${m.id}: ${msg}`);
      await admin.from("collection_messages").update({ error: msg.slice(0, 500) }).eq("id", m.id);
    }
  }
}

/** Word a single message now ("Remind now"). Returns the text the owner will send or approve. */
export async function wordMessage(deps: CollectDeps, messageId: string) {
  const { data: m, error } = await deps.admin
    .from("collection_messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", messageId)
    .eq("status", "pending")
    .single();
  if (error || !m) throw new Error("Reminder not found");
  const base = (deps.baseUrl || getAppBaseUrl()).replace(/\/$/, "");
  return wordOne(deps, m as MessageRow, base, new Map(), new Map());
}

/** Claim and send one ready message. Returns what happened. */
export async function dispatchMessage(deps: CollectDeps, messageId: string): Promise<"sent" | "failed" | "held"> {
  const { admin } = deps;
  const now = (deps.now ?? new Date()).toISOString();
  const { data: claimed, error } = await admin.rpc("collect_claim", { p_id: messageId, p_now: now });
  if (error) throw error;
  const m = (Array.isArray(claimed) ? claimed[0] : claimed) as MessageRow | undefined;
  // Not claimable now: outside sending hours, already messaged today, or no longer allowed
  if (!m?.claim_token) return "held";

  const base = (deps.baseUrl || getAppBaseUrl()).replace(/\/$/, "");
  let ok = false;
  let provider: string | null = null;
  let providerId: string | null = null;
  let failure: string | null = null;
  try {
    const [{ data: org }, { data: cust }] = await Promise.all([
      admin.from("organizations").select("name, brand_name, email").eq("id", m.organization_id).single(),
      admin.from("customers").select("collect_token").eq("id", m.customer_id).single(),
    ]);
    const business = String(org?.brand_name || org?.name || "");
    if (m.channel === "email") {
      if (!m.to_address || !m.subject || !m.body) throw new Error("Missing email details");
      const send = deps.sendEmail ?? defaultSendEmail;
      const token = String(cust?.collect_token ?? "");
      const sent = await send({
        fromName: business,
        to: [m.to_address],
        // With receiving set up, replies come to Kayyro (read, then forwarded to the business)
        replyTo: replyAddress(m.id) || (org?.email as string | null) || null,
        subject: m.subject,
        text: m.body,
        html: collectEmailHtml({ text: m.body, business, lang: m.language }),
        headers: token
          ? { "List-Unsubscribe": `<${optOutPostUrl(base, token)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
          : undefined,
      });
      ok = true;
      provider = "resend";
      providerId = sent.id;
    } else {
      const sender = deps.whatsappFor ? await deps.whatsappFor(m.organization_id) : await defaultWhatsappFor(admin, m.organization_id);
      if (!sender) throw new Error("No WhatsApp sender connected");
      let sent: { id: string | null };
      if (m.kind === "reply") {
        // An answer to the customer's message, inside WhatsApp's 24-hour reply window
        if (!m.to_address || !m.body) throw new Error("Missing WhatsApp details");
        sent = await sender.sendText(m.to_address, m.body);
      } else {
        if (!m.to_address || !m.wa_template || !m.wa_variables) throw new Error("Missing WhatsApp details");
        sent = await sender.sendTemplate({
          to: m.to_address,
          template: m.wa_template,
          language: m.language,
          params: m.wa_variables,
        });
      }
      ok = true;
      provider = sender.provider;
      providerId = sent.id;
    }
  } catch (e) {
    failure = (e as Error).message || "Send failed";
  }
  await admin.rpc("collect_finish", {
    p_id: m.id,
    p_token: m.claim_token,
    p_ok: ok,
    p_provider: provider,
    p_provider_message_id: providerId,
    p_error: failure,
  });
  return ok ? "sent" : "failed";
}

export async function dispatchReady(deps: CollectDeps, report: CollectReport) {
  const { data: rows, error } = await deps.admin
    .from("collection_messages")
    .select("id")
    .eq("status", "ready")
    .eq("direction", "out")
    .order("created_at")
    .limit(100);
  if (error) throw error;
  for (const r of rows ?? []) {
    try {
      const result = await dispatchMessage(deps, String(r.id));
      if (result === "sent") report.sent++;
      else if (result === "failed") report.failed++;
      else report.held++;
    } catch (e) {
      report.errors.push(`${r.id}: ${(e as Error).message}`);
    }
  }
}

/** One scheduler tick (pg_cron every 15 minutes). */
export async function runCollect(deps: CollectDeps): Promise<CollectReport> {
  const report: CollectReport = { planned: 0, classified: 0, worded: 0, sent: 0, failed: 0, held: 0, summaries: 0, errors: [] };
  const now = (deps.now ?? new Date()).toISOString();
  const { data: planned, error } = await deps.admin.rpc("collect_plan", { p_org: null, p_now: now });
  if (error) throw error;
  report.planned = Number(planned ?? 0);
  await classifyPending(deps, report);
  await wordPending(deps, report);
  await dispatchReady(deps, report);
  // The owner's daily summary (Business plan)
  const summaries = await sendDueSummaries(deps);
  report.summaries = summaries.sent;
  report.errors.push(...summaries.errors);
  return report;
}

// ---------- Reading replies ----------

/** AI questions Kayyro Collect may use per business per month for reading replies */
const AI_REPLIES_PER_MONTH = 500;

export type ClassifyDeps = CollectDeps & {
  classify?: (messages: ReturnType<typeof buildClassifyMessages>) => Promise<string>;
};

/**
 * Read one stored reply and act on it. Without AI (not set up, Starter plan,
 * switched off, over the monthly allowance or an error) the reply goes to
 * "Needs you" for the owner. Returns what the database did.
 */
export async function classifyMessage(deps: ClassifyDeps, messageId: string): Promise<{ action: string; reading: Classification }> {
  const { admin } = deps;
  const { data: m, error } = await admin
    .from("collection_messages")
    .select("id, organization_id, invoice_id, body, intent_status")
    .eq("id", messageId)
    .eq("direction", "in")
    .single();
  if (error || !m) throw new Error("Reply not found");
  if (m.intent_status !== "pending") return { action: String(m.intent_status), reading: UNSURE };

  const [{ data: settings }, { data: allowed }, { data: clock }] = await Promise.all([
    admin.from("collect_settings").select("ai_replies").eq("organization_id", m.organization_id).maybeSingle(),
    admin.rpc("collect_plan_allows", { p_org: m.organization_id }),
    admin.rpc("collect_clock", { p_org: m.organization_id }),
  ]);
  const today = String((Array.isArray(clock) ? clock[0] : clock)?.local_date ?? new Date().toISOString().slice(0, 10));

  let reading: Classification = { ...UNSURE, summary: "Kayyro didn't read this reply automatically" };
  const canUseAi = (deps.classify || aiConfigured()) && allowed === true && settings?.ai_replies !== false;
  if (canUseAi) {
    const limited = await rateLimit(admin, `collect:ai:${m.organization_id}`, AI_REPLIES_PER_MONTH, 30 * 86_400);
    if (limited.ok) {
      try {
        const context = m.invoice_id ? await replyContext(admin, String(m.invoice_id)) : {};
        const messages = buildClassifyMessages({ reply: String(m.body ?? ""), today, ...context });
        const text = deps.classify ? await deps.classify(messages) : await chatJson(messages);
        reading = parseClassification(text, today);
      } catch (e) {
        console.error("[collect/classify]", (e as Error).message);
      }
    }
  }
  const { data: action, error: applyError } = await admin.rpc("collect_apply_intent", {
    p_id: m.id,
    p_intent: reading.intent,
    p_confidence: reading.confidence,
    p_promise_date: reading.promise_date,
    p_summary: reading.summary || null,
  });
  if (applyError) throw applyError;
  return { action: String(action), reading };
}

async function replyContext(admin: SupabaseClient, invoiceId: string) {
  const [{ data: inv }, { data: balance }, { data: last }] = await Promise.all([
    admin.from("invoices").select("invoice_number, currency, due_date").eq("id", invoiceId).maybeSingle(),
    admin.rpc("collect_invoice_balance", { p_invoice: invoiceId }),
    admin
      .from("collection_messages")
      .select("body")
      .eq("invoice_id", invoiceId)
      .eq("direction", "out")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    invoiceNumber: inv?.invoice_number ?? null,
    amount: inv ? formatAmount(Number(balance ?? 0), String(inv.currency || "AED")) : null,
    dueDate: inv?.due_date ?? null,
    lastReminder: (last?.body as string | null) ?? null,
  };
}

/** Replies still waiting to be read (e.g. the AI was down when they arrived). */
export async function classifyPending(deps: ClassifyDeps, report: CollectReport) {
  const { data: rows, error } = await deps.admin
    .from("collection_messages")
    .select("id")
    .eq("direction", "in")
    .eq("intent_status", "pending")
    .order("created_at")
    .limit(50);
  if (error) throw error;
  for (const r of rows ?? []) {
    try {
      await classifyMessage(deps, String(r.id));
      report.classified++;
    } catch (e) {
      report.errors.push(`${r.id}: ${(e as Error).message}`);
    }
  }
}

/**
 * After a reply was read: write the wording of any answer it queued, and send
 * it straight away when it may go out by itself.
 */
export async function answerReply(deps: CollectDeps, inboundId: string) {
  const { data: answers } = await deps.admin
    .from("collection_messages")
    .select("id")
    .eq("reply_to_id", inboundId)
    .eq("direction", "out")
    .eq("status", "pending");
  for (const a of answers ?? []) {
    await wordMessage(deps, String(a.id));
    const { data: row } = await deps.admin.from("collection_messages").select("status").eq("id", a.id).single();
    if (row?.status === "ready") await dispatchMessage(deps, String(a.id));
  }
}
