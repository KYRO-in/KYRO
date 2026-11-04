import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mfaRequired } from "@/lib/security/mfa";
import { rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { serverError } from "@/lib/security/request";
import { sendSummary } from "@/lib/collect/summary";

export const runtime = "nodejs";

/** Settings > "Send a test now": today's summary to the configured address (admins, Business plan). */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const mfa = await mfaRequired(supabase);
    if (mfa) return mfa;

    const { data: profile } = await supabase.from("users").select("organization_id, role").eq("id", user.id).single();
    if (!profile?.organization_id || profile.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can do this." }, { status: 403 });
    }
    const { data: allowed } = await supabase.rpc("collect_insights_allows", { p_org: profile.organization_id });
    if (allowed !== true) return NextResponse.json({ error: "The daily summary is part of the Business plan." }, { status: 403 });

    const admin = createAdminClient();
    const limited = await rateLimit(admin, `collect:summary-test:${profile.organization_id}`, 5, 3600);
    if (!limited.ok) return tooManyRequests(limited.retryAfter);

    const result = await sendSummary({ admin }, String(profile.organization_id));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return serverError("collect/summary/test", e, "Could not send the summary. Check the address in the settings.");
  }
}
