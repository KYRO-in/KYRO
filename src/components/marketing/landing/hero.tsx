"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ArrowRight, CheckCircle2, Play, Receipt, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { EASE, Magnetic, Reveal, WordsReveal } from "./primitives";
import { ProductVideo } from "./product-video";

function FloatChip({
  className,
  delay = 0,
  children,
}: {
  className?: string;
  delay?: number;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.85, y: 20 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 1.4 + delay, duration: 0.8, ease: EASE }}
      className={className}
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, -10, 0] }}
        transition={{ duration: 5 + delay * 2, repeat: Infinity, ease: "easeInOut" }}
        className="flex items-center gap-2.5 rounded-2xl border border-white/12 bg-[#1a1433]/85 px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] backdrop-blur-md"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start 95%", "start 25%"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 24, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.88, 1]);
  const glow = useTransform(scrollYProgress, [0, 1], [0.35, 1]);

  return (
    <section className="relative overflow-hidden pt-32 sm:pt-40">
      {/* living background */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute -left-40 -top-56 h-[760px] w-[760px] rounded-full bg-[#7c1cf0]/30 blur-[130px]"
          animate={reduce ? undefined : { x: [0, 90, 0], y: [0, 60, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-40 top-10 h-[640px] w-[640px] rounded-full bg-[#d946ef]/20 blur-[130px]"
          animate={reduce ? undefined : { x: [0, -80, 0], y: [0, 80, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <div
          className="absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(182,140,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(182,140,255,0.07) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, #000 20%, transparent 100%)",
            maskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, #000 20%, transparent 100%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 text-center sm:px-6">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="mx-auto inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/5 py-1.5 pl-2 pr-4 text-[13px] font-medium text-white/80 backdrop-blur"
        >
          <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-[#b65cff]/25">
            <span className="absolute h-5 w-5 animate-ping rounded-full bg-[#b65cff]/40" />
            <span className="h-2 w-2 rounded-full bg-[#b65cff]" />
          </span>
          Built for the GCC · VAT for all 6 Gulf countries
        </motion.div>

        <h1 className="mx-auto mt-7 max-w-5xl font-display text-[46px] font-extrabold leading-[1.02] tracking-[-0.045em] text-white sm:text-7xl lg:text-[96px]">
          <WordsReveal text="Tax billing" delay={0.1} />
          <br />
          <WordsReveal text="done in seconds." wordClassName="landing-sheen" delay={0.35} />
        </h1>

        <motion.p
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
          className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-white/65 sm:text-xl"
        >
          Tax invoices, stock and your VAT return, in one calm, fast workspace for businesses across the UAE,
          Saudi Arabia, Bahrain, Oman, Qatar and Kuwait.
        </motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 1.05 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <Magnetic>
            <Link
              href="/signup"
              className="group relative inline-flex h-14 items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-[#b65cff] to-[#7c1cf0] px-7 text-[15px] font-semibold text-white shadow-[0_18px_50px_-12px_rgba(182,92,255,0.9)] transition-shadow hover:shadow-[0_22px_70px_-10px_rgba(182,92,255,1)]"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">Start free for 14 days</span>
              <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Magnetic>
          <Magnetic strength={0.2}>
            <Link
              href="/#tour"
              className="inline-flex h-14 items-center gap-2.5 rounded-2xl border border-white/15 bg-white/5 px-6 text-[15px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                <Play className="h-3 w-3 translate-x-px fill-white" />
              </span>
              See it in action
            </Link>
          </Magnetic>
        </motion.div>
        <Reveal delay={1.2} y={10}>
          <p className="mt-5 text-[13px] text-white/45">No card required · VAT ready · Built for the GCC</p>
        </Reveal>
      </div>

      {/* product film, flattening as it scrolls into view */}
      <div ref={stage} className="relative mx-auto mt-16 max-w-5xl px-4 pb-24 sm:mt-20 sm:px-6" style={{ perspective: 1800 }}>
        <motion.div
          aria-hidden
          style={{ opacity: glow }}
          className="absolute inset-x-10 -bottom-4 top-24 -z-0 rounded-[40px] bg-gradient-to-b from-[#b65cff]/40 to-[#7c1cf0]/0 blur-[90px]"
        />
        <motion.div style={{ rotateX, scale, transformOrigin: "50% 100%" }} className="relative will-change-transform">
          <ProductVideo />
          <FloatChip className="absolute -left-3 top-16 hidden lg:block xl:-left-14" delay={0}>
            <ShieldCheck className="h-4 w-4 text-[#34d399]" />
            Your tax number on every invoice
          </FloatChip>
          <FloatChip className="absolute -right-3 top-40 hidden lg:block xl:-right-16" delay={0.25}>
            <Receipt className="h-4 w-4 text-[#b65cff]" />
            VAT 15% · SAR 1,150.00
          </FloatChip>
          <FloatChip className="absolute -bottom-5 left-16 hidden md:block" delay={0.5}>
            <CheckCircle2 className="h-4 w-4 text-[#34d399]" />
            VAT 201 · Saudi VAT return
          </FloatChip>
        </motion.div>
      </div>
    </section>
  );
}
