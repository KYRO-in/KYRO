import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCollect } from "@/lib/collect/runner";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.COLLECT_CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Kayyro Collect scheduler tick, called by Supabase pg_cron every 15 minutes
 * (see docs/KAYYRO_COLLECT.md). Plans, words and sends the day's reminders.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await runCollect({ admin: createAdminClient() });
    if (report.errors.length) console.error("[collect/run]", report.errors.slice(0, 20));
    return NextResponse.json({ ok: true, ...report, errors: report.errors.length });
  } catch (e) {
    console.error("[collect/run] failed:", (e as Error).message);
    return NextResponse.json({ error: "Collect run failed" }, { status: 500 });
  }
}
