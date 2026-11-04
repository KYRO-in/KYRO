/**
 * Kayyro Collect: payment gateways that mark invoices paid by themselves.
 *
 * A gateway connector (Tap, Telr, Razorpay, Stripe Connect...) does two things:
 * makes a checkout link for an invoice, and turns the gateway's verified
 * webhook into a payment. The payment is recorded with
 * recordGatewayPayment(), which records each gateway reference once and marks
 * the invoice paid (collect_record_gateway_payment, migration 050).
 *
 * None is connected yet: "Pay now" on the payment page uses the business's
 * own payment link (Settings > payment link) and bank details.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type GatewayId = "tap" | "telr" | "razorpay" | "stripe_connect";

export type GatewayPayment = {
  reference: string;
  invoiceId: string;
  amount: number;
  currency: string;
};

export interface PaymentConnector {
  readonly id: GatewayId;
  /** A hosted checkout page for what is still owed on the invoice */
  checkoutUrl(input: { invoiceId: string; amount: number; currency: string; returnUrl: string }): Promise<string>;
  /** Verify the webhook's signature and read the payment; null for events that aren't a successful payment */
  parseWebhook(request: Request): Promise<GatewayPayment | null>;
}

export async function recordGatewayPayment(
  admin: SupabaseClient,
  gateway: GatewayId,
  payment: GatewayPayment
): Promise<"recorded" | "duplicate"> {
  const { data, error } = await admin.rpc("collect_record_gateway_payment", {
    p_provider: gateway,
    p_reference: payment.reference,
    p_invoice: payment.invoiceId,
    p_amount: payment.amount,
    p_currency: payment.currency,
  });
  if (error) throw error;
  return data === "duplicate" ? "duplicate" : "recorded";
}
