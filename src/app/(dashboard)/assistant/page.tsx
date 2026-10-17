"use client";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useOrgAccess } from "@/hooks/use-org-access";
import { aiQuestionsFor } from "@/lib/billing/plans";
import { browserTimeZone } from "@/lib/attendance";
import { isDemoMode } from "@/lib/demo/mode";
import { cn } from "@/lib/utils";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

type Turn = { role: "user" | "assistant"; content: string; error?: boolean };

const STORAGE_KEY = "kayyro-ask-history";

const SUGGESTIONS = [
  "How much did I sell this week?",
  "Who owes me the most money?",
  "Which products are running low?",
  "What were my best sellers last month?",
  "Who was late this week?",
  "How much did I spend on purchases and expenses this month?",
];

/** Bold and bullet points only - the assistant is told to keep to these. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul${blocks.length}`} className="my-1.5 list-disc space-y-1 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={`p${blocks.length}`} className="my-1.5">{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <div className="text-[15px] leading-relaxed">{blocks}</div>;
}

export default function AssistantPage() {
  const demo = isDemoMode();
  const { org } = useOrgAccess();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ used: number; max: number | null } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setTurns(JSON.parse(saved) as Turn[]);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-30)));
    } catch {
      /* private mode */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setDraft("");
    if (demo) {
      setTurns([
        ...next,
        {
          role: "assistant",
          content:
            "Ask Kayyro reads your live business data, so it works once you sign in to your own account. In this demo, try the POS, Staff and Attendance screens instead.",
        },
      ]);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeZone: browserTimeZone(),
          messages: next.filter((t) => !t.error).map(({ role, content }) => ({ role, content })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { answer?: string; error?: string; used?: number; max?: number | null };
      if (!res.ok || !json.answer) {
        setTurns([...next, { role: "assistant", content: json.error ?? "Something went wrong. Please try again.", error: true }]);
      } else {
        setTurns([...next, { role: "assistant", content: json.answer }]);
        if (typeof json.used === "number") setUsage({ used: json.used, max: json.max ?? null });
      }
    } catch {
      setTurns([...next, { role: "assistant", content: "Couldn't reach Kayyro. Check your connection and try again.", error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const max = usage?.max ?? aiQuestionsFor(org?.plan, org?.country);

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <PageHeader
        eyebrow="AI"
        title="Ask Kayyro"
        description="Ask about your sales, stock, customers, spending or staff - in plain words, in any language."
        accent="violet"
        actions={
          turns.length > 0 ? (
            <Button variant="secondary" onClick={() => setTurns([])} disabled={busy}>
              <RotateCcw className="h-4 w-4" />
              New chat
            </Button>
          ) : undefined
        }
      />

      <div className="panel flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {turns.length === 0 && (
            <div className="mx-auto flex max-w-xl flex-col items-center py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-purple-dark)] to-[var(--brand-purple-light)] text-white">
                <Sparkles className="h-6 w-6" />
              </span>
              <h2 className="mt-4 font-display text-xl font-semibold text-ink">What would you like to know?</h2>
              <p className="mt-1 text-sm text-slate">
                Kayyro looks at your own invoices, payments, stock and attendance to answer. It can read, never change.
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-ink transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5",
                  t.role === "user"
                    ? "bg-primary text-white"
                    : t.error
                      ? "border border-coral/40 bg-rose-soft text-coral-deep"
                      : "border border-border bg-surface-hover text-ink"
                )}
              >
                {t.role === "user" ? <p className="whitespace-pre-wrap text-[15px]">{t.content}</p> : <Answer text={t.content} />}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface-hover px-4 py-3 text-sm text-slate">
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: `${d * 120}ms` }}
                    />
                  ))}
                </span>
                Looking at your numbers…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="border-t border-border p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              rows={1}
              placeholder="Ask anything about your business…"
              aria-label="Your question"
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-surface px-4 py-2.5 text-[15px] text-ink outline-none focus:border-primary"
            />
            <Button type="submit" disabled={!draft.trim() || busy} aria-label="Ask" className="h-11 w-11 shrink-0 px-0">
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-slate">
            {usage
              ? `${usage.used} of ${max ?? "unlimited"} questions used this month.`
              : `Your plan includes ${max.toLocaleString("en-US")} questions a month.`}{" "}
            Answers come from your data; double-check anything you file with the tax office.
          </p>
        </form>
      </div>
    </div>
  );
}
