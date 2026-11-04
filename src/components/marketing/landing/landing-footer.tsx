import { APP_NAME, BRAND_LOGO_MARK, LEGAL_ENTITY_NAME, LEGAL_SUPPORT_EMAIL } from "@/lib/brand";
import { ArrowUpRight, Mail } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#tour", label: "Tour" },
      { href: "/#industries", label: "Every business" },
      { href: "/countries", label: "Countries & tax" },
      { href: "/#calculator", label: "VAT calculator" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/how-it-works", label: "How to use" },
      { href: "/how-it-works#first-invoice", label: "Your first invoice" },
      { href: "/how-it-works#vat", label: "VAT returns" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Start free trial" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy-policy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/refund-policy", label: "Refunds" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/8 bg-[#07050f]">
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/2 h-80 w-[900px] -translate-x-1/2 rounded-full bg-[#7c1cf0]/20 blur-[120px]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Image src={BRAND_LOGO_MARK} alt="" width={34} height={34} className="h-[34px] w-[34px] object-contain" />
              <span className="font-display text-xl font-extrabold tracking-tight text-white">{APP_NAME}</span>
            </Link>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/55">
              VAT billing, stock and payments for every kind of business in the GCC - from the corner vegetable
              stall in Dubai to the furniture showroom in Riyadh.
            </p>
            <a
              href={`mailto:${LEGAL_SUPPORT_EMAIL}`}
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/85 transition-colors hover:border-white/25 hover:text-white"
            >
              <Mail className="h-4 w-4 text-[#c98bff]" /> {LEGAL_SUPPORT_EMAIL}
            </a>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">{col.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="group inline-flex items-center gap-1 text-sm text-white/70 transition-colors hover:text-white">
                        {l.label}
                        <ArrowUpRight className="h-3 w-3 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <p
          aria-hidden
          className="pointer-events-none mt-16 select-none bg-gradient-to-b from-white/[0.09] to-transparent bg-clip-text text-center font-display text-[18vw] font-extrabold leading-[0.8] tracking-[-0.06em] text-transparent sm:text-[150px]"
        >
          {APP_NAME}
        </p>

        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-white/8 pt-6 text-xs text-white/40 sm:flex-row">
          <p>
            © {new Date().getFullYear()} {LEGAL_ENTITY_NAME}. All rights reserved.
          </p>
          <p className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" /> VAT ready · Built for the GCC
          </p>
        </div>
      </div>
    </footer>
  );
}
