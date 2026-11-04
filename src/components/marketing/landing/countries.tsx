"use client";

import { calcInvoiceTotals } from "@/lib/vat";
import {
  calcOptionsFor,
  invoiceTitleFor,
  resolveTaxContext,
  taxSummaryRows,
} from "@/lib/vat/context";
import { ENABLED_COUNTRIES, getCountryConfig, type CountryVatConfig } from "@/lib/vat/countries";
import { cn, currencyDecimals } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Globe2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EASE, Reveal, WordsReveal } from "./primitives";

/** What makes each country's billing different, in plain words. */
export function countryHighlights(c: CountryVatConfig): string[] {
  const out: string[] = [];
  if (c.taxSystem === "none") {
    out.push("No VAT yet: clean invoices titled \"Invoice\", with no tax lines");
    out.push("Ready to switch VAT on if it is introduced");
  }
  if (c.zatcaQr) {
    out.push("ZATCA QR code on every invoice");
    out.push("Simplified Tax Invoice for consumers, Tax Invoice for businesses");
  }
  if (c.currencyDecimals === 3) out.push(`${c.currency} kept to 3 decimals, payments included`);
  if (c.code === "AE") out.push("VAT 201 split across all seven emirates");
  if (c.arabic) out.push("English + Arabic invoices");
  if (c.taxSystem === "vat") out.push("Exports to other countries zero-rated");
  return out.slice(0, 5);
}

/** A typical region for each sample invoice (the first in the list can be unusual, e.g. a union territory). */
const SAMPLE_REGION: Record<string, string> = { AE: "Dubai", SA: "Riyadh" };

function formatAmount(n: number, currency: string) {
  const d = currencyDecimals(currency);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** A live sample invoice, priced by the same engine the app uses. */
function SampleInvoice({ country }: { country: CountryVatConfig }) {
  const reduce = useReducedMotion();
  const ctx = useMemo(
    () =>
      resolveTaxContext({
        sellerCountry: country.code,
        sellerState: SAMPLE_REGION[country.code] ?? country.regions[0] ?? "",
        customer: { country: country.code, state: SAMPLE_REGION[country.code] ?? country.regions[0] ?? "" },
      }),
    [country]
  );
  const money = (n: number) => formatAmount(n, ctx.currency);
  const lines = [
    { name: "Consulting, 4 hours", quantity: 4, unitPrice: 125 },
    { name: "Product bundle", quantity: 3, unitPrice: 84.5 },
  ];
  const totals = calcInvoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, vatRate: country.standardRate })),
    calcOptionsFor(ctx, false)
  );
  const rows = taxSummaryRows(ctx, totals.breakdown, money);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={country.code}
        initial={reduce ? false : { opacity: 0, y: 14, rotateX: -6 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -10 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="rounded-3xl border border-white/12 bg-gradient-to-b from-[#1d1738] to-[#120e24] p-6 shadow-[0_40px_120px_-40px_rgba(124,28,240,0.7)] sm:p-7"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#c98bff]">
              {invoiceTitleFor(ctx, "registered")}
            </p>
            <p className="mt-1 font-display text-lg font-bold text-white">Your Business</p>
            <p className="font-mono text-xs text-white/45">
              {country.taxIdLabel} {country.taxSystem === "none" ? "(optional)" : country.taxIdPlaceholder}
            </p>
          </div>
          <span className="rounded-full border border-white/12 px-3 py-1 font-mono text-xs font-semibold text-white/70">
            {country.currency}
          </span>
        </div>

        <div className="mt-5 space-y-2 border-y border-white/10 py-4 text-sm">
          {lines.map((l, i) => (
            <div key={l.name} className="flex items-baseline justify-between gap-3 text-white/75">
              <span className="min-w-0 truncate">
                {l.name}
                <span className="ml-2 font-mono text-xs text-white/40">
                  {l.quantity} × {l.unitPrice.toFixed(2)}
                </span>
              </span>
              <span className="shrink-0 font-mono text-white/90">{money(totals.lines[i].taxableValue)}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between text-white/60">
            <span>{ctx.taxFree ? "Subtotal" : `Total excl. ${country.taxName}`}</span>
            <span className="font-mono">{money(totals.subtotal)}</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="flex justify-between gap-3 text-white/60">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 font-mono">{money(r.amount)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between border-t border-white/10 pt-3 text-white">
            <span className="font-semibold">{ctx.taxFree ? "Total" : `Total incl. ${country.taxName}`}</span>
            <span className="font-mono text-xl font-bold text-[#34d399]">{money(totals.grandTotal)}</span>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 text-[11px] text-white/45">
          <span>Place of supply: {ctx.placeOfSupply}</span>
          {country.zatcaQr ? (
            <span aria-hidden className="grid h-12 w-12 grid-cols-5 gap-[2px] rounded-md bg-white p-1">
              {Array.from({ length: 25 }, (_, i) => (
                <span key={i} className={cn("rounded-[1px]", (i * 7 + 3) % 5 < 2 || i % 6 === 0 ? "bg-black" : "bg-white")} />
              ))}
            </span>
          ) : (
            <span>{country.returnName}</span>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Country chips → what changes + a live sample invoice. */
export function CountryExplorer({ compact = false }: { compact?: boolean }) {
  const reduce = useReducedMotion();
  const [code, setCode] = useState("AE");
  const country = getCountryConfig(code);

  const otherRates = country.rates.filter((r) => r.rate !== country.standardRate && r.rate > 0);

  return (
    <div className={cn("mx-auto grid max-w-5xl gap-6", compact ? "lg:grid-cols-[1.1fr_1fr]" : "lg:grid-cols-[1.15fr_1fr]")}>
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-7">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Country">
          {ENABLED_COUNTRIES.map((c) => {
            const on = c.code === code;
            return (
              <button
                key={c.code}
                type="button"
                aria-pressed={on}
                onClick={() => setCode(c.code)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors",
                  on
                    ? "border-[#b65cff] bg-[#b65cff]/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white"
                )}
              >
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white/80">
                  {c.code}
                </span>
                {c.name}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={country.code}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="mt-6 border-t border-white/10 pt-6"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-display text-2xl font-bold text-white">{country.name}</h3>
              <span className="text-sm text-white/50">
                {country.taxSystem === "none"
                  ? "No VAT"
                  : `${country.taxName} ${country.standardRate}% standard${
                      otherRates.length ? ` · ${otherRates.map((r) => `${r.rate}%`).join(" / ")}` : ""
                    }`}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Currency", `${country.currency} · ${country.currencyDecimals} decimals`],
                ["Tax number", country.taxIdLabel],
                ["Invoice title", country.simplifiedInvoiceTitle ? `${country.invoiceTitle} / Simplified` : country.invoiceTitle],
                ["Return", country.returnName],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-white/8 bg-black/20 px-3.5 py-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">{k}</dt>
                  <dd className="mt-0.5 font-medium text-white/90">{v}</dd>
                </div>
              ))}
            </dl>

            <ul className="mt-5 space-y-2">
              {countryHighlights(country).map((h) => (
                <li key={h} className="flex gap-2.5 text-sm text-white/70">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" />
                  {h}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex flex-col justify-center gap-3" style={{ perspective: 1200 }}>
        <SampleInvoice country={country} />
        {country.taxSystem !== "none" ? (
          <p className="px-2 text-center text-xs leading-relaxed text-white/40">
            Selling abroad? Exports are zero-rated automatically, and the right wording prints on the
            invoice.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Home-page section: the six GCC countries. */
export function Countries() {
  return (
    <section id="countries" className="relative scroll-mt-20 py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 -z-0 mx-auto h-[480px] max-w-4xl rounded-full bg-[#7c1cf0]/12 blur-[130px]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">
              <Globe2 className="h-4 w-4" /> {ENABLED_COUNTRIES.length} Gulf countries
            </p>
          </Reveal>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-6xl">
            <WordsReveal text="Your country's tax," inView />
            <br />
            <WordsReveal text="built in." inView delay={0.2} className="text-[#c98bff]" />
          </h2>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-white/60">
              VAT in the UAE, Saudi Arabia, Bahrain and Oman, and clean invoices in Qatar and Kuwait. Pick
              your country once and every invoice, receipt and tax return follows its rules, in its currency.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1} className="mt-14">
          <CountryExplorer />
        </Reveal>

        <Reveal delay={0.15}>
          <p className="mt-10 text-center">
            <Link
              href="/countries"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#d9aaff] hover:text-white"
            >
              See all six countries, rates and returns →
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
