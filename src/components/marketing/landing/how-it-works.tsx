"use client";

import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import {
  BarChart3,
  Boxes,
  Building2,
  Check,
  Command,
  FolderTree,
  Keyboard,
  LayoutDashboard,
  Mail,
  MousePointerClick,
  Package,
  Percent,
  ScanBarcode,
  Users,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { EASE, Reveal, Tilt, WordsReveal } from "./primitives";

function BrowserFrame({ src, label, alt, priority = false }: { src: string; label: string; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0817] shadow-[0_40px_120px_-30px_rgba(124,28,240,0.55)]">
      <div className="flex h-9 items-center gap-2 border-b border-white/10 bg-[#140f29] px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]/70" />
        <span className="ml-3 truncate font-mono text-[11px] text-white/45">{label}</span>
      </div>
      <Image src={src} alt={alt} width={1920} height={1080} priority={priority} className="h-auto w-full" sizes="(min-width: 1024px) 640px, 100vw" />
    </div>
  );
}

const STEPS = [
  {
    title: "Who is it for?",
    body: "Search a customer by name, phone or tax number - or add a new one without leaving the invoice.",
    img: "/marketing/showcase/howto-step1.webp",
    label: "kayyro / invoices / new · step 1",
  },
  {
    title: "What are they buying?",
    body: "Tap items from your catalog by category, scan a barcode, or type. Weights take decimals, so 1.25 kg is just 1.25.",
    img: "/marketing/showcase/howto-step2.webp",
    label: "kayyro / invoices / new · step 2",
  },
  {
    title: "Check everything",
    body: "VAT is worked out on every line, with a summary by rate. Flip ‘prices include VAT’ if your shelf prices already do.",
    img: "/marketing/showcase/howto-step3.webp",
    label: "kayyro / invoices / new · step 3",
  },
  {
    title: "Send it",
    body: "Email the PDF in one click, share on WhatsApp, or print. Your customer gets a secure download link too.",
    img: "/marketing/showcase/howto-email.webp",
    label: "kayyro / invoices / KY-2026-27-0112",
  },
];

/** Auto-playing walkthrough of the four invoice steps (click any step to jump). */
export function FirstInvoiceSteps() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-25% 0px" });
  const DURATION = 4.5;

  useEffect(() => {
    if (paused || reduce || !inView) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % STEPS.length), DURATION * 1000);
    return () => window.clearTimeout(t);
  }, [active, paused, reduce, inView]);

  return (
    <section id="first-invoice" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">Your first invoice</p>
          </Reveal>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-5xl">
            <WordsReveal text="Four steps. About a minute." inView />
          </h2>
        </div>

        <div ref={ref} className="mt-12 grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <ol className="space-y-2" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            {STEPS.map((s, i) => {
              const on = i === active;
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    className={cn(
                      "relative w-full overflow-hidden rounded-2xl border p-5 text-left transition-colors",
                      on ? "border-[#b65cff]/40 bg-white/[0.05]" : "border-transparent hover:bg-white/[0.03]"
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold transition-colors",
                          on ? "bg-gradient-to-b from-[#b65cff] to-[#7c1cf0] text-white" : i < active ? "bg-[#34d399]/20 text-[#6ee7b7]" : "bg-white/[0.06] text-white/50"
                        )}
                      >
                        {i < active ? <Check className="h-4 w-4" /> : i + 1}
                      </span>
                      <div>
                        <p className={cn("font-display text-lg font-bold", on ? "text-white" : "text-white/60")}>{s.title}</p>
                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.p
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.35, ease: EASE }}
                              className="overflow-hidden text-[15px] leading-relaxed text-white/60"
                            >
                              <span className="block pt-1.5">{s.body}</span>
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    {on && !reduce && (
                      <motion.span
                        key={`bar-${active}-${paused}`}
                        className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-[#7c1cf0] to-[#e879f9]"
                        initial={{ width: "0%" }}
                        animate={{ width: paused ? "0%" : "100%" }}
                        transition={{ duration: paused ? 0 : DURATION, ease: "linear" }}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          <Tilt max={4}>
            <div className="relative">
              <div aria-hidden className="absolute -inset-8 rounded-[48px] bg-gradient-to-tr from-[#7c1cf0]/35 to-[#e879f9]/10 blur-3xl" />
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  className="relative"
                >
                  <BrowserFrame src={STEPS[active]!.img} label={STEPS[active]!.label} alt={STEPS[active]!.title} priority={active === 0} />
                </motion.div>
              </AnimatePresence>
            </div>
          </Tilt>
        </div>
      </div>
    </section>
  );
}

type Chapter = {
  id: string;
  icon: LucideIcon;
  kicker: string;
  title: string;
  points: string[];
  img: string;
  label: string;
};

const CHAPTERS: Chapter[] = [
  {
    id: "setup",
    icon: Building2,
    kicker: "Day one",
    title: "Set up your business",
    points: [
      "Sign up with your business name and pick your trade - 16 are built in, from fruit & vegetables to furniture.",
      "Pick your country, then add your tax number (TRN or VAT number), address, bank details and signature once; they print on every invoice.",
      "Choose whether your prices include VAT. You can still flip it on any single invoice.",
    ],
    img: "/marketing/showcase/settings.webp",
    label: "kayyro / settings",
  },
  {
    id: "catalog",
    icon: FolderTree,
    kicker: "Catalog",
    title: "Add what you sell",
    points: [
      "Group products into categories and subcategories - Vegetables › Leafy greens, Bedroom › Mattresses.",
      "Choose how each item is sold: pieces, kg, grams, litres, metres, boxes, cartons, hours or nights.",
      "Set a reorder level and Kayyro flags anything running low on the dashboard.",
    ],
    img: "/marketing/showcase/products.webp",
    label: "kayyro / products",
  },
  {
    id: "customers",
    icon: Users,
    kicker: "Customers",
    title: "Customers & credit",
    points: [
      "Save each customer's country, tax number, phone and email so invoices and reminders fill themselves in - customers abroad are reverse charged or zero-rated for you.",
      "Record part payments; every customer gets a running ledger and balance.",
      "The Outstanding page sorts debts by age so you chase the oldest money first.",
    ],
    img: "/marketing/showcase/outstanding.webp",
    label: "kayyro / outstanding",
  },
  {
    id: "send",
    icon: Mail,
    kicker: "Get paid",
    title: "Email, WhatsApp & reminders",
    points: [
      "Email any invoice with the PDF attached, or select many and send them all at once.",
      "Payment reminders go to every customer who owes you - one click, with their balance filled in.",
      "Prefer chat? Share the PDF link on WhatsApp straight from the invoice.",
    ],
    img: "/marketing/showcase/invoices.webp",
    label: "kayyro / invoices",
  },
  {
    id: "dashboard",
    icon: LayoutDashboard,
    kicker: "Every morning",
    title: "Your dashboard",
    points: [
      "Today's sales against last week, a monthly goal ring and your billing streak keep momentum visible.",
      "See money waiting to be collected, best sellers, top customers and stock that needs attention.",
      "A VAT set-aside estimate for the quarter so filing day is never a surprise.",
    ],
    img: "/marketing/showcase/dashboard.webp",
    label: "kayyro / dashboard",
  },
  {
    id: "vat",
    icon: BarChart3,
    kicker: "Compliance",
    title: "VAT returns",
    points: [
      "Your return in your country's layout: UAE VAT 201 by emirate, or the Saudi, Bahrain and Oman VAT returns with output and input VAT. Qatar and Kuwait get a sales summary.",
      "Export the workbook to Excel for your accountant, along with sales and purchase registers.",
      "Credit notes and zero-rated or exempt supplies are handled in their own boxes.",
    ],
    img: "/marketing/showcase/vat201b.webp",
    label: "kayyro / reports / vat 201",
  },
  {
    id: "stock",
    icon: Boxes,
    kicker: "Stock",
    title: "Inventory that moves itself",
    points: [
      "Every invoice deducts stock and every purchase adds it - including decimals for weights and lengths.",
      "Stock in, stock out and counted adjustments are kept in a full audit trail.",
      "Multiple warehouses on the Business plan.",
    ],
    img: "/marketing/showcase/inventory.webp",
    label: "kayyro / inventory",
  },
];

/** Long-form guide with a table of contents that follows your scroll. */
export function Chapters() {
  const [current, setCurrent] = useState(CHAPTERS[0]!.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: "-35% 0px -55% 0px" }
    );
    CHAPTERS.forEach((c) => {
      const el = document.getElementById(c.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <section className="relative border-t border-white/8 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-28 space-y-1" aria-label="Guide chapters">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">The guide</p>
            {CHAPTERS.map((c, i) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
                  current === c.id ? "text-white" : "text-white/50 hover:text-white/80"
                )}
              >
                {current === c.id && (
                  <motion.span layoutId="toc-active" className="absolute inset-0 rounded-xl bg-white/[0.07]" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
                )}
                <span className="relative font-mono text-[11px] text-white/35">{String(i + 1).padStart(2, "0")}</span>
                <span className="relative">{c.title}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="space-y-24">
          {CHAPTERS.map((c, i) => (
            <article key={c.id} id={c.id} className="scroll-mt-28">
              <Reveal>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-b from-[#b65cff]/30 to-[#7c1cf0]/20 text-[#e2c2ff]">
                    <c.icon className="h-5 w-5" />
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">
                    {String(i + 1).padStart(2, "0")} · {c.kicker}
                  </p>
                </div>
                <h3 className="mt-4 font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">{c.title}</h3>
              </Reveal>
              <div className="mt-8 grid items-start gap-8 xl:grid-cols-[0.9fr_1.1fr]">
                <ul className="space-y-4">
                  {c.points.map((p, j) => (
                    <motion.li
                      key={p}
                      initial={{ opacity: 0, x: -14 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-60px" }}
                      transition={{ delay: j * 0.1, duration: 0.5, ease: EASE }}
                      className="flex gap-3 text-[15px] leading-relaxed text-white/70"
                    >
                      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#34d399]/15 text-[#6ee7b7]">
                        <Check className="h-3 w-3" />
                      </span>
                      {p}
                    </motion.li>
                  ))}
                </ul>
                <Reveal delay={0.1}>
                  <div className="group transition-transform duration-500 hover:-translate-y-1">
                    <BrowserFrame src={c.img} label={c.label} alt={`${c.title} - Kayyro screenshot`} />
                  </div>
                </Reveal>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const TIPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Command, title: "Ctrl + K to find anything", body: "Jump to any invoice, customer, product or page from the search bar." },
  { icon: MousePointerClick, title: "Tap to add", body: "On a new invoice, tap catalog tiles - tap again to add one more." },
  { icon: ScanBarcode, title: "Scan barcodes", body: "A USB or Bluetooth scanner works out of the box on the invoice screen." },
  { icon: Percent, title: "Prices include VAT?", body: "One switch decides whether VAT is added on top or worked out of your price." },
  { icon: Package, title: "Decimals where they belong", body: "Kilos, litres and metres take decimals; pieces and boxes stay whole." },
  { icon: Keyboard, title: "Press / to search", body: "Hands on the keyboard? “/” focuses the search box on every page." },
];

export function Tips() {
  return (
    <section className="relative border-t border-white/8 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">Little things that save hours</h2>
        </Reveal>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TIPS.map((t, i) => (
            <Reveal key={t.title} delay={i * 0.05}>
              <div className="group h-full rounded-2xl border border-white/8 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]">
                <t.icon className="h-5 w-5 text-[#c98bff] transition-transform group-hover:scale-110" />
                <p className="mt-3 font-display text-base font-bold text-white">{t.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-white/55">{t.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
