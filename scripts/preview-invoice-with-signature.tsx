/**
 * Render a sample UAE tax invoice PDF (standard + zero-rated lines, signature).
 * Run: npx tsx --tsconfig tsconfig.json scripts/preview-invoice-with-signature.tsx
 * Add --ar for the bilingual English + Arabic version.
 */
import React from "react";
import fs from "fs";
import path from "path";
import { Font, pdf } from "@react-pdf/renderer";
import { InvoicePdfDocument } from "../src/components/invoices/invoice-pdf";
import { ensureInvoicePdfFonts, PDF_ARABIC_FAMILY } from "../src/lib/invoice-pdf-fonts";
import type { CompanySettings, Invoice, Product } from "../src/lib/types";

function fileToDataUrl(p: string) {
  const buf = fs.readFileSync(p);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function product(id: string, name: string, vatRate: number, zero = false): Product {
  return {
    id,
    name,
    variant: null,
    pack_size: "Pcs",
    hsn_code: "",
    vat_rate: vatRate,
    vat_category: zero ? "zero" : "standard",
    base_price: 0,
    category: "Misc",
    sku: id,
    barcode: null,
    reorder_threshold: 0,
    is_active: true,
    image_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  ensureInvoicePdfFonts();
  const root = process.cwd();
  const arabic = process.argv.includes("--ar");
  // In Node the Arabic font comes from disk instead of the site URL
  Font.register({
    family: PDF_ARABIC_FAMILY,
    fonts: [400, 600, 700].map((w) => ({
      src: path.join(root, `public/fonts/pdf/ibm-plex-sans-arabic-${w}.ttf`),
      fontWeight: w,
    })),
  });
  const company: CompanySettings = {
    id: "x",
    company_name: "Al Waha General Trading LLC",
    brand_name: "Al Waha Trading",
    tax_id: "100123456700003",
    country: "AE",
    currency: "AED",
    prices_include_vat: false,
    address: "Shop 4, Al Fahidi Street",
    city: "Bur Dubai",
    state: "Dubai",
    pincode: "12345",
    phone: "+971 4 123 4567",
    email: "billing@alwaha.example.ae",
    bank_name: "Emirates NBD",
    bank_account: "AE070331234567890123456",
    bank_swift: "EBILAEAD",
    bank_branch: "Bur Dubai",
    invoice_prefix: "KY",
    updated_at: new Date().toISOString(),
    signature_url: "local",
    name_ar: "الواحة للتجارة العامة ذ.م.م",
    invoice_language: arabic ? "en_ar" : "en",
    payment_link_url: "https://pay.example.ae/alwaha",
  };

  const invoice: Invoice = {
    id: "inv",
    invoice_number: "KY/2026/0001",
    customer_id: "c",
    invoice_date: "2026-10-07",
    subtotal: 1250,
    total_vat: 50,
    round_off: 0,
    grand_total: 1300,
    currency: "AED",
    prices_include_vat: false,
    status: "issued",
    cancelled_reason: null,
    notes: null,
    created_by: null,
    created_at: new Date().toISOString(),
    customer: {
      id: "c",
      name: "Al Noor Trading LLC",
      phone: "+971 50 123 4567",
      email: null,
      tax_id: "100234567800003",
      country: "AE",
      billing_address: "Office 1204, Business Bay",
      state: "Dubai",
      customer_type: "b2b",
      created_at: new Date().toISOString(),
    },
    items: [
      {
        id: "i1",
        invoice_id: "inv",
        product_id: "p1",
        hsn_code: "",
        quantity: 10,
        unit_price: 100,
        price_overridden: false,
        taxable_value: 1000,
        vat_rate: 5,
        vat_amount: 50,
        vat_category: "standard",
        line_total: 1050,
        product: product("p1", "Industrial Floor Cleaner 5L", 5),
      },
      {
        id: "i2",
        invoice_id: "inv",
        product_id: "p2",
        hsn_code: "",
        quantity: 1,
        unit_price: 250,
        price_overridden: false,
        taxable_value: 250,
        vat_rate: 0,
        vat_amount: 0,
        vat_category: "zero",
        line_total: 250,
        product: product("p2", arabic ? "تمور مجدول - Medjool dates" : "Export consignment handling", 0, true),
      },
    ],
  };

  const sigPath = path.join(root, "tmp", "sample-signature.png");
  const blob = await pdf(
    <InvoicePdfDocument
      invoice={invoice}
      company={company}
      logoSrc={fileToDataUrl(path.join(root, "public/logo/kayyro-icon.png"))}
      wordmarkSrc={fileToDataUrl(path.join(root, "public/logo/kayyro-full.png"))}
      signatureSrc={fs.existsSync(sigPath) ? fileToDataUrl(sigPath) : null}
      businessType="general"
    />
  ).toBlob();

  const out = path.join(root, "tmp", arabic ? "invoice-bilingual.pdf" : "invoice-with-signature.pdf");
  fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  console.log("wrote", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
