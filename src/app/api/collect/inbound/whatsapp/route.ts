import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/security/rate-limit";
import { parseWhatsAppWebhook } from "@/lib/collect/inbound";
import { answerReply, classifyMessage } from "@/lib/collect/runner";

export const runtime = "nodejs";
export const maxDuration = 60;

async function accountFor(key: string | null) {
  if (!key || !/^[a-f0-9]{64}$/.test(key)) return null;
  const { data } = await createAdminClient()
    .from("collect_channel_accounts")
    .select("organization_id, active")
    .eq("webhook_key", key)
    .maybeSingle();
  return data?.active ? String(data.organization_id) : null;
}

/** Webhook check (Meta-style hub.challenge), if the provider asks for one. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!(await accountFor(url.searchParams.get("k")))) return new NextResponse("Not found", { status: 404 });
  const challenge = url.searchParams.get("hub.challenge");
  return new NextResponse(challenge && /^[\w-]{1,200}$/.test(challenge) ? challenge : "ok");
}

/**
 * Incoming WhatsApp messages from 360dialog for one business
 * (/api/collect/inbound/whatsapp?k={webhook key}). Each reply is stored once,
 * read by the AI and acted on; answers go out by themselves only in automatic mode.
 */
export async function POST(request: Request) {
  const key = new URL(request.url).searchParams.get("k");
  const org = await accountFor(key);
  if (!org) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  const limited = await rateLimit(admin, `collect:inbound:wa:${org}`, 300, 600);
  if (!limited.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const messages = parseWhatsAppWebhook(await request.json().catch(() => null));
  for (const msg of messages.slice(0, 20)) {
    try {
      const { data: id, error } = await admin.rpc("collect_record_inbound", {
        p_org: org,
        p_channel: "whatsapp",
        p_from: msg.from,
        p_subject: null,
        p_body: msg.text,
        p_provider: "360dialog",
        p_provider_message_id: msg.id,
        p_reply_to: null,
      });
      if (error || !id) continue;
      const { action } = await classifyMessage({ admin }, String(id));
      if (action !== "needs_you") await answerReply({ admin }, String(id));
    } catch (e) {
      // Stored replies are read again by the next scheduler run
      console.error("[collect/inbound/whatsapp]", (e as Error).message);
    }
  }
  // Always 200 so the provider doesn't retry messages we already have
  return NextResponse.json({ ok: true });
}
