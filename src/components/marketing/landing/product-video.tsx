"use client";

import { useInView, useReducedMotion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The Kayyro tour film. Autoplays muted + looped only while it is on screen,
 * pauses off screen to save battery/bandwidth, and never autoplays for
 * visitors who ask for reduced motion (they get the poster and a play button).
 */
export function ProductVideo({
  className,
  label = "kayyro / tour",
}: {
  className?: string;
  label?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const inView = useInView(frame, { amount: 0.35 });
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (inView && !userPaused && !reduce) {
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [inView, userPaused, reduce]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      setUserPaused(false);
      void v.play().catch(() => undefined);
    } else {
      setUserPaused(true);
      v.pause();
    }
  };

  return (
    <div
      ref={frame}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0817] shadow-[0_40px_140px_-30px_rgba(124,28,240,0.65)]",
        className
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b border-white/10 bg-[#140f29] px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
        <span className="ml-3 font-mono text-[11px] text-white/45">{label}</span>
      </div>
      <div className="relative aspect-video w-full">
        <video
          ref={ref}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          loop
          playsInline
          preload="metadata"
          poster="/marketing/kayyro-tour-poster.jpg"
          aria-label="Kayyro product tour: creating a VAT tax invoice, the live dashboard and the VAT 201 summary"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration) setProgress(v.currentTime / v.duration);
          }}
        >
          <source src="/marketing/kayyro-tour.webm" type="video/webm" />
          <source src="/marketing/kayyro-tour.mp4" type="video/mp4" />
        </video>

        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause tour video" : "Play tour video"}
          className="group absolute inset-0 flex items-end justify-end p-4 outline-none"
        >
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur transition-all duration-300 group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-[var(--primary)]",
              playing ? "opacity-0 group-hover:opacity-100" : "opacity-100"
            )}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
          </span>
        </button>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div
            className="h-full origin-left bg-[var(--primary)]"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </div>
    </div>
  );
}
