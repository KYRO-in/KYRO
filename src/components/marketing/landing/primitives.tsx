"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The one easing curve the whole page shares - fast out, soft landing. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade + rise when scrolled into view. Renders static for reduced-motion users. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-80px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** One word, sliding up out of a static mask. */
function Word({
  word,
  last,
  delay,
  inView,
  wordClassName,
}: {
  word: string;
  last: boolean;
  delay: number;
  inView: boolean;
  wordClassName?: string;
}) {
  const reduce = useReducedMotion();
  const mask = useRef<HTMLSpanElement>(null);
  // Observe the static mask, never the translated word: a word hidden below the
  // mask has no visible area, so it would never register as "in view".
  const seen = useInView(mask, { once: true, margin: "-60px" });
  const go = inView ? seen : true;
  return (
    <span ref={mask} className="-mb-[0.2em] inline-block overflow-hidden pb-[0.2em] align-bottom" aria-hidden>
      <motion.span
        className={cn("inline-block will-change-transform", wordClassName)}
        initial={reduce ? false : { y: "115%", rotate: 3 }}
        animate={go ? { y: "0%", rotate: 0 } : { y: "115%", rotate: 3 }}
        transition={{ duration: 0.9, ease: EASE, delay }}
      >
        {word}
        {last ? "" : " "}
      </motion.span>
    </span>
  );
}

/** Headline that slides up word by word out of a mask. */
export function WordsReveal({
  text,
  className,
  wordClassName,
  delay = 0,
  stagger = 0.07,
  inView = false,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  stagger?: number;
  inView?: boolean;
}) {
  const words = text.split(" ");
  return (
    <span className={className} aria-label={text}>
      {words.map((w, i) => (
        <Word
          key={i}
          word={w}
          last={i === words.length - 1}
          delay={delay + i * stagger}
          inView={inView}
          wordClassName={wordClassName}
        />
      ))}
    </span>
  );
}

/** Element drifts toward the pointer - buttons feel alive. */
export function Magnetic({
  children,
  className,
  strength = 0.28,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={cn("inline-block", className)}
      style={{ x, y }}
      onPointerMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** 3D tilt toward the pointer, with a soft light sheen. */
export function Tilt({
  children,
  className,
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 140, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 140, damping: 18 });
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <div style={{ perspective: 1400 }} className={className}>
      <motion.div
        ref={ref}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        onPointerMove={(e) => {
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          ry.set(px * max * 2);
          rx.set(-py * max * 2);
        }}
        onPointerLeave={() => {
          rx.set(0);
          ry.set(0);
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/** Number that counts up once it scrolls into view. */
export function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  // The real number is in the page from the start (search engines, no-JS, slow
  // phones); it only counts up from zero once it scrolls into view.
  const mv = useMotionValue(value);

  useEffect(() => {
    if (!inView || reduce) return;
    mv.set(0);
    const c = animate(mv, value, { duration: 1.6, ease: EASE });
    return () => c.stop();
  }, [inView, reduce, value, mv]);

  const text = useTransform(mv, (v) =>
    `${prefix}${v.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`
  );

  return (
    <motion.span ref={ref} className={className}>
      {text}
    </motion.span>
  );
}

/** Spring-smoothed money readout for live calculators. */
export function AnimatedMoney({
  value,
  currency = "AED",
  decimals = 2,
  className,
}: {
  value: number;
  currency?: string;
  /** Minor digits: 2 for most currencies, 3 for dinars and rials */
  decimals?: number;
  className?: string;
}) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 170, damping: 24, mass: 0.6 });
  useEffect(() => {
    mv.set(value);
  }, [value, mv]);
  const text = useTransform(spring as MotionValue<number>, (v) =>
    `${currency} ${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  );
  return <motion.span className={className}>{text}</motion.span>;
}
