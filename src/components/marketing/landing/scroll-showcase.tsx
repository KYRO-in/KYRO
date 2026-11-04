"use client";

import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import Image from "next/image";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EASE, Reveal } from "./primitives";

const STEPS = [
  {
    kicker: "Billing",
    title: "Tax invoices in seconds",
    body: "Pick a customer, add items. VAT is worked out on every line under your country's rules, your tax number prints automatically, and prices can include or exclude tax.",
    img: "/marketing/showcase/invoice-step3.webp",
    label: "kayyro / invoices / new",
  },
  {
    kicker: "Overview",
    title: "Your business, live",
    body: "Revenue, outstanding balances, stock alerts and customers on one calm dashboard, always up to date.",
    img: "/marketing/showcase/dashboard.webp",
    label: "kayyro / dashboard",
  },
  {
    kicker: "Compliance",
    title: "Your tax return, ready to file",
    body: "Output tax, input tax from purchases and the net payable, in your country's layout - UAE VAT 201 or the Saudi, Bahrain and Oman VAT returns - and exported to Excel.",
    img: "/marketing/showcase/vat201b.webp",
    label: "kayyro / reports / vat 201",
  },
  {
    kicker: "Relationships",
    title: "Customers and credit, tracked",
    body: "A ledger for every customer with part payments, balances due and one-tap WhatsApp reminders.",
    img: "/marketing/showcase/customers.webp",
    label: "kayyro / customers",
  },
  {
    kicker: "Inventory",
    title: "Stock that stays honest",
    body: "Every invoice moves stock. Low-stock alerts, batches, warehouses and zero-, standard- and exempt-rated items.",
    img: "/marketing/showcase/products.webp",
    label: "kayyro / products",
  },
];

function Frame({ step, priority = false }: { step: (typeof STEPS)[number]; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0817] shadow-[0_40px_120px_-30px_rgba(124,28,240,0.6)]">
      <div className="flex h-9 items-center gap-2 border-b border-white/10 bg-[#140f29] px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="ml-3 font-mono text-[11px] text-white/45">{step.label}</span>
      </div>
      <Image
        src={step.img}
        alt={`${step.title} - Kayyro screenshot`}
        width={1920}
        height={1080}
        priority={priority}
        sizes="(min-width: 1024px) 720px, 100vw"
        className="block h-auto w-full"
      />
    </div>
  );
}

export function ScrollShowcase() {
  const reduce = useReducedMotion();
  const section = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const i = Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length * 0.999)));
    setActive((cur) => (cur === i ? cur : i));
  });

  return (
    <section id="tour" className="relative scroll-mt-4">
      <div className="mx-auto max-w-6xl px-4 pt-20 text-center sm:px-6">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">The product</p>
          <h2 className="mx-auto mt-3 max-w-3xl font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-6xl">
            Everything you bill, track and file.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/60">Scroll to walk through a day in Kayyro.</p>
        </Reveal>
      </div>

      {/* desktop: sticky stage that swaps as you scroll */}
      <div ref={section} className="relative mt-10 hidden lg:block" style={{ height: `${STEPS.length * 85}vh` }}>
        <div className="sticky top-0 flex h-screen items-center">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-center gap-14 px-6">
            <ol className="relative space-y-2">
              <div className="absolute bottom-3 left-[7px] top-3 w-px bg-white/10" aria-hidden />
              {STEPS.map((s, i) => {
                const on = i === active;
                return (
                  <li key={s.title} className="relative pl-9">
                    <span
                      className={cn(
                        "absolute left-0 top-[22px] h-[15px] w-[15px] rounded-full border-2 transition-all duration-500",
                        on ? "scale-110 border-[#b65cff] bg-[#b65cff] shadow-[0_0_24px_rgba(182,92,255,0.9)]" : "border-white/25 bg-[#0e0b1a]"
                      )}
                    />
                    <div className={cn("rounded-2xl p-4 transition-all duration-500", on ? "bg-white/[0.06]" : "opacity-45")}>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#c98bff]">{s.kicker}</p>
                      <h3 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-white">{s.title}</h3>
                      <AnimatePresence initial={false}>
                        {on && (
                          <motion.p
                            initial={reduce ? false : { height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.45, ease: EASE }}
                            className="overflow-hidden text-[15px] leading-relaxed text-white/65"
                          >
                            <span className="block pt-2">{s.body}</span>
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="relative">
              <div className="absolute -inset-10 -z-10 rounded-[48px] bg-[#7c1cf0]/25 blur-[90px]" aria-hidden />
              <div className="relative" style={{ perspective: 1600 }}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active}
                    initial={reduce ? false : { opacity: 0, y: 36, rotateX: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0, y: -24, scale: 0.98 }}
                    transition={{ duration: 0.55, ease: EASE }}
                    style={{ transformOrigin: "50% 100%" }}
                  >
                    <Frame step={STEPS[active]} priority={active === 0} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* mobile / tablet: simple stacked story */}
      <div className="mx-auto mt-12 max-w-2xl space-y-16 px-4 pb-8 sm:px-6 lg:hidden">
        {STEPS.map((s) => (
          <Reveal key={s.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#c98bff]">{s.kicker}</p>
            <h3 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-white">{s.title}</h3>
            <p className="mb-6 mt-3 text-base leading-relaxed text-white/65">{s.body}</p>
            <Frame step={s} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
