import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mfaRequired } from "@/lib/security/mfa";
import { rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { serverError } from "@/lib/security/request";
import { dispatchMessage } from "@/lib/collect/runner";

export const runtime = "nodejs";

const bodySchema = z.object({
  id: z.string().uuid(),
  subject: z.string().max(200).optional(),
  body: z.string().max(5000).optional(),
});

/**
 * Approve a drafted reminder (optionally edited) and send it now if it is
 * inside sending hours; otherwise it goes out at the next scheduler run.
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
    const limited = await rateLimit(admin, `collect:approve:${user.id}`, 120, 3600);
    if (!limited.ok) return tooManyRequests(limited.retryAfter);

    // Approval runs as the signed-in user: the database checks they are an admin of this business
    const { data: status, error } = await supabase.rpc("collect_approve", {
      p_id: parsed.data.id,
      p_subject: parsed.data.subject ?? null,
      p_body: parsed.data.body ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (status !== "ready") return NextResponse.json({ status });

    const result = await dispatchMessage({ admin }, parsed.data.id);
    return NextResponse.json({ status: result === "held" ? "scheduled" : result });
  } catch (e) {
    return serverError("collect/send-now", e, "Could not send the reminder. Please try again.");
  }
}
