import { mfaRequired } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRazorpay } from "@/lib/billing/razorpay";
import {
  getRazorpayPlanId,
  type BillingInterval,
  type PaidPlanId,
  PAID_PLANS,
  PLAN_CURRENCY,
  PLAN_PRICES,
  razorpayPlanEnvKey,
} from "@/lib/billing/plans";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { serverError } from "@/lib/security/request";

const bodySchema = z.object({
  plan: z.enum(["starter", "pro", "business"]),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    const plan = parsed.data.plan as PaidPlanId;
    const interval = parsed.data.interval as BillingInterval;

    const admin = createAdminClient();
    const limited = await rateLimit(admin, `billing:org:${profile.organization_id}`, 10, 3600);
    if (!limited.ok) return tooManyRequests(limited.retryAfter);

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("*")
      .eq("id", profile.organization_id)
      .single();
    if (orgErr || !org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 400 });
    }

    // Every business pays the same AED plan, monthly or yearly
    if (!process.env[razorpayPlanEnvKey(plan, interval)]) {
      console.error(`[billing/create-subscription] ${razorpayPlanEnvKey(plan, interval)} is not set`);
      return NextResponse.json(
        {
          error:
            interval === "annual"
              ? "Yearly billing is not available yet. Choose monthly, or contact support."
              : "Payments are not set up yet. Please contact support.",
        },
        { status: 500 }
      );
    }
    const razorpay = getRazorpay();
    const razorpayPlanId = getRazorpayPlanId(plan, interval);

    let customerId = org.razorpay_customer_id as string | null;
    if (!customerId) {
      const customer = await razorpay.customers.create({
        name: org.brand_name || org.name || profile.full_name || "Customer",
        email: org.email || user.email || undefined,
        contact: org.phone || undefined,
        notes: {
          organization_id: org.id,
          slug: org.slug,
        },
      });
      customerId = customer.id;
      await admin
        .from("organizations")
        .update({ razorpay_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", org.id);
    }

    // Renews for up to 12 months (monthly) or 5 years (yearly); cancel_at_cycle_end handled separately
    const subscription = await razorpay.subscriptions.create({
      plan_id: razorpayPlanId,
      customer_id: customerId,
      customer_notify: 1,
      total_count: interval === "annual" ? 5 : 12,
      quantity: 1,
      notes: {
        organization_id: org.id,
        plan,
        interval,
      },
    });

    await admin
      .from("organizations")
      .update({
        razorpay_subscription_id: subscription.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", org.id);

    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
    if (!keyId) {
      console.error("[billing/create-subscription] NEXT_PUBLIC_RAZORPAY_KEY_ID is not set");
      return NextResponse.json({ error: "Payments are not set up yet. Please contact support." }, { status: 500 });
    }

    return NextResponse.json({
      subscriptionId: subscription.id,
      keyId,
      plan,
      planName: PAID_PLANS[plan].name,
      amount: PLAN_PRICES[plan][interval],
      currency: PLAN_CURRENCY,
      prefill: {
        name: org.brand_name || org.name,
        email: org.email || user.email,
        contact: org.phone || undefined,
      },
    });
  } catch (e) {
    return serverError("billing/create-subscription", e, "Could not start checkout. Please try again or contact support.");
  }
}
