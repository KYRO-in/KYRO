import { mfaRequired } from "@/lib/security/mfa";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/mode";
import {
  ensureInvoiceShortCode,
  INVOICE_PDF_BUCKET,
  invoicePdfDownloadFilename,
  invoicePdfObjectPath,
  invoicePublicDownloadUrl,
} from "@/lib/invoice-short-link";
import { getEmailStatus, sendEmail } from "@/lib/email/send";
import {
  DEFAULT_TEMPLATES,
  fillTemplate,
  isValidEmail,
  parseEmailList,
  renderInvoiceEmailHtml,
  type EmailKind,
} from "@/lib/email/templates";
import { APP_NAME } from "@/lib/brand";
import { formatCurrency, formatDate } from "@/lib/utils";
import { NextResponse } from "next/server";
import { rateLimitAll, tooManyRequests } from "@/lib/security/rate-limit";
import { looksLikePdf, serverError } from "@/lib/security/request";

const MAX_RECIPIENTS = 10;
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/**
 * Emails one invoice (or a payment reminder) with its PDF attached.
 * The browser renders the PDF (same renderer as Download) and posts it here.
 *
 * Responses:
 *   200 { ok: true, id, pdfUrl }
 *   503 { error: "not_configured", pdfUrl, subject, text } → client falls back to the mail app
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: invoiceId } = await params;
  try {
    if (isDemoMode()) {
      return NextResponse.json({ error: "Demo mode sends emails locally." }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const mfa = await mfaRequired(supabase);
    if (mfa) return mfa;

    const { data: profile } = await supabase
      .from("users")
      .select("organization_id, role")
      .eq("id", user.id)
      .single();
    if (profile?.role === "accountant") {
      return NextResponse.json({ error: "Accountant access is view-only." }, { status: 403 });
    }
    const orgId = profile?.organization_id as string | undefined;
    if (!orgId) return NextResponse.json({ error: "No organization linked" }, { status: 400 });

    // Keeps a hijacked or abusive account from turning Kayyro into a spam relay
    const admin = createAdminClient();
    const limited = await rateLimitAll(admin, [
      { key: `email:user:${user.id}:m`, limit: 15, windowSeconds: 60 },
      { key: `email:org:${orgId}:h`, limit: 120, windowSeconds: 3600 },
      { key: `email:org:${orgId}:d`, limit: 500, windowSeconds: 86400 },
    ]);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter, "You have sent a lot of emails in a short time. Please wait a little and try again.");
    }

    const form = await request.formData();
    const kind: EmailKind = form.get("kind") === "reminder" ? "reminder" : "invoice";
    const to = parseEmailList(String(form.get("to") ?? ""));
    const cc = parseEmailList(String(form.get("cc") ?? ""));
    const bad = [...to, ...cc].filter((e) => !isValidEmail(e));
    if (!to.length) return NextResponse.json({ error: "Add at least one email address." }, { status: 400 });
    if (bad.length) return NextResponse.json({ error: `Check this address: ${bad[0]}` }, { status: 400 });
    if (to.length + cc.length > MAX_RECIPIENTS) {
      return NextResponse.json({ error: `Up to ${MAX_RECIPIENTS} recipients per email.` }, { status: 400 });
    }

    const file = form.get("pdf");
    const pdf =
      file && typeof file !== "string" && typeof (file as Blob).arrayBuffer === "function"
        ? Buffer.from(await (file as Blob).arrayBuffer())
        : null;
    if (!pdf) return NextResponse.json({ error: "Missing PDF" }, { status: 400 });
    if (pdf.byteLength > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "The PDF is too large to email." }, { status: 413 });
    }
    if (!looksLikePdf(pdf)) {
      return NextResponse.json({ error: "The attachment is not a valid PDF." }, { status: 400 });
    }

    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select(
        "id, invoice_number, invoice_date, grand_total, amount_paid, currency, status, organization_id, customer:customers(id, name, email)"
      )
      .eq("id", invoiceId)
      .eq("organization_id", orgId)
      .single();
    if (invErr || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === "cancelled") {
      return NextResponse.json({ error: "Cancelled invoices can't be emailed." }, { status: 400 });
    }

    const { data: org } = await admin
      .from("organizations")
      .select("name, brand_name, email")
      .eq("id", orgId)
      .single();
    // Email preferences arrive with migration 038 - tolerate their absence
    const { data: payPrefs } = await admin
      .from("organizations")
      .select("payment_link_url")
      .eq("id", orgId)
      .maybeSingle();
    const payUrl = (payPrefs?.payment_link_url as string | null) ?? null;
    const { data: prefs } = await admin
      .from("organizations")
      .select("email_subject_template, email_body_template, email_bcc_self")
      .eq("id", orgId)
      .maybeSingle();

    const rawCustomer = invoice.customer as
      | { id: string; name: string; email: string | null }
      | { id: string; name: string; email: string | null }[]
      | null;
    const customer = Array.isArray(rawCustomer) ? rawCustomer[0] : rawCustomer;
    const company = (org?.brand_name || org?.name || APP_NAME) as string;

    // Same PDF the customer can reopen from the short link
    let pdfUrl: string | null = null;
    try {
      const objectPath = invoicePdfObjectPath(orgId, invoice.id, invoice.invoice_number);
      const { error: upErr } = await admin.storage
        .from(INVOICE_PDF_BUCKET)
        .upload(objectPath, pdf, { contentType: "application/pdf", upsert: true });
      if (!upErr) {
        const shortCode = await ensureInvoiceShortCode(admin, invoice.id);
        pdfUrl = invoicePublicDownloadUrl(shortCode, request);
      } else {
        console.warn("[invoice-email] pdf upload skipped:", upErr.message);
      }
    } catch (e) {
      console.warn("[invoice-email] short link skipped:", e);
    }

    const total = Number(invoice.grand_total);
    const due = Math.max(0, total - Number(invoice.amount_paid ?? 0));
    const vars = {
      customer: customer?.name ?? "there",
      invoice_number: invoice.invoice_number as string,
      date: formatDate(invoice.invoice_date as string),
      amount: formatCurrency(total, invoice.currency as string),
      amount_due: formatCurrency(due, invoice.currency as string),
      company,
      link: pdfUrl ?? "",
    };
    const defaults = DEFAULT_TEMPLATES[kind];
    const subjectTemplate =
      String(form.get("subject") ?? "").trim() ||
      (kind === "invoice" ? (prefs?.email_subject_template as string | null) : null) ||
      defaults.subject;
    const bodyTemplate =
      String(form.get("message") ?? "").trim() ||
      (kind === "invoice" ? (prefs?.email_body_template as string | null) : null) ||
      defaults.body;
    const subject = fillTemplate(subjectTemplate, vars).replace(/[\r\n]+/g, " ").slice(0, 200);
    const text = fillTemplate(bodyTemplate, vars).slice(0, 5000);

    const status = getEmailStatus();
    if (!status.configured) {
      return NextResponse.json(
        { error: "not_configured", pdfUrl, subject, text, to, cc },
        { status: 503 }
      );
    }

    const replyTo = (org?.email as string | null) || user.email || null;
    const bcc = prefs?.email_bcc_self && replyTo && isValidEmail(replyTo) ? [replyTo] : [];

    let providerId: string | null = null;
    let sendError: string | null = null;
    try {
      const sent = await sendEmail({
        fromName: company,
        to,
        cc,
        bcc,
        replyTo,
        subject,
        text,
        html: renderInvoiceEmailHtml({
          kind,
          message: text,
          company,
          invoiceNumber: vars.invoice_number,
          date: vars.date,
          total: vars.amount,
          due: vars.amount_due,
          link: pdfUrl,
          payUrl,
        }),
        attachments: [
          {
            filename: invoicePdfDownloadFilename(invoice.invoice_number).replace(
              /\.pdf$/i,
              ` ${String(invoice.invoice_number).replace(/[^\w.-]+/g, "-")}.pdf`
            ),
            content: pdf,
          },
        ],
      });
      providerId = sent.id;
    } catch (e) {
      console.error("[invoice-email] provider", e);
      sendError = "The email could not be sent. Please check the address and try again.";
    }

    // Log every attempt; the table arrives with migration 038 (ignore if missing).
    const { error: logErr } = await admin.from("invoice_emails").insert({
      organization_id: orgId,
      invoice_id: invoice.id,
      customer_id: customer?.id ?? null,
      kind,
      to_email: to.join(", "),
      cc: cc.length ? cc.join(", ") : null,
      subject,
      status: sendError ? "failed" : "sent",
      provider: status.provider,
      provider_message_id: providerId,
      error: sendError,
      sent_by: user.id,
    });
    if (logErr) console.warn("[invoice-email] log skipped:", logErr.message);

    if (sendError) {
      return NextResponse.json({ error: sendError, pdfUrl }, { status: 502 });
    }

    const { data: counter } = await admin
      .from("invoices")
      .select("email_count")
      .eq("id", invoice.id)
      .maybeSingle();
    const { error: stampErr } = await admin
      .from("invoices")
      .update({
        last_emailed_at: new Date().toISOString(),
        email_count: Number((counter as { email_count?: number } | null)?.email_count ?? 0) + 1,
      })
      .eq("id", invoice.id)
      .eq("organization_id", orgId);
    if (stampErr) console.warn("[invoice-email] stamp skipped:", stampErr.message);

    return NextResponse.json({ ok: true, id: providerId, pdfUrl });
  } catch (e) {
    return serverError("invoice-email", e, "Email failed. Please try again.");
  }
}
