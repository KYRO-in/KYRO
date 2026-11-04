"use client";

import { amountInWords } from "@/lib/amount-in-words";
import { calcLineVat, type VatCategory } from "@/lib/vat";
import { countryOptions, getCountryConfig } from "@/lib/vat/countries";
import { cn, currencyDecimals } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { AnimatedMoney, EASE, Reveal, WordsReveal } from "./primitives";

type Choice = { id: string; label: string; hint: string; rate: number; category: VatCategory };

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-3.5", strong ? "text-white" : "text-white/70")}>
      <span className={cn("text-[15px]", strong && "font-semibold")}>{label}</span>
      <span className={cn("font-mono tabular-nums", strong ? "text-2xl font-bold text-[#34d399] sm:text-3xl" : "text-lg font-semibold text-white")}>
        {children}
      </span>
    </div>
  );
}

const inputClass =
  "h-14 w-full rounded-2xl border border-white/12 bg-black/30 px-4 font-mono text-xl font-semibold text-white outline-none transition focus:border-[#b65cff] focus:ring-4 focus:ring-[#b65cff]/20";

export function VatCalculator() {
  const reduce = useReducedMotion();
  const [countryCode, setCountryCode] = useState("AE");
  const [price, setPrice] = useState("350");
  const [qty, setQty] = useState("12");
  const [choiceId, setChoiceId] = useState("std");
  const [inclusive, setInclusive] = useState(false);

  const country = getCountryConfig(countryCode);
  const taxName = country.taxName;
  const decimals = currencyDecimals(country.currency);

  // The rates this country uses, then zero-rated and exempt
  const choices = useMemo<Choice[]>(() => {
    if (country.taxSystem === "none") {
      return [{ id: "std", label: "No VAT", hint: `${country.name} has no VAT yet`, rate: 0, category: "zero" }];
    }
    const rated = country.rates
      .filter((r) => r.rate > 0)
      .slice(0, 3)
      .map((r, i) => ({
        id: i === 0 ? "std" : `r${r.rate}`,
        label: i === 0 ? `Standard ${r.rate}%` : `${r.rate}%`,
        hint: i === 0 ? "Most goods and services" : r.label.replace(/^\S+\s*/, "").replace(/[()]/g, "") || "Reduced rate",
        rate: r.rate,
        category: "standard" as VatCategory,
      }));
    return [
      ...rated,
      { id: "zero", label: "Zero-rated", hint: "e.g. qualifying exports", rate: 0, category: "zero" },
      { id: "exempt", label: "Exempt", hint: "No tax, no recovery", rate: 0, category: "exempt" },
    ];
  }, [country]);

  const choice = choices.find((c) => c.id === choiceId) ?? choices[0];

  const result = useMemo(() => {
    const p = Math.max(0, Number(price) || 0);
    const q = Math.max(0, Number(qty) || 0);
    return calcLineVat(
      { quantity: q, unitPrice: p, vatRate: choice.rate, vatCategory: choice.category },
      { pricesIncludeVat: inclusive, decimals, taxFree: country.taxSystem === "none" }
    );
  }, [price, qty, choice, inclusive, decimals, country.taxSystem]);

  const words = useMemo(() => amountInWords(result.lineTotal, country.currency), [result.lineTotal, country.currency]);
  const badge =
    country.taxSystem === "none"
      ? "No VAT"
      : choice.category === "standard"
        ? `${taxName} ${choice.rate}%`
        : choice.category === "zero"
          ? "0% zero-rated"
          : "Exempt";

  return (
    <section id="calculator" className="relative scroll-mt-4 py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -z-0 mx-auto h-[520px] max-w-4xl -translate-y-1/2 rounded-full bg-[#7c1cf0]/15 blur-[130px]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">Try it right here</p>
          </Reveal>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-6xl">
            <WordsReveal text="Gulf VAT, worked out." inView />
            <br />
            <WordsReveal text="To the last cent." inView delay={0.2} className="text-[#c98bff]" />
          </h2>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-xl text-lg text-white/60">
              This is the same engine that prices every Kayyro invoice. Pick your country, change anything and watch it
              recalculate.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1} className="mx-auto mt-14 grid max-w-5xl gap-6 lg:grid-cols-2">
          {/* inputs */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur sm:p-8">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Country</span>
              <select
                value={countryCode}
                onChange={(e) => {
                  setCountryCode(e.target.value);
                  setChoiceId("std");
                }}
                className={cn(inputClass, "font-sans text-base")}
              >
                {countryOptions().map((o) => (
                  <option key={o.value} value={o.value} className="bg-[#120e24]">
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
                  Unit price ({country.currency})
                </span>
                <input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-white/50">Quantity</span>
                <input
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
                  className={inputClass}
                />
              </label>
            </div>

            <fieldset className="mt-6">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">{taxName} rate</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {choices.map((t) => {
                  const on = choice.id === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setChoiceId(t.id)}
                      className={cn(
                        "relative rounded-2xl border px-4 py-3 text-left transition-colors",
                        on ? "border-[#b65cff] text-white" : "border-white/12 text-white/70 hover:border-white/25"
                      )}
                    >
                      {on && (
                        <motion.span
                          layoutId="vat-treatment"
                          className="absolute inset-0 rounded-2xl bg-[#b65cff]/18"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        />
                      )}
                      <span className="relative block text-[15px] font-semibold">{t.label}</span>
                      <span className="relative mt-0.5 block truncate text-xs text-white/50">{t.hint}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>


            {country.taxSystem !== "none" && (
              <button
                type="button"
                role="switch"
                aria-checked={inclusive}
                onClick={() => setInclusive((v) => !v)}
                className="mt-6 flex w-full items-center justify-between gap-4 rounded-2xl border border-white/12 bg-black/20 px-4 py-4 text-left transition-colors hover:border-white/25"
              >
                <span>
                  <span className="block text-[15px] font-semibold text-white">Prices already include {taxName}</span>
                  <span className="mt-0.5 block text-xs text-white/50">
                    {inclusive
                      ? `${taxName} is worked out of the price you entered`
                      : `${taxName} is added on top of the price you entered`}
                  </span>
                </span>
                <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300", inclusive ? "bg-[#b65cff]" : "bg-white/20")}>
                  <motion.span
                    className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow"
                    animate={{ x: inclusive ? 20 : 0 }}
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
                  />
                </span>
              </button>
            )}
          </div>

          {/* receipt */}
          <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-gradient-to-b from-[#1d1738] to-[#120e24] p-6 shadow-[0_40px_120px_-40px_rgba(124,28,240,0.7)] sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#c98bff]">
                {country.invoiceTitle} · {country.name}
              </p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={badge + String(inclusive)}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0 rounded-full border border-white/12 px-3 py-1 text-xs font-semibold text-white/70"
                >
                  {badge}
                  {country.taxSystem !== "none" ? (inclusive ? " · incl." : " · excl.") : ""}
                </motion.span>
              </AnimatePresence>
            </div>

            <div className="mt-5 divide-y divide-white/10">
              <Row label={country.taxSystem === "none" ? "Amount" : "Taxable amount"}>
                <AnimatedMoney value={result.taxableValue} currency={country.currency} decimals={decimals} />
              </Row>
              {country.taxSystem === "none" ? null : (
                <Row label={choice.category === "standard" ? `${taxName} ${choice.rate}%` : taxName}>
                  <AnimatedMoney value={result.vatAmount} currency={country.currency} decimals={decimals} />
                </Row>
              )}
              <Row label="Total" strong>
                <AnimatedMoney value={result.lineTotal} currency={country.currency} decimals={decimals} />
              </Row>
            </div>

            <p className="mt-5 min-h-[3.25rem] text-sm leading-relaxed text-white/50">
              <span className="font-semibold text-white/70">In words: </span>
              {words}
            </p>
            {country.currencyDecimals === 3 && (
              <p className="mt-1 text-xs text-white/35">{country.currency} is kept to 3 decimals, as the law expects.</p>
            )}

            <motion.div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#b65cff]/25 blur-[70px]"
              animate={reduce ? undefined : { scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 6, repeat: Infinity, ease: EASE }}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
