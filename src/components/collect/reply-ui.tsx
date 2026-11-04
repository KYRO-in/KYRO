"use client";

import { useCollectLang } from "@/components/collect/collect-ui";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { proofUrl, useCollectMutations, type ReplyReading } from "@/hooks/use-collect";
import { intentLabel } from "@/lib/collect/i18n";
import type { PaymentClaim } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Check, FileText, MessageCircle, MessageSquarePlus, X } from "lucide-react";
import { useState } from "react";

/** "Log a reply": paste what the customer sent to the owner's own phone or inbox. */
export function LogReplyButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const { t } = useCollectLang();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="h-3.5 w-3.5" /> {t.logReply}
      </Button>
      {open && <LogReplyModal invoiceId={invoiceId} invoiceNumber={invoiceNumber} onClose={() => setOpen(false)} />}
    </>
  );
}

function LogReplyModal({ invoiceId, invoiceNumber, onClose }: { invoiceId: string; invoiceNumber: string; onClose: () => void }) {
  const { t, lang } = useCollectLang();
  const { toast } = useToast();
  const { logReply, markSentByHand } = useCollectMutations();
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReplyReading | null>(null);

  const read = () =>
    logReply.mutate(
      { invoiceId, channel, text: text.trim() },
      { onSuccess: setResult, onError: (e) => toast((e as Error).message, "error") }
    );

  const sendAnswer = () => {
    const a = result?.answer;
    if (!a?.link) return;
    window.open(a.link, "_blank", "noopener,noreferrer");
    markSentByHand.mutate(a.id, {
      onSuccess: () => {
        toast(t.markedSent);
        onClose();
      },
      onError: (e) => toast((e as Error).message, "error"),
    });
  };

  return (
    <Modal open onClose={onClose} title={`${t.logReply} · ${invoiceNumber}`} size="lg">
      <div className="space-y-3" dir={lang === "ar" ? "rtl" : "ltr"}>
        {!result ? (
          <>
            <p className="text-sm text-slate">{t.logReplyHint}</p>
            <div className="flex gap-2">
              {(["whatsapp", "email"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={cn(
                    "min-h-[40px] rounded-[9px] border px-3 text-sm",
                    channel === c ? "border-primary bg-primary/10 text-primary" : "border-border text-slate"
                  )}
                >
                  {c === "whatsapp" ? t.whatsapp : t.email}
                </button>
              ))}
            </div>
            <Textarea id="collect-reply-text" label={t.replyText} value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={4000} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={onClose}>
                {t.cancel}
              </Button>
              <Button type="button" onClick={read} loading={logReply.isPending} disabled={!text.trim()}>
                {t.read}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-[10px] border border-border bg-cloud/60 p-3">
              <p className="text-xs text-slate">{t.aiResult}</p>
              <p className="font-display text-base font-semibold text-ink">
                {intentLabel(t, result.intent)}
                {result.promiseDate ? ` · ${formatDate(result.promiseDate)}` : ""}
              </p>
              {result.summary && <p className="mt-1 text-sm text-ink">{result.summary}</p>}
              <p className="mt-1 text-[11px] text-slate">
                {t.confidence}: {Math.round(result.confidence * 100)}%
              </p>
            </div>
            {result.action === "needs_you" && <p className="text-sm text-tangerine">{t.needsYouResult}</p>}
            {result.answer?.body && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate">{t.answer}</p>
                <pre className="whitespace-pre-wrap rounded-[10px] border border-border bg-surface p-3 font-sans text-sm text-ink">
                  {result.answer.body}
                </pre>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={onClose}>
                {t.done}
              </Button>
              {result.answer?.link && result.answer.status !== "sent" && (
                <Button type="button" onClick={sendAnswer} loading={markSentByHand.isPending}>
                  <MessageCircle className="h-4 w-4" /> {t.sendAnswer}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** "Says it's paid": see the proof, then confirm (records the payment) or reject (reminders resume). */
export function ClaimActions({ claim, canDecide }: { claim: PaymentClaim; canDecide: boolean }) {
  const { t } = useCollectLang();
  const { toast } = useToast();
  const { resolveClaim } = useCollectMutations();
  const [opening, setOpening] = useState(false);

  const view = async () => {
    if (!claim.file_path) return;
    setOpening(true);
    const url = await proofUrl(claim.file_path);
    setOpening(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast("Could not open the file.", "error");
  };

  const decide = (status: "confirmed" | "rejected") =>
    resolveClaim.mutate(
      { id: claim.id, status },
      {
        onSuccess: () => toast(status === "confirmed" ? t.claimConfirmed : t.claimRejected),
        onError: (e) => toast((e as Error).message, "error"),
      }
    );

  return (
    <div className="flex flex-wrap gap-1.5">
      {claim.file_path && (
        <Button size="sm" variant="outline" type="button" onClick={view} loading={opening}>
          <FileText className="h-3.5 w-3.5" /> {t.viewProof}
        </Button>
      )}
      {canDecide && (
        <>
          <Button size="sm" type="button" onClick={() => decide("confirmed")} loading={resolveClaim.isPending}>
            <Check className="h-3.5 w-3.5" /> {t.confirmPaid}
          </Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => decide("rejected")} disabled={resolveClaim.isPending}>
            <X className="h-3.5 w-3.5" /> {t.reject}
          </Button>
        </>
      )}
    </div>
  );
}
