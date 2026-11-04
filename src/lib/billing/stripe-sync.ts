import type { PaidPlanId } from "@/lib/billing/plans";

/** The parts of a Stripe subscription that decide an organization's plan and status. */
export type StripeSubscriptionLike = {
  id: string;
  customer: string | { id: string } | null;
  status: string;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  /** Older Stripe API versions keep the period end here */
  current_period_end?: number | null;
  items?: { data: { current_period_end?: number | null; price?: { id?: string | null } | null }[] };
  metadata?: Record<string, string> | null;
};

export type OrgSubscriptionStatus = "active" | "past_due" | "cancelled";

/**
 * Stripe's status -> ours. null = the customer has not paid yet (a checkout that
 * was opened but not finished), so the organization stays as it was.
 */
export function mapStripeStatus(status: string): OrgSubscriptionStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

export function stripeCustomerId(sub: StripeSubscriptionLike): string | null {
  if (!sub.customer) return null;
  return typeof sub.customer === "string" ? sub.customer : sub.customer.id;
}

function periodEndIso(sub: StripeSubscriptionLike): string | null {
  // Newer API versions put the period on the item; older ones on the subscription
  const seconds = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  if (seconds == null || !Number.isFinite(Number(seconds))) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

/**
 * The organizations columns to write for a Stripe subscription. Always built from
 * the subscription as Stripe holds it now, so a late or repeated webhook never
 * moves an organization backwards.
 */
export function subscriptionToOrgPatch(
  sub: StripeSubscriptionLike,
  tierForPrice: (priceId: string | null | undefined) => PaidPlanId | null
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    updated_at: new Date().toISOString(),
  };
  const customer = stripeCustomerId(sub);
  if (customer) patch.stripe_customer_id = customer;

  const status = mapStripeStatus(sub.status);
  if (!status) return patch;

  patch.subscription_status = status;

  const metaPlan = sub.metadata?.plan;
  const tier =
    tierForPrice(sub.items?.data?.[0]?.price?.id) ??
    (metaPlan === "starter" || metaPlan === "pro" || metaPlan === "business" ? metaPlan : null);

  if (status === "cancelled") {
    patch.cancel_at_period_end = false;
    return patch;
  }

  if (tier) patch.plan = tier;
  const end = periodEndIso(sub);
  if (end) patch.current_period_end = end;
  // Cancelling from the customer portal may set cancel_at instead of cancel_at_period_end
  patch.cancel_at_period_end = Boolean(sub.cancel_at_period_end) || sub.cancel_at != null;
  return patch;
}
