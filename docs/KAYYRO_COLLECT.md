# Kayyro Collect: setup

Kayyro Collect chases unpaid invoices on WhatsApp and email with fixed, polite
templates (English and Arabic), reads customers' replies with AI, and links every
reminder to a payment page. Every message waits for the owner's approval unless
the business switches to automatic sending.

## 1. Database

Run `supabase/migrations/049_kayyro_collect.sql`, then
`supabase/migrations/050_collect_replies_payments.sql` and
`supabase/migrations/051_collect_insights.sql`, in the Supabase SQL editor
(after 046, 047 and 048). It adds due dates to invoices, the Collect tables and
the scheduling rules. Existing invoices get a due date of invoice date + 30 days.

Check it worked:

```sql
select public.kayyro_schema_version();  -- 51
```

## 2. The scheduler secret (Vercel)

Make a long random secret (at least 32 characters), for example with
`openssl rand -hex 32`, and add it in Vercel > Settings > Environment Variables:

```
COLLECT_CRON_SECRET=<the secret>
```

Redeploy so the app picks it up. Keep the same value for step 3. Never paste it
into chat or commit it.

## 3. Run it every 15 minutes (Supabase pg_cron)

In Supabase > Database > Extensions, enable **pg_cron** and **pg_net**.
Then in the SQL editor, store the secret in Vault and schedule the job
(replace the two placeholders; use your live domain):

```sql
select vault.create_secret('<the secret>', 'collect_cron_secret');

select cron.schedule(
  'kayyro-collect',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_APP_DOMAIN/api/collect/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'collect_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

Each run plans the reminders due today, writes their wording, and sends the
approved or automatic ones that are inside the business's sending hours. A run
that finds nothing to do is cheap. To check runs:

```sql
select status, return_message, start_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'kayyro-collect')
order by start_time desc limit 10;

select status_code, left(content::text, 200), created from net._http_response order by created desc limit 10;
```

To pause everything: `select cron.unschedule('kayyro-collect');`

## 4. Email

Reminder emails go through the same Resend setup as invoice emails
(`RESEND_API_KEY`, verified sending domain). They are sent in the business's
name, replies go to the business's email, and each one has a one-click
unsubscribe header.

## 5. WhatsApp

Until a WhatsApp Business number is connected, WhatsApp reminders are sent from
the owner's own phone: **Send on WhatsApp** opens the chat with the message
filled in, and Kayyro logs it.

Automatic WhatsApp sending (later, through 360dialog):

1. Create a 360dialog account and connect the business's WhatsApp number.
2. Submit the templates in `src/lib/collect/templates.ts` (`WHATSAPP_TEMPLATES`,
   10 templates: 5 steps in English and Arabic, category Utility) and wait for
   Meta's approval.
3. Store the business's 360dialog API key in `collect_channel_accounts`
   (server-only table; insert it from the Supabase SQL editor, never from the app).

WhatsApp is only sent automatically to customers whose "agreed to get WhatsApp
reminders" box is ticked (the date is recorded).

## 6. Reading replies (AI)

Replies are read with the same AI provider as Ask Kayyro (`AI_API_KEY`). Each
reply becomes one of: already paid, promise to pay, dispute, wants an invoice
copy, asks for more time, wrong contact, other.

| The customer says | Kayyro does |
| --- | --- |
| Already paid | Stops reminders, asks for proof, puts it in "Needs you" to confirm or reject |
| Will pay on a date | Saves the promise, pauses reminders, sends one reminder that morning; if the day passes unpaid the promise is marked broken and chasing resumes |
| Dispute | Stops reminders and puts the reason in "Needs you" |
| Invoice copy | Sends the invoice link again |
| More time / wrong contact / other | "Needs you" |

Below 70% confidence, or when a promise has no usable date (past, or more than
90 days away), nothing happens by itself: the reply goes to "Needs you". Answers
to replies follow the approval setting like every other message. The AI only
classifies; it can't send or change anything. AI reading is on Pro and Business
(and trials), up to 500 replies per business per month, and can be switched off
in Collect settings. Without AI every reply goes to "Needs you".

**Replies that reach your own phone or inbox:** use **Log a reply** on the Get Paid
page; Kayyro reads it the same way.

### WhatsApp replies (360dialog)

Once the business's number is connected (step 5), find its webhook key in the SQL
editor and register the webhook with 360dialog (their API: `POST /v1/configs/webhook`
with the business's `D360-API-KEY`):

```sql
select webhook_key from public.collect_channel_accounts where organization_id = '<business id>';
```

Webhook URL: `https://YOUR_APP_DOMAIN/api/collect/inbound/whatsapp?k=<webhook_key>`

### Email replies (Resend receiving)

1. In Resend, add a receiving domain, for example `reply.YOUR_DOMAIN`, and add the MX
   record Resend shows at your DNS provider.
2. Add a webhook for the event `email.received` pointing to
   `https://YOUR_APP_DOMAIN/api/collect/inbound/email`.
3. In Vercel add `COLLECT_INBOUND_DOMAIN=reply.YOUR_DOMAIN` and
   `RESEND_INBOUND_WEBHOOK_SECRET=<the webhook's signing secret, whsec_...>`, then redeploy.

Reminder emails then use `reply+<message id>@reply.YOUR_DOMAIN` as the reply
address. Each reply is read and acted on, then forwarded to the business's email
(so the business still sees every reply and can answer the customer directly).
Without these two settings, replies go straight to the business's email as before.

## 7. Payment page

Every reminder links to the invoice's private payment page (`/pay/<token>`), in
English and Arabic:

- **Pay now** opens the business's payment link (Settings > payment link: Stripe,
  PayTabs, Tap, a bank link...). Bank details from Settings are shown too.
- **I already paid**: the customer uploads a receipt (JPG, PNG, WebP or PDF, up to
  5 MB, checked by content) and/or a note. Files are stored privately per business
  (bucket `collect-proofs`). Reminders pause until the owner confirms (which
  records the payment) or rejects (reminders resume).

Payment gateways that mark invoices paid by themselves (Tap, Telr, Razorpay,
Stripe Connect) plug in through `src/lib/collect/payments.ts`; the database side
(`collect_record_gateway_payment`, one payment per gateway reference) is ready.

## 8. Insights (Business plan)

**Late-payer risk** (Low / Medium / High) shows on Get Paid and on each customer's
page, with the reasons. Points add up (the rules are in `collect_risk_level`):

| Signal | +1 | +2 |
| --- | --- | --- |
| Average days late on invoices paid in the last 12 months | over 7 days | over 30 days |
| Broken promises to pay in the last 6 months | 1 | 2 or more |
| Oldest overdue invoice now | over 14 days | over 60 days |
| At least half of what they owe is overdue (and over a week) | yes | |

2-3 points = Medium, 4 or more = High.

**Daily summary**: switch it on in Collect settings. Every working day from the
chosen time (09:00 by default) the owner gets: what was collected yesterday, how
many customers need them, what is expected this week, what is overdue, and the
top items that need them. It goes by email, or by WhatsApp once a WhatsApp
Business number is connected (template `kayyro_daily_summary` in
`src/lib/collect/insights.ts`, 5 variables, to submit to Meta with the reminder
templates). It is sent once a day by the same 15-minute scheduler; **Send a test
now** sends it straight away.

**Ask Kayyro** can answer "Who owes me the most?" (existing `money_owed`), "Who will
probably pay late?" (`late_payer_risk`) and "How much will I collect this week?"
(`expected_collections`: unpaid invoices due or promised in the period, disputed
ones left out).

## Plans

| Plan | Kayyro Collect |
| --- | --- |
| Starter | "Remind now" by hand (WhatsApp one-tap, email); automatic reminders locked |
| Trial | Like Pro, so businesses can try it |
| Pro | Automatic reminders for 100 invoices a month, AI reads replies |
| Business | Unlimited, AI reads replies, risk badges, daily summary |

"Remind now" messages don't count towards the monthly allowance.

## Safety rules (enforced in the database)

- Never a reminder for a paid, cancelled, fully credited or disputed invoice, a
  paused customer, or a customer who opted out (checked again at the moment of sending).
- At most one message per invoice per channel per day; each message is claimed
  before sending, so two runs can't send it twice.
- Only inside sending hours on the business's working days (country default,
  per-business override, optional Ramadan hours).
- Only admins can approve or send; staff can record promises and disputes.
- Every message is logged in `collection_messages`.
