import { createAdminClient } from "@/lib/supabase/admin";
import { mapStripePriceIdToTier } from "@/lib/billing/plans";
import { getStripe, stripeConfigured } from "@/lib/billing/stripe";
import { stripeCustomerId, subscriptionToOrgPatch, type StripeSubscriptionLike } from "@/lib/billing/stripe-sync";
import type Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Admin = ReturnType<typeof createAdminClient>;

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** The subscription an event is about, whichever Stripe API version sent it. */
function subscriptionIdFor(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return null;
      return idOf(obj.subscription as string | { id: string } | null);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return typeof obj.id === "string" ? obj.id : null;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const parent = obj.parent as { subscription_details?: { subscription?: string | { id: string } } } | undefined;
      return idOf(parent?.subscription_details?.subscription) ?? idOf(obj.subscription as string | { id: string } | null);
    }
    default:
      return null;
  }
}

async function findOrgId(admin: Admin, sub: StripeSubscriptionLike, hint: string | null): Promise<string | null> {
  const fromMeta = sub.metadata?.organization_id;
  if (fromMeta) return fromMeta;
  if (hint) return hint;
  const { data: bySub } = await admin.from("organizations").select("id").eq("stripe_subscription_id", sub.id).maybeSingle();
  if (bySub?.id) return bySub.id;
  const customer = stripeCustomerId(sub);
  if (customer) {
    const { data: byCustomer } = await admin.from("organizations").select("id").eq("stripe_customer_id", customer).maybeSingle();
    if (byCustomer?.id) return byCustomer.id;
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripeConfigured() || !secret) {
    console.error("[billing/stripe/webhook] STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const subId = subscriptionIdFor(event);
  if (!subId) {
    // Events we don't act on (Stripe sends more than we subscribe to)
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const admin = createAdminClient();
  try {
    // The event carries a snapshot; the subscription as Stripe holds it now is the truth
    let sub: StripeSubscriptionLike;
    try {
      sub = (await stripe.subscriptions.retrieve(subId)) as unknown as StripeSubscriptionLike;
    } catch (e) {
      if (event.type.startsWith("customer.subscription.")) {
        sub = event.data.object as unknown as StripeSubscriptionLike;
      } else {
        throw e;
      }
    }

    const session = event.type === "checkout.session.completed" ? (event.data.object as Stripe.Checkout.Session) : null;
    const hint = session ? (session.client_reference_id ?? session.metadata?.organization_id ?? null) : null;
    const orgId = await findOrgId(admin, sub, hint);

    // Audit log, once per Stripe event id (Stripe retries failed deliveries)
    const { error: logErr } = await admin.from("billing_events").insert({
      organization_id: orgId,
      event_type: event.type,
      provider: "stripe",
      stripe_subscription_id: subId,
      provider_event_id: event.id,
      raw_payload: event,
    });
    if (logErr && logErr.code !== "23505") console.error("[billing/stripe/webhook] could not log event:", logErr.message);

    if (!orgId) {
      console.warn("[billing/stripe/webhook] could not resolve organization for", event.type);
      return NextResponse.json({ ok: true, matched: false });
    }

    const patch = subscriptionToOrgPatch(sub, mapStripePriceIdToTier);
    const { error } = await admin.from("organizations").update(patch).eq("id", orgId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, matched: true, organization_id: orgId });
  } catch (e) {
    // A 500 makes Stripe retry the delivery
    console.error("[billing/stripe/webhook] failed:", (e as Error).message);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }
}
