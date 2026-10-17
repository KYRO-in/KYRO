"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useRecurringMutations } from "@/hooks/use-recurring";
import {
  RECURRING_FREQUENCIES,
  isoDate,
  nextRunDate,
  recurringItemsFromInvoice,
  recurringTotal,
} from "@/lib/recurring";
import type { Invoice, RecurringFrequency } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/** Turn an invoice into a schedule that repeats it (same customer, items and prices). */
export function RepeatInvoiceModal({
  invoice,
  open,
  onClose,
}: {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
}) {
  const { save } = useRecurringMutations();
  const { toast } = useToast();
  const items = useMemo(() => recurringItemsFromInvoice(invoice), [invoice]);
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSavedId(null);
    const first = nextRunDate(invoice.invoice_date.slice(0, 10), frequency);
    const today = isoDate(new Date());
    setStart(first < today ? today : first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, frequency]);

  const currency = invoice.currency || "AED";
  const total = recurringTotal(items);

  const submit = () => {
    if (!start) return;
    if (end && end < start) {
      toast("The end date must be after the first date.", "error");
      return;
    }
    save.mutate(
      {
        customer_id: invoice.customer_id,
        source_invoice_id: invoice.id,
        name: `${invoice.customer?.name ?? "Customer"} · ${items.map((i) => i.name).slice(0, 2).join(", ")}`.slice(0, 120),
        frequency,
        next_run_date: start,
        end_date: end || null,
        items,
        prices_include_vat: !!invoice.prices_include_vat,
        warehouse_id: invoice.warehouse_id ?? null,
        notes: invoice.notes ?? null,
        active: true,
      },
      {
        onSuccess: (row) => {
          setSavedId(row.id);
          toast("Recurring invoice saved");
        },
        onError: (e) => toast((e as Error).message, "error"),
      }
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Repeat this invoice">
      {savedId ? (
        <div className="space-y-4 text-sm">
          <p className="text-ink">
            Done. The next invoice for <strong>{invoice.customer?.name}</strong> is due on{" "}
            <strong>{formatDate(start)}</strong>. When it&apos;s due, Kayyro shows it on your dashboard and you create it with one
            tap.
          </p>
          <div className="flex justify-end gap-2">
            <Link href="/invoices/recurring">
              <Button type="button" variant="secondary">
                See recurring invoices
              </Button>
            </Link>
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate">
          This invoice has no catalog items to repeat (room stays and custom lines can&apos;t be repeated).
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate">
            Same customer, items and prices: {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold text-ink">{formatCurrency(total, currency)}</span> before VAT. VAT uses each
            product&apos;s rate on the day.
          </p>
          <Select
            id="frequency"
            label="Repeat"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
            options={RECURRING_FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input id="start" label="First invoice on" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
            <Input id="end" label="Stop after (optional)" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} loading={save.isPending} disabled={!start}>
              Save schedule
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
