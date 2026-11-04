import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Link,
} from "@react-pdf/renderer";
import { amountInWords } from "@/lib/amount-in-words";
import { APP_NAME, BRAND_COLORS } from "@/lib/brand";
import { getCountryConfig } from "@/lib/vat/countries";
import {
  contextForDocument,
  documentBreakdown,
  invoiceTitleFor,
  lineRateLabel,
  taxSummaryRows,
  treatmentNote,
} from "@/lib/vat/context";
import { currencyDecimals } from "@/lib/utils";
import {
  getBusinessTypeConfig,
  showsProductFormField,
  type BusinessType,
} from "@/lib/business-types";
import {
  formatCompanyAddress,
  formatCompanyBankLine,
  formatCompanyContact,
} from "@/lib/invoice-letterhead";
import { invoicePdfFontStack } from "@/lib/invoice-pdf-fonts";
import { AR } from "@/lib/invoice-arabic";
import type { CompanySettings, Invoice, InvoiceItem } from "@/lib/types";
import { formatQty } from "@/lib/units";

/** Approximate printable content width on A4 with 32pt side padding. */
const CONTENT_WIDTH = 531;

function createStyles(fontFamily: string[], bold: string[]) {
  return StyleSheet.create({
    page: {
      paddingTop: 28,
      paddingBottom: 72,
      paddingHorizontal: 32,
      fontSize: 9,
      fontFamily,
      color: BRAND_COLORS.ink,
      backgroundColor: "#FFFFFF",
    },
    headerTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 8,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    logoIcon: {
      width: 28,
      height: 28,
      marginRight: 8,
      objectFit: "contain",
    },
    logoWordmark: {
      height: 40,
      width: 180,
      objectFit: "contain",
    },
    brandFallback: {
      fontSize: 13,
      fontFamily: bold,
      fontWeight: 700,
      color: BRAND_COLORS.primary,
    },
    copyPill: {
      borderWidth: 1,
      borderColor: BRAND_COLORS.primary,
      borderRadius: 10,
      paddingVertical: 3,
      paddingHorizontal: 8,
      backgroundColor: "#F5F0FF",
    },
    copyPillText: {
      fontSize: 7,
      fontFamily: bold,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: BRAND_COLORS.primary,
    },
    gradientBar: {
      flexDirection: "row",
      height: 4,
      marginBottom: 10,
      borderRadius: 2,
      overflow: "hidden",
    },
    gradientSeg1: { flex: 1, backgroundColor: BRAND_COLORS.primary },
    gradientSeg2: { flex: 1, backgroundColor: "#8B2CF5" },
    gradientSeg3: { flex: 1, backgroundColor: "#A040FA" },
    gradientSeg4: { flex: 1, backgroundColor: BRAND_COLORS.primaryLight },
    footerAccent: {
      flexDirection: "row",
      height: 2,
      marginBottom: 8,
      borderRadius: 1,
      overflow: "hidden",
    },
    businessBlock: {
      marginBottom: 8,
    },
    businessName: {
      fontSize: 18,
      fontFamily: bold,
      fontWeight: 700,
      color: BRAND_COLORS.ink,
      letterSpacing: -0.2,
    },
    taxInvoiceLabel: {
      fontSize: 8,
      fontFamily: bold,
      fontWeight: 600,
      color: BRAND_COLORS.muted,
      textTransform: "uppercase",
      letterSpacing: 1.2,
      marginTop: 3,
      marginBottom: 4,
    },
    companyLine: {
      fontSize: 8.5,
      color: BRAND_COLORS.ink,
      marginTop: 1,
    },
    muted: {
      color: BRAND_COLORS.muted,
      fontSize: 7.5,
      marginTop: 1.5,
    },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 6,
      marginBottom: 10,
    },
    metaBlock: {
      flex: 1,
      paddingRight: 10,
    },
    metaBlockRight: {
      width: 210,
      alignItems: "flex-end",
    },
    sectionLabel: {
      fontSize: 7.5,
      color: BRAND_COLORS.primary,
      marginBottom: 3,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      fontFamily: bold,
      fontWeight: 700,
    },
    bold: { fontFamily: bold, fontWeight: 700 },
    bodyText: { fontSize: 8.5, color: BRAND_COLORS.ink, marginTop: 1 },
    metaLine: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginTop: 2,
    },
    metaKey: {
      fontSize: 7.5,
      color: BRAND_COLORS.primary,
      fontFamily: bold,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: 0.4,
      marginRight: 6,
    },
    metaVal: {
      fontSize: 8.5,
      color: BRAND_COLORS.ink,
      fontFamily: bold,
      fontWeight: 700,
    },
    table: { marginTop: 2 },
    th: {
      flexDirection: "row",
      backgroundColor: BRAND_COLORS.tableHeader,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: BRAND_COLORS.border,
      paddingVertical: 5,
      alignItems: "center",
    },
    thText: {
      fontFamily: bold,
      fontWeight: 700,
      color: BRAND_COLORS.ink,
      fontSize: 7.5,
      textTransform: "uppercase",
      letterSpacing: 0.3,
    },
    tr: {
      flexDirection: "row",
      borderBottomWidth: 0.5,
      borderColor: BRAND_COLORS.border,
      paddingVertical: 5,
      alignItems: "flex-start",
    },
    trAlt: {
      backgroundColor: "#F8FAFC",
    },
    cell: { paddingHorizontal: 3 },
    cellRight: { paddingHorizontal: 3, textAlign: "right" },
    lineMeta: { fontSize: 7, color: BRAND_COLORS.muted, marginTop: 1 },
    totalsWrap: {
      marginTop: 10,
      alignSelf: "flex-end",
      width: 230,
      backgroundColor: "#F8FAFC",
      borderWidth: 1,
      borderColor: BRAND_COLORS.border,
      borderRadius: 4,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 2.5,
    },
    totalLabel: { fontSize: 8.5, color: BRAND_COLORS.ink },
    totalValue: { fontSize: 8.5, color: BRAND_COLORS.ink, textAlign: "right" },
    grand: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 1.5,
      borderTopColor: BRAND_COLORS.primary,
      marginTop: 5,
      paddingTop: 6,
    },
    grandLabel: {
      fontSize: 11,
      fontFamily: bold,
      fontWeight: 700,
      color: BRAND_COLORS.primary,
    },
    grandValue: {
      fontSize: 12,
      fontFamily: bold,
      fontWeight: 700,
      color: BRAND_COLORS.primary,
      textAlign: "right",
    },
    words: {
      marginTop: 12,
      fontSize: 8.5,
      color: BRAND_COLORS.ink,
      paddingRight: 8,
    },
    wordsLabel: {
      fontFamily: bold,
      fontWeight: 700,
      color: BRAND_COLORS.muted,
    },
    signatureBlock: {
      marginTop: 22,
      alignSelf: "flex-end",
      width: 160,
      alignItems: "center",
    },
    signatureLabel: {
      fontSize: 7.5,
      color: BRAND_COLORS.muted,
      marginBottom: 4,
      textAlign: "center",
    },
    signatureImage: {
      width: 130,
      height: 48,
      marginBottom: 4,
      objectFit: "contain",
    },
    signatureSpacer: { height: 36 },
    signatureLine: {
      width: "100%",
      borderTopWidth: 0.75,
      borderColor: BRAND_COLORS.border,
      marginBottom: 4,
    },
    signatureTitle: {
      fontSize: 8,
      fontFamily: bold,
      fontWeight: 700,
      textAlign: "center",
      color: BRAND_COLORS.ink,
    },
    footer: {
      position: "absolute",
      bottom: 22,
      left: 32,
      right: 32,
      width: CONTENT_WIDTH,
    },
    footerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
    },
    footerText: {
      flex: 1,
      fontSize: 7.5,
      color: BRAND_COLORS.muted,
      paddingRight: 10,
    },
    arabic: {
      letterSpacing: 0,
      textTransform: "none",
    },
    payBox: {
      marginTop: 10,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: BRAND_COLORS.tableHeader,
      flexDirection: "row",
      alignItems: "center",
    },
    payLabel: {
      fontFamily: bold,
      fontWeight: 700,
      fontSize: 8.5,
      color: BRAND_COLORS.primary,
      marginRight: 8,
    },
    noteBox: {
      marginTop: 8,
      fontSize: 8,
      color: BRAND_COLORS.ink,
    },
    qrRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
    },
    qrImage: { width: 78, height: 78 },
    qrLabel: { fontSize: 7, color: BRAND_COLORS.muted, marginRight: 8, textAlign: "right" },
    payLink: {
      fontSize: 8.5,
      color: BRAND_COLORS.ink,
      textDecoration: "none",
    },
    footerMark: {
      width: 18,
      height: 18,
      opacity: 0.35,
      objectFit: "contain",
    },
  });
}

/** PDF-only money format: currency code prefix, since standard PDF fonts lack symbols like ₹. */
function pdfMoney(n: number, currency: string) {
  const code = currency === "INR" ? "Rs." : currency;
  const digits = currencyDecimals(currency);
  return `${code} ${Number(n).toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

const COPY_LABELS = ["Original for Recipient", "Duplicate", "Triplicate"] as const;

function BrandGradientBar({
  barStyle,
  styles,
}: {
  barStyle: "gradientBar" | "footerAccent";
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles[barStyle]}>
      <View style={styles.gradientSeg1} />
      <View style={styles.gradientSeg2} />
      <View style={styles.gradientSeg3} />
      <View style={styles.gradientSeg4} />
    </View>
  );
}

function lineParticulars(
  item: InvoiceItem,
  businessType: BusinessType,
  inr: (n: number) => string
): { title: string; meta: string[] } {
  const cfg = getBusinessTypeConfig(businessType);
  const name = item.room_booking_id
    ? "Room stay"
    : (item.product?.name ?? "Item");
  const variant = item.product?.variant ? ` (${item.product.variant})` : "";
  const meta: string[] = [];

  if (
    showsProductFormField(businessType, "pack_size") &&
    item.product?.pack_size
  ) {
    meta.push(item.product.pack_size);
  }
  if (cfg.invoiceLineFields.lineImeiSerial && item.imei_serial) {
    meta.push(`IMEI/S/N: ${item.imei_serial}`);
  }
  if (cfg.invoiceLineFields.lineBatchNumber && item.batch_number) {
    meta.push(`Batch: ${item.batch_number}`);
  }
  if (cfg.invoiceLineFields.lineVariantTag && item.variant_tag) {
    meta.push(item.variant_tag);
  }
  if (cfg.invoiceLineFields.jewelleryPricing) {
    const huid = item.jewellery_huid || item.product?.huid_number;
    const purity = item.jewellery_purity || item.product?.purity;
    const locked = item.rate_locked_at_sale ?? item.metal_rate_used;
    if (huid) meta.push(`Hallmark: ${huid}`);
    if (purity) meta.push(`Purity: ${purity.toUpperCase()}`);
    if (locked != null) meta.push(`Rate: ${inr(locked)}/g`);
    if (item.gross_weight != null) meta.push(`Gross: ${item.gross_weight}g`);
    if (item.net_weight != null) meta.push(`Net: ${item.net_weight}g`);
    if (item.making_charge_amount != null) {
      meta.push(`Making: ${inr(item.making_charge_amount)}`);
    }
    if (item.stone_value != null && Number(item.stone_value) > 0) {
      meta.push(`Stone: ${inr(item.stone_value)}`);
    }
  }
  if (cfg.invoiceLineFields.hotelStay) {
    if (item.check_in_date) meta.push(`Check-in: ${item.check_in_date}`);
    if (item.check_out_date) meta.push(`Check-out: ${item.check_out_date}`);
    if (item.guest_id_proof) meta.push(`ID: ${item.guest_id_proof}`);
    meta.push(`${item.quantity} night${item.quantity === 1 ? "" : "s"}`);
  }

  return { title: `${name}${variant}`, meta };
}

export function InvoicePdfDocument({
  invoice,
  company,
  copyIndex = 0,
  logoSrc = null,
  wordmarkSrc = null,
  signatureSrc = null,
  qrSrc = null,
  businessType = "general",
}: {
  invoice: Invoice;
  company: CompanySettings;
  copyIndex?: 0 | 1 | 2;
  /** Prefer data URLs so PDF generation does not depend on network fetch. */
  logoSrc?: string | null;
  wordmarkSrc?: string | null;
  signatureSrc?: string | null;
  /** Saudi Arabia: ZATCA QR code (PNG data URL) */
  qrSrc?: string | null;
  businessType?: BusinessType;
}) {
  const customer = invoice.customer;
  if (!customer) {
    throw new Error("Invoice customer is required for PDF");
  }
  const items = invoice.items ?? [];
  const styles = createStyles(invoicePdfFontStack(), invoicePdfFontStack(true));
  // Bilingual tax invoice: Arabic under each English label
  const bilingual = company.invoice_language === "en_ar";
  // Arabic sits in its own nested Text: letter-spacing and upper-casing would break Arabic joining
  const t = (en: string, ar: string): React.ReactNode =>
    bilingual ? (
      <>
        {en}
        {"\n"}
        <Text style={styles.arabic}>{ar}</Text>
      </>
    ) : (
      en
    );
  // Printed under the rules the invoice was issued with (country, treatment, India split)
  const taxCtx = contextForDocument(invoice, company, customer);
  const country = taxCtx.country;
  const taxName = country.taxName;
  const showTax = !taxCtx.taxFree;
  const gst = country.taxSystem === "gst";
  const currency = invoice.currency || company.currency || country.currency;
  const inr = (n: number) => pdfMoney(n, currency);
  const summaryRows = taxSummaryRows(taxCtx, documentBreakdown(taxCtx, items), inr);
  const placeOfSupply = taxCtx.placeOfSupply;
  const note = treatmentNote(taxCtx);
  const customerTaxIdLabel = getCountryConfig(customer.country || country.code).taxIdLabel;
  // Column widths: tax columns fold into the description when there is no tax
  const w = showTax
    ? { desc: "27%", qty: "10%", rate: "14%", taxable: "12%", pct: "8%", vat: "11%", amount: "14%" }
    : { desc: "46%", qty: "12%", rate: "18%", taxable: "0%", pct: "0%", vat: "0%", amount: "20%" };
  const addressLine = formatCompanyAddress(company);
  // The business's own number is labelled for its current country
  const contactLine = formatCompanyContact({ ...company, taxIdLabel: getCountryConfig(company.country).taxIdLabel });
  const bankLine = formatCompanyBankLine(company);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerTop}>
          <View style={styles.brandRow}>
            {wordmarkSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={wordmarkSrc} style={styles.logoWordmark} />
            ) : logoSrc ? (
              <>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={logoSrc} style={styles.logoIcon} />
                <Text style={styles.brandFallback}>{APP_NAME}</Text>
              </>
            ) : (
              <Text style={styles.brandFallback}>{APP_NAME}</Text>
            )}
          </View>
          <View style={styles.copyPill}>
            <Text style={styles.copyPillText}>{COPY_LABELS[copyIndex]}</Text>
          </View>
        </View>

        <BrandGradientBar barStyle="gradientBar" styles={styles} />

        <View style={styles.businessBlock}>
          <Text style={styles.businessName}>
            {company.brand_name || company.company_name}
          </Text>
          {bilingual && company.name_ar ? <Text style={styles.businessName}>{company.name_ar}</Text> : null}
          <Text style={styles.taxInvoiceLabel}>
            {invoiceTitleFor(taxCtx, customer.tax_id)}
            {bilingual && showTax ? <Text style={styles.arabic}>{`  ·  ${AR.taxInvoice}`}</Text> : null}
          </Text>
          {company.brand_name && company.brand_name !== company.company_name ? (
            <Text style={styles.companyLine}>{company.company_name}</Text>
          ) : null}
          {addressLine ? <Text style={styles.muted}>{addressLine}</Text> : null}
          {contactLine ? <Text style={styles.muted}>{contactLine}</Text> : null}
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.sectionLabel}>{t("Bill To", "العميل")}</Text>
            <Text style={styles.bold}>{customer.name}</Text>
            {customer.billing_address ? (
              <Text style={styles.bodyText}>{customer.billing_address}</Text>
            ) : null}
            <Text style={styles.bodyText}>
              {customer.state}
              {customer.state ? " · " : ""}
              {customer.tax_id
                ? `${customerTaxIdLabel}: ${customer.tax_id}`
                : showTax
                  ? `Not ${taxName} registered`
                  : ""}
            </Text>
            {bilingual && showTax ? (
              <Text style={[styles.bodyText, styles.arabic]}>
                {customer.tax_id ? `${AR.trn}: ${customer.tax_id}` : AR.notRegistered}
              </Text>
            ) : null}
            {customer.phone ? (
              <Text style={styles.bodyText}>Ph: {customer.phone}</Text>
            ) : null}
          </View>
          <View style={styles.metaBlockRight}>
            <View style={styles.metaLine}>
              <Text style={styles.metaKey}>{t("Invoice No", "رقم الفاتورة")}</Text>
              <Text style={styles.metaVal}>{invoice.invoice_number}</Text>
            </View>
            <View style={styles.metaLine}>
              <Text style={styles.metaKey}>{t("Date", "التاريخ")}</Text>
              <Text style={styles.metaVal}>
                {new Date(invoice.invoice_date).toLocaleDateString("en-GB")}
              </Text>
            </View>
            <View style={styles.metaLine}>
              <Text style={styles.metaKey}>{t("Place of Supply", "مكان التوريد")}</Text>
              <Text style={styles.metaVal}>{placeOfSupply}</Text>
            </View>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.cell, styles.thText, { width: "4%" }]}>#</Text>
            <Text style={[styles.cell, styles.thText, { width: w.desc }]}>
              {t("Description", "الوصف")}
            </Text>
            <Text style={[styles.cellRight, styles.thText, { width: w.qty }]}>
              {getBusinessTypeConfig(businessType).invoiceLineFields.jewelleryPricing
                ? t("Pcs", "العدد")
                : t("Qty", "الكمية")}
            </Text>
            <Text style={[styles.cellRight, styles.thText, { width: w.rate }]}>
              {getBusinessTypeConfig(businessType).invoiceLineFields.jewelleryPricing
                ? t("Rate/g", "السعر/غ")
                : t("Rate", "السعر")}
            </Text>
            {showTax ? (
              <>
                <Text style={[styles.cellRight, styles.thText, { width: w.taxable }]}>
                  {t("Taxable", "الخاضع للضريبة")}
                </Text>
                <Text style={[styles.cellRight, styles.thText, { width: w.pct }]}>
                  {t(`${taxName} %`, "النسبة")}
                </Text>
                <Text style={[styles.cellRight, styles.thText, { width: w.vat }]}>
                  {t(taxName, "الضريبة")}
                </Text>
              </>
            ) : null}
            <Text style={[styles.cellRight, styles.thText, { width: w.amount }]}>
              {t("Amount", "المبلغ")}
            </Text>
          </View>
          {items.map((item, i) => {
            const line = lineParticulars(item, businessType, inr);
            const rowStyle =
              i % 2 === 1 ? [styles.tr, styles.trAlt] : [styles.tr];
            return (
              <View key={item.id} style={rowStyle}>
                <Text style={[styles.cell, { width: "4%" }]}>{i + 1}</Text>
                <View style={[styles.cell, { width: w.desc }]}>
                  <Text>{line.title}</Text>
                  {(gst && item.hsn_code ? [`HSN/SAC: ${item.hsn_code}`, ...line.meta] : line.meta).map((m) => (
                    <Text key={m} style={styles.lineMeta}>
                      {m}
                    </Text>
                  ))}
                </View>
                <Text style={[styles.cellRight, { width: w.qty }]}>
                  {formatQty(item.quantity, item.unit ?? item.product?.unit ?? (item.room_booking_id ? "night" : null))}
                </Text>
                <Text style={[styles.cellRight, { width: w.rate }]}>
                  {getBusinessTypeConfig(businessType).invoiceLineFields.jewelleryPricing &&
                  item.metal_rate_used != null
                    ? inr(item.metal_rate_used)
                    : inr(item.unit_price)}
                </Text>
                {showTax ? (
                  <>
                    <Text style={[styles.cellRight, { width: w.taxable }]}>
                      {inr(item.taxable_value)}
                    </Text>
                    <Text style={[styles.cellRight, { width: w.pct }]}>
                      {lineRateLabel(taxCtx, Number(item.vat_rate), item.vat_category)}
                    </Text>
                    <Text style={[styles.cellRight, { width: w.vat }]}>
                      {inr(item.vat_amount)}
                    </Text>
                  </>
                ) : null}
                <Text style={[styles.cellRight, { width: w.amount }]}>
                  {inr(Number(item.taxable_value) + Number(item.vat_amount))}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.totalsWrap}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {showTax ? t(`Total excl. ${taxName}`, "الإجمالي غير شامل الضريبة") : t("Subtotal", "المجموع")}
            </Text>
            <Text style={styles.totalValue}>{inr(invoice.subtotal)}</Text>
          </View>
          {summaryRows.map((row) => (
            <View key={row.key} style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                {row.kind === "tax"
                  ? t(row.label, AR.vat)
                  : t(row.label, row.key.startsWith("exempt") ? AR.exempt : AR.zeroRated)}
              </Text>
              <Text style={styles.totalValue}>{inr(row.amount)}</Text>
            </View>
          ))}
          {showTax ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t(`Total ${taxName}`, "إجمالي الضريبة")}</Text>
              <Text style={styles.totalValue}>{inr(invoice.total_vat)}</Text>
            </View>
          ) : null}
          {Number(invoice.round_off) !== 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t("Round Off", "التقريب")}</Text>
              <Text style={styles.totalValue}>{inr(invoice.round_off)}</Text>
            </View>
          ) : null}
          <View style={styles.grand}>
            <Text style={styles.grandLabel}>
              {showTax ? t(`Total incl. ${taxName}`, "الإجمالي شامل الضريبة") : t("Total", "الإجمالي")}
            </Text>
            <Text style={styles.grandValue}>{inr(invoice.grand_total)}</Text>
          </View>
        </View>

        <Text style={styles.words}>
          <Text style={styles.wordsLabel}>Amount in words: </Text>
          {amountInWords(invoice.grand_total, currency)}
        </Text>

        {note ? <Text style={styles.noteBox}>{note}</Text> : null}

        {qrSrc ? (
          <View style={styles.qrRow}>
            <Text style={styles.qrLabel}>{t("ZATCA QR code", "رمز QR - هيئة الزكاة والضريبة والجمارك")}</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={qrSrc} style={styles.qrImage} />
          </View>
        ) : null}

        {company.payment_link_url ? (
          <View style={styles.payBox}>
            <Text style={styles.payLabel}>{t("Pay online", "الدفع الإلكتروني")}</Text>
            <Link src={company.payment_link_url} style={styles.payLink}>
              {company.payment_link_url.replace(/^https?:\/\//, "")}
            </Link>
          </View>
        ) : null}

        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLabel}>For {company.company_name}</Text>
          {signatureSrc ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={signatureSrc} style={styles.signatureImage} />
          ) : (
            <View style={styles.signatureSpacer} />
          )}
          <View style={styles.signatureLine} />
          <Text style={styles.signatureTitle}>{t("Authorized Signatory", "المفوض بالتوقيع")}</Text>
        </View>

        <View style={styles.footer} fixed>
          <BrandGradientBar barStyle="footerAccent" styles={styles} />
          <View style={styles.footerRow}>
            <View style={styles.footerText}>
              {bankLine ? <Text>{bankLine}</Text> : null}
              <Text style={{ marginTop: 3 }}>
                This is a computer-generated {invoiceTitleFor(taxCtx, customer.tax_id)} from {company.company_name}.
              </Text>
            </View>
            {logoSrc ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoSrc} style={styles.footerMark} />
            ) : null}
          </View>
        </View>
      </Page>
    </Document>
  );
}
