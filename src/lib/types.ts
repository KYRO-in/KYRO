import type {
  CustomerType,
  BusinessDataCategory,
  ExpenseCategory,
  InvoiceStatus,
  MovementType,
  PaymentMode,
  UserRole,
} from "./constants";
import type { BusinessType } from "./business-types";
import type { TaxSplit, TaxTreatment, VatCategory } from "./vat";
import type { InvoiceLanguage } from "./invoice-arabic";

export interface AppUser {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
  organization_id: string | null;
  has_seen_onboarding?: boolean;
}

/** Tenant / business account (replaces company_settings for app reads). */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** VAT registration number (UAE TRN) */
  tax_id: string | null;
  /** @deprecated India GSTIN, history only */
  gstin?: string | null;
  /** ISO country code of the VAT registration */
  country: string;
  /** ISO currency code used for new documents */
  currency: string;
  /** Default for new invoices: entered prices already include VAT */
  prices_include_vat: boolean;
  address: string | null;
  /** Emirate / region */
  state: string;
  bank_details: string | null;
  logo_url: string | null;
  plan: "free" | "starter" | "pro" | "business";
  subscription_status: "trialing" | "active" | "past_due" | "cancelled";
  trial_ends_at: string | null;
  created_at: string;
  brand_name: string;
  city: string;
  /** P.O. Box / postal code */
  pincode: string;
  phone: string;
  email: string;
  bank_name: string;
  /** IBAN (or account number) */
  bank_account: string;
  /** SWIFT / BIC (column name predates VAT) */
  bank_ifsc: string;
  bank_branch: string;
  invoice_prefix: string;
  /** @deprecated India UPI, no longer shown */
  upi_id: string;
  updated_at: string;
  /** Public URL of authorized signatory image (org-scoped storage). */
  signature_url?: string | null;
  /** Vertical config; missing/null treated as general */
  business_type?: BusinessType;
  razorpay_customer_id?: string | null;
  razorpay_subscription_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  /** Email: default subject / message for invoice emails ({placeholders} allowed) */
  email_subject_template?: string | null;
  email_body_template?: string | null;
  /** Email: send a blind copy to the organization email */
  email_bcc_self?: boolean;
  /** Dashboard: monthly sales target in the organization currency */
  monthly_sales_goal?: number | null;
  /** Business name in Arabic, printed on bilingual invoices */
  name_ar?: string | null;
  /** Invoice PDF language: English, or English with Arabic labels */
  invoice_language?: InvoiceLanguage;
  /** Online payment page (Stripe, PayTabs, bank link…) printed on invoices and emails */
  payment_link_url?: string | null;
  /** Document numbering: calendar year (KY/2026/0001) or April–March (KY/2026-27/0001) */
  numbering_period?: NumberingPeriod;
  /** Set when the owner asked for the account to be closed */
  deletion_requested_at?: string | null;
}

export type NumberingPeriod = "calendar" | "april";

export interface BillingEvent {
  id: string;
  organization_id: string | null;
  event_type: string;
  razorpay_subscription_id: string | null;
  /** Which payment provider sent the event (migration 047) */
  provider?: "razorpay" | "stripe";
  stripe_subscription_id?: string | null;
  raw_payload: unknown;
  created_at: string;
}

/**
 * Letterhead / invoice shape used by PDF + Settings UI.
 * Mapped from Organization (company_settings is no longer read by the app).
 */
export interface CompanySettings {
  id: string;
  company_name: string;
  brand_name: string;
  /** VAT registration number (UAE TRN) */
  tax_id: string;
  country: string;
  currency: string;
  prices_include_vat: boolean;
  address: string;
  city: string;
  /** Emirate / region */
  state: string;
  /** P.O. Box / postal code */
  pincode: string;
  phone: string;
  email: string;
  bank_name: string;
  /** IBAN */
  bank_account: string;
  /** SWIFT / BIC */
  bank_swift: string;
  bank_branch: string;
  invoice_prefix: string;
  /** Authorized signatory image URL (org upload). */
  signature_url?: string | null;
  updated_at: string;
  /** Same as Organization.id */
  organization_id?: string;
  slug?: string;
  plan?: Organization["plan"];
  subscription_status?: Organization["subscription_status"];
  trial_ends_at?: string | null;
  business_type?: BusinessType;
  name_ar?: string | null;
  invoice_language?: InvoiceLanguage;
  payment_link_url?: string | null;
  numbering_period?: NumberingPeriod;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  organization_id?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Supplier VAT registration number */
  tax_id: string | null;
  country: string;
  address: string | null;
  /** Emirate / region */
  state: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  organization_id?: string;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string;
  hsn_code: string;
  quantity: number;
  unit_cost: number;
  taxable_value: number;
  vat_rate: number;
  vat_amount: number;
  line_total: number;
  batch_number: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  product?: Product;
}

export interface Purchase {
  id: string;
  purchase_number: string;
  supplier_id: string;
  warehouse_id: string | null;
  purchase_date: string;
  subtotal: number;
  total_vat: number;
  round_off: number;
  grand_total: number;
  /** ISO currency the document was issued in (pre-VAT documents are INR) */
  currency: string;
  /** Tax rules the purchase was recorded under (India: input CGST+SGST vs IGST) */
  tax_country?: string | null;
  tax_split?: TaxSplit | null;
  status: "received" | "cancelled";
  notes: string | null;
  created_by: string | null;
  created_at: string;
  organization_id?: string;
  supplier?: Supplier;
  warehouse?: Warehouse;
  items?: PurchaseItem[];
}

export interface CreditNoteItem {
  id: string;
  credit_note_id: string;
  product_id: string;
  hsn_code: string;
  quantity: number;
  unit_price: number;
  taxable_value: number;
  vat_rate: number;
  vat_amount: number;
  line_total: number;
  product?: Product;
}

export interface CreditNote {
  id: string;
  credit_note_number: string;
  invoice_id: string;
  customer_id: string;
  warehouse_id: string | null;
  credit_date: string;
  subtotal: number;
  total_vat: number;
  round_off: number;
  grand_total: number;
  /** ISO currency the document was issued in (pre-VAT documents are INR) */
  currency: string;
  /** Copied from the credited invoice */
  tax_country?: string | null;
  tax_treatment?: TaxTreatment | null;
  tax_split?: TaxSplit | null;
  place_of_supply?: string | null;
  reason: string | null;
  status: "issued" | "cancelled";
  created_by: string | null;
  created_at: string;
  organization_id?: string;
  invoice?: Invoice;
  customer?: Customer;
  items?: CreditNoteItem[];
}

export interface Product {
  id: string;
  organization_id?: string;
  name: string;
  category: string;
  /** Optional subcategory inside `category` */
  subcategory?: string | null;
  variant: string | null;
  /** Unit the price is per (pcs, kg, l, m, box, hour...) - see lib/units */
  unit?: string;
  sku: string;
  /** Optional barcode / EAN for scanner billing */
  barcode?: string | null;
  pack_size: string;
  /** Optional item / tariff code (legacy HSN column) */
  hsn_code: string;
  base_price: number;
  /**
   * Internal quick-reference unit cost. Not used for invoices, VAT, or customer pricing.
   * Detailed cost history lives in Business Data → Product Costs.
   */
  manufacturing_cost?: number | null;
  vat_rate: number;
  vat_category: VatCategory;
  reorder_threshold: number;
  is_active: boolean;
  image_url: string | null;
  mfg_date?: string | null;
  exp_date?: string | null;
  /** @deprecated Prefer invoice-line IMEI; kept for older mobile catalog rows */
  imei_serial?: string | null;
  /** Pharmacy - optional batch on the catalog item */
  batch_number?: string | null;
  /** Freelancer - when true, skip stock check/deduction on invoices */
  is_service?: boolean;
  /** Jewellery - gold | silver | platinum | palladium; null for fixed-price products */
  metal_type?: "gold" | "silver" | "platinum" | "palladium" | null;
  purity?: string | null;
  huid_number?: string | null;
  gross_weight?: number | null;
  net_weight?: number | null;
  making_charge_type?: "flat" | "per_gram" | "percent" | null;
  making_charge_value?: number | null;
  stone_value?: number | null;
  /** Jewellery: % of metal value (estimate only; not a fixed base price) */
  wastage_percent?: number | null;
  created_at: string;
  updated_at: string;
  current_stock?: number;
}

export interface PriceHistory {
  id: string;
  product_id: string;
  old_price: number | null;
  new_price: number;
  changed_by: string | null;
  changed_at: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  movement_type: MovementType;
  quantity: number;
  reference: string | null;
  reason: string | null;
  batch_number: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  created_by: string | null;
  created_at: string;
  edited_at?: string | null;
  edited_by?: string | null;
  warehouse_id?: string | null;
  organization_id?: string;
  product?: Product;
  user?: AppUser;
  editor?: AppUser;
  warehouse?: Warehouse;
}

export interface Customer {
  id: string;
  name: string;
  organization_id?: string;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  /** Emirate / region */
  state: string;
  /** Customer VAT registration number, if registered */
  tax_id: string | null;
  country: string;
  customer_type: CustomerType;
  created_at: string;
  /** Kayyro Collect (migration 049) */
  payment_terms_days?: number | null;
  preferred_language?: "auto" | "en" | "ar";
  preferred_channel?: "whatsapp" | "email" | "both";
  collect_paused?: boolean;
  /** When the customer agreed to WhatsApp reminders (null = not opted in) */
  whatsapp_opt_in_at?: string | null;
  /** When the customer opted out of reminders (only they can undo it) */
  collect_opted_out_at?: string | null;
  collect_token?: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  invoice_date: string;
  /** Payment due date (migration 049): invoice date + payment terms */
  due_date?: string | null;
  subtotal: number;
  total_vat: number;
  round_off: number;
  grand_total: number;
  /** ISO currency the document was issued in (pre-VAT documents are INR) */
  currency: string;
  prices_include_vat?: boolean;
  /** Sum of payments applied to this invoice */
  amount_paid?: number;
  /** Country whose tax rules the invoice was issued under (stamped at issue) */
  tax_country?: string | null;
  /** domestic | reverse_charge | export */
  tax_treatment?: TaxTreatment | null;
  /** single | cgst_sgst | igst (India) */
  tax_split?: TaxSplit | null;
  /** Printed place of supply, e.g. "Dubai" or "Karnataka (29)" */
  place_of_supply?: string | null;
  status: InvoiceStatus;
  cancelled_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  edited_at?: string | null;
  edited_by?: string | null;
  warehouse_id?: string | null;
  organization_id?: string;
  /** Public PDF short link code for /i/{short_code} */
  short_code?: string | null;
  /** Email: last time this invoice was emailed, and how many times */
  last_emailed_at?: string | null;
  email_count?: number;
  customer?: Customer;
  items?: InvoiceItem[];
  creator?: AppUser;
  warehouse?: Warehouse;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id?: string | null;
  hsn_code: string;
  quantity: number;
  /** Unit snapshot printed on the line (kg, pcs...) */
  unit?: string | null;
  unit_price: number;
  price_overridden: boolean;
  taxable_value: number;
  vat_rate: number;
  vat_amount: number;
  vat_category?: VatCategory;
  line_total: number;
  /** Mobile shop - optional IMEI/serial for this line */
  imei_serial?: string | null;
  /** Pharmacy - optional batch for this line */
  batch_number?: string | null;
  /** Cloth shop lite - free-text size/color tag */
  variant_tag?: string | null;
  /** Jewellery snapshots - rate/weights charged at bill time */
  metal_rate_used?: number | null;
  /** Same locked rate per gram as metal_rate_used; permanent sale-time snapshot */
  rate_locked_at_sale?: number | null;
  /** live_metal_rates | metal_rates | manual */
  rate_source?: string | null;
  gross_weight?: number | null;
  net_weight?: number | null;
  making_charge_amount?: number | null;
  stone_value?: number | null;
  jewellery_purity?: string | null;
  jewellery_huid?: string | null;
  /** Hotel folio - stay dates and guest ID (display only) */
  check_in_date?: string | null;
  check_out_date?: string | null;
  guest_id_proof?: string | null;
  /** Hotel: line billed from a room booking */
  room_booking_id?: string | null;
  product?: Product;
}

export interface CreateInvoicePayload {
  customer_id: string;
  invoice_date: string;
  notes?: string;
  warehouse_id?: string | null;
  prices_include_vat?: boolean;
  /** How the invoice is taxed, resolved by the invoice form (see lib/vat/context) */
  tax?: InvoiceTaxFields & { decimals: number; tax_free: boolean };
  items: {
    product_id?: string | null;
    quantity: number;
    unit?: string | null;
    unit_price: number;
    price_overridden: boolean;
    imei_serial?: string | null;
    batch_number?: string | null;
    variant_tag?: string | null;
    metal_rate_used?: number | null;
    rate_locked_at_sale?: number | null;
    rate_source?: string | null;
    gross_weight?: number | null;
    net_weight?: number | null;
    making_charge_amount?: number | null;
    stone_value?: number | null;
    jewellery_purity?: string | null;
    jewellery_huid?: string | null;
    check_in_date?: string | null;
    check_out_date?: string | null;
    guest_id_proof?: string | null;
    room_booking_id?: string | null;
    hsn_code?: string | null;
    vat_rate?: number | null;
    vat_category?: VatCategory | null;
  }[];
}

export interface InvoiceTaxFields {
  tax_country: string;
  tax_treatment: TaxTreatment;
  tax_split: TaxSplit;
  place_of_supply: string;
}

export type UpdateInvoicePayload = CreateInvoicePayload & {
  force?: boolean;
};

/** Internal bookkeeping - never used by invoices / base_price */
export interface ProductCost {
  id: string;
  product_id: string;
  cost_price: number;
  supplier: string | null;
  purchase_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  product?: Product;
}

export interface OtherExpense {
  id: string;
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paid_to: string | null;
  payment_mode: PaymentMode | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

/** Hotel — billable room category (per night). */
export type RoomType = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  sac_code: string | null;
  base_price: number;
  vat_rate: number;
  max_occupancy: number;
  is_active: boolean;
  created_at: string;
};

export type RoomStatus = "available" | "maintenance" | "out_of_service";

export type HotelRoom = {
  id: string;
  organization_id: string;
  room_type_id: string;
  room_number: string;
  status: RoomStatus;
  created_at: string;
  room_type?: RoomType;
};

export type RoomBookingStatus = "booked" | "checked_in" | "checked_out" | "cancelled";

export type RoomBooking = {
  id: string;
  organization_id: string;
  room_id: string;
  customer_id: string;
  check_in_date: string;
  check_out_date: string;
  status: RoomBookingStatus;
  guest_id_proof: string | null;
  notes: string | null;
  invoice_id: string | null;
  created_at: string;
  room?: HotelRoom;
  customer?: Customer;
};

/** Unified Business Data ledger entry */
export interface BusinessDataEntry {
  id: string;
  company_person_name: string;
  category: BusinessDataCategory;
  item_name: string;
  expense_name: string;
  payment_method: PaymentMode;
  amount: number;
  note: string | null;
  entry_date: string;
  created_by: string | null;
  created_at: string;
  organization_id?: string;
}

/** Organization-defined product category or subcategory (parent_id set). */
export interface ProductCategoryRow {
  id: string;
  organization_id?: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
}

/** One sent (or failed) invoice / reminder email. */
export interface InvoiceEmailLog {
  id: string;
  organization_id?: string;
  invoice_id: string | null;
  customer_id: string | null;
  kind: "invoice" | "reminder";
  to_email: string;
  cc: string | null;
  subject: string;
  status: "sent" | "failed";
  provider: string | null;
  provider_message_id: string | null;
  error: string | null;
  sent_by: string | null;
  created_at: string;
}

export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

/** One repeated line on a recurring invoice. Prices stay as agreed; VAT uses the product's current rate. */
export interface RecurringItem {
  product_id: string;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
}

export interface RecurringInvoice {
  id: string;
  organization_id?: string;
  customer_id: string;
  source_invoice_id: string | null;
  name: string;
  frequency: RecurringFrequency;
  next_run_date: string;
  end_date: string | null;
  items: RecurringItem[];
  prices_include_vat: boolean;
  warehouse_id: string | null;
  notes: string | null;
  active: boolean;
  last_invoice_id: string | null;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  customer?: Pick<Customer, "id" | "name"> | null;
}

/** Someone who works in the business. Employees don't need an app login. */
export interface Employee {
  id: string;
  organization_id?: string;
  full_name: string;
  job_title: string | null;
  phone: string | null;
  /** Shop wall-clock time, "09:00:00" */
  shift_start: string | null;
  shift_end: string | null;
  /** May check in from their own phone using their private link */
  allow_phone: boolean;
  checkin_token: string;
  /** Reference photo in the private attendance bucket */
  photo_path: string | null;
  has_pin: boolean;
  active: boolean;
  created_at: string;
}

export type AttendanceSource = "kiosk" | "phone" | "manual";

/** One check-in or check-out */
export interface AttendancePunch {
  id: string;
  organization_id?: string;
  employee_id: string;
  kind: "in" | "out";
  at: string;
  source: AttendanceSource;
  /** Selfie taken at the moment of the punch (private bucket path, or a data URL in demo mode) */
  photo_path: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// ---------- Kayyro Collect ----------
export type CollectChannel = "whatsapp" | "email";
export type CollectMessageStatus =
  | "pending"
  | "awaiting_approval"
  | "ready"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "cancelled"
  | "received";

export interface CollectSettings {
  organization_id: string;
  enabled: boolean;
  enabled_at: string | null;
  channel_email: boolean;
  channel_whatsapp: boolean;
  tone: number;
  language: "auto" | "en" | "ar";
  send_start: string;
  send_end: string;
  working_days: number[] | null;
  time_zone: string | null;
  ramadan_enabled: boolean;
  ramadan_start: string | null;
  ramadan_end: string | null;
  ramadan_send_start: string;
  ramadan_send_end: string;
  approval_mode: "approve" | "auto";
  default_terms_days: number;
  include_existing: boolean;
  /** Phase 2 (migration 050): the AI reads customers' replies */
  ai_replies?: boolean;
  /** Phase 3 (migration 051): the owner's daily summary, Business plan */
  summary_enabled?: boolean;
  summary_channel?: "email" | "whatsapp";
  summary_to?: string | null;
  summary_time?: string;
  updated_at: string;
}

export interface ReminderStep {
  id: string;
  organization_id: string;
  offset_days: number;
  action: "message" | "call_task";
  step_key: "before_due" | "due_today" | "polite" | "firm" | "call" | "final";
  active: boolean;
}

export interface CollectionMessage {
  id: string;
  organization_id: string;
  invoice_id: string | null;
  customer_id: string | null;
  step_id: string | null;
  step_key: string | null;
  direction: "out" | "in";
  channel: CollectChannel;
  status: CollectMessageStatus;
  local_date: string;
  sent_on: string | null;
  auto_send: boolean;
  manual: boolean;
  /** reminder, or an answer to / a customer's reply (migration 050) */
  kind?: "reminder" | "reply";
  from_address?: string | null;
  reply_to_id?: string | null;
  intent?: ReplyIntentName | null;
  intent_confidence?: number | null;
  intent_summary?: string | null;
  intent_promise_date?: string | null;
  intent_status?: "pending" | "applied" | "needs_you" | null;
  language: "en" | "ar";
  subject: string | null;
  body: string | null;
  to_address: string | null;
  wa_template: string | null;
  wa_variables: string[] | null;
  provider: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface CollectTask {
  id: string;
  organization_id: string;
  invoice_id: string | null;
  customer_id: string | null;
  kind: "call" | "dispute" | "paid_claim" | "promise" | "extension" | "wrong_contact" | "other" | "limit";
  status: "open" | "done" | "dismissed";
  title: string;
  note: string | null;
  due_date: string | null;
  created_at: string;
  message_id?: string | null;
  claim_id?: string | null;
}

export interface PaymentPromise {
  id: string;
  invoice_id: string;
  customer_id: string | null;
  promised_date: string;
  amount: number | null;
  status: "open" | "kept" | "broken" | "cancelled";
  created_at: string;
}

export type ReplyIntentName =
  | "already_paid"
  | "promise_to_pay"
  | "dispute"
  | "request_invoice_copy"
  | "request_extension"
  | "wrong_contact"
  | "other";

/** "I already paid" from the payment page or a reply (migration 050) */
export interface PaymentClaim {
  id: string;
  invoice_id: string;
  customer_id: string | null;
  source: "payment_page" | "reply";
  note: string | null;
  file_path: string | null;
  file_type: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
}

export interface Dispute {
  id: string;
  invoice_id: string;
  customer_id: string | null;
  reason: string;
  status: "open" | "resolved";
  created_at: string;
}
