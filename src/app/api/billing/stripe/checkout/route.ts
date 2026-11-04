import { mfaRequired } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, requestOrigin, stripeConfigured } from "@/lib/billing/stripe";
import { getStripePriceId, stripePriceEnvKey, type BillingInterval, type PaidPlanId } from "@/lib/billing/plans";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { serverError } from "@/lib/security/request";

export const runtime = "nodejs";

const bodySchema = z.object({
  plan: z.enum(["starter", "pro", "business"]),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
});

/** Starts a Stripe Checkout (hosted payment page) for a monthly or yearly Kayyro plan, billed in AED. */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const mfa = await mfaRequired(supabase);
    if (mfa) return mfa;

    const { data: profile } = await supabase
      .from("users")
      .select("role, organization_id, full_name")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    if (!profile.organization_id) {
      return NextResponse.json({ error: "No organization linked" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    const plan = parsed.data.plan as PaidPlanId;
    const interval = parsed.data.interval as BillingInterval;

    // Not switched on: the page falls back to Razorpay
    if (!stripeConfigured() || !process.env[stripePriceEnvKey(plan, interval)]?.trim()) {
      return NextResponse.json(
        { error: "Card payments are not switched on yet.", code: "stripe_not_configured" },
        { status: 503 }
      );
    }

    const admin = createAdminClient();
    const limited = await rateLimit(admin, `billing:org:${profile.organization_id}`, 10, 3600);
    if (!limited.ok) return tooManyRequests(limited.retryAfter);

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id, name, slug, brand_name, email, phone, country, subscription_status, stripe_customer_id, stripe_subscription_id")
      .eq("id", profile.organization_id)
      .single();
    if (orgErr || !org) return NextResponse.json({ error: "Organization not found" }, { status: 400 });

    if (org.subscription_status === "active" && org.stripe_subscription_id) {
      return NextResponse.json(
        { error: "You already have an active subscription. Use Manage billing to change plan or card." },
        { status: 409 }
      );
    }

    const stripe = getStripe();

    let customerId = org.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org.brand_name || org.name || profile.full_name || "Customer",
        email: org.email || user.email || undefined,
        phone: org.phone || undefined,
        metadata: { organization_id: org.id, slug: org.slug ?? "" },
      });
      customerId = customer.id;
      await admin
        .from("organizations")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", org.id);
    }

    const origin = requestOrigin(request);
    const metadata = { organization_id: org.id, plan, interval };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: org.id,
      line_items: [{ price: getStripePriceId(plan, interval), quantity: 1 }],
      success_url: `${origin}/settings/billing?checkout=success`,
      cancel_url: `${origin}/settings/billing?checkout=cancelled`,
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_update: { name: "auto", address: "auto" },
    });

    if (!session.url) {
      return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return serverError("billing/stripe/checkout", e, "Could not start checkout. Please try again or contact support.");
  }
}
