"use client";

import {
  ANNUAL_SAVING_LABEL,
  formatPlanPrice,
  getPlanChecklist,
  getPlanPrice,
  PAID_PLAN_ORDER,
  PAID_PLANS,
  type AiAllowanceRegion,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { Check, Crown, Leaf, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const TIER_ICONS = {
  starter: Leaf,
  pro: Sparkles,
  business: Crown,
} as const;

const TIER_ICON_STYLES: Record<PaidPlanId, string> = {
  starter: "bg-primary/10 text-primary",
  pro: "bg-primary/15 text-primary",
  business: "bg-primary/10 text-primary",
};

type PricingPlansProps = {
  /** marketing → links to signup; billing → calls onSelectPlan */
  variant: "marketing" | "billing";
  onSelectPlan?: (planId: PaidPlanId, interval: BillingInterval) => void;
  busyPlan?: PaidPlanId | null;
  className?: string;
  /** Hide the section heading (billing page already has PageHeader context) */
  hideHeading?: boolean;
  /** Ask Kayyro allowance to show (billing page: the business's own). Prices are always AED. */
  aiRegion?: AiAllowanceRegion;
};

export function PricingPlans({
  variant,
  onSelectPlan,
  busyPlan = null,
  className,
  hideHeading = false,
  aiRegion = "global",
}: PricingPlansProps) {
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  return (
    <div className={cn("w-full", className)}>
      {!hideHeading ? (
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Pricing
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Simple plans for growing shops
          </h2>
          <p className="mt-2 text-sm text-slate">
            Start with a 14-day trial. Upgrade when you&apos;re ready - cancel anytime.
          </p>
        </div>
      ) : null}

      <div className={cn("flex flex-wrap items-center justify-center gap-3", hideHeading ? "" : "mt-8")}>
        <div
          role="group"
          aria-label="Billing interval"
          className="inline-flex rounded-full border border-border bg-cloud p-1 shadow-sm"
        >
          {(
            [
              { id: "monthly" as const, label: "Monthly" },
              { id: "annual" as const, label: "Annual" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={interval === opt.id}
              onClick={() => setInterval(opt.id)}
              className={cn(
                "min-h-[40px] rounded-full px-5 text-sm font-semibold transition-colors",
                interval === opt.id
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate hover:text-ink"
              )}
            >
              {opt.label}
              {opt.id === "annual" ? (
                <span
                  className={cn(
                    "ml-1.5 text-[10px] font-bold uppercase tracking-wide",
                    interval === "annual" ? "text-white/90" : "text-primary"
                  )}
                >
                  {ANNUAL_SAVING_LABEL}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-slate">
        Prices in UAE dirhams (AED). Annual: pay for 10 months, get 12.
      </p>

      <div className="mt-8 grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
        {PAID_PLAN_ORDER.map((id) => (
          <PlanCard
            key={id}
            planId={id}
            interval={interval}
            aiRegion={aiRegion}
            variant={variant}
            busy={busyPlan === id}
            onSelect={onSelectPlan}
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  planId,
  interval,
  aiRegion,
  variant,
  busy,
  onSelect,
}: {
  planId: PaidPlanId;
  interval: BillingInterval;
  aiRegion: AiAllowanceRegion;
  variant: "marketing" | "billing";
  busy: boolean;
  onSelect?: (planId: PaidPlanId, interval: BillingInterval) => void;
}) {
  const plan = PAID_PLANS[planId];
  const price = getPlanPrice(plan, interval);
  const checklist = getPlanChecklist(planId, aiRegion);
  const Icon = TIER_ICONS[planId];
  const popular = !!plan.recommended;

  const ctaLabel =
    variant === "marketing"
      ? popular
        ? "Start free trial"
        : "Get started"
      : popular
        ? "Upgrade to Pro"
        : `Choose ${plan.name}`;

  const ctaClass = cn(
    "mt-5 inline-flex h-11 w-full items-center justify-center rounded-[10px] text-sm font-semibold transition-all duration-200",
    popular
      ? "bg-primary text-white shadow-sm hover:opacity-95"
      : "border border-primary/30 bg-surface text-primary hover:bg-primary/5"
  );

  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-[16px] border bg-surface p-5 shadow-card sm:p-6",
        popular
          ? "border-primary/40 bg-primary-soft shadow-[0_8px_28px_rgba(124,28,240,0.10)]"
          : "border-border"
      )}
    >
      {popular ? (
        <div
          className="pointer-events-none absolute -right-10 top-5 z-10 w-40 rotate-45 bg-primary py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-sm"
          aria-hidden
        >
          Most Popular
        </div>
      ) : null}

      <div className="flex items-center gap-3 pr-10">
        <span
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            TIER_ICON_STYLES[planId]
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">{plan.name}</h3>
          <p className="text-xs text-slate">{plan.description}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-baseline gap-2">
          {price.compareAt != null ? (
            <span className="font-mono text-sm text-slate-dim line-through">
              {formatPlanPrice(price.compareAt)}
            </span>
          ) : null}
          <span className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {formatPlanPrice(price.price)}
          </span>
          <span className="text-sm font-medium text-slate">{price.periodSuffix}</span>
        </div>
        <p className="mt-1.5 text-sm text-slate">
          Only{" "}
          <span className="font-semibold text-ink">{formatPlanPrice(price.perMonth)}</span> per month
        </p>
      </div>

      {variant === "marketing" ? (
        <Link href="/signup" className={ctaClass}>
          {ctaLabel}
        </Link>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect?.(planId, interval)}
          className={cn(ctaClass, "disabled:pointer-events-none disabled:opacity-50")}
        >
          {busy ? (
            <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : null}
          {ctaLabel}
        </button>
      )}

      <div className="mt-5 flex-1 border-t border-border pt-4">
        <ul className="space-y-2.5">
          {checklist.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-2 text-sm",
                item.included ? "text-ink" : "text-slate-dim"
              )}
            >
              {item.included ? (
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  strokeWidth={2.5}
                  aria-hidden
                />
              ) : (
                <X
                  className="mt-0.5 h-4 w-4 shrink-0 text-rose/55"
                  strokeWidth={2.5}
                  aria-hidden
                />
              )}
              <span className={item.included ? undefined : "line-through decoration-slate-dim/40"}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
