import { mapStripeStatus, subscriptionToOrgPatch, type StripeSubscriptionLike } from "./stripe-sync";
import type { PaidPlanId } from "./plans";
import { mapStripePriceIdToTier, stripePriceEnvKey } from "./plans";

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

const tierFor = (id: string | null | undefined): PaidPlanId | null =>
  id === "price_pro" ? "pro" : id === "price_starter" ? "starter" : null;

const base: StripeSubscriptionLike = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_pro" } }] },
  metadata: { organization_id: "org_1", plan: "pro" },
};

// ---- status mapping ----
check(mapStripeStatus("active") === "active", "active -> active");
check(mapStripeStatus("trialing") === "active", "trialing -> active");
check(mapStripeStatus("past_due") === "past_due", "past_due -> past_due");
check(mapStripeStatus("unpaid") === "past_due", "unpaid -> past_due");
check(mapStripeStatus("canceled") === "cancelled", "canceled -> cancelled");
check(mapStripeStatus("incomplete") === null, "an unfinished checkout changes nothing");
check(mapStripeStatus("incomplete_expired") === null, "an expired checkout changes nothing");

// ---- an active subscription ----
let p = subscriptionToOrgPatch(base, tierFor);
check(p.subscription_status === "active", "active subscription -> active");
check(p.plan === "pro", "the plan comes from the Stripe price");
check(p.stripe_subscription_id === "sub_1" && p.stripe_customer_id === "cus_1", "both Stripe ids are stored");
check(p.current_period_end === new Date(1_800_000_000 * 1000).toISOString(), "the period end comes from the item");
check(p.cancel_at_period_end === false, "not cancelling");

// ---- the plan falls back to the metadata we set at checkout ----
p = subscriptionToOrgPatch({ ...base, items: { data: [{ price: { id: "price_unknown" } }] } }, tierFor);
check(p.plan === "pro", "unknown price -> plan from the checkout metadata");

// ---- older Stripe API versions keep the period end on the subscription ----
p = subscriptionToOrgPatch({ ...base, items: { data: [{ price: { id: "price_starter" } }] }, current_period_end: 1_700_000_000, metadata: {} }, tierFor);
check(p.current_period_end === new Date(1_700_000_000 * 1000).toISOString(), "period end falls back to the subscription");
check(p.plan === "starter", "plan from the price");

// ---- cancelling at the end of the period keeps access ----
p = subscriptionToOrgPatch({ ...base, cancel_at_period_end: true }, tierFor);
check(p.subscription_status === "active" && p.cancel_at_period_end === true, "cancel at period end: still active, flagged");
p = subscriptionToOrgPatch({ ...base, cancel_at: 1_800_000_000 }, tierFor);
check(p.cancel_at_period_end === true, "the portal's cancel_at counts as cancelling");

// ---- a failed payment / a cancelled subscription ----
p = subscriptionToOrgPatch({ ...base, status: "past_due" }, tierFor);
check(p.subscription_status === "past_due", "failed payment -> past_due");
p = subscriptionToOrgPatch({ ...base, status: "canceled", cancel_at_period_end: true }, tierFor);
check(p.subscription_status === "cancelled" && p.cancel_at_period_end === false, "cancelled subscription -> cancelled");
check(!("plan" in p), "a cancelled subscription leaves the plan field alone");

// ---- checkout opened but not paid ----
p = subscriptionToOrgPatch({ ...base, status: "incomplete" }, tierFor);
check(!("subscription_status" in p) && !("plan" in p), "unpaid: no status or plan change");
check(p.stripe_subscription_id === "sub_1", "unpaid: the subscription id is still linked");

// ---- the customer can arrive as an object ----
p = subscriptionToOrgPatch({ ...base, customer: { id: "cus_9" } }, tierFor);
check(p.stripe_customer_id === "cus_9", "customer object -> id");

// ---- price ids come from the environment ----
process.env[stripePriceEnvKey("starter")] = "price_S";
process.env[stripePriceEnvKey("pro")] = " price_P ";
check(stripePriceEnvKey("business") === "STRIPE_PRICE_BUSINESS", "env key names");
check(mapStripePriceIdToTier("price_S") === "starter", "starter price id -> starter");
check(mapStripePriceIdToTier("price_P") === "pro", "price ids are trimmed");
check(mapStripePriceIdToTier("price_other") === null && mapStripePriceIdToTier(undefined) === null, "unknown price id -> none");
process.env[stripePriceEnvKey("business", "annual")] = "price_BY";
check(stripePriceEnvKey("pro", "annual") === "STRIPE_PRICE_PRO_ANNUAL", "yearly env key names");
check(mapStripePriceIdToTier("price_BY") === "business", "a yearly price id -> its plan");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nstripe-sync tests passed");
process.exit(failures ? 1 : 0);
