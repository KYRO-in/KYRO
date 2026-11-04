import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { isDemoMode } from "@/lib/demo/mode";
import { PROOF_BUCKET, PROOF_MAX_BYTES, proofType } from "@/lib/collect/proof";

export const runtime = "nodejs";

/**
 * "I already paid" from the payment page: an optional note and an optional
 * proof file (JPEG, PNG, WebP or PDF up to 5 MB, checked by its content).
 * The file goes to private storage under the business's own folder.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = String(form?.get("t") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (isDemoMode()) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const limited = await rateLimit(admin, `collect:claim:${clientIp(request)}`, 10, 3600);
  if (!limited.ok) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  const { data: inv } = await admin
    .from("invoices")
    .select("id, organization_id")
    .eq("collect_pay_token", token)
    .maybeSingle();
  if (!inv) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const note = String(form?.get("note") ?? "").trim().slice(0, 500);
  const file = form?.get("file");
  let path: string | null = null;
  let type: string | null = null;
  let size: number | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > PROOF_MAX_BYTES) return NextResponse.json({ error: "The file is larger than 5 MB." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = proofType(bytes);
    if (!kind) return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP) or a PDF." }, { status: 400 });
    path = `${inv.organization_id}/${inv.id}/${randomUUID()}.${kind.ext}`;
    type = kind.mime;
    size = file.size;
    const { error: upErr } = await admin.storage.from(PROOF_BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (upErr) {
      console.error("[collect/pay/claim] upload", upErr.message);
      return NextResponse.json({ error: "Could not upload the file. Please try again." }, { status: 500 });
    }
  }
  if (!path && !note) return NextResponse.json({ error: "Add the receipt or a short note." }, { status: 400 });

  const { error } = await admin.rpc("collect_submit_paid_claim", {
    p_token: token,
    p_note: note || null,
    p_file_path: path,
    p_file_type: type,
    p_file_size: size,
  });
  if (error) {
    if (path) await admin.storage.from(PROOF_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
