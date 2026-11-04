import { FaqList } from "@/components/marketing/faq-list";
import { CountryExplorer } from "@/components/marketing/landing/countries";
import { FinalCta } from "@/components/marketing/landing/final-cta";
import { PageHero } from "@/components/marketing/landing/page-hero";
import { Reveal } from "@/components/marketing/landing/primitives";
import { APP_NAME } from "@/lib/brand";
import { ENABLED_COUNTRIES, OFFERED_GROUPS } from "@/lib/vat/countries";
import { ArrowRight, Coins, FileCheck2, Languages, QrCode, Plane, ToggleRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Countries & tax",
  description: `${APP_NAME} bills under the VAT rules of all ${ENABLED_COUNTRIES.length} GCC countries: the UAE, Saudi Arabia, Bahrain, Oman, Qatar and Kuwait.`,
};

const FEATURES = [
  {
    icon: QrCode,
    title: "Saudi ZATCA QR",
    body: "Every Saudi invoice carries the ZATCA QR code. Consumers get a Simplified Tax Invoice, businesses a Tax Invoice.",
  },
  {
    icon: Languages,
    title: "English and Arabic",
    body: "Every invoice can print in English with Arabic labels, in your own currency, for all six countries.",
  },
  {
    icon: ToggleRight,
    title: "Qatar and Kuwait, ready for VAT",
    body: "No VAT yet, so invoices are titled \"Invoice\" with no tax lines and no VAT return. If VAT is introduced, it can be switched on.",
  },
  {
    icon: Plane,
    title: "Exports, zero-rated",
    body: "Customers abroad are zero-rated automatically, with the right note on the invoice. You can change it on any bill.",
  },
  {
    icon: Coins,
    title: "Dinars to the fils",
    body: "Bahraini dinar, Omani rial and Kuwaiti dinar keep 3 decimals everywhere - invoices, payments and balances.",
  },
  {
    icon: FileCheck2,
    title: "Your country's return",
    body: "UAE VAT 201 by emirate, the Saudi, Bahrain and Oman VAT returns, or a sales summary in Qatar and Kuwait - exported to Excel.",
  },
];

const FAQ = [
  {
    q: "Can I change country later?",
    a: "Yes, in Settings. New invoices follow the new country's rules and currency, and invoices you already issued keep theirs. Kayyro also offers to move your products to the new standard rate in one click.",
  },
  {
    q: "I sell to customers in other countries. What happens?",
    a: "Give each customer their country. A customer abroad is treated as a zero-rated export, or as reverse charge for a VAT-registered business when you choose it. The treatment is shown on the invoice and you can change it.",
  },
  {
    q: "Does Kayyro connect to ZATCA or the FTA?",
    a: "Not yet. Kayyro prints the ZATCA QR code (phase 1) on Saudi invoices and prepares your return in the official layout, ready for you or your accountant to file. Kayyro is not ZATCA phase 2 (e-invoicing integration) compliant yet.",
  },
  {
    q: "What if a rate changes?",
    a: "Every product can carry any rate, so a change never blocks you - pick the new rate on the product. Rates shown here are the published rates for 2026; always confirm with your accountant.",
  },
];

export default function CountriesPage() {
  return (
    <main>
      <PageHero
        eyebrow={`${ENABLED_COUNTRIES.length} GCC countries · VAT`}
        title="Your country's tax,"
        accent="built in."
        body="Pick your country once. Every invoice, receipt, credit note and tax return follows its rules, in its currency."
      >
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="group inline-flex h-12 items-center gap-2 rounded-2xl bg-gradient-to-b from-[#b65cff] to-[#7c1cf0] px-6 text-[15px] font-semibold text-white shadow-[0_18px_50px_-12px_rgba(182,92,255,0.9)]"
          >
            Start free for 14 days
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href="#all-countries"
            className="inline-flex h-12 items-center rounded-2xl border border-white/15 bg-white/5 px-5 text-[15px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
          >
            See all six countries
          </Link>
        </div>
      </PageHero>

      <section className="relative pb-20 sm:pb-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <CountryExplorer compact />
          </Reveal>
        </div>
      </section>

      <section className="relative border-y border-white/8 bg-white/[0.02] py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <h2 className="text-center font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl">
              The hard parts, handled
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.05}>
                <div className="h-full rounded-3xl border border-white/10 bg-white/[0.04] p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#b65cff]/20 text-[#d9aaff]">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-bold text-white">{f.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/60">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="all-countries" className="relative scroll-mt-24 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl">
              All six countries, at a glance
            </h2>
            <p className="mt-3 max-w-2xl text-white/55">
              Standard and reduced rates, currency, tax number and the return {APP_NAME} prepares for you.
            </p>
          </Reveal>

          {OFFERED_GROUPS.map((group) => {
            const list = ENABLED_COUNTRIES.filter((c) => c.group === group);
            return (
              <Reveal key={group} className="mt-10">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">
                  {group} · {list.length}
                </h3>
                <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.03]">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.12em] text-white/40">
                        <th className="px-5 py-3 font-semibold">Country</th>
                        <th className="px-5 py-3 font-semibold">Tax</th>
                        <th className="px-5 py-3 font-semibold">Other rates</th>
                        <th className="px-5 py-3 font-semibold">Currency</th>
                        <th className="px-5 py-3 font-semibold">Decimals</th>
                        <th className="px-5 py-3 font-semibold">Tax number</th>
                        <th className="px-5 py-3 font-semibold">Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((c) => {
                        const reduced = c.rates.filter((r) => r.rate > 0 && r.rate !== c.standardRate).map((r) => `${r.rate}%`);
                        return (
                          <tr key={c.code} className="border-b border-white/[0.06] text-white/75 last:border-0">
                            <td className="px-5 py-3">
                              <span className="mr-2 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white/80">
                                {c.code}
                              </span>
                              <span className="font-medium text-white">{c.name}</span>
                            </td>
                            <td className="px-5 py-3">
                              {c.taxSystem === "none" ? "No VAT" : `${c.taxName} ${c.standardRate}%`}
                            </td>
                            <td className="px-5 py-3 font-mono text-xs">{reduced.length ? reduced.join(" · ") : "-"}</td>
                            <td className="px-5 py-3 font-mono text-xs">{c.currency}</td>
                            <td className="px-5 py-3 font-mono text-xs">{c.currencyDecimals}</td>
                            <td className="px-5 py-3">{c.taxIdLabel}</td>
                            <td className="px-5 py-3">{c.returnName}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Reveal>
            );
          })}
          <p className="mt-6 text-xs text-white/35">
            Published rates for 2026. Always confirm the rules for your own business with your accountant.
          </p>
        </div>
      </section>

      <section className="relative pb-20 sm:pb-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal>
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">
              Questions about countries
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="mt-8">
            <FaqList items={FAQ} />
          </Reveal>
        </div>
      </section>

      <FinalCta />
    </main>
  );
}
