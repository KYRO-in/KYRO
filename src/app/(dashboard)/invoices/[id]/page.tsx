"use client";

import { InvoiceCompanyHeader } from "@/components/invoices/invoice-company-header";
import { RecordPaymentModal } from "@/components/payments/record-payment-modal";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui/page-header";
import { useCompanySettings } from "@/hooks/use-company";
import { useInvoice, useInvoiceMutations } from "@/hooks/use-invoices";
import { HelpTip } from "@/components/ui/help-tip";
import { amountInWords } from "@/lib/amount-in-words";
import { buildPdfBlob, downloadInvoicePdf, printInvoicePdf } from "@/lib/invoice-pdf-download";
import { INVOICE_STATUS_LABELS, invoiceAmountDue } from "@/lib/invoice-payment";
import { isDemoMode } from "@/lib/demo/mode";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Download, MessageCircle, Pencil, Printer, Banknote, Mail, PartyPopper, Plus, ReceiptText, Repeat, X } from "lucide-react";
import { RepeatInvoiceModal } from "@/components/invoices/repeat-invoice-modal";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmailInvoiceModal } from "@/components/invoices/email-invoice-modal";
import type { EmailKind } from "@/lib/email/templates";
import { formatQty, getUnit } from "@/lib/units";
import { AnimatePresence, motion } from "motion/react";
import { APP_NAME, BRAND_LOGO_ICON } from "@/lib/brand";
import { getCountryConfig } from "@/lib/vat/countries";
import {
  contextForDocument,
  documentBreakdown,
  invoiceTitleFor,
  lineRateLabel,
  taxSummaryRows,
  treatmentNote,
} from "@/lib/vat/context";
import { ZatcaQr } from "@/components/invoices/zatca-qr";
import {
  invoiceShareMessage,
  paymentReminderMessage,
  whatsappShareUrl,
  whatsappUrl,
} from "@/lib/whatsapp";
import { useToast } from "@/components/ui/toast";
import { DueDateChip } from "@/components/collect/due-date-chip";
import { useBusinessType } from "@/hooks/use-business-type";
import { formatPurityLabel } from "@/lib/jewellery";

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { isAdmin, user, loading: authLoading, isReadOnly } = useAuth();
  const [repeatOpen, setRepeatOpen] = useState(false);
  const { isJewellery, isHotel } = useBusinessType();
  const {
    data: invoice,
    isLoading,
    isFetching,
    error: fetchError,
  } = useInvoice(id);
  const { data: company } = useCompanySettings();
  const { updateStatus } = useInvoiceMutations();
  const { toast } = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [forceEditOpen, setForceEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [waSharing, setWaSharing] = useState(false);
  const [noPhoneNote, setNoPhoneNote] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailKind, setEmailKind] = useState<EmailKind>("invoice");
  const searchParams = useSearchParams();
  const [justCreated, setJustCreated] = useState(false);

  // Arriving from "Generate invoice": open the email or celebrate, then tidy the URL
  useEffect(() => {
    if (!invoice) return;
    const send = searchParams.get("send");
    const created = searchParams.get("created");
    if (!send && !created) return;
    if (send === "email") {
      setEmailKind("invoice");
      setEmailOpen(true);
    }
    setJustCreated(true);
    router.replace(`/invoices/${invoice.id}`, { scroll: false });
  }, [invoice, searchParams, router]);

  const hasCustomerPhone = Boolean(
    invoice?.customer?.phone && invoice.customer.phone.replace(/\D/g, "").length > 0
  );

  const remindWa = useMemo(() => {
    if (!invoice || !company) return null;
    if (invoice.status !== "issued" && invoice.status !== "partially_paid") return null;
    const due = invoiceAmountDue(invoice.grand_total, invoice.amount_paid ?? 0);
    if (due <= 0) return null;
    return whatsappUrl(
      invoice.customer?.phone,
      paymentReminderMessage({
        companyName: company.brand_name || company.company_name,
        invoiceNumber: invoice.invoice_number,
        amount: due,
        currency: invoice.currency,
        customerName: invoice.customer?.name ?? "Customer",
        invoiceDate: formatDate(invoice.invoice_date),
      })
    );
  }, [invoice, company]);

  if (authLoading || isLoading || (isFetching && !invoice)) return <LoadingBlock />;
  if (fetchError) {
    return (
      <EmptyState
        title="Could not load invoice"
        description={
          (fetchError as Error).message ||
          "Check the browser console for [invoices] detail fetch error"
        }
      />
    );
  }
  if (!invoice) return <EmptyState title="Invoice not found" description={`No row for id ${id}`} />;

  // Each invoice keeps the currency and tax rules it was issued under
  const money = (n: number) => formatCurrency(n, invoice.currency);
  const taxCtx = contextForDocument(invoice, company ?? {}, invoice.customer);
  const taxName = taxCtx.country.taxName;
  const customerTaxIdLabel = getCountryConfig(invoice.customer?.country || taxCtx.country.code).taxIdLabel;
  const summaryRows = taxSummaryRows(taxCtx, documentBreakdown(taxCtx, invoice.items ?? []), money);
  const vatLabel = (rate: number, category: unknown) => lineRateLabel(taxCtx, rate, category);
  const note = treatmentNote(taxCtx);
  const showTaxColumns = !taxCtx.taxFree;
  const amountPaid = invoice.amount_paid ?? 0;
  const amountDue = invoiceAmountDue(invoice.grand_total, amountPaid);

  const handlePdf = async (mode: "download" | "print", copy: 0 | 1 | 2 = 0) => {
    if (!company) {
      toast("Company settings not loaded yet", "error");
      return;
    }
    setPdfLoading(true);
    try {
      if (mode === "print") await printInvoicePdf(invoice, company);
      else await downloadInvoicePdf(invoice, company, copy);
      if (mode === "download") toast("PDF downloaded");
    } catch (e) {
      console.error("[pdf]", e);
      toast((e as Error).message || "PDF failed", "error");
    } finally {
      setPdfLoading(false);
    }
  };

  const handleWhatsAppShare = async () => {
    if (!company) {
      toast("Company settings not loaded yet", "error");
      return;
    }
    setWaSharing(true);
    setNoPhoneNote(!hasCustomerPhone);
    try {
      if (isDemoMode()) {
        const message = invoiceShareMessage({
          companyName: company.brand_name || company.company_name,
          invoiceNumber: invoice.invoice_number,
          amount: amountDue,
          currency: invoice.currency,
          customerName: invoice.customer?.name ?? "Customer",
        });
        const url = whatsappShareUrl(invoice.customer?.phone, message);
        toast("Demo mode - sharing without PDF link (Storage requires live Supabase)", "info");
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      const blob = await buildPdfBlob(invoice, company, 0);
      const form = new FormData();
      form.append(
        "pdf",
        new File([blob], `${APP_NAME} Invoice.pdf`, { type: "application/pdf" })
      );

      const res = await fetch(`/api/invoices/${invoice.id}/share-whatsapp`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        error?: string;
        whatsappUrl?: string;
        hasPhone?: boolean;
      };
      if (!res.ok || !json.whatsappUrl) {
        throw new Error(json.error ?? "Could not prepare WhatsApp share");
      }
      if (json.hasPhone === false) setNoPhoneNote(true);
      window.open(json.whatsappUrl, "_blank", "noopener,noreferrer");
      toast("WhatsApp ready - short download link included");
    } catch (e) {
      console.error("[whatsapp-share]", e);
      toast((e as Error).message || "WhatsApp share failed", "error");
    } finally {
      setWaSharing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={invoice.invoice_number}
        description={`Dated ${formatDate(invoice.invoice_date)} · ${invoice.customer?.name ?? ""}`}
        actions={
          <>
            <Link href="/invoices">
              <Button variant="outline">Back</Button>
            </Link>
            <Button
              variant="outline"
              loading={pdfLoading}
              onClick={() => handlePdf("print")}
            >
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Link href={`/receipt/${invoice.id}?print=1`}>
              <Button variant="outline" type="button">
                <ReceiptText className="h-4 w-4" /> Receipt
              </Button>
            </Link>
            {invoice.status !== "cancelled" && !isReadOnly && (
              <Button variant="outline" type="button" onClick={() => setRepeatOpen(true)}>
                <Repeat className="h-4 w-4" /> Repeat
              </Button>
            )}
            <Button loading={pdfLoading} onClick={() => handlePdf("download", 0)}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            {invoice.status !== "cancelled" && (
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setEmailKind("invoice");
                  setEmailOpen(true);
                }}
              >
                <Mail className="h-4 w-4" /> Email
              </Button>
            )}
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="secondary"
                type="button"
                loading={waSharing}
                onClick={() => void handleWhatsAppShare()}
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </Button>
              {(noPhoneNote || !hasCustomerPhone) && (
                <p className="max-w-[220px] text-right text-[11px] text-slate">
                  No phone number on file for this customer.
                </p>
              )}
            </div>
          </>
        }
      />

      <AnimatePresence>
        {justCreated && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="relative mb-4 overflow-hidden rounded-[14px] border border-primary/25 bg-gradient-to-r from-[#7c1cf0]/10 via-[#b65cff]/10 to-transparent p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-[0_6px_18px_rgba(124,28,240,0.35)]">
                <PartyPopper className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-semibold text-ink">
                  {invoice.invoice_number} is ready - {money(invoice.grand_total)}
                </p>
                <p className="text-sm text-slate">Send it while it&apos;s fresh. Customers pay faster when the bill lands right away.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => (setEmailKind("invoice"), setEmailOpen(true))}>
                  <Mail className="h-3.5 w-3.5" /> Email
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void handleWhatsAppShare()}>
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </Button>
                <Link href="/invoices/new">
                  <Button size="sm" variant="outline">
                    <Plus className="h-3.5 w-3.5" /> Another invoice
                  </Button>
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setJustCreated(false)}
                className="absolute right-2 top-2 rounded-full p-1 text-slate hover:bg-surface hover:text-ink"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge
          variant={
            invoice.status === "paid"
              ? "success"
              : invoice.status === "cancelled"
                ? "danger"
                : invoice.status === "partially_paid"
                  ? "warning"
                  : "info"
          }
        >
          {INVOICE_STATUS_LABELS[invoice.status]}
        </Badge>
        {invoice.last_emailed_at && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            <Mail className="h-3 w-3" /> Emailed {formatDate(invoice.last_emailed_at)}
          </span>
        )}
        {invoice.status !== "cancelled" && <DueDateChip invoice={invoice} editable={!isReadOnly} />}
        {(invoice.status === "issued" || invoice.status === "partially_paid") && (
          <Link href={`/invoices/${invoice.id}/edit`}>
            <Button size="sm" variant="outline">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </Link>
        )}
        {isAdmin && invoice.status !== "issued" && invoice.status !== "partially_paid" && (
          <Button size="sm" variant="outline" onClick={() => setForceEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
        {(invoice.status === "issued" || invoice.status === "partially_paid") && user && (
          <>
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <Banknote className="h-3.5 w-3.5" /> Record payment
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                updateStatus.mutate({ id: invoice.id, status: "paid", user_id: user.id })
              }
            >
              Mark paid
            </Button>
          </>
        )}
        {remindWa && (
          <a href={remindWa} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" type="button">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp reminder
            </Button>
          </a>
        )}
        {amountDue > 0 && invoice.status !== "cancelled" && (
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => {
              setEmailKind("reminder");
              setEmailOpen(true);
            }}
          >
            <Mail className="h-3.5 w-3.5" /> Email reminder
          </Button>
        )}
        {isAdmin && invoice.status !== "cancelled" && (
          <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>
            Void invoice
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[10px] bg-[var(--logo-plate)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BRAND_LOGO_ICON}
              alt={APP_NAME}
              className="h-8 w-8 object-contain"
            />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => handlePdf("download", 0)}>
              Original
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handlePdf("download", 1)}>
              Duplicate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handlePdf("download", 2)}>
              Triplicate
            </Button>
          </div>
        </div>
      </div>

      {company ? (
        <div className="panel mb-6 p-4 sm:p-5">
          <InvoiceCompanyHeader company={company} documentTitle={invoiceTitleFor(taxCtx, invoice.customer?.tax_id)} />
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="panel p-4 text-sm">
          <p className="mb-1 text-xs text-slate">Bill to</p>
          <p className="font-semibold text-ink">{invoice.customer?.name}</p>
          <p className="text-slate">{invoice.customer?.billing_address}</p>
          <p className="text-ink">
            {invoice.customer?.state}
            {invoice.customer?.tax_id ? (
              <span className="font-mono">
                {invoice.customer?.state ? " · " : ""}
                {customerTaxIdLabel} {invoice.customer.tax_id}
              </span>
            ) : taxCtx.taxFree ? null : (
              `${invoice.customer?.state ? " · " : ""}Not ${taxName} registered`
            )}
          </p>
        </div>
        <div className="panel p-4 text-sm">
          <p className="mb-1 text-xs text-slate">{invoiceTitleFor(taxCtx, invoice.customer?.tax_id)}</p>
          <p className="font-semibold text-ink">
            {taxCtx.taxFree
              ? "No sales tax"
              : invoice.prices_include_vat
                ? `Prices include ${taxName}`
                : `${taxName} added to prices`}
            {" · "}
            {invoice.currency}
          </p>
          <p className="mt-1 text-slate">Place of supply: {taxCtx.placeOfSupply}</p>
          {note ? <p className="mt-1 text-xs text-slate">{note}</p> : null}
          <p className="mt-2 text-slate">Created by {invoice.creator?.full_name ?? "-"}</p>
          {invoice.edited_at && (
            <p className="mt-1 text-xs text-slate">
              Last edited {formatDate(invoice.edited_at)}
            </p>
          )}
          {invoice.cancelled_reason && (
            <p className="mt-2 text-xs text-rose">Void reason: {invoice.cancelled_reason}</p>
          )}
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead className="bg-surface">
            {isJewellery ? (
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Hallmark No.</th>
                <th>Purity</th>
                <th>Gross Wt</th>
                <th>Net Wt</th>
                <th>Rate/g</th>
                <th>Metal Value</th>
                <th>Making</th>
                <th>Stone</th>
                <th>Taxable</th>
                {showTaxColumns && <th>{taxName} %</th>}
                {showTaxColumns && <th>{taxName}</th>}
              </tr>
            ) : (
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>{showTaxColumns ? "Taxable" : "Amount"}</th>
                {showTaxColumns && <th>{taxName} %</th>}
                {showTaxColumns && <th>{taxName}</th>}
                <th>Total</th>
              </tr>
            )}
          </thead>
          <tbody>
            {(invoice.items ?? []).map((item, i) => {
              const metalValue =
                item.metal_rate_used != null && item.net_weight != null
                  ? Number(item.net_weight) * Number(item.metal_rate_used)
                  : null;
              if (isJewellery) {
                return (
                  <tr key={item.id}>
                    <td>{i + 1}</td>
                    <td>
                      {item.product?.name}
                      {item.price_overridden && (
                        <Badge variant="warning" className="ml-2">
                          Rate override
                        </Badge>
                      )}
                      {(item.rate_locked_at_sale ?? item.metal_rate_used) != null && (
                        <p className="mt-0.5 font-mono text-[11px] text-slate">
                          Locked {money(item.rate_locked_at_sale ?? item.metal_rate_used!)}/g
                        </p>
                      )}
                    </td>
                    <td className="font-mono text-xs">
                      {item.jewellery_huid || item.product?.huid_number || "-"}
                    </td>
                    <td>{formatPurityLabel(item.jewellery_purity || item.product?.purity)}</td>
                    <td className="num">{item.gross_weight ?? "-"}</td>
                    <td className="num">{item.net_weight ?? "-"}</td>
                    <td className="num">
                      {item.metal_rate_used != null
                        ? money(item.metal_rate_used)
                        : "-"}
                    </td>
                    <td className="num">
                      {metalValue != null ? money(metalValue) : "-"}
                    </td>
                    <td className="num">
                      {item.making_charge_amount != null
                        ? money(item.making_charge_amount)
                        : "-"}
                    </td>
                    <td className="num">
                      {item.stone_value != null ? money(item.stone_value) : "-"}
                    </td>
                    <td className="num">{money(item.taxable_value)}</td>
                    {showTaxColumns && <td className="num">{vatLabel(item.vat_rate, item.vat_category)}</td>}
                    {showTaxColumns && <td className="num">{money(item.vat_amount)}</td>}
                  </tr>
                );
              }
              return (
              <tr key={item.id}>
                <td>{i + 1}</td>
                <td>
                  {item.room_booking_id
                    ? "Room stay"
                    : item.product?.name}
                  {item.price_overridden && (
                    <Badge variant="warning" className="ml-2">
                      Override
                    </Badge>
                  )}
                  {(item.imei_serial ||
                    item.batch_number ||
                    item.variant_tag ||
                    item.check_in_date ||
                    item.check_out_date ||
                    item.guest_id_proof) && (
                    <p className="mt-0.5 text-[11px] text-slate">
                      {[
                        item.imei_serial ? `IMEI/S/N: ${item.imei_serial}` : null,
                        item.batch_number ? `Batch: ${item.batch_number}` : null,
                        item.variant_tag ? item.variant_tag : null,
                        item.check_in_date ? `Check-in: ${item.check_in_date}` : null,
                        item.check_out_date ? `Check-out: ${item.check_out_date}` : null,
                        item.guest_id_proof ? `ID: ${item.guest_id_proof}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {isHotel && item.quantity > 0 && (
                    <p className="mt-0.5 text-[11px] text-slate">
                      {item.quantity} night{item.quantity === 1 ? "" : "s"}
                    </p>
                  )}
                </td>
                <td className="num">{formatQty(item.quantity, item.unit ?? item.product?.unit)}</td>
                <td className="num">
                  {money(item.unit_price)}
                  {!item.room_booking_id && (
                    <span className="ml-1 text-[11px] text-slate">/ {getUnit(item.unit ?? item.product?.unit).short}</span>
                  )}
                </td>
                <td className="num">{money(item.taxable_value)}</td>
                {showTaxColumns && <td className="num">{vatLabel(item.vat_rate, item.vat_category)}</td>}
                {showTaxColumns && <td className="num">{money(item.vat_amount)}</td>}
                <td className="num font-medium">{money(item.line_total)}</td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 ml-auto w-full max-w-sm space-y-2.5 panel p-5">
        <div className="leader-row text-sm">
          <span className="shrink-0 text-slate">{taxCtx.taxFree ? "Amount" : `Total excl. ${taxName}`}</span>
          <span className="leader-line" aria-hidden />
          <span className="shrink-0 font-mono text-ink">{money(invoice.subtotal)}</span>
        </div>
        {summaryRows.map((row) => (
          <div key={row.key} className="leader-row text-sm">
            <span className="inline-flex min-w-0 items-center gap-1 text-slate">
              {row.label}
              {row.helpVat ? <HelpTip helpKey="vat" /> : null}
            </span>
            <span className="leader-line" aria-hidden />
            <span className="shrink-0 font-mono text-ink">{money(row.amount)}</span>
          </div>
        ))}
        {!taxCtx.taxFree && (
          <div className="leader-row text-sm">
            <span className="shrink-0 text-slate">Total {taxName}</span>
            <span className="leader-line" aria-hidden />
            <span className="shrink-0 font-mono text-ink">{money(invoice.total_vat)}</span>
          </div>
        )}
        {Number(invoice.round_off) !== 0 && (
          <div className="leader-row text-sm">
            <span className="shrink-0 text-slate">Round off</span>
            <span className="leader-line" aria-hidden />
            <span className="shrink-0 font-mono text-ink">{money(invoice.round_off)}</span>
          </div>
        )}
        <div className="mt-2 rounded-[10px] border border-sage bg-sage-soft px-3 py-3">
          <div className="flex items-end justify-between gap-3">
            <span className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-sage">
              {taxCtx.taxFree ? "Total" : `Total incl. ${taxName}`}
            </span>
            <span className="font-display text-2xl font-semibold tracking-tight text-sage">
              <span className="font-mono">{money(invoice.grand_total)}</span>
            </span>
          </div>
        </div>
        {(amountPaid > 0 || invoice.status === "partially_paid") && (
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between text-slate">
              <span>Amount paid</span>
              <span className="font-mono text-emerald">{money(amountPaid)}</span>
            </div>
            <div className="flex justify-between font-semibold text-ink">
              <span>Balance due</span>
              <span className="font-mono text-coral-deep">{money(amountDue)}</span>
            </div>
          </div>
        )}
        <p className="mt-1 text-right text-xs text-slate">{amountInWords(invoice.grand_total, invoice.currency)}</p>
        {taxCtx.country.zatcaQr && company?.tax_id ? (
          <div className="mt-3 flex items-center justify-end gap-3">
            <p className="text-right text-[11px] text-slate">ZATCA QR code (phase 1)</p>
            <ZatcaQr
              sellerName={company.company_name}
              vatNumber={company.tax_id}
              invoiceDate={invoice.invoice_date}
              createdAt={invoice.created_at}
              total={invoice.grand_total}
              vatTotal={invoice.total_vat}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-10 flex justify-end">
        <div className="flex w-[180px] flex-col items-center text-center">
          <p className="mb-2 text-[11px] text-slate">
            For {company?.company_name ?? "Company"}
          </p>
          {company?.signature_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.signature_url}
              alt="Authorized signature"
              className="mb-1 h-14 w-auto max-w-[150px] object-contain"
            />
          ) : (
            <div className="mb-1 h-14 w-full" aria-hidden />
          )}
          <div className="mb-1 w-full border-t border-ink/40" />
          <p className="text-[11px] font-medium text-ink">Authorized Signatory</p>
        </div>
      </div>

      <ConfirmModal
        open={forceEditOpen}
        onClose={() => setForceEditOpen(false)}
        title="Edit a non-issued invoice?"
        message={`This invoice is ${INVOICE_STATUS_LABELS[invoice.status].toLowerCase()}. Editing after payment or cancellation should only be done when absolutely necessary. Stock will be reversed and re-applied. Continue?`}
        confirmLabel="Edit anyway"
        danger
        onConfirm={() => {
          setForceEditOpen(false);
          router.push(`/invoices/${invoice.id}/edit?force=1`);
        }}
      />
      <ConfirmModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Void this invoice?"
        message={`Are you sure you want to void ${invoice.invoice_number}? Stock will be put back. This cannot be undone.`}
        confirmLabel="Yes, void it"
        danger
        loading={updateStatus.isPending}
        onConfirm={async () => {
          if (!user || !cancelReason.trim()) return;
          await updateStatus.mutateAsync({
            id: invoice.id,
            status: "cancelled",
            cancelled_reason: cancelReason,
            user_id: user.id,
            restoreStock: true,
          });
          setCancelOpen(false);
          toast("Done - invoice voided.");
        }}
      />
      {cancelOpen && (
        <div className="fixed bottom-6 left-1/2 z-[60] w-full max-w-md -translate-x-1/2 panel p-4">
          <input
            className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus:border-emerald focus:outline-none"
            placeholder="Cancellation reason (required)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      )}
      <RepeatInvoiceModal invoice={invoice} open={repeatOpen} onClose={() => setRepeatOpen(false)} />

      <EmailInvoiceModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        invoice={invoice}
        initialKind={emailKind}
      />
      <RecordPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        customerId={invoice.customer_id}
        invoiceId={invoice.id}
        defaultAmount={amountDue > 0 ? amountDue : undefined}
        title={`Record payment - ${invoice.invoice_number}`}
      />
    </div>
  );
}
