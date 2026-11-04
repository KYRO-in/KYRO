# Kayyro security

How Kayyro protects business data, and what to configure before going live.

## How it is protected

| Area | What Kayyro does |
|------|----------------|
| Secrets | Server keys (`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `METALS_API_KEY`) are read only in server code and never sent to the browser. `.env*.local` is git-ignored. The full git history was scanned: no keys have ever been committed. |
| Authentication | Supabase Auth. Passwords are hashed by Supabase (bcrypt) and never stored or logged by Kayyro. Sign-up enforces strong passwords (8+ characters with upper and lower case, a number and a symbol) and confirms the email address. Password reset by email link; the reset page never reveals whether an account exists. |
| Tenant isolation | Row Level Security on every table: a business can only read and write its own rows (`current_org_id()`). |
| Access control | Admin-only pages (`/settings`, `/users`, `/warehouses`) are checked on the server in middleware as well as in the UI. In the database, staff cannot change roles, promote themselves, move users between businesses, or edit business settings. The accountant role is read-only, enforced by a database trigger on every business table (including inside invoice functions). |
| Financial records | The database checks every invoice, purchase and credit note: each line must equal quantity × price with tax matching its rate, the totals must equal the lines, and nothing can be negative (migration 048). Issued invoices, invoice lines and payments can only change through Kayyro’s own database functions; invoices and payments can’t be deleted, saved purchases and credit notes can’t be edited, and sale-linked stock entries can’t be edited. Every change or removal of these records is written to an audit log that admins can read. |
| Billing | Plan, trial and subscription fields can only be changed by the server (Razorpay webhook with a verified HMAC signature, Stripe webhook with a verified signature), never from the browser. Plan limits (invoices per month, active products, expired trial) are enforced in the database. |
| API endpoints | Every private endpoint checks the session and the user's business. Errors return a generic message; details are only logged on the server. |
| Rate limiting | Shared, database-backed limits (migration 039) on sign-up, staff invites, invoice emails, WhatsApp shares, short links and checkout, plus per-IP flood protection in middleware. |
| CSRF / CORS | State-changing API calls from other websites are rejected (Origin / Sec-Fetch-Site check). No CORS headers are sent, so other sites cannot read API responses. |
| XSS | React escapes all output; email HTML is escaped; a Content Security Policy only allows scripts from Kayyro and Razorpay. |
| Security headers | CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`. API responses are `no-store`. |
| Input handling | All forms are validated with zod. Uploaded PDFs must be real PDFs (and at most 6 MB). Exports guard against spreadsheet formula injection. Redirects after login only go to pages on this site. |
| Files | Invoice PDFs are in a private bucket, opened through short-lived signed links. Signature images can no longer be listed by outsiders. Browser source maps are not published. |
| Debug | Production builds strip debug logging, and the setup page is hidden once Supabase is configured. |
| Dependencies | Next.js 15.5.28 and React 19. `npm audit --omit=dev` reports 0 vulnerabilities (checked 29 Oct 2026). |

## Go-live checklist

### Supabase (SQL Editor)

1. Back up the database (Database → Backups).
2. Run `037_vat_gcc.sql`, then `038_every_business_email.sql`, then `039_security_hardening.sql`, then `041_kayyro_features.sql`, and every later numbered migration in order (up to `048_protect_financial_records.sql`). Each is safe to re-run.

### Supabase (Dashboard)

- **Authentication → Providers → Email**: set the minimum password length to 8 and turn **Confirm email** on.
- **Authentication → Emails → SMTP**: connect your own SMTP (e.g. Resend). The built-in sender only allows a few emails an hour, which blocks sign-ups and password resets.
- **Authentication → Attack Protection**: turn on *leaked password protection* (needs a paid plan) and CAPTCHA if you see bot sign-ups.
- **Authentication → Rate Limits**: keep the defaults or lower them. They protect the login form from password guessing.
- **Authentication → URL Configuration**: set the Site URL to your live domain and remove any `localhost` redirect URLs you no longer need.
- **Advisors → Security Advisor**: run it after the migrations and fix anything it reports.

### Vercel (Project → Settings → Environment Variables)

- `NEXT_PUBLIC_APP_URL` = your live URL, e.g. `https://app.yourdomain.com`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (never prefix it with `NEXT_PUBLIC_`)
- `RAZORPAY_KEY_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, plan ids
- `RESEND_API_KEY`, `EMAIL_FROM` (optional, for one-click email)
- `DEMO_MODE` and `NEXT_PUBLIC_DEMO_MODE` must be **unset or `false`**: demo mode turns off sign-in.
- Mark the secret values as **Sensitive**.

### GitHub

- The repository is public. Make it private (Settings → General → Danger Zone) unless you mean to publish the source.
- Turn on **Secret scanning** and **Dependabot alerts** (Settings → Code security).

## Known limits

- Email confirmation follows the Supabase "Confirm email" switch. If it is off, accounts are confirmed straight away.
- Sign-up and login rate limits are Supabase's own (Authentication → Rate Limits); add CAPTCHA there if bots appear.
- Account closure is a request (`organizations.deletion_requested_at`); deleting the data is done by support after confirming by email.
- The CSP allows inline scripts, because Next.js needs them without per-request nonces. External scripts are still blocked.
- `npm audit` lists a few advisories in development-only build tools (Tailwind 3 / ESLint dependencies). They are not shipped to the server or browsers.

## Reporting a problem

Email the support address on the website. Please do not open a public issue for security problems.
