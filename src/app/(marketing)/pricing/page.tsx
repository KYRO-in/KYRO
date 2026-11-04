import { PricingPlans } from "@/components/billing/pricing-plans";
import { FaqList } from "@/components/marketing/faq-list";
import { FinalCta } from "@/components/marketing/landing/final-cta";
import { PageHero } from "@/components/marketing/landing/page-hero";
import { ComparisonTable, SavingsCalculator, TrustRow } from "@/components/marketing/landing/pricing-extras";
import { Reveal } from "@/components/marketing/landing/primitives";
import { APP_NAME } from "@/lib/brand";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Simple ${APP_NAME} plans in UAE dirhams for businesses across the GCC. 14-day free trial, no card required, cancel anytime.`,
};

const BILLING_FAQ = [
  {
    q: "Do I need a card to start?",
    a: "No. Every new business gets 14 days free with the Starter limits. Pick a plan whenever you're ready.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes. Upgrade or downgrade from Settings → Billing at any time. Your invoices, products and customers stay exactly where they are.",
  },
  {
    q: "What happens if I go over my invoice limit?",
    a: "We'll let you know before you hit it. Nothing is deleted - you simply upgrade to keep issuing new invoices that month.",
  },
  {
    q: "Is the annual plan cheaper?",
    a: "Yes - you pay for 10 months and get 12, so you save 2 months. Starter is AED 490 a year, Pro AED 990 and Business AED 1,990.",
  },
  {
    q: "How do refunds work?",
    a: "You can cancel anytime. See our Refund & Cancellation Policy for how refunds are handled on annual plans.",
  },
];

export default function PricingPage() {
  return (
    <main>
      <PageHero
        eyebrow="Pricing in AED"
        title="Simple pricing."
        accent="Pays for itself."
        body="Every plan includes tax invoices for your Gulf country, VAT return summaries, email & WhatsApp sending and all 16 trades. Start free for 14 days - no card required."
      >
        <TrustRow />
      </PageHero>

      <section className="relative pb-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <PricingPlans variant="marketing" hideHeading />
          </Reveal>
        </div>
      </section>

      <SavingsCalculator />
      <ComparisonTable />

      <section className="relative py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal>
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">Billing questions</h2>
          </Reveal>
          <Reveal delay={0.1} className="mt-8">
            <FaqList items={BILLING_FAQ} />
          </Reveal>
        </div>
      </section>

      <FinalCta />
    </main>
  );
}
