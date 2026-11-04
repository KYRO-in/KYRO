"use client";

import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/ui/toast";
import { useCollectMessages, useCollectOpenItems, useCollectSettings, useCustomerRisk } from "@/hooks/use-collect";
import { useOrgAccess } from "@/hooks/use-org-access";
import { RiskBadge } from "@/components/collect/risk-badge";
import { useCustomerMutations } from "@/hooks/use-customers";
import { COLLECT_DICT, intentLabel, stepLabel } from "@/lib/collect/i18n";
import { addDaysIso, isOpen } from "@/lib/collect/status";
import type { Customer, Invoice } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { CalendarCheck, Flag, Mail, MessageCircle, MessageSquareText, Phone } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

const t = COLLECT_DICT.en;

/** Customer page: reminder timeline, the next planned reminder, and the pause switch. */
export function CustomerCollectPanel({ customer, invoices }: { customer: Customer; invoices: Invoice[] }) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const { upsert } = useCustomerMutations();
  const { data: collect } = useCollectSettings();
  const { data: messages } = useCollectMessages({ customerId: customer.id });
  const { data: open } = useCollectOpenItems();
  const { can, org } = useOrgAccess();
  const { data: risk } = useCustomerRisk(can("collectInsights"));
  const myRisk = risk?.get(customer.id);
  const today = new Date().toLocaleDateString("en-CA");

  const openInvoices = useMemo(
    () =>
      invoices
        .filter((i) => isOpen({ ...i, amount_paid: Number(i.amount_paid ?? 0), due_date: i.due_date ?? null }))
        .map((i) => ({ inv: i, due: i.due_date ?? addDaysIso(i.invoice_date, 30) }))
        .sort((a, b) => a.due.localeCompare(b.due)),
    [invoices]
  );

  const next = useMemo(() => {
    if (customer.collect_opted_out_at) return "Stopped by the customer";
    if (customer.collect_paused) return "Paused";
    if (!collect?.settings.enabled) return "Kayyro Collect is off";
    const disputed = new Set((open?.disputes ?? []).map((d) => d.invoice_id));
    const promised = new Map((open?.promises ?? []).map((p) => [p.invoice_id, p.promised_date] as const));
    const steps = (collect.steps ?? []).filter((s) => s.active).sort((a, b) => a.offset_days - b.offset_days);
    let best: { date: string; label: string; invoice: string } | null = null;
    for (const { inv, due } of openInvoices) {
      if (disputed.has(inv.id)) continue;
      const after = promised.get(inv.id);
      const done = new Set((messages ?? []).filter((m) => m.invoice_id === inv.id && m.status === "sent").map((m) => m.step_key));
      if (after && after >= today) continue;
      const label = (s: (typeof steps)[number]) => (s.action === "call_task" ? "Call the customer" : stepLabel(t, s.step_key));
      // The scheduler sends the latest step that has come due (if not sent yet), otherwise waits for the next one
      const reached = steps.filter((s) => addDaysIso(due, s.offset_days) <= today).pop();
      const upcoming = steps.find((s) => addDaysIso(due, s.offset_days) > today);
      const pick =
        reached && reached.action === "message" && !done.has(reached.step_key)
          ? { date: today, label: label(reached) }
          : upcoming
            ? { date: addDaysIso(due, upcoming.offset_days), label: label(upcoming) }
            : null;
      if (pick && (!best || pick.date < best.date)) best = { ...pick, invoice: inv.invoice_number };
    }
    return best ? `${best.label} ${best.date === today ? "today" : `on ${formatDate(best.date)}`} · ${best.invoice}` : openInvoices.length ? "Nothing scheduled" : "Nothing owed";
  }, [customer, collect, open, openInvoices, messages, today]);

  const timeline = useMemo(() => {
    const ids = new Set(invoices.map((i) => i.id));
    const number = new Map(invoices.map((i) => [i.id, i.invoice_number] as const));
    const items: { at: string; icon: "wa" | "email" | "reply" | "promise" | "dispute"; text: string; sub: string }[] = [];
    for (const m of messages ?? []) {
      if (m.direction === "in") {
        items.push({
          at: m.sent_at ?? m.created_at,
          icon: "reply",
          text: `Replied${m.intent ? ` (${intentLabel(t, m.intent).toLowerCase()})` : ""}: “${(m.body ?? "").slice(0, 120)}”`,
          sub: number.get(m.invoice_id ?? "") ?? m.invoice?.invoice_number ?? "",
        });
        continue;
      }
      if (m.status !== "sent" && m.status !== "failed") continue;
      items.push({
        at: m.sent_at ?? m.created_at,
        icon: m.channel === "whatsapp" ? "wa" : "email",
        text: `${m.manual ? t.manual : `${m.kind === "reply" ? `${t.answer}: ` : ""}${stepLabel(t, m.step_key)}`} · ${m.channel === "whatsapp" ? "WhatsApp" : "Email"}${m.status === "failed" ? " (failed)" : ""}`,
        sub: number.get(m.invoice_id ?? "") ?? m.invoice?.invoice_number ?? "",
      });
    }
    for (const p of open?.promises ?? []) {
      if (ids.has(p.invoice_id)) items.push({ at: p.created_at, icon: "promise", text: `Promised to pay on ${formatDate(p.promised_date)}`, sub: number.get(p.invoice_id) ?? "" });
    }
    for (const d of open?.disputes ?? []) {
      if (ids.has(d.invoice_id)) items.push({ at: d.created_at, icon: "dispute", text: `Disputed: ${d.reason}`, sub: number.get(d.invoice_id) ?? "" });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  }, [messages, open, invoices]);

  const togglePause = () =>
    upsert.mutate(
      {
        id: customer.id,
        name: customer.name,
        state: customer.state,
        customer_type: customer.customer_type,
        country: customer.country,
        email: customer.email,
        phone: customer.phone,
        tax_id: customer.tax_id,
        billing_address: customer.billing_address,
        collect_paused: !customer.collect_paused,
      },
      {
        onSuccess: () => toast(customer.collect_paused ? "Reminders resumed" : "Reminders paused"),
        onError: (e) => toast((e as Error).message, "error"),
      }
    );

  if (!collect) return null;

  return (
    <section className="panel mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-ink">Payment reminders</h2>
          <p className="mt-1 text-sm text-slate">
            Next: <span className="font-medium text-ink">{next}</span>
          </p>
          {myRisk && (
            <div className="mt-2">
              <RiskBadge risk={myRisk} currency={org?.currency || "AED"} detailed />
            </div>
          )}
          {customer.whatsapp_opt_in_at && (
            <p className="mt-0.5 text-xs text-slate">WhatsApp opt-in since {formatDate(customer.whatsapp_opt_in_at)}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/collect" className="text-sm text-primary hover:underline">
            Get Paid
          </Link>
          {isAdmin && !customer.collect_opted_out_at && (
            <button
              type="button"
              role="switch"
              aria-checked={!customer.collect_paused}
              disabled={upsert.isPending}
              onClick={togglePause}
              className="flex min-h-[40px] items-center gap-2 text-sm text-ink"
            >
              <span className={cn("relative h-6 w-11 rounded-full transition-colors", customer.collect_paused ? "bg-border" : "bg-primary")}>
                <span
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                    customer.collect_paused ? "start-0.5" : "start-[22px]"
                  )}
                />
              </span>
              {customer.collect_paused ? "Paused" : "On"}
            </button>
          )}
        </div>
      </div>

      {timeline.length > 0 && (
        <ol className="mt-4 space-y-2 border-s border-border ps-4">
          {timeline.map((item, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -start-[25px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface">
                {item.icon === "wa" ? (
                  <MessageCircle className="h-3.5 w-3.5 text-sage" />
                ) : item.icon === "email" ? (
                  <Mail className="h-3.5 w-3.5 text-primary" />
                ) : item.icon === "reply" ? (
                  <MessageSquareText className="h-3.5 w-3.5 text-violet" />
                ) : item.icon === "promise" ? (
                  <CalendarCheck className="h-3.5 w-3.5 text-violet" />
                ) : (
                  <Flag className="h-3.5 w-3.5 text-tangerine" />
                )}
              </span>
              <span className="text-ink">{item.text}</span>
              <span className="block text-[11px] text-slate">
                {formatDate(item.at)}
                {item.sub ? ` · ${item.sub}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      {customer.phone && openInvoices.length > 0 && (
        <a href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`} className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate hover:text-ink">
          <Phone className="h-3.5 w-3.5" /> {customer.phone}
        </a>
      )}
    </section>
  );
}
