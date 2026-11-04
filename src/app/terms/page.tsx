import { LegalPageShell, LegalSection } from "@/components/legal/legal-page-shell";
import {
  APP_NAME,
  APP_TITLE,
  LEGAL_ENTITY_ADDRESS,
  LEGAL_ENTITY_NAME,
  LEGAL_GOVERNING_LAW,
  LEGAL_JURISDICTION,
  LEGAL_SUPPORT_EMAIL,
  LEGAL_TERMS_UPDATED,
} from "@/lib/brand";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: `Terms of Service - ${APP_NAME}`,
  description: `Terms governing your use of ${APP_NAME}, operated by ${LEGAL_ENTITY_NAME}.`,
  openGraph: {
    title: `Terms of Service - ${APP_TITLE}`,
    description: `Terms of Service for ${APP_NAME}.`,
  },
};

export default function TermsOfServicePage() {
  return (
    <LegalPageShell title="Terms of Service" updated={LEGAL_TERMS_UPDATED}>
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use
        of {APP_NAME} (the &quot;Service&quot;), operated by{" "}
        <strong>{LEGAL_ENTITY_NAME}</strong> (&quot;we&quot;, &quot;us&quot;,
        &quot;our&quot;). By creating an account or using {APP_NAME}, you agree
        to these Terms.
      </p>

      <LegalSection id="eligibility" title="1. Eligibility">
        <p>
          You must be at least 18 years old and legally authorized to act on
          behalf of the business you register, to use {APP_NAME}.
        </p>
      </LegalSection>

      <LegalSection id="description" title="2. Description of Service">
        <p>
          {APP_NAME} is a cloud-based billing, VAT invoicing, and inventory
          management tool for small and medium businesses in the UAE. {APP_NAME}{" "}
          provides software tools; it does not provide legal, tax, or accounting
          advice.
        </p>
        <p>
          <strong>
            You are solely responsible for the accuracy of the tax, pricing, and
            business information you enter, and for your own compliance with
            applicable VAT and other tax laws.
          </strong>{" "}
          {APP_NAME} helps calculate and format invoices based on the information
          you provide, but does not verify the correctness of your TRN, VAT rates,
          or tax classifications.
        </p>
      </LegalSection>

      <LegalSection id="registration" title="3. Account Registration">
        <ul>
          <li>
            You must provide accurate, current information when registering.
          </li>
          <li>
            You are responsible for maintaining the confidentiality of your login
            credentials and for all activity under your account.
          </li>
          <li>
            Each business (&quot;Organization&quot;) using {APP_NAME} has its own
            isolated account; the Organization&apos;s admin is responsible for
            managing staff access within that account.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="billing" title="4. Subscription Plans and Billing">
        <ul>
          <li>
            {APP_NAME} is offered on a subscription basis with a free trial
            period, followed by paid plans (Starter, Pro, Business, or as
            otherwise published).
          </li>
          <li>
            Subscription fees are billed in advance on a recurring basis (monthly
            or annual, as selected) via our payment partners, Stripe and Razorpay.
          </li>
          <li>
            Prices are subject to change with prior notice; changes apply from
            your next billing cycle.
          </li>
          <li>
            Your subscription renews automatically unless cancelled before the
            renewal date.
          </li>
          <li>
            See our separate{" "}
            <Link href="/refund-policy" className="font-medium text-primary hover:underline">
              Refund &amp; Cancellation Policy
            </Link>{" "}
            for details on cancelling your subscription and refund eligibility.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="your-data" title="5. Your Data">
        <ul>
          <li>
            You retain ownership of all business data you enter into {APP_NAME}{" "}
            (products, customers, invoices, and related records).
          </li>
          <li>
            You grant us a limited license to store, process, and display this
            data solely for the purpose of providing the Service to you.
          </li>
          <li>
            You are responsible for the accuracy and legality of the data you
            upload, including any personal data of your own customers, and for
            obtaining any consents required under applicable law to process that
            data through {APP_NAME}.
          </li>
          <li>
            On account termination, you may export your data before deletion; see
            our{" "}
            <Link href="/privacy-policy" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            for our data retention practices.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="acceptable-use" title="6. Acceptable Use">
        <p>You agree not to:</p>
        <ul>
          <li>
            Use {APP_NAME} for any unlawful purpose, including tax evasion or
            fraudulent invoicing
          </li>
          <li>
            Attempt to access another Organization&apos;s data without
            authorization
          </li>
          <li>
            Reverse-engineer, decompile, or attempt to extract the source code of
            the Service
          </li>
          <li>
            Interfere with or disrupt the integrity or performance of the Service
          </li>
          <li>Use the Service to store or transmit malicious code</li>
        </ul>
        <p>
          Violation of this section may result in immediate suspension or
          termination of your account.
        </p>
      </LegalSection>

      <LegalSection id="ip" title="7. Intellectual Property">
        <p>
          {APP_NAME}, including its software, design, branding, and underlying
          technology, is the property of {LEGAL_ENTITY_NAME}. These Terms do not
          grant you any ownership rights in the Service itself - only a limited
          right to use it as described here.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="8. Service Availability">
        <p>
          We aim to keep {APP_NAME} available and reliable but do not guarantee
          uninterrupted access. We may perform maintenance, updates, or
          experience downtime from time to time. We are not liable for losses
          arising from temporary unavailability of the Service.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="9. Limitation of Liability">
        <p>To the maximum extent permitted by law:</p>
        <ul>
          <li>
            {APP_NAME} is provided &quot;as is&quot; without warranties of any
            kind, express or implied.
          </li>
          <li>
            We are not liable for any indirect, incidental, or consequential
            damages arising from your use of the Service, including but not
            limited to loss of business, revenue, or data.
          </li>
          <li>
            We are not responsible for penalties, fines, or losses arising from
            incorrect tax filings, VAT errors, or business decisions made using
            data generated through {APP_NAME} - you remain responsible for
            verifying accuracy before relying on any invoice or report for tax
            filing purposes.
          </li>
          <li>
            Our total liability to you for any claim arising from the Service is
            limited to the subscription fees you paid us in the 3 months
            preceding the claim.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="termination" title="10. Termination">
        <ul>
          <li>
            You may cancel your subscription and close your account at any time
            via account Settings or by contacting support.
          </li>
          <li>
            We may suspend or terminate your account if you violate these Terms,
            engage in fraudulent activity, or fail to pay subscription fees.
          </li>
          <li>
            Upon termination, your right to access the Service ends; data
            retention after termination is governed by our{" "}
            <Link href="/privacy-policy" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes to These Terms">
        <p>
          We may update these Terms from time to time. We will notify you of
          material changes via email or in-app notice. Continued use of the
          Service after changes take effect constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection id="law" title="12. Governing Law and Dispute Resolution">
        <p>
          These Terms are governed by the laws of{" "}
          <strong>{LEGAL_GOVERNING_LAW}</strong>. Any disputes arising from these
          Terms or your use of the Service shall be subject to the exclusive
          jurisdiction of the courts of <strong>{LEGAL_JURISDICTION}</strong>.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact Us">
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
