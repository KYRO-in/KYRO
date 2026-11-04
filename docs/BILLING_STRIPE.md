# Stripe billing (billed in AED)

Kayyro is sold in the six GCC countries, and every plan is priced in **UAE dirhams (AED)**, monthly or yearly. Checkout goes through **Stripe**. If Stripe is not set up, checkout falls back to Razorpay's AED plans ([BILLING_PHASE2.md](BILLING_PHASE2.md)), so nothing breaks while you set it up.

Stripe Checkout is Stripe's own payment page: the customer pays on stripe.com, and Kayyro never sees card details. Cards, Apple Pay and Google Pay are shown automatically.

## 1. Run the database update

Supabase, SQL Editor: paste and run `supabase/migrations/047_stripe_billing.sql` (project: Kayyro Mumbai). Safe to run twice.

## 2. Stripe Dashboard (Dubai account)

Do everything in **Test mode** first (toggle at the top of the Dashboard).

1. **Products**: create three products, each with **two recurring prices in AED**: one monthly, one yearly. The amounts must match the pricing page (`PLAN_PRICES` in `src/lib/billing/plans.ts`). Yearly = pay 10 months, get 12.

   | Product | Monthly (AED) | Variable | Yearly (AED) | Variable |
   |---|---|---|---|---|
   | Kayyro Starter | 49 | `STRIPE_PRICE_STARTER` | 490 | `STRIPE_PRICE_STARTER_ANNUAL` |
   | Kayyro Pro | 99 | `STRIPE_PRICE_PRO` | 990 | `STRIPE_PRICE_PRO_ANNUAL` |
   | Kayyro Business | 199 | `STRIPE_PRICE_BUSINESS` | 1,990 | `STRIPE_PRICE_BUSINESS_ANNUAL` |

   Open each price and copy its id (it starts with `price_`, not `prod_`). Without the `_ANNUAL` ids, yearly checkout falls back to Razorpay.

2. **Customer portal**: Settings, Billing, Customer portal. Turn it on, and allow *update payment method*, *view invoices* and *cancel subscription* (at the end of the period). The "Manage card & invoices" button in Kayyro opens this portal.

3. **API keys**: Developers, API keys. Copy the **Secret key** (`sk_test_...`). Never put it in the browser or in chat; only in Vercel.

4. **Webhook**: Developers, Webhooks, Add endpoint:
   - URL: `https://www.kayyro.com/api/billing/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
   - Copy the **Signing secret** (`whsec_...`).

## 3. Vercel environment variables

Project, Settings, Environment Variables (Production), then redeploy:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_BUSINESS=price_...
STRIPE_PRICE_STARTER_ANNUAL=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_BUSINESS_ANNUAL=price_...
```

## 4. Test it

1. Sign in as an admin of a business whose country is **not** India (for example United Arab Emirates). Open Settings, Billing, and press Upgrade.
2. You land on Stripe's page. Pay with the test card `4242 4242 4242 4242`, any future date, any CVC.
3. You return to Kayyro: "Payment received - activating your plan...". Within a few seconds the status becomes **Active** and the plan changes. If not, see *Stripe, Developers, Webhooks* for the delivery log.
4. Press **Manage card & invoices** to see the portal, and **Cancel subscription** to cancel at the end of the period.

## 5. Going live

1. Finish Stripe's account activation (business details, bank account for payouts in AED).
2. Switch the Dashboard to **Live mode** and repeat steps 2.1 to 2.4 there. Live mode has its own products, prices, keys and webhook.
3. Replace the five Vercel variables with the live values (`sk_live_...`, the live `whsec_...`, the live `price_...` ids) and redeploy.
4. Make one real payment with your own card and refund it from the Dashboard.

## How it works (for developers)

| File | Purpose |
|---|---|
| `src/app/api/billing/stripe/checkout/route.ts` | Creates the Stripe Customer and a Checkout Session; returns its URL. Returns `stripe_not_configured` when Stripe is not set up, so the page falls back to Razorpay |
| `src/app/api/billing/stripe/webhook/route.ts` | Verifies Stripe's signature, then re-reads the subscription from Stripe and updates the organization (plan, status, renewal date, cancel flag). Logs each event once in `billing_events` |
| `src/app/api/billing/stripe/portal/route.ts` | Opens the customer portal |
| `src/app/api/billing/cancel/route.ts` | Cancels at period end on whichever provider the business uses |
| `src/lib/billing/stripe-sync.ts` | Pure rules: Stripe status to Kayyro status, plan from price id, period end (tested in `stripe-sync.test.ts`) |
| `supabase/migrations/047_stripe_billing.sql` | `stripe_customer_id`, `stripe_subscription_id`, event log columns; the billing columns stay server-only |

Notes:
- Prices are monthly only. Annual prices on the page are shown for reference, as with Razorpay.
- Kayyro does not add VAT on top of the Stripe price. If Focused Folks Solutions LLP is VAT-registered in the UAE and your price should include 5% VAT, set the Stripe prices as tax-inclusive or turn on Stripe Tax, and ask your accountant which applies.
- Payouts to your UAE bank account follow Stripe's payout schedule for the Dubai account.
