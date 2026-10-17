"use client";

import { BusinessTypePicker } from "@/components/settings/business-type-picker";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useUpdateCompanySettings } from "@/hooks/use-company";
import { BUSINESS_TYPE_OPTIONS, normalizeBusinessType, type BusinessType } from "@/lib/business-types";
import { useEffect, useState } from "react";

/**
 * Own card at the top of Settings: shows the current business type and lets an
 * admin switch it. Saves straight away (separate from the main settings form).
 */
export function BusinessTypeSection({
  organizationId,
  current,
}: {
  organizationId: string;
  current: BusinessType | string | undefined;
}) {
  const saved = normalizeBusinessType(current);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<BusinessType>(saved);
  const update = useUpdateCompanySettings();
  const { toast } = useToast();

  useEffect(() => setChoice(saved), [saved]);

  const savedOpt = BUSINESS_TYPE_OPTIONS.find((o) => o.value === saved);
  const choiceOpt = BUSINESS_TYPE_OPTIONS.find((o) => o.value === choice);
  const changed = choice !== saved;

  const save = async () => {
    try {
      await update.mutateAsync({ id: organizationId, business_type: choice });
      toast(`Business type changed to ${choiceOpt?.label ?? choice}`);
      setOpen(false);
    } catch (e) {
      toast((e as Error).message || "Could not change business type", "error");
    }
  };

  return (
    <section id="business-type" className="panel mb-6 max-w-2xl scroll-mt-24 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-2xl leading-none" aria-hidden>
            {savedOpt?.emoji}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate">Business type</p>
            <p className="font-display text-base font-semibold text-ink">{savedOpt?.label ?? "General"}</p>
          </div>
        </div>
        {!open && (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Change business type
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate">
            Pick what fits best - it sets your categories, units (kg, litres, metres…) and the extra
            invoice and product fields.
          </p>
          <BusinessTypePicker value={choice} onChange={setChoice} />
          {choiceOpt?.description ? <p className="text-xs text-slate">{choiceOpt.description}</p> : null}

          {changed && (
            <p className="rounded-[10px] border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-ink">
              Switching from {savedOpt?.label} to {choiceOpt?.label} changes labels, units and optional
              fields across the app. Your products, customers, invoices, stock and tax stay exactly as
              they are, and you can switch back any time.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={!changed} loading={update.isPending}>
              {changed ? `Switch to ${choiceOpt?.label}` : "Pick a different type"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setChoice(saved);
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
