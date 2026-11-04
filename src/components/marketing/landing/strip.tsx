"use client";

import { BUSINESS_TYPE_OPTIONS } from "@/lib/business-types";
import { NumberTicker, Reveal } from "./primitives";

const STATS = [
  { value: 4, suffix: "", label: "steps from customer to tax invoice" },
  { value: 6, suffix: "", label: "Gulf countries' VAT rules built in" },
  { value: 16, suffix: "", label: "trades, each with its own units and fields" },
  { value: 14, suffix: "", label: "days free, no card needed" },
];

export function StatsStrip() {
  return (
    <section className="relative border-y border-white/8 bg-white/[0.02] py-12">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-10 px-4 sm:px-6 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08} y={20} className="px-4 text-center lg:border-l lg:border-white/8 lg:first:border-l-0">
            <div className="font-display text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
              <NumberTicker value={s.value} suffix={s.suffix} />
            </div>
            <p className="mx-auto mt-2 max-w-[15rem] text-sm leading-snug text-white/55">{s.label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function BusinessMarquee() {
  const types = BUSINESS_TYPE_OPTIONS.filter((o) => o.value !== "general");
  const row = [...types, ...types];
  return (
    <section className="relative overflow-hidden py-16">
      <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
        One billing engine · sixteen trades built in
      </p>
      <div
        className="landing-marquee-mask group relative flex overflow-hidden"
        style={{
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
          maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
        }}
      >
        <div className="landing-marquee flex shrink-0 items-center gap-4 pr-4 group-hover:[animation-play-state:paused]">
          {row.map((t, i) => {
            return (
              <div
                key={`${t.value}-${i}`}
                className="flex items-center gap-3 whitespace-nowrap rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3.5 text-[15px] font-semibold text-white/85"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#b65cff]/15 text-lg" aria-hidden>
                  {t.emoji}
                </span>
                {t.label}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
