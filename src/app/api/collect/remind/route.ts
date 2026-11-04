import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mfaRequired } from "@/lib/security/mfa";
import { rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { serverError } from "@/lib/security/request";
import { wordMessage } from "@/lib/collect/runner";
import { oneTapLink } from "@/lib/collect/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  invoiceId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]),
});

/**
 * "Remind now" (every plan): drafts one reminder from the fixed templates.
 * WhatsApp comes back as a one-tap link for the owner's phone; email comes
 * back for review and is sent with /api/collect/send-now.
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
    if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    const admin = createAdminClient();
    const limited = await rateLimit(admin, `collect:remind:${user.id}`, 60, 3600);
    if (!limited.ok) return tooManyRequests(limited.retryAfter);

    // As the signed-in user: the database checks the role, the invoice and once-a-day
    const { data: id, error } = await supabase.rpc("collect_manual_reminder", {
      p_invoice: parsed.data.invoiceId,
      p_channel: parsed.data.channel,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const { subject, body } = await wordMessage({ admin }, String(id));
    const { data: m } = await admin.from("collection_messages").select("to_address, language").eq("id", id).single();
    return NextResponse.json({
      id,
      channel: parsed.data.channel,
      to: m?.to_address ?? null,
      language: m?.language ?? "en",
      subject,
      body,
      link: parsed.data.channel === "whatsapp" ? oneTapLink(m?.to_address, body) : null,
    });
  } catch (e) {
    return serverError("collect/remind", e, "Could not prepare the reminder. Please try again.");
  }
}
