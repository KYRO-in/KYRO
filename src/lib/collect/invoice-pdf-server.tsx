/**
 * Server side: make sure an invoice has a PDF in storage and a short link,
 * so an automatic reminder can carry "View the invoice" without anyone
 * opening the app. Renders with the same component as the Download button.
 */
import React from "react";
import { pdf } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvoicePdfDocument } from "@/components/invoices/invoice-pdf";
import { BRAND_LOGO_FULL, BRAND_LOGO_ICON } from "@/lib/brand";
import { normalizeBusinessType } from "@/lib/business-types";
import { ensureInvoicePdfFonts } from "@/lib/invoice-pdf-fonts";
import { mapInvoiceRow } from "@/lib/invoice-row";
import {
  ensureInvoiceShortCode,
  getAppBaseUrl,
  INVOICE_PDF_BUCKET,
  invoicePdfObjectPath,
  invoicePublicDownloadUrl,
} from "@/lib/invoice-short-link";
import { organizationToCompanySettings } from "@/lib/organization";
import { mapOrgRow } from "@/lib/organization-row";
import type { CompanySettings, Invoice } from "@/lib/types";
import { getCountryConfig } from "@/lib/vat/countries";
import { zatcaQrDataUrl, zatcaTimestamp } from "@/lib/vat/zatca";

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/png";
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function renderInvoicePdfBuffer(invoice: Invoice, company: CompanySettings): Promise<Buffer> {
  if (!invoice.customer || !invoice.items?.length) throw new Error("Invoice is missing its customer or lines.");
  const base = getAppBaseUrl();
  ensureInvoicePdfFonts(base);
  const taxCountry = getCountryConfig(invoice.tax_country || company.country);
  const [logoSrc, wordmarkSrc, signatureSrc, qrSrc] = await Promise.all([
    toDataUrl(`${base}${BRAND_LOGO_ICON}`),
    toDataUrl(`${base}${BRAND_LOGO_FULL}`),
    company.signature_url ? toDataUrl(company.signature_url) : Promise.resolve(null),
    taxCountry.zatcaQr && company.tax_id
      ? zatcaQrDataUrl({
          sellerName: company.company_name,
          vatNumber: company.tax_id,
          timestamp: zatcaTimestamp(invoice.invoice_date, invoice.created_at),
          total: Number(invoice.grand_total),
          vatTotal: Number(invoice.total_vat),
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const blob = await pdf(
    <InvoicePdfDocument
      invoice={invoice}
      company={company}
      copyIndex={0}
      logoSrc={logoSrc}
      wordmarkSrc={wordmarkSrc}
      signatureSrc={signatureSrc}
      qrSrc={qrSrc}
      businessType={normalizeBusinessType(company.business_type)}
    />
  ).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}

/** The customer-facing invoice link (/i/CODE), creating the PDF first if needed. */
export async function ensureInvoicePdfLink(admin: SupabaseClient, invoiceId: string): Promise<string> {
  const { data: row, error } = await admin
    .from("invoices")
    .select("*, customer:customers(*), items:invoice_items(*, product:products(*))")
    .eq("id", invoiceId)
    .single();
  if (error || !row) throw new Error("Invoice not found");
  const invoice = mapInvoiceRow(row as Record<string, unknown>);
  const orgId = String((row as { organization_id: string }).organization_id);
  const objectPath = invoicePdfObjectPath(orgId, invoice.id, invoice.invoice_number);
  const folder = objectPath.slice(0, objectPath.lastIndexOf("/"));
  const fileName = objectPath.slice(objectPath.lastIndexOf("/") + 1);

  const { data: files } = await admin.storage.from(INVOICE_PDF_BUCKET).list(folder, { search: fileName });
  if (!files?.some((f) => f.name === fileName)) {
    const { data: orgRow, error: orgErr } = await admin.from("organizations").select("*").eq("id", orgId).single();
    if (orgErr || !orgRow) throw new Error("Business not found");
    const company = organizationToCompanySettings(mapOrgRow(orgRow as Record<string, unknown>));
    const bytes = await renderInvoicePdfBuffer(invoice, company);
    const { error: upErr } = await admin.storage
      .from(INVOICE_PDF_BUCKET)
      .upload(objectPath, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr && !/exists|duplicate/i.test(upErr.message)) throw upErr;
  }
  const code = await ensureInvoiceShortCode(admin, invoice.id);
  return invoicePublicDownloadUrl(code);
}
