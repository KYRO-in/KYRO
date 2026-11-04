import { mfaRequired } from "@/lib/security/mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, requestOrigin, stripeConfigured } from "@/lib/billing/stripe";
import { NextResponse } from "next/server";
import { serverError } from "@/lib/security/request";

export const runtime = "nodejs";

/**
 * Opens Stripe's customer portal: update the card, see invoices, change plan or
 * cancel. The portal must be switched on once in the Stripe Dashboard.
 */
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
      .select("role, organization_id")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    if (!profile.organization_id) {
      return NextResponse.json({ error: "No organization linked" }, { status: 400 });
    }
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Card payments are not switched on yet." }, { status: 503 });
    }

    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("id, stripe_customer_id")
      .eq("id", profile.organization_id)
      .single();
    if (!org?.stripe_customer_id) {
      return NextResponse.json({ error: "There is no card subscription on this account." }, { status: 400 });
    }

    try {
      const session = await getStripe().billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        return_url: `${requestOrigin(request)}/settings/billing`,
      });
      return NextResponse.json({ url: session.url });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (/configuration/i.test(msg)) {
        console.error("[billing/stripe/portal] customer portal is not set up in Stripe:", msg);
        return NextResponse.json(
          { error: "The billing portal is not set up yet. Please contact support." },
          { status: 503 }
        );
      }
      throw e;
    }
  } catch (e) {
    return serverError("billing/stripe/portal", e, "Could not open billing. Please try again or contact support.");
  }
}
