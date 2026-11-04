import { FinalCta } from "@/components/marketing/landing/final-cta";
import { Chapters, FirstInvoiceSteps, Tips } from "@/components/marketing/landing/how-it-works";
import { PageHero } from "@/components/marketing/landing/page-hero";
import { APP_NAME } from "@/lib/brand";
import { ArrowRight, Play } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description: `A walkthrough of ${APP_NAME}: set up your business, add what you sell with categories and units, send VAT invoices for your Gulf country by email or WhatsApp, collect payments and prepare your tax return.`,
};

export default function HowItWorksPage() {
  return (
    <main>
      <PageHero
        eyebrow="How it works"
        title="From sign-up to"
        accent="your first invoice."
        body="Everything you need to run billing, stock and VAT - explained in plain words, with the real screens."
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
            href="/#tour"
            className="inline-flex h-12 items-center gap-2.5 rounded-2xl border border-white/15 bg-white/5 px-5 text-[15px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
              <Play className="h-3 w-3 translate-x-px fill-white" />
            </span>
            Watch the tour
          </Link>
        </div>
      </PageHero>

      <FirstInvoiceSteps />
      <Chapters />
      <Tips />
      <FinalCta />
    </main>
  );
}
