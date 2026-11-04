/**
 * Kayyro Collect daily summary to the owner (server only, Business plan).
 * The scheduler run claims each business's summary once a day from its
 * summary time (09:00 by default) on working days, then sends it by email,
 * or by WhatsApp when a WhatsApp Business number is connected.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail as defaultSendEmail, type OutgoingEmail } from "@/lib/email/send";
import { getAppBaseUrl } from "@/lib/invoice-short-link";
import { collectEmailHtml } from "@/lib/collect/email-html";
import {
  normaliseSummary,
  renderDailySummary,
  summaryTemplateParams,
  SUMMARY_TEMPLATE,
} from "@/lib/collect/insights";
import { Dialog360Sender, type WhatsAppSender } from "@/lib/collect/whatsapp";

export type SummaryDeps = {
  admin: SupabaseClient;
  now?: Date;
  baseUrl?: string;
  sendEmail?: (email: OutgoingEmail) => Promise<{ id: string | null }>;
  whatsappFor?: (organizationId: string) => Promise<WhatsAppSender | null>;
};

export type SummaryResult = { channel: "email" | "whatsapp"; to: string };

/** Build and send one business's summary now (the caller decides whether it is due). */
export async function sendSummary(deps: SummaryDeps, organizationId: string): Promise<SummaryResult> {
  const { admin } = deps;
  const now = (deps.now ?? new Date()).toISOString();
  const [{ data: raw, error }, { data: org }, { data: s }] = await Promise.all([
    admin.rpc("collect_daily_summary_data", { p_org: organizationId, p_now: now }),
    admin.from("organizations").select("name, brand_name, email, phone").eq("id", organizationId).single(),
    admin.from("collect_settings").select("summary_channel, summary_to, language").eq("organization_id", organizationId).single(),
  ]);
  if (error) throw error;
  if (!org || !s) throw new Error("Business not found");
  const data = normaliseSummary((raw ?? {}) as Record<string, unknown>);
  const business = String(org.brand_name || org.name || "");
  const lang = s.language === "ar" ? "ar" : "en";
  const link = `${(deps.baseUrl || getAppBaseUrl()).replace(/\/$/, "")}/collect`;

  if (s.summary_channel === "whatsapp") {
    const to = String(s.summary_to || org.phone || "");
    const sender = deps.whatsappFor ? await deps.whatsappFor(organizationId) : await whatsappSender(admin, organizationId);
    if (sender && to.replace(/\D/g, "").length >= 8) {
      await sender.sendTemplate({ to, template: SUMMARY_TEMPLATE.name, language: lang, params: summaryTemplateParams(data, business, link) });
      return { channel: "whatsapp", to };
    }
    // No WhatsApp Business number yet: the summary still arrives, by email
  }
  const to = String((s.summary_channel === "email" && s.summary_to) || org.email || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("No email address for the daily summary");
  const { subject, text } = renderDailySummary(data, { business, link, lang });
  await (deps.sendEmail ?? defaultSendEmail)({
    fromName: "Kayyro Collect",
    to: [to],
    subject,
    text,
    html: collectEmailHtml({ text, business: "Kayyro Collect", lang }),
  });
  return { channel: "email", to };
}

async function whatsappSender(admin: SupabaseClient, organizationId: string): Promise<WhatsAppSender | null> {
  const { data } = await admin
    .from("collect_channel_accounts")
    .select("api_key, active")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data?.active && data.api_key ? new Dialog360Sender(String(data.api_key)) : null;
}

/** Scheduler step: every business whose summary is due now gets it once. */
export async function sendDueSummaries(deps: SummaryDeps): Promise<{ sent: number; errors: string[] }> {
  const { admin } = deps;
  const now = (deps.now ?? new Date()).toISOString();
  const errors: string[] = [];
  let sent = 0;
  const { data: rows, error } = await admin.from("collect_settings").select("organization_id").eq("summary_enabled", true).limit(500);
  if (error) {
    // Before migration 051 there is no summary yet
    if (/summary_enabled|does not exist|schema cache/i.test(error.message)) return { sent, errors };
    throw error;
  }
  for (const r of rows ?? []) {
    const org = String(r.organization_id);
    try {
      const { data: due } = await admin.rpc("collect_claim_summary", { p_org: org, p_now: now });
      if (due !== true) continue;
      await sendSummary(deps, org);
      sent++;
    } catch (e) {
      errors.push(`summary ${org}: ${(e as Error).message}`);
    }
  }
  return { sent, errors };
}
