"use client";

import { useAuth } from "@/components/auth-provider";
import {
  CollectShell,
  CollectTabs,
  LockedPreview,
  RemindButtons,
  StatusPill,
  useCollectLang,
} from "@/components/collect/collect-ui";
import { ClaimActions, LogReplyButton } from "@/components/collect/reply-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useCollectMessages, useCollectMutations, useCollectOpenItems, useCollectSettings, useCustomerRisk } from "@/hooks/use-collect";
import { RiskBadge } from "@/components/collect/risk-badge";
import { useCreditNotes } from "@/hooks/use-credit-notes";
import { useInvoices } from "@/hooks/use-invoices";
import { useOrgAccess } from "@/hooks/use-org-access";
import { usePayments } from "@/hooks/use-payments";
import {
  addDaysIso,
  balanceDue,
  collectStatus,
  daysBetween,
  getPaidSummary,
  isOpen,
  weekEnd,
  type CollectInvoice,
} from "@/lib/collect/status";
import type { Invoice } from "@/lib/types";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { BadgeCheck, CalendarCheck, Flag, Inbox, MessageSquareText, Phone, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

function localToday() {
  return new Date().toLocaleDateString("en-CA");
}

export default function GetPaidPage() {
  return (
    <CollectShell>
      <GetPaid />
    </CollectShell>
  );
}

type Row = { inv: Invoice; c: CollectInvoice; due: string };

function GetPaid() {
  const { t, lang } = useCollectLang();
  const { isAdmin, isReadOnly } = useAuth();
  const { can, org } = useOrgAccess();
  const { data: invoices, isLoading: l1 } = useInvoices();
  const { data: payments, isLoading: l2 } = usePayments();
  const { data: creditNotes } = useCreditNotes();
  const { data: collect, isLoading: l3 } = useCollectSettings();
  const { data: open, isLoading: l4 } = useCollectOpenItems();
  const { data: messages } = useCollectMessages();
  const insights = can("collectInsights");
  const { data: risk } = useCustomerRisk(insights);
  const { resolveTask } = useCollectMutations();
  const { toast } = useToast();
  const [promiseFor, setPromiseFor] = useState<Row | null>(null);
  const [disputeFor, setDisputeFor] = useState<Row | null>(null);
  const today = localToday();
  const currency = org?.currency || "AED";
  const money = (n: number, cur?: string | null) => formatCurrency(n, cur || currency);

  const credited = useMemo(() => {
    const m = new Map<string, number>();
    for (const cn of creditNotes ?? []) {
      if (cn.status === "issued") m.set(cn.invoice_id, (m.get(cn.invoice_id) ?? 0) + Number(cn.grand_total));
    }
    return m;
  }, [creditNotes]);

  const ctx = useMemo(
    () => ({
      disputed: new Set((open?.disputes ?? []).map((d) => d.invoice_id)),
      promises: new Map((open?.promises ?? []).map((p) => [p.invoice_id, p.promised_date] as const)),
    }),
    [open]
  );

  const rows: Row[] = useMemo(
    () =>
      (invoices ?? [])
        .filter((inv) => inv.status !== "cancelled")
        .map((inv) => {
          const c: CollectInvoice = {
            id: inv.id,
            customer_id: inv.customer_id,
            status: inv.status,
            grand_total: Number(inv.grand_total),
            amount_paid: Number(inv.amount_paid ?? 0),
            credited: credited.get(inv.id) ?? 0,
            due_date: inv.due_date ?? null,
            invoice_date: inv.invoice_date,
          };
          return { inv, c, due: c.due_date ?? addDaysIso(c.invoice_date, 30) };
        }),
    [invoices, credited]
  );
  const unpaid = useMemo(() => rows.filter((r) => isOpen(r.c)).sort((a, b) => a.due.localeCompare(b.due)), [rows]);

  const summary = useMemo(
    () =>
      getPaidSummary({
        invoices: rows.map((r) => r.c),
        ctx,
        today,
        currency,
        payments: (payments ?? []).map((p) => ({ invoice_id: p.invoice_id, amount: Number(p.amount), payment_date: p.payment_date })),
        remindersSent: (messages ?? []).filter((m) => m.status === "sent" && m.direction === "out"),
      }),
    [rows, ctx, today, currency, payments, messages]
  );

  const expected = useMemo(() => {
    const end = weekEnd(today);
    return unpaid
      .map((r) => {
        const promised = ctx.promises.get(r.inv.id);
        return { r, on: promised && promised >= today ? promised : r.due, promised: !!promised && promised >= today };
      })
      .filter((x) => !ctx.disputed.has(x.r.inv.id) && x.on >= today && x.on <= end)
      .sort((a, b) => a.on.localeCompare(b.on));
  }, [unpaid, ctx, today]);

  const waiting = (messages ?? []).filter((m) => m.status === "awaiting_approval").length;
  const failed = (messages ?? []).filter((m) => m.status === "failed").length;
  const tasks = open?.tasks ?? [];
  const auto = can("collectAuto");
  const settings = collect?.settings;

  if (l1 || l2 || l3 || l4) return <LoadingBlock />;

  const tiles = [
    { label: t.unpaid, value: summary.unpaid, tone: "text-ink" },
    { label: t.overdue, value: summary.overdue, tone: "text-rose" },
    { label: t.expectedWeek, value: summary.expectedThisWeek, tone: "text-primary" },
    { label: t.collectedByCollect, value: summary.collectedByCollect, tone: "text-sage", hint: t.collectedHint },
  ];

  const statusOf = (r: Row) => collectStatus(r.c, today, ctx);
  const lateText = (r: Row) => {
    const d = daysBetween(r.due, today);
    return d > 0 ? t.daysLate(d) : t.dueIn(-d);
  };

  return (
    <div>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.subtitle} accent="sage" />
      <CollectTabs waiting={waiting} />

      {!auto ? (
        <LockedPreview />
      ) : settings && !settings.enabled ? (
        <section className="panel mb-5 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-display text-base font-semibold text-ink">{t.off}</p>
            <p className="mt-1 max-w-xl text-sm text-slate">{t.offHint}</p>
          </div>
          <Link href="/collect/settings">
            <Button variant="secondary">{t.turnOn}</Button>
          </Link>
        </section>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="panel p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">{tile.label}</p>
            <p className={cn("mt-1 font-display text-xl font-bold tabular-nums 2xl:text-2xl", tile.tone)} dir="ltr">
              {money(tile.value)}
            </p>
            {tile.hint && <p className="mt-0.5 text-[11px] text-slate">{tile.hint}</p>}
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-2">
        <section className="panel p-5">
          <h2 className="mb-3 font-display text-sm font-semibold text-ink">{t.needsYou}</h2>
          <ul className="space-y-2">
            {waiting > 0 && (
              <li>
                <Link href="/collect/queue" className="flex items-center gap-3 rounded-[10px] border border-border bg-cloud/60 px-3 py-2.5 hover:bg-surface-hover">
                  <Inbox className="h-4 w-4 text-tangerine" />
                  <span className="flex-1 text-sm text-ink">{t.approvals}</span>
                  <span className="rounded-full bg-tangerine/15 px-2 text-xs font-semibold text-tangerine">{waiting}</span>
                </Link>
              </li>
            )}
            {failed > 0 && (
              <li>
                <Link href="/collect/queue" className="flex items-center gap-3 rounded-[10px] border border-border bg-cloud/60 px-3 py-2.5 hover:bg-surface-hover">
                  <TriangleAlert className="h-4 w-4 text-rose" />
                  <span className="flex-1 text-sm text-ink">{t.failed}</span>
                  <span className="rounded-full bg-rose/15 px-2 text-xs font-semibold text-rose">{failed}</span>
                </Link>
              </li>
            )}
            {tasks.map((task) => {
              const inv = invoices?.find((i) => i.id === task.invoice_id);
              const claim =
                task.kind === "paid_claim"
                  ? (open?.claims ?? []).find((c) => c.id === task.claim_id || c.invoice_id === task.invoice_id)
                  : undefined;
              return (
                <li key={task.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-cloud/60 px-3 py-2.5">
                  {task.kind === "call" ? (
                    <Phone className="h-4 w-4 text-primary" />
                  ) : task.kind === "paid_claim" ? (
                    <BadgeCheck className="h-4 w-4 text-sage" />
                  ) : task.message_id ? (
                    <MessageSquareText className="h-4 w-4 text-violet" />
                  ) : (
                    <Flag className="h-4 w-4 text-tangerine" />
                  )}
                  <span className="min-w-[55%] flex-1 text-sm text-ink">
                    {task.title}
                    {task.note && <span className="block text-xs text-slate">“{task.note}”</span>}
                    {inv && (
                      <span className="block text-[11px] text-slate" dir="ltr">
                        {inv.invoice_number} · {money(balanceDue({ ...inv, amount_paid: Number(inv.amount_paid ?? 0), due_date: inv.due_date ?? null, credited: credited.get(inv.id) ?? 0 }), inv.currency)}
                        {inv.customer?.phone ? ` · ${inv.customer.phone}` : ""}
                      </span>
                    )}
                  </span>
                  {claim && <ClaimActions claim={claim} canDecide={isAdmin} />}
                  {!claim && task.kind === "call" && inv?.customer?.phone && (
                    <a href={`tel:${inv.customer.phone.replace(/[^\d+]/g, "")}`}>
                      <Button size="sm" variant="outline" type="button">
                        <Phone className="h-3.5 w-3.5" /> {t.callTask}
                      </Button>
                    </a>
                  )}
                  {!isReadOnly && !claim && (
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      disabled={!isAdmin}
                      onClick={() =>
                        resolveTask.mutate(
                          { id: task.id, status: "done" },
                          { onError: (e) => toast((e as Error).message, "error") }
                        )
                      }
                    >
                      {t.done}
                    </Button>
                  )}
                </li>
              );
            })}
            {!waiting && !failed && !tasks.length && <li className="text-sm text-slate">{t.needsYouEmpty}</li>}
          </ul>
        </section>

        <section className="panel p-5">
          <h2 className="mb-3 font-display text-sm font-semibold text-ink">{t.expectedList}</h2>
          {expected.length ? (
            <ul className="divide-y divide-border/60">
              {expected.slice(0, 8).map(({ r, on, promised }) => (
                <li key={r.inv.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/invoices/${r.inv.id}`} className="text-sm font-medium text-primary hover:underline">
                      {r.inv.customer?.name ?? r.inv.invoice_number}
                    </Link>
                    <p className="text-[11px] text-slate">
                      <span dir="ltr">{r.inv.invoice_number}</span> · {promised ? t.promisedOn(formatDate(on)) : formatDate(on)}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-semibold text-ink" dir="ltr">
                    {money(balanceDue(r.c), r.inv.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate">{t.expectedEmpty}</p>
          )}
        </section>
      </div>

      {!unpaid.length ? (
        <EmptyState title={t.allEmpty} />
      ) : (
        <div className="panel overflow-hidden">
          <h2 className="px-5 pt-4 font-display text-sm font-semibold text-ink">{t.allInvoices}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-start text-sm">
              <thead>
                <tr className="border-b border-border bg-cloud/80 text-xs uppercase tracking-wide text-slate">
                  <th className="px-5 py-3 text-start font-medium">{t.invoice}</th>
                  <th className="px-5 py-3 text-start font-medium">{t.customer}</th>
                  <th className="px-5 py-3 text-start font-medium">{t.due}</th>
                  <th className="px-5 py-3 text-end font-medium">{t.balance}</th>
                  <th className="px-5 py-3 text-start font-medium">{t.status}</th>
                  <th className="px-5 py-3 text-end font-medium">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {unpaid.map((r) => {
                  const status = statusOf(r);
                  const cust = r.inv.customer;
                  const blocked = status === "disputed" || !!cust?.collect_opted_out_at;
                  return (
                    <tr key={r.inv.id} className="border-b border-border/60 text-ink">
                      <td className="px-5 py-3 font-medium">
                        <Link href={`/invoices/${r.inv.id}`} className="text-primary hover:underline" dir="ltr">
                          {r.inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        {cust ? (
                          <Link href={`/customers/${cust.id}`} className="hover:underline">
                            {cust.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {cust?.collect_paused && <span className="ms-2 text-[11px] text-slate">⏸</span>}
                        {cust && risk?.get(cust.id) && risk.get(cust.id)!.level !== "low" && (
                          <span className="ms-2">
                            <RiskBadge risk={risk.get(cust.id)!} currency={r.inv.currency || currency} />
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="block whitespace-nowrap">{formatDate(r.due)}</span>
                        <span className={cn("whitespace-nowrap text-[11px]", status === "overdue" ? "text-rose" : "text-slate")}>{lateText(r)}</span>
                      </td>
                      <td className="px-5 py-3 text-end font-semibold tabular-nums" dir="ltr">
                        {money(balanceDue(r.c), r.inv.currency)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill status={status} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {isAdmin && (
                            <RemindButtons
                              invoiceId={r.inv.id}
                              hasPhone={!!cust?.phone}
                              hasEmail={!!cust?.email}
                              disabled={blocked}
                            />
                          )}
                          {!isReadOnly && (
                            <>
                              {auto && <LogReplyButton invoiceId={r.inv.id} invoiceNumber={r.inv.invoice_number} />}
                              <Button size="sm" variant="ghost" type="button" onClick={() => setPromiseFor(r)} disabled={status === "disputed"}>
                                <CalendarCheck className="h-3.5 w-3.5" /> {t.promise}
                              </Button>
                              <Button size="sm" variant="ghost" type="button" onClick={() => setDisputeFor(r)} disabled={status === "disputed"}>
                                <Flag className="h-3.5 w-3.5" /> {t.dispute}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PromiseModal row={promiseFor} onClose={() => setPromiseFor(null)} today={today} lang={lang} />
      <DisputeModal row={disputeFor} onClose={() => setDisputeFor(null)} />
    </div>
  );
}

function PromiseModal({ row, onClose, today, lang }: { row: Row | null; onClose: () => void; today: string; lang: string }) {
  const { t } = useCollectLang();
  const { toast } = useToast();
  const { addPromise } = useCollectMutations();
  const [date, setDate] = useState(addDaysIso(today, 3));
  if (!row) return null;
  return (
    <Modal open onClose={onClose} title={`${t.promise} · ${row.inv.invoice_number}`} size="sm">
      <div className="space-y-4" dir={lang === "ar" ? "rtl" : "ltr"}>
        <Input type="date" label={t.due} value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            loading={addPromise.isPending}
            onClick={() =>
              addPromise.mutate(
                { invoiceId: row.inv.id, customerId: row.inv.customer_id, date },
                {
                  onSuccess: () => {
                    toast(t.saved);
                    onClose();
                  },
                  onError: (e) => toast((e as Error).message, "error"),
                }
              )
            }
          >
            {t.save}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DisputeModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const { t } = useCollectLang();
  const { toast } = useToast();
  const { openDispute } = useCollectMutations();
  const [reason, setReason] = useState("");
  if (!row) return null;
  return (
    <Modal open onClose={onClose} title={`${t.dispute} · ${row.inv.invoice_number}`} size="sm">
      <div className="space-y-4">
        <Input label={t.message} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!reason.trim()}
            loading={openDispute.isPending}
            onClick={() =>
              openDispute.mutate(
                { invoiceId: row.inv.id, customerId: row.inv.customer_id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast(t.saved);
                    setReason("");
                    onClose();
                  },
                  onError: (e) => toast((e as Error).message, "error"),
                }
              )
            }
          >
            {t.save}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
