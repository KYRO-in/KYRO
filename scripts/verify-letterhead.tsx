/**
 * Quick letterhead empty-field check + PDF preview with blank address/TRN.
 * Run: npx tsx --tsconfig tsconfig.json scripts/verify-letterhead.ts
 */
import React from "react";
import fs from "fs";
import path from "path";
import { pdf } from "@react-pdf/renderer";
import { InvoicePdfDocument } from "../src/components/invoices/invoice-pdf";
import { ensureInvoicePdfFonts } from "../src/lib/invoice-pdf-fonts";
import {
  formatCompanyAddress,
  formatCompanyContact,
} from "../src/lib/invoice-letterhead";
import type { CompanySettings, Invoice } from "../src/lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function fileToDataUrl(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  // Unit checks
  assert(
    formatCompanyAddress({ address: "", city: "", state: "Dubai", pincode: "" }) ===
      "Dubai",
    "emirate-only should not have commas"
  );
  assert(
    formatCompanyAddress({ address: "", city: "", state: "", pincode: "" }) === "",
    "all empty address"
  );
  assert(
    formatCompanyContact({ tax_id: "", phone: "", email: "" }) === "",
    "empty contact"
  );
  assert(
    formatCompanyContact({ tax_id: "  ", phone: "", email: "admin@example.com" }) === "",
    "whitespace TRN + placeholder email omitted"
  );
  assert(
    formatCompanyContact({ tax_id: "", phone: "99", email: "" }) === "Ph: 99",
    "phone only"
  );
  console.log("format helpers OK");

  ensureInvoicePdfFonts();
  const root = path.resolve(__dirname, "..");
  const logoSrc = fileToDataUrl(path.join(root, "public/logo/kayyro-icon.png"));
  const wordmarkSrc = fileToDataUrl(path.join(root, "public/logo/kayyro-full.png"));

  const company: CompanySettings = {
    id: "preview",
    company_name: "Sparse Letterhead LLC",
    brand_name: "Sparse Co",
    tax_id: "",
    country: "AE",
    currency: "AED",
    prices_include_vat: false,
    address: "",
    city: "",
    state: "Dubai",
    pincode: "",
    phone: "",
    email: "",
    bank_name: "",
    bank_account: "",
    bank_swift: "",
    bank_branch: "",
    invoice_prefix: "KY",
    updated_at: new Date().toISOString(),
  };

  console.log("PDF address line:", JSON.stringify(formatCompanyAddress(company)));
  console.log("PDF contact line:", JSON.stringify(formatCompanyContact(company)));

  const invoice = {
    id: "inv",
    invoice_number: "KY-EMPTY-001",
    customer_id: "c1",
    invoice_date: "2026-08-04",
    subtotal: 100,
    total_vat: 5,
    round_off: 0,
    grand_total: 105,
    currency: "AED",
    status: "issued",
    cancelled_reason: null,
    notes: null,
    created_by: null,
    created_at: new Date().toISOString(),
    customer: {
      id: "c1",
      name: "Walk-in",
      phone: null,
      email: null,
      tax_id: null,
      country: "AE",
      billing_address: null,
      state: "Dubai",
      customer_type: "b2c",
      created_at: new Date().toISOString(),
    },
    items: [
      {
        id: "i1",
        invoice_id: "inv",
        product_id: "p1",
        hsn_code: "3402",
        quantity: 1,
        unit_price: 100,
        price_overridden: false,
        taxable_value: 100,
        vat_rate: 5,
        vat_amount: 5,
        line_total: 105,
        product: {
          id: "p1",
          name: "Test Item",
          variant: null,
          pack_size: "1",
          hsn_code: "3402",
          vat_rate: 5,
          vat_category: "standard",
          base_price: 100,
          category: "Misc",
          sku: "T1",
          barcode: null,
          reorder_threshold: 0,
          is_active: true,
          image_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    ],
  } as Invoice;

  const blob = await pdf(
    <InvoicePdfDocument
      invoice={invoice}
      company={company}
      logoSrc={logoSrc}
      wordmarkSrc={wordmarkSrc}
      businessType="general"
    />
  ).toBlob();

  const outDir = path.join(root, "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "invoice-letterhead-empty.pdf");
  fs.writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()));
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
