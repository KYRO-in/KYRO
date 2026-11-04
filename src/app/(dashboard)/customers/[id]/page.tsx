"use client";

import { RecordPaymentModal } from "@/components/payments/record-payment-modal";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui/page-header";
import { CustomerFormModal } from "@/components/customers/customer-form-modal";
import { CustomerCollectPanel } from "@/components/collect/customer-collect-panel";
import { useBusinessType } from "@/hooks/use-business-type";
import { useCompanySettings } from "@/hooks/use-company";
import { useCustomers } from "@/hooks/use-customers";
import { useInvoices } from "@/hooks/use-invoices";
import { usePayments } from "@/hooks/use-payments";
import { buildCustomerLedger } from "@/lib/customer-ledger";
import { customerTypeLabel, PAYMENT_MODE_LABELS } from "@/lib/constants";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  outstandingReminderMessage,
  whatsappShareUrl,
} from "@/lib/whatsapp";
import { ArrowLeft, MessageCircle, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

export default function CustomerDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { isAdmin } = useAuth();
  const { isHotel, isJewellery } = useBusinessType();
  const hideCustomerType = isHotel || isJewellery;
  const { data: customers, isLoading: loadingCust } = useCustomers();
  const { data: invoices, isLoading: loadingInv } = useInvoices();
  const { data: payments, isLoading: loadingPay } = usePayments(id);
  const { data: company } = useCompanySettings();
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const customer = useMemo(
    () => (customers ?? []).find((c) => c.id === id) ?? null,
    [customers, id]
  );

  const customerInvoices = useMemo(
    () => (invoices ?? []).filter((i) => i.customer_id === id),
    [invoices, id]
  );

  const { summary, entries } = useMemo(
    () => buildCustomerLedger(customerInvoices, payments ?? []),
    [customerInvoices, payments]
  );

  const remindWa = useMemo(() => {
    if (!customer || !company || summary.outstanding <= 0) return null;
    return whatsappShareUrl(
      customer.phone,
      outstandingReminderMessage({
        companyName: company.brand_name || company.company_name,
        customerName: customer.name,
        amount: summary.outstanding,
      })
    );
  }, [customer, company, summary.outstanding]);

  if (loadingCust || loadingInv || loadingPay) return <LoadingBlock />;
  if (!customer) {
    return (
      <EmptyState
        title="Customer not found"
        description="This customer may have been deleted."
        action={
          <Link href="/customers">
            <Button variant="secondary">Back to customers</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Credit / Ledger"
        title={customer.name}
        description={`${hideCustomerType ? "" : `${customerTypeLabel(customer.customer_type)} · `}${customer.state}${
          customer.phone ? ` · ${customer.phone}` : ""
        }`}
        accent="violet"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/customers">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" /> Customers
              </Button>
            </Link>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {remindWa && (
              <a href={remindWa} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" type="button">
                  <MessageCircle className="h-4 w-4" /> Reminder
                </Button>
              </a>
            )}
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <Plus className="h-4 w-4" /> Record payment
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate">
            Total billed
          </p>
          <p className="mt-1 font-display text-xl font-semibold text-ink tabular-nums">
            {formatCurrency(summary.totalBilled)}
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate">
            Total paid
          </p>
          <p className="mt-1 font-display text-xl font-semibold text-ink tabular-nums">
            {formatCurrency(summary.totalPaid)}
          </p>
        </div>
        <div className="panel panel-accent-sun wash-sun p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate">
            Outstanding balance
          </p>
          <p
            className={`mt-1 font-display text-xl font-semibold tabular-nums ${
              summary.outstanding > 0 ? "text-coral-deep" : "text-emerald"
            }`}
          >
            {formatCurrency(summary.outstanding)}
          </p>
        </div>
      </div>

      <CustomerCollectPanel customer={customer} invoices={customerInvoices} />

      <div className="panel overflow-hidden">
        <div className="border-b border-border/70 px-5 py-4">
          <h2 className="font-display text-sm font-semibold text-ink">
            Khata / ledger
          </h2>
          <p className="mt-1 text-xs text-slate">
            Chronological invoices and payments with running balance
          </p>
        </div>
        {!entries.length ? (
          <p className="px-5 py-10 text-center text-sm text-slate">
            No invoices or payments yet for this customer.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-cloud/80 text-xs uppercase tracking-wide text-slate">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Entry</th>
                  <th className="px-5 py-3 font-medium text-right">Debit</th>
                  <th className="px-5 py-3 font-medium text-right">Credit</th>
                  <th className="px-5 py-3 font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 text-ink">
                    <td className="px-5 py-2.5 whitespace-nowrap text-slate">
                      {formatDate(e.date)}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={e.kind === "invoice" ? "info" : "success"}>
                          {e.kind === "invoice" ? "Invoice" : "Payment"}
                        </Badge>
                        {e.invoice_id ? (
                          <Link
                            href={`/invoices/${e.invoice_id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {e.label}
                          </Link>
                        ) : (
                          <span className="font-medium">{e.label}</span>
                        )}
                      </div>
                      {e.kind === "payment" && e.payment_mode && (
                        <p className="mt-0.5 text-[11px] text-slate">
                          {PAYMENT_MODE_LABELS[e.payment_mode]}
                          {e.notes ? ` · ${e.notes}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {e.delta > 0 ? formatCurrency(e.delta) : "-"}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-emerald">
                      {e.delta < 0 ? formatCurrency(-e.delta) : "-"}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-medium tabular-nums ${
                        e.runningBalance > 0 ? "text-coral-deep" : "text-emerald"
                      }`}
                    >
                      {formatCurrency(e.runningBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RecordPaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        customerId={customer.id}
        title={`Record payment - ${customer.name}`}
      />
      <CustomerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={customer}
      />
    </div>
  );
}
