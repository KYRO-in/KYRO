import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mfaRequired } from "@/lib/security/mfa";
import { rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { serverError } from "@/lib/security/request";
import { answerReply, classifyMessage } from "@/lib/collect/runner";
import { oneTapLink } from "@/lib/collect/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 45;

const bodySchema = z.object({
  invoiceId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]),
  text: z.string().trim().min(1).max(4000),
});

/**
 * "Log a reply": the owner pastes a reply that came to their own phone or
 * inbox. Kayyro reads it like any other reply and returns what it did, plus
 * the answer to send (one-tap on WhatsApp when it can't go out by itself).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const mfa = await mfaRequired(supabase);
    if (mfa) return mfa;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Paste the customer's reply (up to 4,000 characters)." }, { status: 400 });

    const admin = createAdminClient();
    const limited = await rateLimit(admin, `collect:reply:${user.id}`, 60, 3600);
    if (!limited.ok) return tooManyRequests(limited.retryAfter);

    // As the signed-in user: the database checks the business and the role
    const { data: id, error } = await supabase.rpc("collect_log_reply", {
      p_invoice: parsed.data.invoiceId,
      p_channel: parsed.data.channel,
      p_body: parsed.data.text,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const { action, reading } = await classifyMessage({ admin }, String(id));
    if (action !== "needs_you") await answerReply({ admin }, String(id));
    const { data: answer } = await admin
      .from("collection_messages")
      .select("id, channel, status, subject, body, to_address")
      .eq("reply_to_id", id)
      .eq("direction", "out")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({
      action,
      intent: reading.intent,
      confidence: reading.confidence,
      summary: reading.summary,
      promiseDate: reading.promise_date,
      answer: answer
        ? {
            id: answer.id,
            channel: answer.channel,
            status: answer.status,
            to: answer.to_address,
            subject: answer.subject,
            body: answer.body,
            link: answer.channel === "whatsapp" && answer.body ? oneTapLink(answer.to_address, answer.body) : null,
          }
        : null,
    });
  } catch (e) {
    return serverError("collect/reply", e, "Could not read the reply. Please try again.");
  }
}
