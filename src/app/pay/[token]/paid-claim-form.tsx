"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const T = {
  en: {
    title: "I already paid",
    hint: "Upload the receipt or transfer confirmation, or add a short note. Reminders pause until the business confirms.",
    file: "Receipt (photo or PDF, up to 5 MB)",
    note: "Note (optional), e.g. transfer reference",
    send: "Send",
    sending: "Sending…",
    tooBig: "The file is larger than 5 MB.",
    empty: "Add the receipt or a short note.",
  },
  ar: {
    title: "لقد دفعت بالفعل",
    hint: "ارفعوا إيصال الدفع أو تأكيد التحويل، أو أضيفوا ملاحظة قصيرة. تتوقف التذكيرات حتى تؤكد الجهة الدفع.",
    file: "الإيصال (صورة أو PDF حتى 5 ميغابايت)",
    note: "ملاحظة (اختياري)، مثل مرجع التحويل",
    send: "إرسال",
    sending: "جارٍ الإرسال…",
    tooBig: "حجم الملف أكبر من 5 ميغابايت.",
    empty: "أضيفوا الإيصال أو ملاحظة قصيرة.",
  },
};

export function PaidClaimForm({ token, lang }: { token: string; lang: "en" | "ar" }) {
  const t = T[lang];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    const note = String(form.get("note") ?? "").trim();
    if (file instanceof File && file.size > 5 * 1024 * 1024) return setError(t.tooBig);
    if (!(file instanceof File && file.size > 0) && !note) return setError(t.empty);
    form.set("t", token);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/collect/pay/claim", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
      router.replace(`/pay/${token}?lang=${lang}&sent=1`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel space-y-3 p-6">
      <p className="font-display text-sm font-semibold text-ink">{t.title}</p>
      <p className="text-xs text-slate">{t.hint}</p>
      <label className="block text-sm text-ink">
        <span className="field-label mb-1 block">{t.file}</span>
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="block w-full text-sm text-slate file:me-3 file:rounded-[8px] file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-primary"
        />
      </label>
      <label className="block text-sm text-ink">
        <span className="field-label mb-1 block">{t.note}</span>
        <input
          type="text"
          name="note"
          maxLength={500}
          className="h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-base text-ink md:text-sm"
        />
      </label>
      {error && <p className="text-xs text-rose">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 items-center justify-center rounded-[10px] bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? t.sending : t.send}
      </button>
    </form>
  );
}
