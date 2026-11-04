import { PricingPlans } from "@/components/billing/pricing-plans";
import { FaqList } from "@/components/marketing/faq-list";
import { Bento } from "@/components/marketing/landing/bento";
import { Countries } from "@/components/marketing/landing/countries";
import { FinalCta } from "@/components/marketing/landing/final-cta";
import { Hero } from "@/components/marketing/landing/hero";
import { Industries } from "@/components/marketing/landing/industries";
import { Reveal } from "@/components/marketing/landing/primitives";
import { ScrollShowcase } from "@/components/marketing/landing/scroll-showcase";
import { GetPaid } from "@/components/marketing/landing/get-paid";
import { BusinessMarquee, StatsStrip } from "@/components/marketing/landing/strip";
import { VatCalculator } from "@/components/marketing/landing/vat-calculator";
import { APP_DESCRIPTION, APP_NAME, APP_TITLE } from "@/lib/brand";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: APP_TITLE },
  description: APP_DESCRIPTION,
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    type: "website",
    images: [{ url: "/marketing/kayyro-tour-poster.jpg", width: 1600, height: 900 }],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    images: ["/marketing/kayyro-tour-poster.jpg"],
  },
};

const FAQ_ITEMS = [
  {
    q: "Will it work for my kind of business?",
    a: `Almost certainly. ${APP_NAME} has 16 trades built in - fruit & vegetables, grocery, restaurants, hardware & building materials, furniture & appliances, perfumes, auto parts, wholesale, pharmacy, mobile shops, clothing, salons, jewellery, hotels, freelancers and a general mode. Each brings its own units (kg, litres, metres, boxes, hours…), categories with subcategories and invoice fields.`,
  },
  {
    q: "Can I sell by weight, like 1.25 kg?",
    a: "Yes. Quantities follow the unit you sell in: kilos, grams and litres take decimals, while pieces and boxes stay whole. Stock moves by the same amount, so 1.25 kg sold is 1.25 kg off the shelf.",
  },
  {
    q: "Can I email invoices to my customers?",
    a: "Yes - one at a time from the invoice page, many at once from the invoice list, or payment reminders to everyone who owes you. Each email carries the PDF tax invoice and a secure download link, and replies come straight to your business email.",
  },
  {
    q: "Will Kayyro message my customers without asking me?",
    a: "Not unless you want it to. By default you approve every message. You can switch to automatic sending any time.",
  },
  {
    q: "Which countries' tax rules does it follow?",
    a: "The six GCC countries: the UAE (VAT 5%), Saudi Arabia (VAT 15%, with the ZATCA QR code), Bahrain (VAT 10%), Oman (VAT 5%), and Qatar and Kuwait, which have no VAT yet, so their invoices carry no tax lines. Each invoice carries your tax number, the customer's where they have one, tax per line and a summary by rate, in your own currency, in English and Arabic. Exports and reverse charge are handled too. Always confirm the requirements for your own business with your accountant.",
  },
  {
    q: "Do you file my VAT return for me?",
    a: `No. ${APP_NAME} prepares a return summary laid out like yours (UAE VAT 201, or the Saudi, Bahrain and Oman VAT returns) plus an Excel workbook from your invoices and purchases. You or your accountant still file it.`,
  },
  {
    q: "I sell to customers in other countries. Is that covered?",
    a: "Yes. Give the customer their country and Kayyro treats a sale abroad as a zero-rated export, or as reverse charge for a VAT-registered business customer when you choose it. The wording prints on the invoice, and you can change it on any bill.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. Each business's data is fully isolated from other tenants, and the app is hosted on a secure cloud stack. You only see your own organization.",
  },
  {
    q: "What's included in the free trial?",
    a: "New accounts get a 14-day free trial with the Starter limits. No card required up front. Subscribe when you're ready to continue, and cancel anytime from Settings → Billing.",
  },
];

export default function MarketingHomePage() {
  return (
    <main>
      <Hero />
      <StatsStrip />
      <BusinessMarquee />
      <ScrollShowcase />
      <GetPaid />
      <Industries />
      <Countries />
      <VatCalculator />
      <Bento />

      <section id="pricing" className="relative scroll-mt-20 border-y border-white/8 bg-white/[0.02] py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <PricingPlans variant="marketing" />
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-10 text-center">
              <Link
                href="/pricing"
                className="group inline-flex items-center gap-2 text-sm font-semibold text-[#d9aaff] hover:text-white"
              >
                Compare every feature and see what you&apos;ll save
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      <section id="faq" className="relative scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">FAQ</p>
            <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-5xl">
              Straight answers
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="mt-10">
            <FaqList items={FAQ_ITEMS} />
          </Reveal>
        </div>
      </section>

      <FinalCta />
    </main>
  );
}
