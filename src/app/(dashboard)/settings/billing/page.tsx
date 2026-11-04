"use client";

import { useAuth } from "@/components/auth-provider";
import { PricingPlans } from "@/components/billing/pricing-plans";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingBlock, PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useOrganization } from "@/hooks/use-company";
import { aiAllowanceRegionFor, type BillingInterval } from "@/lib/billing/plans";
import { useBillingEvents } from "@/hooks/use-billing-events";
import { useOrgAccess } from "@/hooks/use-org-access";
import { type PaidPlanId } from "@/lib/billing/plans";
import { isDemoMode } from "@/lib/demo/mode";
import { formatDate } from "@/lib/utils";
import Script from "next/script";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { APP_NAME, BRAND_COLORS } from "@/lib/brand";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "trialing":
      return "Trial";
    case "active":
      return "Active";
    case "past_due":
      return "Past due";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function statusVariant(status: string): "info" | "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "trialing") return "info";
  if (status === "past_due") return "warning";
  return "danger";
}

export default function BillingPage() {
  const { isAdmin } = useAuth();
  const { data: org, isLoading } = useOrganization();
  const { trialDaysLeft } = useOrgAccess();
  const { data: events } = useBillingEvents();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busyPlan, setBusyPlan] = useState<PaidPlanId | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const demo = isDemoMode();

  const openCheckout = useCallback(
    async (plan: PaidPlanId, interval: BillingInterval) => {
      if (demo) {
        toast("Billing is disabled in demo mode", "error");
        return;
      }
      setBusyPlan(plan);
      try {
        // Card payments go through Stripe (AED) when it is switched on
        const sres = await fetch("/api/billing/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, interval }),
        });
        const sjson = (await sres.json().catch(() => ({}))) as { error?: string; url?: string; code?: string };
        if (sres.ok && sjson.url) {
          window.location.assign(sjson.url);
          return;
        }
        // Stripe not set up yet: carry on with Razorpay below
        if (sjson.code !== "stripe_not_configured") throw new Error(sjson.error ?? "Could not start checkout");

        const res = await fetch("/api/billing/create-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, interval }),
        });
        const json = (await res.json()) as {
          error?: string;
          subscriptionId?: string;
          keyId?: string;
          planName?: string;
          prefill?: { name?: string; email?: string; contact?: string };
        };
        if (!res.ok || !json.subscriptionId || !json.keyId) {
          throw new Error(json.error ?? "Could not start checkout");
        }
        if (!window.Razorpay) {
          throw new Error("Razorpay Checkout script not loaded yet - wait a moment and retry");
        }

        const rzp = new window.Razorpay({
          key: json.keyId,
          subscription_id: json.subscriptionId,
          name: APP_NAME,
          description: `${json.planName ?? plan} subscription`,
          prefill: json.prefill ?? {},
          theme: { color: BRAND_COLORS.primary },
          handler: () => {
            toast("Payment submitted - activating your plan…", "success");
            void qc.invalidateQueries({ queryKey: ["organization"] });
            void qc.invalidateQueries({ queryKey: ["billing_events"] });
          },
          modal: {
            ondismiss: () => {
              toast("Checkout closed", "error");
            },
          },
        });
        rzp.open();
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setBusyPlan(null);
      }
    },
    [demo, qc, toast]
  );

  const manageBilling = async () => {
    if (demo) {
      toast("Billing is disabled in demo mode", "error");
      return;
    }
    setOpeningPortal(true);
    try {
      const res = await fetch("/api/billing/stripe/portal", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Could not open billing");
      window.location.assign(json.url);
    } catch (e) {
      toast((e as Error).message, "error");
      setOpeningPortal(false);
    }
  };

  // Back from Stripe Checkout: the webhook can take a few seconds to activate the plan
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("checkout");
    if (!result) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (result !== "success") {
      toast("Checkout cancelled", "error");
      return;
    }
    toast("Payment received - activating your plan…", "success");
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["organization"] });
      void qc.invalidateQueries({ queryKey: ["billing_events"] });
    };
    refresh();
    const timers = [3000, 8000, 15000].map((ms) => window.setTimeout(refresh, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [qc, toast]);

  const cancelSubscription = async () => {
    if (demo) {
      toast("Billing is disabled in demo mode", "error");
      return;
    }
    if (!confirm("Cancel at period end? You keep access until the renewal date.")) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Cancel failed");
      toast("Subscription will cancel at period end", "success");
      void qc.invalidateQueries({ queryKey: ["organization"] });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCancelling(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-[12px] border border-border bg-surface p-8 text-sm text-slate">
        Only organization admins can manage billing.
      </div>
    );
  }

  if (isLoading || !org) {
    return <LoadingBlock />;
  }

  const paid =
    org.subscription_status === "active" ||
    org.subscription_status === "past_due" ||
    (org.plan !== "free" && (!!org.razorpay_subscription_id || !!org.stripe_subscription_id));
  const showUpgrade =
    org.subscription_status === "trialing" ||
    org.subscription_status === "cancelled" ||
    org.plan === "free";

  return (
    <div>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />

      <PageHeader
        eyebrow="Account"
        title="Billing"
        description="Plan, trial and subscription"
        accent="violet"
      />

      <div className="panel mb-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate">Current plan</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-ink capitalize">
              {org.plan === "free" ? "Trial / Free" : org.plan}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(org.subscription_status)}>
                {statusLabel(org.subscription_status)}
              </Badge>
              {org.cancel_at_period_end ? (
                <Badge variant="warning">Cancels at period end</Badge>
              ) : null}
            </div>
          </div>
          <div className="text-sm text-slate">
            {org.subscription_status === "trialing" && trialDaysLeft != null ? (
              <p>
                <span className="font-medium text-ink">{trialDaysLeft}</span> day
                {trialDaysLeft === 1 ? "" : "s"} left in trial
                {org.trial_ends_at ? ` · ends ${formatDate(org.trial_ends_at)}` : null}
              </p>
            ) : null}
            {org.current_period_end ? (
              <p className="mt-1">
                Renews / access until{" "}
                <span className="font-medium text-ink">{formatDate(org.current_period_end)}</span>
              </p>
            ) : null}
          </div>
        </div>

        {paid && org.subscription_status !== "cancelled" ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {org.stripe_customer_id ? (
              <Button variant="secondary" loading={openingPortal} onClick={() => void manageBilling()}>
                Manage card &amp; invoices
              </Button>
            ) : null}
            <Button
              variant="secondary"
              loading={cancelling}
              onClick={() => void cancelSubscription()}
              disabled={!!org.cancel_at_period_end}
            >
              {org.cancel_at_period_end ? "Cancellation scheduled" : "Cancel subscription"}
            </Button>
          </div>
        ) : null}
      </div>

      {showUpgrade ? (
        <div className="mb-8">
          <PricingPlans
            variant="billing"
            hideHeading
            aiRegion={aiAllowanceRegionFor(org.country)}
            busyPlan={busyPlan}
            onSelectPlan={(id, interval) => void openCheckout(id, interval)}
          />
        </div>
      ) : null}

      <div className="panel overflow-x-auto p-0">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Billing activity</h3>
          <p className="text-xs text-slate">Recent webhook events for this organization</p>
        </div>
        {demo ? (
          <p className="p-5 text-sm text-slate">Billing events are not available in demo mode.</p>
        ) : !events?.length ? (
          <p className="p-5 text-sm text-slate">No billing events yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Subscription</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.created_at)}</td>
                  <td className="font-mono text-xs">{e.event_type}</td>
                  <td className="font-mono text-xs text-slate">
                    {e.stripe_subscription_id ?? e.razorpay_subscription_id ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
