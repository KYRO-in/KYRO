import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { collectEmailHtml } from "@/lib/collect/email-html";
import { extractEmail, messageIdFromAddresses, stripQuotedReply, verifySvixSignature } from "@/lib/collect/inbound";
import { answerReply, classifyMessage } from "@/lib/collect/runner";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReceivedEmail = {
  id?: string;
  from?: string;
  to?: string[];
  received_for?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
};

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ");
}

/**
 * Replies to reminder emails (Resend receiving, event "email.received").
 * The reply address reply+{message id}@{COLLECT_INBOUND_DOMAIN} says which
 * reminder it answers. The reply is read and acted on, then forwarded to the
 * business so they still see every reply.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!secret || !apiKey) return NextResponse.json({ error: "Receiving is not set up" }, { status: 503 });

  const raw = await request.text();
  const valid = verifySvixSignature(
    secret,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    raw
  );
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const event = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  const emailId = event.data?.email_id;
  if (event.type !== "email.received" || !emailId || !/^[\w-]{6,100}$/.test(emailId)) {
    return NextResponse.json({ ok: true });
  }

  // The webhook carries no body: fetch the email itself
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return NextResponse.json({ error: "Could not fetch the email" }, { status: 502 });
  const email = (await res.json()) as ReceivedEmail;

  const replyTo = messageIdFromAddresses([...(email.to ?? []), ...(email.received_for ?? [])]);
  if (!replyTo) return NextResponse.json({ ok: true });
  const admin = createAdminClient();
  const { data: reminder } = await admin
    .from("collection_messages")
    .select("organization_id, customer_id, invoice_id")
    .eq("id", replyTo)
    .eq("direction", "out")
    .maybeSingle();
  if (!reminder) return NextResponse.json({ ok: true });

  const fullText = (email.text || (email.html ? htmlToText(email.html) : "")).trim();
  const body = stripQuotedReply(fullText) || fullText.slice(0, 2000);
  const from = extractEmail(email.from ?? "");
  const { data: id, error } = await admin.rpc("collect_record_inbound", {
    p_org: reminder.organization_id,
    p_channel: "email",
    p_from: from,
    p_subject: email.subject ?? null,
    p_body: body,
    p_provider: "resend",
    p_provider_message_id: emailId,
    p_reply_to: replyTo,
  });
  if (error || !id) return NextResponse.json({ ok: true });

  const { data: stored } = await admin.from("collection_messages").select("intent_status").eq("id", id).single();
  if (stored?.intent_status !== "pending") return NextResponse.json({ ok: true }); // a retry: already handled

  let note = "";
  try {
    const { action, reading } = await classifyMessage({ admin }, String(id));
    note = action === "needs_you" ? "It is waiting for you in Kayyro (Get Paid > Needs you today)." : `Kayyro read it as: ${reading.summary || action}.`;
    if (action !== "needs_you") await answerReply({ admin }, String(id));
  } catch (e) {
    console.error("[collect/inbound/email]", (e as Error).message);
  }

  // Forward to the business, so replies never disappear into Kayyro
  const [{ data: org }, { data: cust }, { data: inv }] = await Promise.all([
    admin.from("organizations").select("name, brand_name, email").eq("id", reminder.organization_id).single(),
    admin.from("customers").select("name").eq("id", reminder.customer_id).maybeSingle(),
    admin.from("invoices").select("invoice_number").eq("id", reminder.invoice_id).maybeSingle(),
  ]);
  if (org?.email) {
    const who = cust?.name || from;
    const forward = `${who} replied to your payment reminder.\n${note}\n\n----\n${fullText.slice(0, 8000)}`;
    await sendEmail({
      fromName: "Kayyro Collect",
      to: [String(org.email)],
      replyTo: from || null,
      subject: `Reply from ${who}${inv?.invoice_number ? ` about ${inv.invoice_number}` : ""}`,
      text: forward,
      html: collectEmailHtml({ text: forward, business: "Kayyro Collect", lang: "en" }),
    }).catch((e) => console.error("[collect/inbound/email] forward", (e as Error).message));
  }
  return NextResponse.json({ ok: true });
}
