"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useCollectMutations, type ReminderDraft } from "@/hooks/use-collect";
import { COLLECT_DICT, statusLabel, type CollectDict, type UiLang } from "@/lib/collect/i18n";
import type { CollectStatus } from "@/lib/collect/status";
import { cn } from "@/lib/utils";
import { Lock, Mail, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

const LANG_KEY = "kayyro.collect.lang";

type LangCtx = { lang: UiLang; t: CollectDict; setLang: (l: UiLang) => void };
const CollectLangContext = createContext<LangCtx>({ lang: "en", t: COLLECT_DICT.en, setLang: () => {} });

export function useCollectLang() {
  return useContext(CollectLangContext);
}

/** Wraps every Collect page: language (EN / AR, right-to-left) and the Get Paid / Approve / Settings tabs. */
export function CollectShell({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<UiLang>("en");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved === "ar" || saved === "en") setLangState(saved);
    } catch {
      /* private mode: English */
    }
  }, []);
  const setLang = (l: UiLang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  };
  const t = COLLECT_DICT[lang];
  return (
    <CollectLangContext.Provider value={{ lang, t, setLang }}>
      <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
        {children}
      </div>
    </CollectLangContext.Provider>
  );
}

export function CollectTabs({ waiting }: { waiting?: number }) {
  const { t, lang, setLang } = useCollectLang();
  const path = usePathname();
  const tabs = [
    { href: "/collect", label: t.title },
    { href: "/collect/queue", label: t.approvals, count: waiting },
    { href: "/collect/settings", label: t.settings },
  ];
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <nav className="flex gap-1 rounded-[12px] border border-border bg-surface p-1 shadow-card">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "inline-flex min-h-[40px] items-center gap-2 rounded-[9px] px-3.5 text-sm font-medium transition-colors",
              path === tab.href ? "bg-primary text-white" : "text-slate hover:bg-primary/5 hover:text-ink"
            )}
          >
            {tab.label}
            {!!tab.count && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold",
                  path === tab.href ? "bg-white/25 text-white" : "bg-tangerine/15 text-tangerine"
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => setLang(lang === "en" ? "ar" : "en")}
        className="min-h-[40px] rounded-[10px] border border-border bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-hover"
      >
        {t.language}
      </button>
    </div>
  );
}

const PILL: Record<CollectStatus, string> = {
  upcoming: "bg-cloud text-slate",
  due: "bg-amber/15 text-[#b45309] dark:text-[#fcd34d]",
  overdue: "bg-rose/15 text-rose",
  promised: "bg-violet/15 text-violet",
  disputed: "bg-[#fb923c]/15 text-[#c2410c] dark:text-[#fdba74]",
  paid: "bg-sage-soft text-sage",
};

export function StatusPill({ status }: { status: CollectStatus }) {
  const { t } = useCollectLang();
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", PILL[status])}>
      {statusLabel(t, status)}
    </span>
  );
}

/** Starter: what automatic reminders look like, with an upgrade button. */
export function LockedPreview({ children }: { children?: React.ReactNode }) {
  const { t } = useCollectLang();
  return (
    <section className="panel relative mb-5 overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <Lock className="h-4 w-4 text-primary" /> {t.lockedTitle}
          </p>
          <p className="mt-1 text-sm text-slate">{t.lockedBody}</p>
        </div>
        <Link href="/settings/billing">
          <Button>
            <Sparkles className="h-4 w-4" /> {t.upgrade}
          </Button>
        </Link>
      </div>
      {children && <div className="pointer-events-none mt-5 select-none opacity-55 blur-[1px]" aria-hidden>{children}</div>}
    </section>
  );
}

/** "Remind now" for one invoice: WhatsApp from the owner's phone, or a reviewed email. */
export function RemindButtons({
  invoiceId,
  hasPhone,
  hasEmail,
  disabled,
  size = "sm",
}: {
  invoiceId: string;
  hasPhone: boolean;
  hasEmail: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useCollectLang();
  const { toast } = useToast();
  const { remind } = useCollectMutations();
  const [draft, setDraft] = useState<ReminderDraft | null>(null);
  const [busy, setBusy] = useState<"email" | "whatsapp" | null>(null);

  const start = async (channel: "email" | "whatsapp") => {
    setBusy(channel);
    try {
      setDraft(await remind.mutateAsync({ invoiceId, channel }));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button
          size={size}
          variant="outline"
          type="button"
          disabled={disabled || !hasPhone}
          loading={busy === "whatsapp"}
          onClick={() => start("whatsapp")}
        >
          <MessageCircle className="h-3.5 w-3.5" /> {t.whatsapp}
        </Button>
        <Button
          size={size}
          variant="outline"
          type="button"
          disabled={disabled || !hasEmail}
          loading={busy === "email"}
          onClick={() => start("email")}
        >
          <Mail className="h-3.5 w-3.5" /> {t.email}
        </Button>
      </div>
      <ReminderModal draft={draft} onClose={() => setDraft(null)} />
    </>
  );
}

export function ReminderModal({ draft, onClose }: { draft: ReminderDraft | null; onClose: () => void }) {
  const { t } = useCollectLang();
  const { toast } = useToast();
  const { approve, markSentByHand } = useCollectMutations();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBody(draft?.body ?? "");
  }, [draft]);

  if (!draft) return null;
  const isWa = draft.channel === "whatsapp";

  const sendWhatsApp = async () => {
    if (draft.link) window.open(draft.link, "_blank", "noopener,noreferrer");
    try {
      await markSentByHand.mutateAsync(draft.id);
      toast(t.markedSent);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const sendEmail = async () => {
    try {
      const r = await approve.mutateAsync({ id: draft.id, subject, body });
      toast(r.status === "sent" ? t.sent : r.status === "scheduled" ? t.scheduled : r.status, r.status === "failed" ? "error" : "success");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t.remindNow} · ${isWa ? t.whatsapp : t.email}`} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-slate">
          {t.to}: <span className="font-medium text-ink" dir="ltr">{draft.to}</span>
        </p>
        {!isWa && <Input label={t.subject} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}
        {isWa ? (
          <pre className="whitespace-pre-wrap rounded-[10px] border border-border bg-cloud/60 p-3 font-sans text-sm text-ink">{draft.body}</pre>
        ) : (
          <Textarea id="collect-remind-body" label={t.message} value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={5000} />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t.cancel}
          </Button>
          {isWa ? (
            <Button type="button" onClick={sendWhatsApp} loading={markSentByHand.isPending} disabled={!draft.link}>
              <MessageCircle className="h-4 w-4" /> {t.sendWhatsapp}
            </Button>
          ) : (
            <Button type="button" onClick={sendEmail} loading={approve.isPending}>
              <Mail className="h-4 w-4" /> {t.approveSend}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
