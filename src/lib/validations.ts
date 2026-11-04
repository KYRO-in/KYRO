import { z } from "zod";
import { DEFAULT_INVOICE_PREFIX } from "@/lib/brand";
import { VAT_CATEGORIES } from "@/lib/vat";
import { DEFAULT_COUNTRY, isOfferedCountry, isValidTaxId, getCountryConfig } from "@/lib/vat/countries";

/** A new business: one of the six GCC countries (empty = the UAE). */
const countryField = z
  .string()
  .optional()
  .refine((v) => !v || isOfferedCountry(v), "Kayyro is available for businesses in the GCC for now.")
  .transform((v) => (v ? v.toUpperCase() : DEFAULT_COUNTRY));
import { BUSINESS_TYPES, type ProductFormFieldId } from "@/lib/business-types";

/** Empty string / blank → null; otherwise non-negative number. */
const optionalPrice = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : val;
}, z.union([z.null(), z.number().min(0, "Price must be ≥ 0")]));

const optionalString = z.string().optional().nullable().or(z.literal(""));

/** Full product payload schema (DB still stores all columns; form whitelist controls UI). */
export const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  subcategory: optionalString,
  unit: z.string().optional().default("pcs"),
  variant: optionalString,
  sku: z.string().optional().default(""),
  barcode: optionalString,
  pack_size: z.string().optional().default("Unit"),
  hsn_code: z.string().optional().default(""),
  base_price: z.coerce.number().min(0, "Price must be ≥ 0"),
  manufacturing_cost: optionalPrice,
  vat_rate: z.coerce.number().min(0, "VAT rate must be ≥ 0").max(100, "VAT rate must be ≤ 100"),
  vat_category: z.enum(VAT_CATEGORIES as [string, ...string[]]).default("standard"),
  reorder_threshold: z.coerce.number().min(0, "Must be 0 or more").default(10),
  is_active: z.boolean().default(true),
  mfg_date: optionalString,
  exp_date: optionalString,
  imei_serial: optionalString,
  batch_number: optionalString,
  is_service: z.boolean().default(false),
  metal_type: z.enum(["gold", "silver", "platinum", "palladium"]).optional().nullable(),
  purity: optionalString,
  huid_number: optionalString,
  gross_weight: z.coerce.number().min(0).optional().nullable(),
  net_weight: z.coerce.number().min(0).optional().nullable(),
  making_charge_type: z.enum(["flat", "per_gram", "percent"]).optional().nullable(),
  making_charge_value: z.coerce.number().min(0).optional().nullable(),
  stone_value: z.coerce.number().min(0).optional().nullable(),
  wastage_percent: z.coerce.number().min(0).optional().nullable(),
});

/** Validate only whitelisted fields as required; others get safe defaults on submit. */
export function productSchemaForFields(visible: ReadonlySet<ProductFormFieldId>) {
  return productSchema.superRefine((data, ctx) => {
    if (visible.has("name") && !data.name?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Name is required", path: ["name"] });
    }
    if (visible.has("category") && !data.category?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Category is required", path: ["category"] });
    }
    if (visible.has("sku") && !data.sku?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SKU is required", path: ["sku"] });
    }
    if (visible.has("pack_size") && !data.pack_size?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pack size is required", path: ["pack_size"] });
    }
    if (data.vat_category !== "standard" && data.vat_rate !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Zero-rated and exempt items carry 0% VAT",
        path: ["vat_rate"],
      });
    }
  });
}

export const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  billing_address: z.string().optional().nullable(),
  state: z.string().optional().default(""),
  country: z.string().optional().default(DEFAULT_COUNTRY),
  tax_id: z.string().optional().nullable(),
  customer_type: z.enum(["b2b", "b2c"]),
  // Kayyro Collect (migration 049); empty terms = the business default
  payment_terms_days: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && Number(v) <= 365), "Enter 0 to 365 days"),
  preferred_language: z.enum(["auto", "en", "ar"]).optional(),
  preferred_channel: z.enum(["both", "email", "whatsapp"]).optional(),
  collect_paused: z.boolean().optional(),
  whatsapp_opt_in: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (!isValidTaxId(data.tax_id, data.country)) {
    const cfg = getCountryConfig(data.country);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Enter a valid ${cfg.taxIdLabel} (${cfg.taxIdHint})`,
      path: ["tax_id"],
    });
  }
});

export const stockInSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive("Quantity must be more than 0"),
  source: z.enum(["production", "purchase"]),
  batch_number: z.string().optional().nullable(),
  mfg_date: z.string().optional().nullable(),
  exp_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const stockOutSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive("Quantity must be more than 0"),
  reason: z.string().min(1, "Reason is required"),
  notes: z.string().optional().nullable(),
});

export const stockAdjustSchema = z.object({
  product_id: z.string().uuid(),
  new_quantity: z.coerce.number().min(0, "Stock can't be negative"),
  reason: z.string().min(3, "Reason is required"),
});

export const companySettingsSchema = z.object({
  company_name: z.string().min(1),
  brand_name: z.string().min(1),
  country: z.string().min(2).default(DEFAULT_COUNTRY),
  tax_id: z.string().optional().default(""),
  prices_include_vat: z.boolean().default(false),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1, "Choose your emirate, state or region"),
  pincode: z.string().optional().default(""),
  phone: z.string().min(1),
  email: z.string().email("Enter a valid email"),
  bank_name: z.string().optional().default(""),
  bank_account: z.string().optional().default(""),
  bank_swift: z.string().optional().default(""),
  bank_branch: z.string().optional().default(""),
  invoice_prefix: z.string().min(1, "Invoice prefix is required").default(DEFAULT_INVOICE_PREFIX),
  business_type: z.enum(BUSINESS_TYPES).default("general"),
}).superRefine((data, ctx) => {
  if (!isValidTaxId(data.tax_id, data.country)) {
    const cfg = getCountryConfig(data.country);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Enter a valid ${cfg.taxIdLabel} (${cfg.taxIdHint})`,
      path: ["tax_id"],
    });
  }
});

export const STRONG_PASSWORD_HINT =
  "At least 8 characters, with uppercase, lowercase, a number, and a symbol";

/** Signup / invite: min 8 + mixed case, digit, and symbol. */
export const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol (e.g. ! @ # $)");

export function passwordStrengthChecks(password: string) {
  return {
    minLength: password.length >= 8,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

export const inviteUserSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  role: z.enum(["admin", "staff", "accountant"]),
  password: strongPasswordSchema,
});

export const signupSchema = z.object({
  business_name: z.string().min(2, "Business name is required"),
  owner_name: z.string().min(1, "Owner name is required"),
  email: z.string().trim().toLowerCase().email(),
  password: strongPasswordSchema,
  business_type: z.enum(BUSINESS_TYPES).default("general"),
  country: countryField,
});

/** For auth users who already have a session but no org/profile yet. */
export const completeSetupSchema = z.object({
  business_name: z.string().min(2, "Business name is required"),
  owner_name: z.string().min(1, "Owner name is required"),
  business_type: z.enum(BUSINESS_TYPES).default("general"),
  country: countryField,
});
