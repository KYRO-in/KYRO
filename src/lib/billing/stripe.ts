import Stripe from "stripe";

/** True when a Stripe secret key is set, i.e. card payments outside India are switched on. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY. Add your Stripe secret key to the environment variables.");
  }
  if (!client) client = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

/** The address the customer is on right now, used for Stripe's return links. */
export function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}
