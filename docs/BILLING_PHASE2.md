# Phase 2 — Razorpay billing

## 1. Run SQL in Supabase

Paste and run: `supabase/migrations/020_billing_razorpay.sql`

## 2. Env vars (`.env.local`)

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_PLAN_STARTER=plan_...
RAZORPAY_PLAN_PRO=plan_...
RAZORPAY_PLAN_BUSINESS=plan_...
# Rupee plans for businesses in India
RAZORPAY_PLAN_STARTER_INR=plan_...
RAZORPAY_PLAN_PRO_INR=plan_...
RAZORPAY_PLAN_BUSINESS_INR=plan_...
# Ask Kayyro (AI assistant) - free key from https://console.groq.com (see .env.local.example)
AI_API_KEY=gsk_...
RAZORPAY_WEBHOOK_SECRET=...   # after creating the webhook
```

Create **subscription plans** in Razorpay Dashboard (Test Mode) → Plans, monthly, then paste each Plan ID:

| Plan | AED (Gulf, UK, Europe) | INR (India) |
|---|---|---|
| Starter | 49 | 499 |
| Pro | 99 | 999 |
| Business | 199 | 1,999 |

These must match `REGION_PRICES` in `src/lib/billing/plans.ts`. Businesses whose country is India are sent to the `_INR` plans; everyone else to the AED plans.

## 3. Webhook (local testing)

Use a tunnel (e.g. ngrok / Cloudflare Tunnel) to your Next.js app:

`https://YOUR_TUNNEL/api/billing/webhook`

Events to enable:
- `subscription.activated`
- `subscription.charged`
- `subscription.pending`
- `subscription.halted`
- `subscription.cancelled`

Copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET`, restart `npm run dev`.

## 4. Manual test

1. Sign up a fresh org → Status **Trial** on `/settings/billing`
2. Click **Upgrade** → Razorpay test card checkout
3. Confirm webhook flips `subscription_status` to `active` and sets `plan`
4. **Cancel subscription** → `cancel_at_period_end = true`
5. Set `past_due` in SQL → creates blocked + banner links to Billing

## Routes

| Route | Purpose |
|-------|---------|
| `/settings/billing` | UI |
| `POST /api/billing/create-subscription` | Start checkout |
| `POST /api/billing/cancel` | Cancel at period end |
| `POST /api/billing/webhook` | Razorpay events |
