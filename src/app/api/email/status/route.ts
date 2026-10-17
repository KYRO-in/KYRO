import { isDemoMode } from "@/lib/demo/mode";
import { getEmailStatus } from "@/lib/email/send";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Whether invoice emails go out directly (Resend) or fall back to the user's mail app. */
export async function GET() {
  if (isDemoMode()) {
    return NextResponse.json({ configured: true, provider: "demo", fromAddress: "demo@kayyro.local" });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = getEmailStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
}
