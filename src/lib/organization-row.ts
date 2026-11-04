import { normalizeBusinessType } from "@/lib/business-types";
import { DEFAULT_INVOICE_PREFIX } from "@/lib/brand";
import type { Organization } from "@/lib/types";
import { DEFAULT_COUNTRY, getCountryConfig } from "@/lib/vat/countries";

/** A raw organizations row (browser or server) as an Organization. */
export function mapOrgRow(row: Record<string, unknown>): Organization {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    tax_id: (row.tax_id as string | null) ?? null,
    gstin: (row.gstin as string | null) ?? null,
    country: String(row.country ?? DEFAULT_COUNTRY),
    currency: String(row.currency ?? getCountryConfig(row.country as string).currency),
    prices_include_vat: Boolean(row.prices_include_vat ?? false),
    address: (row.address as string | null) ?? null,
    state: String(row.state ?? ""),
    bank_details: (row.bank_details as string | null) ?? null,
    logo_url: (row.logo_url as string | null) ?? null,
    plan: (row.plan as Organization["plan"]) ?? "free",
    subscription_status:
      (row.subscription_status as Organization["subscription_status"]) ?? "trialing",
    trial_ends_at: (row.trial_ends_at as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    brand_name: String(row.brand_name ?? ""),
    city: String(row.city ?? ""),
    pincode: String(row.pincode ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
    bank_name: String(row.bank_name ?? ""),
    bank_account: String(row.bank_account ?? ""),
    bank_ifsc: String(row.bank_ifsc ?? ""),
    bank_branch: String(row.bank_branch ?? ""),
    invoice_prefix: String(row.invoice_prefix ?? DEFAULT_INVOICE_PREFIX),
    upi_id: String(row.upi_id ?? ""),
    signature_url: (row.signature_url as string | null) ?? null,
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    business_type: normalizeBusinessType(row.business_type),
    razorpay_customer_id: (row.razorpay_customer_id as string | null) ?? null,
    razorpay_subscription_id: (row.razorpay_subscription_id as string | null) ?? null,
    stripe_customer_id: (row.stripe_customer_id as string | null) ?? null,
    stripe_subscription_id: (row.stripe_subscription_id as string | null) ?? null,
    current_period_end: (row.current_period_end as string | null) ?? null,
    cancel_at_period_end: Boolean(row.cancel_at_period_end ?? false),
    email_subject_template: (row.email_subject_template as string | null) ?? null,
    email_body_template: (row.email_body_template as string | null) ?? null,
    email_bcc_self: Boolean(row.email_bcc_self ?? false),
    monthly_sales_goal: row.monthly_sales_goal != null ? Number(row.monthly_sales_goal) : null,
    name_ar: (row.name_ar as string | null) ?? null,
    invoice_language: row.invoice_language === "en_ar" ? "en_ar" : "en",
    payment_link_url: (row.payment_link_url as string | null) ?? null,
    numbering_period: row.numbering_period === "april" ? "april" : "calendar",
    deletion_requested_at: (row.deletion_requested_at as string | null) ?? null,
  };
}
