"use client";

import { useCollectLang } from "@/components/collect/collect-ui";
import { riskReasons, type CustomerRisk } from "@/lib/collect/insights";
import { cn } from "@/lib/utils";

const STYLE = {
  low: "bg-sage-soft text-sage",
  medium: "bg-amber/15 text-[#b45309] dark:text-[#fcd34d]",
  high: "bg-rose/15 text-rose",
} as const;

/** Late-payer risk (Business plan). The reasons show on hover, or under it with `detailed`. */
export function RiskBadge({ risk, currency, detailed }: { risk: CustomerRisk; currency: string; detailed?: boolean }) {
  const { t, lang } = useCollectLang();
  const reasons = riskReasons(risk, currency, lang);
  const label = { low: t.risk_low, medium: t.risk_medium, high: t.risk_high }[risk.level];
  return (
    <span className={cn(detailed ? "block" : "inline-block")}>
      <span
        title={detailed ? undefined : reasons.join(" · ")}
        className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", STYLE[risk.level])}
      >
        {label}
      </span>
      {detailed && (
        <span className="mt-1 block text-xs text-slate">{reasons.join(" · ")}</span>
      )}
    </span>
  );
}
