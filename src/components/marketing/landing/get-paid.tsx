"use client";

import { motion, useReducedMotion } from "motion/react";
import { BellRing, CalendarCheck, Check, CheckCheck, HandCoins, Link2, MessageSquareText } from "lucide-react";
import { EASE, Reveal, WordsReveal } from "./primitives";

const POINTS = [
  { icon: BellRing, text: "Automatic, polite reminders", soon: false },
  { icon: MessageSquareText, text: "AI reads every reply", soon: false },
  { icon: Link2, text: "One-tap payment links", soon: false },
];

const CHAT = [
  {
    from: "business" as const,
    text: "Hi Ahmed, a friendly reminder that invoice INV-1042 for AED 3,150.00 was due on 3 Nov. View and pay here: 🔗 Invoice INV-1042",
    time: "10:02",
  },
  { from: "customer" as const, text: "Thanks, will pay Thursday", time: "10:14" },
  { from: "business" as const, text: "Noted for Thursday. Thank you, Ahmed!", time: "10:15" },
];

/** A WhatsApp-style conversation: reminder, reply, promise saved. */
function ChatMockup() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="overflow-hidden rounded-[28px] border border-white/12 bg-[#0b141a] shadow-[0_40px_120px_-40px_rgba(124,28,240,0.7)]">
        <div className="flex items-center gap-3 bg-[#1f2c34] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7c1cf0] font-display text-sm font-bold text-white">
            AT
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Al Noor Trading</p>
            <p className="text-[11px] text-white/50">Business account</p>
          </div>
        </div>
        <div className="space-y-2.5 px-3 py-4">
          {CHAT.map((m, i) => (
            <motion.div
              key={i}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: 0.35 + i * 0.55, ease: EASE }}
              className={m.from === "business" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  m.from === "business"
                    ? "max-w-[85%] rounded-2xl rounded-tr-md bg-[#005c4b] px-3 py-2 text-[13px] leading-snug text-white"
                    : "max-w-[85%] rounded-2xl rounded-tl-md bg-[#202c33] px-3 py-2 text-[13px] leading-snug text-white"
                }
              >
                {m.text}
                <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-white/50">
                  {m.time}
                  {m.from === "business" && <CheckCheck className="h-3 w-3 text-[#53bdeb]" />}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <motion.span
        initial={reduce ? false : { opacity: 0, scale: 0.85 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.4, delay: 2.1, ease: EASE }}
        className="absolute -bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-[#34d399]/40 bg-[#0f2a22] px-3 py-1.5 text-xs font-semibold text-[#6ee7b7] shadow-lg"
      >
        <CalendarCheck className="h-3.5 w-3.5" /> Promise saved: Thursday
      </motion.span>
    </div>
  );
}

export function GetPaid() {
  return (
    <section id="get-paid" className="relative scroll-mt-20 py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/4 -z-0 mx-auto h-[420px] max-w-4xl rounded-full bg-[#7c1cf0]/12 blur-[130px]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <Reveal>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#c98bff]">
              <HandCoins className="h-4 w-4" /> Get paid · Kayyro Collect
            </p>
          </Reveal>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-[-0.035em] text-white sm:text-6xl">
            <WordsReveal text="Get paid on time," inView />
            <br />
            <WordsReveal text="without chasing." inView delay={0.2} className="text-[#c98bff]" />
          </h2>
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-xl text-lg text-white/60">
              Kayyro reminds your customers on WhatsApp and email, in English or Arabic, reads their replies and tracks
              every promise to pay. You only step in when it matters.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <ul className="mt-8 space-y-3">
              {POINTS.map((p) => (
                <li key={p.text} className="flex items-center gap-3 text-white/85">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04]">
                    <p.icon className="h-4 w-4 text-[#c98bff]" />
                  </span>
                  <span className="font-medium">{p.text}</span>
                  {p.soon ? (
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                      Coming soon
                    </span>
                  ) : (
                    <Check className="h-4 w-4 text-[#6ee7b7]" />
                  )}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <ChatMockup />
        </Reveal>
      </div>
    </section>
  );
}
