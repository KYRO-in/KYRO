"use client";

import { useAuth } from "@/components/auth-provider";
import { CollectShell, CollectTabs, LockedPreview, useCollectLang } from "@/components/collect/collect-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useCollectMessages, useCollectMutations, useCollectSettings, type CollectMessageRow } from "@/hooks/use-collect";
import { useOrgAccess } from "@/hooks/use-org-access";
import { intentLabel, stepLabel } from "@/lib/collect/i18n";
import { oneTapLink } from "@/lib/collect/whatsapp";
import { cn, formatDate } from "@/lib/utils";
import { Check, Mail, MessageCircle, Pencil, RotateCcw, SkipForward } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function CollectQueuePage() {
  return (
    <CollectShell>
      <Queue />
    </CollectShell>
  );
}

function Queue() {
  const { t } = useCollectLang();
  const { can } = useOrgAccess();
  const { data: messages, isLoading } = useCollectMessages();
  const { data: collect } = useCollectSettings();

  if (isLoading) return <LoadingBlock />;
  const waiting = (messages ?? []).filter((m) => m.direction === "out" && (m.status === "awaiting_approval" || m.status === "failed"));
  const recent = (messages ?? []).filter((m) => ["sent", "skipped", "cancelled", "ready", "sending", "received"].includes(m.status)).slice(0, 30);

  return (
    <div>
      <PageHeader eyebrow={t.eyebrow} title={t.queueTitle} description={t.queueSubtitle} accent="sage" />
      <CollectTabs waiting={waiting.filter((m) => m.status === "awaiting_approval").length} />
      {!can("collectAuto") && <LockedPreview />}

      {waiting.length ? (
        <div className="space-y-3">
          {waiting.map((m) => (
            <QueueCard key={m.id} m={m} whatsappConnected={!!collect?.whatsappConnected} />
          ))}
        </div>
      ) : (
        <EmptyState title={t.queueEmpty} />
      )}

      <section className="panel mt-6 overflow-hidden">
        <h2 className="px-5 pt-4 font-display text-sm font-semibold text-ink">{t.history}</h2>
        {recent.length ? (
          <ul className="divide-y divide-border/60">
            {recent.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                {m.channel === "whatsapp" ? <MessageCircle className="h-4 w-4 text-sage" /> : <Mail className="h-4 w-4 text-primary" />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{m.customer?.name ?? "—"}</span>
                  <span className="text-slate">
                    {" · "}
                    <span dir="ltr">{m.invoice?.invoice_number}</span> ·{" "}
                    {m.direction === "in"
                      ? `${t.received}: ${intentLabel(t, m.intent) || "…"}`
                      : m.manual
                        ? t.manual
                        : `${m.kind === "reply" ? `${t.answer}: ` : ""}${stepLabel(t, m.step_key)}`}
                  </span>
                  {m.direction === "in" && m.body && (
                    <span className="block max-w-xl truncate text-xs text-slate" title={m.body}>
                      “{m.body}”
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    m.status === "sent" ? "bg-sage-soft text-sage" : "bg-cloud text-slate"
                  )}
                >
                  {m.status === "received" ? t.received : m.status === "sent" ? t.sent : m.status === "skipped" ? t.skip : m.status === "cancelled" ? t.cancel : t.scheduled}
                </span>
                <span className="text-[11px] text-slate">{formatDate(m.sent_at ?? m.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-slate">{t.historyEmpty}</p>
        )}
      </section>
    </div>
  );
}

function QueueCard({ m, whatsappConnected }: { m: CollectMessageRow; whatsappConnected: boolean }) {
  const { t } = useCollectLang();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const { approve, markSentByHand, skip, retry } = useCollectMutations();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(m.subject ?? "");
  const [body, setBody] = useState(m.body ?? "");
  const isWa = m.channel === "whatsapp";
  // WhatsApp goes out by itself only with a connected Business number and the customer's opt-in; otherwise one tap from the owner's phone
  const oneTap = isWa && !(whatsappConnected && m.customer?.whatsapp_opt_in_at);
  const fail = (e: unknown) => toast((e as Error).message, "error");

  const onApprove = () =>
    approve.mutate(
      editing ? { id: m.id, subject, body } : { id: m.id },
      {
        onSuccess: (r) => {
          setEditing(false);
          toast(r.status === "sent" ? t.sent : r.status === "scheduled" || r.status === "ready" ? t.scheduled : r.status, r.status === "failed" ? "error" : "success");
        },
        onError: fail,
      }
    );

  const onOneTap = () => {
    const link = oneTapLink(m.to_address, m.body ?? "");
    if (link) window.open(link, "_blank", "noopener,noreferrer");
    markSentByHand.mutate(m.id, { onSuccess: () => toast(t.markedSent), onError: fail });
  };

  return (
    <article className="panel p-4 sm:p-5" dir={m.language === "ar" ? "rtl" : "ltr"} lang={m.language}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {isWa ? <MessageCircle className="h-4 w-4 text-sage" /> : <Mail className="h-4 w-4 text-primary" />}
        <span className="font-medium text-ink">{m.customer?.name ?? "—"}</span>
        <span className="text-sm text-slate">
          ·{" "}
          {m.invoice && (
            <Link href={`/invoices/${m.invoice.id}`} className="text-primary hover:underline" dir="ltr">
              {m.invoice.invoice_number}
            </Link>
          )}{" "}
          · {m.manual ? t.manual : `${m.kind === "reply" ? `${t.answer}: ` : ""}${stepLabel(t, m.step_key)}`}
        </span>
        <span className="ms-auto text-[11px] text-slate" dir="ltr">
          {t.to}: {m.to_address}
        </span>
      </header>

      {m.status === "failed" && m.error && <p className="mb-2 rounded-[8px] bg-rose/10 px-3 py-2 text-xs text-rose">{m.error}</p>}

      {editing && !isWa ? (
        <div className="space-y-3">
          <Input label={t.subject} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          <Textarea id={`collect-body-${m.id}`} label={t.message} value={body} rows={10} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        </div>
      ) : (
        <div className="rounded-[10px] border border-border bg-cloud/60 p-3">
          {m.subject && <p className="mb-1.5 text-sm font-semibold text-ink">{m.subject}</p>}
          <p className="whitespace-pre-wrap text-sm text-ink">{m.body}</p>
        </div>
      )}

      {isAdmin && (
        <footer className="mt-3 flex flex-wrap justify-end gap-2">
          {m.status === "failed" ? (
            <Button size="sm" variant="secondary" type="button" loading={retry.isPending} onClick={() => retry.mutate(m.id, { onError: fail })}>
              <RotateCcw className="h-3.5 w-3.5" /> {t.retry}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" type="button" loading={skip.isPending} onClick={() => skip.mutate(m.id, { onError: fail })}>
                <SkipForward className="h-3.5 w-3.5" /> {t.skip}
              </Button>
              {!isWa && (
                <Button size="sm" variant="secondary" type="button" onClick={() => setEditing((v) => !v)}>
                  <Pencil className="h-3.5 w-3.5" /> {editing ? t.cancel : t.edit}
                </Button>
              )}
              {oneTap ? (
                <Button size="sm" type="button" loading={markSentByHand.isPending} disabled={!m.to_address} onClick={onOneTap}>
                  <MessageCircle className="h-3.5 w-3.5" /> {t.sendWhatsapp}
                </Button>
              ) : (
                <Button size="sm" type="button" loading={approve.isPending} onClick={onApprove}>
                  <Check className="h-3.5 w-3.5" /> {t.approve}
                </Button>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}
