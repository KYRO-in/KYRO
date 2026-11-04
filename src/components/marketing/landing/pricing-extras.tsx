"use client";

import { PAID_PLANS, PAID_PLAN_ORDER, PLAN_PRICES, formatPlanPrice, getPlanChecklist } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Check, Clock, Minus, Sparkles, Wallet } from "lucide-react";
import { useState } from "react";
import { AnimatedMoney, EASE, NumberTicker, Reveal, WordsReveal } from "./primitives";

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-white/70">{label}</span>
        <span className="font-mono text-lg font-semibold text-white">
          {value.toLocaleString("en-US")}
          <span className="ml-1 text-xs text-white/50">{suffix}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="landing-range mt-3 w-full"
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
    </label>
  );
}

/** "What is my time worth?" - all inputs are the visitor's own estimates. */
export function SavingsCalculator() {
  const [invoices, setInvoices] = useState(120);
  const [minutes, setMinutes] = useState(8);
  const [hourly, setHourly] = useState(60);

  const manualHours = (invoices * minutes) / 60;
  const kayyroHours = (invoices * 1) / 60; // about a minute per invoice once your catalog is in
  const savedHours = Math.max(0, manualHours - kayyroHours);
  const savedValue = savedHours * hourly;
  const plan = invoices > 300 ? PAID_PLANS.business : invoices > 50 ? PAID_PLANS.pro : PAID_PLANS.starter;
  const multiple = plan.priceMonthly > 0 ? savedValue / plan.priceMonthly : 0;

  return (
    <section className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">Do the maths</p>
          </Reveal>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-5xl">
            <WordsReveal text="How much is your time worth?" inView />
          </h2>
          <Reveal delay={0.15}>
            <p className="mx-auto mt-4 max-w-xl text-white/60">
              Move the sliders to match your shop. Typing invoices, VAT and reminders by hand adds up fast.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
            <div className="space-y-8 rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
              <Slider label="Invoices you send a month" value={invoices} min={10} max={1000} step={10} suffix="/ month" onChange={setInvoices} />
              <Slider label="Minutes per invoice today (typing, VAT, sending)" value={minutes} min={2} max={20} step={1} suffix="min" onChange={setMinutes} />
              <Slider label="What an hour of your time is worth" value={hourly} min={20} max={300} step={5} suffix="AED" onChange={setHourly} />
              <p className="text-xs text-white/40">
                Estimate only. Assumes about one minute per invoice in Kayyro once your products are added.
              </p>
            </div>

            <div className="relative overflow-hidden rounded-3xl border border-[#b65cff]/40 bg-gradient-to-br from-[#7c1cf0]/35 via-[#1a1033] to-[#0e0a1c] p-6 sm:p-8">
              <div aria-hidden className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#e879f9]/25 blur-3xl" />
              <div className="relative">
                <p className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Clock className="h-4 w-4 text-[#d9aaff]" /> Time you get back
                </p>
                <p className="mt-2 font-display text-5xl font-extrabold tracking-tight text-white">
                  {savedHours.toFixed(1)}
                  <span className="ml-2 text-xl font-bold text-white/60">hours / month</span>
                </p>
                <div className="mt-6 h-px bg-white/10" />
                <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Wallet className="h-4 w-4 text-[#6ee7b7]" /> Worth about
                </p>
                <AnimatedMoney value={savedValue} className="mt-1 block font-mono text-4xl font-semibold text-[#6ee7b7]" />
                <motion.p
                  key={plan.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/75"
                >
                  <Sparkles className="mr-1.5 inline h-4 w-4 text-[#fbbf24]" />
                  At this size the <strong className="text-white">{plan.name}</strong> plan ({formatPlanPrice(plan.priceMonthly)} / month){" "}
                  {multiple >= 1 ? (
                    <>
                      pays for itself <strong className="text-white">{Math.floor(multiple)}×</strong> over.
                    </>
                  ) : (
                    <>still saves you hours of typing every month.</>
                  )}
                </motion.p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const EXTRA_ROWS: { group: string; label: string; plans: [boolean, boolean, boolean] }[] = [
  { group: "Billing", label: "Tax invoices with VAT per line, for all 6 GCC countries", plans: [true, true, true] },
  { group: "Billing", label: "Reverse charge, exports and the ZATCA QR code (Saudi)", plans: [true, true, true] },
  { group: "Billing", label: "English + Arabic invoices, in your own currency", plans: [true, true, true] },
  { group: "Billing", label: "Email & WhatsApp invoices and reminders", plans: [true, true, true] },
  { group: "Billing", label: "Bulk email to many customers", plans: [true, true, true] },
  { group: "Catalog", label: "Units (kg, L, m, box…) with decimal quantities", plans: [true, true, true] },
  { group: "Catalog", label: "Categories & subcategories", plans: [true, true, true] },
  { group: "Customers", label: "Customer ledgers, part payments & ageing", plans: [true, true, true] },
  { group: "Insights", label: "Live dashboard, goals & streaks", plans: [true, true, true] },
];

export function ComparisonTable() {
  const lists = PAID_PLAN_ORDER.map((id) => getPlanChecklist(id));
  const planRows = lists[0]!.map((item, i) => ({
    group: "Plan limits",
    label: item.rowLabel ?? item.label,
    cells: lists.map((l) => l[i]!),
  }));

  return (
    <section className="relative py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Reveal>
          <h2 className="text-center font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">
            Every plan, side by side
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="mt-10 overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.02]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-5 py-4 font-medium text-white/50">Feature</th>
                  {PAID_PLAN_ORDER.map((id) => (
                    <th key={id} className="px-5 py-4 text-center">
                      <span className={cn("font-display text-base font-extrabold", PAID_PLANS[id].recommended ? "text-[#d9aaff]" : "text-white")}>
                        {PAID_PLANS[id].name}
                      </span>
                      <span className="block font-mono text-xs font-normal text-white/50">
                        {formatPlanPrice(PLAN_PRICES[id].monthly)} / mo
                      </span>
                      <span className="block font-mono text-[11px] font-normal text-white/35">
                        or {formatPlanPrice(PLAN_PRICES[id].annual)} / year
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EXTRA_ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-white/[0.06] transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-3.5 text-white/80">{r.label}</td>
                    {r.plans.map((on, i) => (
                      <td key={i} className="px-5 py-3.5 text-center">
                        {on ? <Check className="mx-auto h-4 w-4 text-[#6ee7b7]" /> : <Minus className="mx-auto h-4 w-4 text-white/25" />}
                      </td>
                    ))}
                  </tr>
                ))}
                {planRows.map((r, idx) => (
                  <tr key={`${r.label}-${idx}`} className="border-b border-white/[0.06] last:border-0 transition-colors hover:bg-white/[0.03]">
                    <td className="px-5 py-3.5 text-white/80">{r.label.charAt(0).toUpperCase() + r.label.slice(1)}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="px-5 py-3.5 text-center">
                        {c.value ? (
                          <span className="font-mono text-xs text-white/80">{c.value}</span>
                        ) : c.included ? (
                          <Check className="mx-auto h-4 w-4 text-[#6ee7b7]" />
                        ) : (
                          <Minus className="mx-auto h-4 w-4 text-white/25" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function TrustRow() {
  const items = [
    { k: 14, label: "days free", suffix: "" },
    { k: 0, label: "card needed to start", suffix: "" },
    { k: 16, label: "trades built in", suffix: "" },
    { k: 5, label: "VAT worked out per line", suffix: "%" },
  ];
  return (
    <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="bg-[#0b0817] px-4 py-5 text-center">
          <NumberTicker value={i.k} suffix={i.suffix} className="font-display text-3xl font-extrabold text-white" />
          <p className="mt-1 text-xs text-white/50">{i.label}</p>
        </div>
      ))}
    </div>
  );
}
