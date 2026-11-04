import { mfaRequired } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRazorpay } from "@/lib/billing/razorpay";
import { getStripe } from "@/lib/billing/stripe";
import { NextResponse } from "next/server";
import { serverError } from "@/lib/security/request";

export async function POST() {
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
      .select("role, organization_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    if (!profile.organization_id) {
      return NextResponse.json({ error: "No organization linked" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id, razorpay_subscription_id, stripe_subscription_id")
      .eq("id", profile.organization_id)
      .single();
    if (orgErr || !org || (!org.razorpay_subscription_id && !org.stripe_subscription_id)) {
      return NextResponse.json(
        { error: "No active subscription on this organization" },
        { status: 400 }
      );
    }

    if (org.stripe_subscription_id) {
      // Keeps access until the end of the period already paid for
      await getStripe().subscriptions.update(org.stripe_subscription_id, { cancel_at_period_end: true });
    } else if (org.razorpay_subscription_id) {
      const razorpay = getRazorpay();
      // cancel_at_cycle_end = true → access until period end
      await razorpay.subscriptions.cancel(org.razorpay_subscription_id, true);
    }

    await admin
      .from("organizations")
      .update({
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", org.id);

    return NextResponse.json({ ok: true, cancel_at_period_end: true });
  } catch (e) {
    return serverError("billing/cancel", e, "Could not cancel the subscription. Please try again or contact support.");
  }
}
