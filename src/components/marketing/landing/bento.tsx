"use client";

import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { BadgeCheck, CheckCheck, ChevronRight, FileText, FolderTree, Mail, Paperclip } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EASE, Reveal, WordsReveal } from "./primitives";

/** Card with a soft purple spotlight that follows the cursor. */
function Card({
  className,
  title,
  body,
  children,
}: {
  className?: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-6 transition-colors duration-500 hover:border-white/20 sm:p-7",
        className
      )}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: "radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), rgba(182,92,255,0.17), transparent 45%)",
        }}
      />
      <div className="relative flex h-full flex-col">
        <div className="min-h-[170px] flex-1">{children}</div>
        <h3 className="mt-6 font-display text-xl font-extrabold tracking-tight text-white">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-white/55">{body}</p>
      </div>
    </div>
  );
}

function WhatsAppDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const bubble = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 18, scale: 0.9 },
    animate: inView || reduce ? { opacity: 1, y: 0, scale: 1 } : {},
    transition: { delay: 0.35 + i * 0.7, duration: 0.55, ease: EASE },
  });
  return (
    <div ref={ref} className="flex h-full flex-col justify-end gap-2.5">
      <motion.div {...bubble(0)} className="max-w-[88%] self-start rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 text-[15px] text-white/90">
        Hi Marina Bistro 👋 Your tax invoice is ready.
      </motion.div>
      <motion.div {...bubble(1)} className="flex max-w-[88%] items-center gap-3 self-start rounded-2xl rounded-bl-md bg-white/10 px-4 py-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#b65cff]/25 text-[#d9aaff]">
          <FileText className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-[15px] font-semibold text-white">KY-2026-27-0014.pdf</span>
          <span className="block font-mono text-xs text-white/55">Amount due · AED 4,095.00</span>
        </span>
      </motion.div>
      <motion.div {...bubble(2)} className="max-w-[88%] self-end rounded-2xl rounded-br-md bg-[#34d399]/20 px-4 py-3 text-[15px] text-[#b6f5d8]">
        Received, thank you! 🙏
      </motion.div>
    </div>
  );
}

/** Tax numbers from different countries, typed and checked one after another. */
const TAX_IDS = [
  { label: "Customer TRN · UAE", value: "100234567800003", hint: "15 digits" },
  { label: "Customer VATIN · Oman", value: "OM1100000000", hint: "OM + 10 digits" },
  { label: "Customer VAT Account No. · Bahrain", value: "200000000000002", hint: "15 digits" },
  { label: "Customer VAT No. · Saudi Arabia", value: "300000000000003", hint: "starts and ends with 3" },
];

function TrnDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [idx, setIdx] = useState(0);
  const current = TAX_IDS[idx];
  const full = current.value;
  const [n, setN] = useState(reduce ? full.length : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    setN(0);
    const c = animate(0, full.length, {
      duration: 1.8,
      ease: "linear",
      delay: 0.3,
      onUpdate: (v) => setN((cur) => (Math.floor(v) === cur ? cur : Math.floor(v))),
      onComplete: () => {
        window.setTimeout(() => setIdx((i) => (i + 1) % TAX_IDS.length), 1600);
      },
    });
    return () => c.stop();
  }, [inView, reduce, full]);
  const done = n >= full.length;
  return (
    <div ref={ref} className="flex h-full flex-col justify-center">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/45">{current.label}</p>
      <div className={cn("flex h-14 items-center justify-between rounded-2xl border bg-black/30 px-4 transition-colors duration-500", done ? "border-[#34d399]/60" : "border-white/15")}>
        <span className="font-mono text-lg font-semibold tracking-wider text-white">
          {full.slice(0, n)}
          {!done && <span className="ml-0.5 inline-block h-5 w-[2px] animate-pulse bg-[#b65cff] align-middle" />}
        </span>
        <motion.span
          initial={false}
          animate={done ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 18 }}
          className="text-[#34d399]"
        >
          <BadgeCheck className="h-6 w-6" />
        </motion.span>
      </div>
      <p className="mt-2 text-xs text-white/45">{current.hint} · checked as you type</p>
    </div>
  );
}

const RETURNS = ["VAT 201 · UAE", "VAT return · Saudi", "VAT return · Bahrain", "VAT return · Oman", "Sales summary · Qatar", "Sales summary · Kuwait"];

function ReturnsDemo() {
  return (
    <div className="flex h-full flex-wrap content-center gap-2">
      {RETURNS.map((e, i) => (
        <motion.span
          key={e}
          initial={{ opacity: 0, scale: 0.8, y: 12 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: i * 0.07, duration: 0.5, ease: EASE }}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
            i === 1 ? "border-[#b65cff] bg-[#b65cff]/20 text-white" : "border-white/12 bg-white/5 text-white/70"
          )}
        >
          {e}
        </motion.span>
      ))}
    </div>
  );
}

const STOCK = [
  { name: "Floor Cleaner", pct: 74, low: false },
  { name: "Dish Wash", pct: 52, low: false },
  { name: "Handwash", pct: 31, low: false },
  { name: "Detergent", pct: 9, low: true },
];

function StockDemo() {
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      {STOCK.map((s, i) => (
        <div key={s.name}>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-semibold text-white/85">{s.name}</span>
            {s.low ? (
              <span className="rounded-full bg-[#f59e0b]/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#fbbf24]">Low</span>
            ) : (
              <span className="font-mono text-xs text-white/45">{s.pct}%</span>
            )}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${s.pct}%` }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: 0.15 + i * 0.12, duration: 1.1, ease: EASE }}
              className={cn("h-full rounded-full", s.low ? "bg-[#f59e0b]" : "bg-gradient-to-r from-[#7c1cf0] to-[#b65cff]")}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const LEDGER = [
  { who: "Marina Bistro & Grill", amt: "AED 4,095.00", status: "Part paid", tone: "amber" },
  { who: "Al Noor Trading LLC", amt: "AED 2,310.00", status: "Paid", tone: "mint" },
  { who: "Palm Facilities", amt: "AED 1,980.00", status: "Due", tone: "rose" },
] as const;

const TONES = {
  amber: "bg-[#f59e0b]/20 text-[#fbbf24]",
  mint: "bg-[#34d399]/20 text-[#6ee7b7]",
  rose: "bg-[#f43f5e]/20 text-[#fb7185]",
};

function LedgerDemo() {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      {LEDGER.map((r, i) => (
        <motion.div
          key={r.who}
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: i * 0.12, duration: 0.6, ease: EASE }}
          className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{r.who}</span>
            <span className="block font-mono text-xs text-white/50">{r.amt}</span>
          </span>
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", TONES[r.tone])}>{r.status}</span>
        </motion.div>
      ))}
    </div>
  );
}

function EmailDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const go = inView || !!reduce;
  return (
    <div ref={ref} className="relative flex h-full flex-col justify-center gap-3">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={go ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: EASE }}
        className="rounded-2xl border border-white/10 bg-black/30 p-4"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
          <span className="flex min-w-0 items-center gap-2 text-sm text-white/80">
            <Mail className="h-4 w-4 shrink-0 text-[#c98bff]" />
            <span className="truncate">accounts@gulfhospitality.ae</span>
          </span>
          <motion.span
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            animate={go ? { opacity: 1, scale: 1 } : {}}
            transition={{ delay: 1.5, type: "spring", stiffness: 380, damping: 18 }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#34d399]/15 px-2 py-0.5 text-[11px] font-bold text-[#6ee7b7]"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Delivered
          </motion.span>
        </div>
        <p className="mt-3 text-[15px] font-semibold text-white">Tax invoice KY-2026-27-0118 from Sparkle Supplies</p>
        <p className="mt-1 text-sm text-white/55">Hi Gulf Hospitality, please find attached your invoice for AED 6,489.00…</p>
        <motion.span
          initial={reduce ? false : { opacity: 0, x: -10 }}
          animate={go ? { opacity: 1, x: 0 } : {}}
          transition={{ delay: 0.7, duration: 0.5, ease: EASE }}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/80"
        >
          <Paperclip className="h-3.5 w-3.5 text-[#c98bff]" /> KY-2026-27-0118.pdf
        </motion.span>
      </motion.div>
      <div className="flex flex-wrap gap-2">
        {["12 invoices emailed", "4 reminders sent", "AED 18,240 collected"].map((t, i) => (
          <motion.span
            key={t}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={go ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 1.1 + i * 0.15, duration: 0.45, ease: EASE }}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/70"
          >
            {t}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

const TREE = [
  { cat: "Vegetables", subs: ["Leafy greens", "Root vegetables", "Exotic"] },
  { cat: "Fruits", subs: ["Citrus", "Dates", "Berries"] },
];

function CategoriesDemo() {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      {TREE.map((t, i) => (
        <motion.div
          key={t.cat}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: i * 0.15, duration: 0.5, ease: EASE }}
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <FolderTree className="h-4 w-4 text-[#c98bff]" /> {t.cat}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
            {t.subs.map((s, j) => (
              <motion.span
                key={s}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: 0.3 + i * 0.15 + j * 0.07, duration: 0.35 }}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs text-white/75"
              >
                <ChevronRight className="h-3 w-3 text-white/35" />
                {s}
              </motion.span>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function Bento() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">Details that matter</p>
          </Reveal>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-6xl">
            <WordsReveal text="Small touches," inView />
            <br />
            <WordsReveal text="big difference." inView delay={0.2} className="text-[#c98bff]" />
          </h2>
        </div>

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          <Reveal className="lg:col-span-2">
            <Card
              className="h-full"
              title="Share on WhatsApp in one tap"
              body="Send the tax invoice PDF straight to your customer's chat, with a short download link, and remind them when a balance is due."
            >
              <WhatsAppDemo />
            </Card>
          </Reveal>
          <Reveal delay={0.08}>
            <Card
              className="h-full"
              title="Tax numbers, checked for you"
              body="UAE TRNs and Saudi, Bahrain and Oman VAT numbers are validated as you type, then printed on the invoice."
            >
              <TrnDemo />
            </Card>
          </Reveal>
          <Reveal>
            <Card className="h-full" title="Your country's return" body="Output and input tax summarised in the layout your tax authority expects, then exported to Excel.">
              <ReturnsDemo />
            </Card>
          </Reveal>
          <Reveal delay={0.08}>
            <Card className="h-full" title="Stock that moves with every sale" body="Invoices draw stock down automatically, and low items raise their hand before you run out.">
              <StockDemo />
            </Card>
          </Reveal>
          <Reveal delay={0.16}>
            <Card className="h-full" title="Credit without the spreadsheet" body="Part payments, balances due and a running ledger for every customer.">
              <LedgerDemo />
            </Card>
          </Reveal>
          <Reveal className="lg:col-span-2">
            <Card
              className="h-full"
              title="Email invoices to everyone, in one click"
              body="Branded emails with the PDF attached - one invoice, a whole selection, or payment reminders to every customer who owes you."
            >
              <EmailDemo />
            </Card>
          </Reveal>
          <Reveal delay={0.08}>
            <Card className="h-full" title="Categories & subcategories" body="Group your catalog the way your shop works, then filter and bill from it in a tap.">
              <CategoriesDemo />
            </Card>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
