import { LegalPageShell, LegalSection } from "@/components/legal/legal-page-shell";
import {
  APP_NAME,
  APP_TITLE,
  LEGAL_ENTITY_ADDRESS,
  LEGAL_ENTITY_NAME,
  LEGAL_REFUNDS_UPDATED,
  LEGAL_SUPPORT_EMAIL,
} from "@/lib/brand";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: `Refund & Cancellation Policy - ${APP_NAME}`,
  description: `How subscription cancellations and refunds work for ${APP_NAME}.`,
  openGraph: {
    title: `Refund & Cancellation Policy - ${APP_TITLE}`,
    description: `Refund and cancellation policy for ${APP_NAME}, operated by ${LEGAL_ENTITY_NAME}.`,
  },
};

export default function RefundsPolicyPage() {
  return (
    <LegalPageShell
      title="Refund & Cancellation Policy"
      updated={LEGAL_REFUNDS_UPDATED}
    >
      <p>
        This policy explains how subscription cancellations and refunds work for{" "}
        {APP_NAME}, operated by <strong>{LEGAL_ENTITY_NAME}</strong>.
      </p>

      <LegalSection id="trial" title="1. Free Trial">
        <ul>
          <li>
            New accounts start with a <strong>14-day free trial</strong>, with no
            payment required.
          </li>
          <li>You may cancel anytime during the trial with no charge.</li>
          <li>
            If you do not cancel before the trial ends, you will be prompted to
            choose a paid plan to continue using the Service; no automatic charge
            is made without your explicit action to subscribe.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cancellation" title="2. Subscription Cancellation">
        <ul>
          <li>
            You may cancel your subscription at any time from{" "}
            <strong>Settings → Billing</strong> within the app.
          </li>
          <li>
            When you cancel, your subscription remains active until the end of
            your current billing period (monthly or annual, whichever you&apos;re
            on) - you will continue to have full access until then.
          </li>
          <li>
            After the billing period ends, your account will move to a
            restricted/read-only state: you can view and export your existing
            data, but cannot create new invoices or add new records until you
            resubscribe.
          </li>
          <li>We do not charge you again after a cancellation takes effect.</li>
        </ul>
      </LegalSection>

      <LegalSection id="refunds" title="3. Refunds">
        <ul>
          <li>
            <strong>Monthly plans:</strong> Fees already paid for the current
            month are non-refundable, but you will not be charged again after
            cancellation.
          </li>
          <li>
            <strong>Annual plans:</strong> If you cancel within the first 7 days
            of starting or renewing an annual plan, you are eligible for a full
            refund. After 7 days, annual fees are non-refundable, but your
            subscription remains active for the full period already paid for.
          </li>
          <li>
            <strong>Billing errors:</strong> If you were charged incorrectly
            (e.g., duplicate charge, wrong plan amount), contact us within 30 days
            of the charge and we will investigate and issue a full refund for the
            erroneous amount if confirmed.
          </li>
          <li>
            Refunds, where applicable, are processed back to the original payment
            method via Stripe or Razorpay and typically take 5–7 business days to reflect,
            depending on your bank.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="how-to" title="4. How to Request a Refund or Cancellation">
        <p>
          Email{" "}
          <a
            href={`mailto:${LEGAL_SUPPORT_EMAIL}`}
            className="font-medium text-primary hover:underline"
          >
            {LEGAL_SUPPORT_EMAIL}
          </a>{" "}
          with your registered account email and the reason for your request, or
          use the in-app cancellation option under Settings → Billing. We aim to
          respond to all billing requests within 2 business days.
        </p>
      </LegalSection>

      <LegalSection id="downgrades" title="5. Downgrades">
        <p>
          If you downgrade from a higher plan to a lower one, the change takes
          effect at the start of your next billing cycle. We do not provide
          partial refunds for the unused portion of a higher-tier plan when
          downgrading mid-cycle.
        </p>
      </LegalSection>

      <LegalSection id="data" title="6. Account Data After Cancellation">
        <p>
          Your business data (products, invoices, customers) is retained for the
          period described in our{" "}
          <Link href="/privacy-policy" className="font-medium text-primary hover:underline">
            Privacy Policy
          </Link>{" "}
          after cancellation, so you can resubscribe later without losing your
          records. You may also export your data before or after cancellation.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="7. Contact Us">
        <p>For any billing, refund, or cancellation questions:</p>
        <p>
          <strong>{LEGAL_ENTITY_NAME}</strong>
        </p>
        <ul>
          <li>
            Email:{" "}
            <a
              href={`mailto:${LEGAL_SUPPORT_EMAIL}`}
              className="font-medium text-primary hover:underline"
            >
              {LEGAL_SUPPORT_EMAIL}
            </a>
          </li>
          <li>Address: {LEGAL_ENTITY_ADDRESS}</li>
        </ul>
      </LegalSection>
    </LegalPageShell>
  );
}
