import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * A customer stops payment reminders: from the button on /u/{token}, or
 * one-click from their mail app (List-Unsubscribe-Post).
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("t") ?? "";
  const fromPage = (request.headers.get("content-type") ?? "").includes("form");
  if (!token && fromPage) {
    const form = await request.formData().catch(() => null);
    token = String(form?.get("t") ?? "");
  }
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const admin = createAdminClient();
  const limited = await rateLimit(admin, `collect:optout:${clientIp(request)}`, 30, 600);
  if (!limited.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { data, error } = await admin.rpc("collect_opt_out", { p_token: token });
  if (error) {
    console.error("[collect/opt-out]", error.message);
    return NextResponse.json({ error: "Could not update" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  if (fromPage) return NextResponse.redirect(new URL(`/u/${token}?done=1`, url.origin), 303);
  return NextResponse.json({ ok: true });
}
