import { calcInvoiceTotals, normalizeVatCategory, type CalcOptions } from "@/lib/vat";
import { calcOptionsFor, calcOptionsForDocument, copiedTaxFields, resolveTaxContext } from "@/lib/vat/context";

/** Tax options for a demo invoice (mirrors the real create / update path). */
function demoCalcOptions(payload: Pick<CreateInvoicePayload, "prices_include_vat" | "tax">): CalcOptions {
  const pricesIncludeVat = !!payload.prices_include_vat;
  const tax = payload.tax;
  if (!tax) return { pricesIncludeVat };
  return {
    pricesIncludeVat,
    decimals: tax.decimals,
    split: tax.tax_split,
    treatment: tax.tax_treatment,
    taxFree: tax.tax_free,
  };
}

function demoTaxFields(payload: Pick<CreateInvoicePayload, "tax">) {
  const tax = payload.tax;
  if (!tax) return {};
  return {
    tax_country: tax.tax_country,
    tax_treatment: tax.tax_treatment,
    tax_split: tax.tax_split,
    place_of_supply: tax.place_of_supply,
  };
}
import { numberingPeriodLabel } from "@/lib/invoice-options";
import { DEFAULT_INVOICE_PREFIX } from "@/lib/brand";
import type {
  AppUser,
  BusinessDataEntry,
  CompanySettings,
  CreateInvoicePayload,
  CreditNote,
  CreditNoteItem,
  Customer,
  Invoice,
  InvoiceEmailLog,
  InvoiceItem,
  Organization,
  OtherExpense,
  PriceHistory,
  Product,
  ProductCategoryRow,
  ProductCost,
  Purchase,
  PurchaseItem,
  RecurringInvoice,
  StockMovement,
  Supplier,
  Warehouse,
} from "@/lib/types";
import type { Payment } from "@/lib/udhaar";
import { invoiceStatusFromPaid } from "@/lib/invoice-payment";
import {
  companySettingsToOrganizationPatch,
  organizationToCompanySettings,
} from "@/lib/organization";
import type { BusinessDataCategory, PaymentMode } from "@/lib/constants";
import { DEMO_ADMIN } from "./mode";

function id() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const P4 = "44444444-4444-4444-8444-444444444444";
const P5 = "55555555-5555-4555-8555-555555555555";
const P6 = "66666666-6666-4666-8666-666666666666";
const P7 = "77777777-7777-4777-8777-777777777777";
const P8 = "88888888-8888-4888-8888-888888888888";
const P9 = "99999999-9999-4999-8999-999999999999";
const P10 = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const P11 = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const P12 = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const P13 = "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3";
const P14 = "b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const C4 = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";
const C5 = "c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5";
const C6 = "c6c6c6c6-c6c6-4c6c-8c6c-c6c6c6c6c6c6";
const W1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const S1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const S2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";

type Store = {
  products: Product[];
  stock: Record<string, number>;
  priceHistory: PriceHistory[];
  movements: StockMovement[];
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  company: CompanySettings;
  organization: Organization;
  users: AppUser[];
  invoiceSeq: number;
  purchaseSeq: number;
  creditNoteSeq: number;
  productCosts: ProductCost[];
  otherExpenses: OtherExpense[];
  businessDataEntries: BusinessDataEntry[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  purchases: Purchase[];
  creditNotes: CreditNote[];
  productCategories: ProductCategoryRow[];
  invoiceEmails: InvoiceEmailLog[];
  recurringInvoices: RecurringInvoice[];
};

function seed(): Store {
  const products: Product[] = [
    {
      id: P1,
      name: "Handwash - Rose",
      category: "Hand & Body Care",
      subcategory: "Handwash",
      unit: "bottle",
      variant: "Rose",
      sku: "HAN-ROS-500ML-A1",
      pack_size: "500ml",
      hsn_code: "34013000",
      base_price: 85,
      manufacturing_cost: 42,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 20,
      is_active: true,
      image_url: null,
      barcode: "8901001000001",
      mfg_date: "2026-01-15",
      exp_date: "2026-08-05",
      created_at: "2026-01-10T10:00:00.000Z",
      updated_at: "2026-01-10T10:00:00.000Z",
    },
    {
      id: P2,
      name: "Dishwash Liquid",
      category: "Kitchen Care",
      subcategory: "Dishwash",
      unit: "bottle",
      variant: "Lemon",
      sku: "DIS-LEM-1L-B2",
      pack_size: "1L",
      hsn_code: "34022090",
      base_price: 120,
      manufacturing_cost: 105,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 15,
      is_active: true,
      image_url: null,
      barcode: "8901001000002",
      mfg_date: "2026-03-01",
      exp_date: "2026-07-31",
      created_at: "2026-01-10T10:00:00.000Z",
      updated_at: "2026-01-10T10:00:00.000Z",
    },
    {
      id: P3,
      name: "Floor Cleaner",
      category: "Floor & Surface",
      subcategory: "Floor cleaners",
      unit: "can",
      variant: "Pine",
      sku: "FLO-PIN-5L-C3",
      pack_size: "5L",
      hsn_code: "34025000",
      base_price: 350,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 10,
      is_active: true,
      image_url: null,
      barcode: null,
      mfg_date: "2025-12-01",
      exp_date: "2026-07-20",
      created_at: "2026-01-12T10:00:00.000Z",
      updated_at: "2026-01-12T10:00:00.000Z",
    },
    {
      id: P4,
      name: "Liquid Detergent",
      category: "Laundry",
      subcategory: "Liquid detergent",
      unit: "bottle",
      variant: "Fresh",
      sku: "DET-FRE-1L-D4",
      pack_size: "1L",
      hsn_code: "34022090",
      base_price: 175,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 25,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-01-15T10:00:00.000Z",
      updated_at: "2026-01-15T10:00:00.000Z",
    },
    {
      id: P5,
      name: "Handwash",
      category: "Hand & Body Care",
      subcategory: "Handwash",
      unit: "bottle",
      variant: null,
      sku: "HANDWASH-1L-P5",
      pack_size: "1L",
      hsn_code: "34013000",
      base_price: 90,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 15,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-01-20T10:00:00.000Z",
      updated_at: "2026-01-20T10:00:00.000Z",
    },
    {
      id: P6,
      name: "Toilet Cleaner",
      category: "Floor & Surface",
      subcategory: "Bathroom",
      unit: "bottle",
      variant: null,
      sku: "TOILET-CLEANER-1L-P6",
      pack_size: "1L",
      hsn_code: "34013000",
      base_price: 85,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 12,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-01-20T10:00:00.000Z",
      updated_at: "2026-01-20T10:00:00.000Z",
    },
    {
      id: P7,
      name: "Car Wash",
      category: "Car Care",
      subcategory: "Car shampoo",
      unit: "bottle",
      variant: null,
      sku: "CAR-WASH-1L-P7",
      pack_size: "1L",
      hsn_code: "34025000",
      base_price: 140,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 10,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-01-20T10:00:00.000Z",
      updated_at: "2026-01-20T10:00:00.000Z",
    },
    {
      id: P8,
      name: "Dish Wash",
      category: "Kitchen Care",
      subcategory: "Dishwash",
      unit: "bottle",
      variant: null,
      sku: "DISH-WASH-1L-P8",
      pack_size: "1L",
      hsn_code: "34022090",
      base_price: 120,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 15,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-01-20T10:00:00.000Z",
      updated_at: "2026-01-20T10:00:00.000Z",
    },
    {
      id: P9,
      name: "Clothe Wash",
      category: "Laundry",
      subcategory: "Liquid detergent",
      unit: "bottle",
      variant: null,
      sku: "CLOTHE-WASH-1L-P9",
      pack_size: "1L",
      hsn_code: "34022090",
      base_price: 175,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 20,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-01-20T10:00:00.000Z",
      updated_at: "2026-01-20T10:00:00.000Z",
    },
    {
      id: P10,
      name: "Bathroom Cleaner",
      category: "Floor & Surface",
      subcategory: "Bathroom",
      unit: "bottle",
      variant: null,
      sku: "BATHROOM-CLEANER-1L-P10",
      pack_size: "1L",
      hsn_code: "34029090",
      base_price: 90,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 12,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-01-20T10:00:00.000Z",
      updated_at: "2026-01-20T10:00:00.000Z",
    },
    {
      id: P11,
      name: "Detergent Powder (loose)",
      category: "Laundry",
      subcategory: "Powder",
      unit: "kg",
      variant: null,
      sku: "DET-POW-KG-P11",
      pack_size: "Loose",
      hsn_code: "34022090",
      base_price: 9.5,
      manufacturing_cost: 5.8,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 80,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-02-01T10:00:00.000Z",
      updated_at: "2026-02-01T10:00:00.000Z",
    },
    {
      id: P12,
      name: "Microfiber Cloth",
      category: "Accessories",
      subcategory: "Cloths & sponges",
      unit: "pack",
      variant: "Pack of 5",
      sku: "MIC-CLO-5PK-P12",
      pack_size: "5 pcs",
      hsn_code: "63079090",
      base_price: 25,
      manufacturing_cost: 11,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 20,
      is_active: true,
      image_url: null,
      barcode: "8901001000012",
      created_at: "2026-02-01T10:00:00.000Z",
      updated_at: "2026-02-01T10:00:00.000Z",
    },
    {
      id: P13,
      name: "Deep Cleaning Service",
      category: "Services",
      subcategory: "Deep cleaning",
      unit: "hour",
      variant: null,
      sku: "SRV-DEEP-HR-P13",
      pack_size: "Unit",
      hsn_code: "",
      base_price: 120,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 0,
      is_active: true,
      is_service: true,
      image_url: null,
      barcode: null,
      created_at: "2026-02-15T10:00:00.000Z",
      updated_at: "2026-02-15T10:00:00.000Z",
    },
    {
      id: P14,
      name: "Floor Cleaner Concentrate",
      category: "Floor & Surface",
      subcategory: "Floor cleaners",
      unit: "l",
      variant: "Lavender",
      sku: "FLO-CON-L-P14",
      pack_size: "Loose",
      hsn_code: "34025000",
      base_price: 32.5,
      manufacturing_cost: 19,
      vat_rate: 5,
      vat_category: "standard",
      reorder_threshold: 60,
      is_active: true,
      image_url: null,
      barcode: null,
      created_at: "2026-02-15T10:00:00.000Z",
      updated_at: "2026-02-15T10:00:00.000Z",
    },
  ];

  // Opening stock before the seeded sample sales below draw it down
  const stock: Record<string, number> = {
    [P1]: 260,
    [P2]: 220,
    [P3]: 140,
    [P4]: 200,
    [P5]: 180,
    [P6]: 200,
    [P7]: 120,
    [P8]: 200,
    [P9]: 160,
    [P10]: 180,
    [P11]: 900,
    [P12]: 160,
    [P13]: 0,
    [P14]: 600,
  };

  const customers: Customer[] = [
    {
      id: C1,
      name: "Al Noor Trading LLC",
      phone: "+971 50 123 4567",
      email: "accounts@alnoor.example.com",
      billing_address: "Office 1204, Business Bay",
      state: "Dubai",
      tax_id: "100234567800003",
      country: "AE",
      customer_type: "b2b",
      created_at: "2026-02-01T10:00:00.000Z",
    },
    {
      id: C2,
      name: "Walk-in Customer",
      phone: "+971 55 987 6543",
      email: null,
      billing_address: "Al Majaz, Sharjah",
      state: "Sharjah",
      tax_id: null,
      country: "AE",
      customer_type: "b2c",
      created_at: "2026-02-05T10:00:00.000Z",
    },
    {
      id: C3,
      name: "Gulf Hospitality Group LLC",
      phone: "+971 2 555 0148",
      email: "procurement@gulfhospitality.example.com",
      billing_address: "Tower B, Al Maryah Island",
      state: "Abu Dhabi",
      tax_id: "100456789000003",
      country: "AE",
      customer_type: "b2b",
      created_at: "2026-02-12T10:00:00.000Z",
    },
    {
      id: C4,
      name: "Marina Bistro & Grill",
      phone: "+971 4 555 0192",
      email: "owner@marinabistro.example.com",
      billing_address: "Dubai Marina Walk, Shop 12",
      state: "Dubai",
      tax_id: "100567890100003",
      country: "AE",
      customer_type: "b2b",
      created_at: "2026-03-02T10:00:00.000Z",
    },
    {
      id: C5,
      name: "Palm Facilities Management",
      phone: "+971 4 555 0177",
      email: "accounts@palmfacilities.example.com",
      billing_address: "Jumeirah Lakes Towers, Cluster D",
      state: "Dubai",
      tax_id: "100678901200003",
      country: "AE",
      customer_type: "b2b",
      created_at: "2026-03-18T10:00:00.000Z",
    },
    {
      id: C6,
      name: "Sharjah Sparkle Laundry",
      phone: "+971 6 555 0163",
      email: "hello@sparklelaundry.example.com",
      billing_address: "Industrial Area 4, Sharjah",
      state: "Sharjah",
      tax_id: "100789012300003",
      country: "AE",
      customer_type: "b2b",
      created_at: "2026-04-05T10:00:00.000Z",
    },
  ];

  const movements: StockMovement[] = [
    {
      id: id(),
      product_id: P1,
      movement_type: "in",
      quantity: 50,
      reference: "Production batch",
      reason: "Initial demo stock",
      batch_number: "BATCH-01",
      mfg_date: "2026-01-01",
      exp_date: "2027-01-01",
      created_by: DEMO_ADMIN.id,
      created_at: "2026-01-10T11:00:00.000Z",
      product: products[0],
      user: DEMO_ADMIN,
    },
    {
      id: id(),
      product_id: P2,
      movement_type: "in",
      quantity: 20,
      reference: "Purchase",
      reason: "Initial demo stock",
      batch_number: null,
      mfg_date: null,
      exp_date: null,
      created_by: DEMO_ADMIN.id,
      created_at: "2026-01-10T11:05:00.000Z",
      product: products[1],
      user: DEMO_ADMIN,
    },
  ];

  const organization: Organization = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Kayyro Demo Trading LLC",
    slug: "kayyro-demo",
    tax_id: "100123456700003",
    country: "AE",
    currency: "AED",
    prices_include_vat: false,
    address: "Warehouse 7, Al Quoz Industrial Area 3",
    state: "Dubai",
    bank_details: "Emirates NBD · IBAN AE070331234567890123456 · SWIFT EBILAEAD · Al Quoz",
    logo_url: null,
    plan: "business",
    subscription_status: "active",
    trial_ends_at: "2027-07-31T00:00:00.000Z",
    created_at: "2026-01-01T10:00:00.000Z",
    brand_name: "Kayyro Demo",
    city: "Dubai",
    pincode: "123456",
    phone: "+971 4 123 4567",
    email: "billing@kayyro.local",
    bank_name: "Emirates NBD",
    bank_account: "AE070331234567890123456",
    bank_ifsc: "EBILAEAD",
    bank_branch: "Al Quoz",
    invoice_prefix: DEFAULT_INVOICE_PREFIX,
    upi_id: "",
    signature_url: null,
    updated_at: now(),
    razorpay_customer_id: null,
    razorpay_subscription_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    business_type: "general",
    monthly_sales_goal: 60000,
    email_bcc_self: false,
    name_ar: "كايرو للتجارة ذ.م.م",
    invoice_language: "en",
    payment_link_url: null,
    numbering_period: "calendar",
  };

  const company: CompanySettings = organizationToCompanySettings(organization);

  const warehouses: Warehouse[] = [
    {
      id: W1,
      name: "Main warehouse",
      code: "MAIN",
      address: null,
      is_default: true,
      is_active: true,
      created_at: "2026-01-01T10:00:00.000Z",
    },
  ];

  const suppliers: Supplier[] = [
    {
      id: S1,
      name: "Gulf Chem Distributors FZE",
      phone: "+971 6 555 0101",
      email: "orders@gulfchem.example.com",
      tax_id: "100345678900003",
      country: "AE",
      address: "SAIF Zone, Sharjah",
      state: "Sharjah",
      notes: "Primary raw material supplier",
      is_active: true,
      created_at: "2026-02-01T10:00:00.000Z",
    },
    {
      id: S2,
      name: "PackRight Packaging",
      phone: "+971 4 555 0202",
      email: null,
      tax_id: null,
      country: "AE",
      address: "Dubai Investments Park",
      state: "Dubai",
      notes: null,
      is_active: true,
      created_at: "2026-02-10T10:00:00.000Z",
    },
  ];

  return {
    products,
    stock,
    priceHistory: [],
    movements,
    customers,
    invoices: [],
    payments: [],
    company,
    organization,
    users: [DEMO_ADMIN],
    invoiceSeq: 0,
    purchaseSeq: 0,
    creditNoteSeq: 0,
    productCosts: [],
    otherExpenses: [],
    businessDataEntries: [
      {
        id: id(),
        company_person_name: "Local Chem Supplier",
        category: "product_purchase",
        item_name: "Handwash concentrate",
        expense_name: "July restock",
        payment_method: "card",
        amount: 4500,
        note: "Bulk drum",
        entry_date: "2026-07-15",
        created_by: DEMO_ADMIN.id,
        created_at: "2026-07-15T10:00:00.000Z",
      },
      {
        id: id(),
        company_person_name: "GIDC Vendor",
        category: "product_purchase",
        item_name: "Floor cleaner base",
        expense_name: "Raw material buy",
        payment_method: "bank_transfer",
        amount: 12600,
        note: null,
        entry_date: "2026-07-05",
        created_by: DEMO_ADMIN.id,
        created_at: "2026-07-05T10:00:00.000Z",
      },
      {
        id: id(),
        company_person_name: "Landlord - Unit 12",
        category: "rent",
        item_name: "Factory shed",
        expense_name: "Unit rent - July",
        payment_method: "bank_transfer",
        amount: 18000,
        note: null,
        entry_date: "2026-07-01",
        created_by: DEMO_ADMIN.id,
        created_at: "2026-07-01T09:00:00.000Z",
      },
      {
        id: id(),
        company_person_name: "Staff payroll",
        category: "salary",
        item_name: "Weekly wages",
        expense_name: "Staff wages - week 1",
        payment_method: "card",
        amount: 12000,
        note: null,
        entry_date: "2026-07-05",
        created_by: DEMO_ADMIN.id,
        created_at: "2026-07-05T09:00:00.000Z",
      },
      {
        id: id(),
        company_person_name: "Torrent Power",
        category: "utilities",
        item_name: "Electricity",
        expense_name: "Electricity bill",
        payment_method: "card",
        amount: 3400,
        note: null,
        entry_date: "2026-07-12",
        created_by: DEMO_ADMIN.id,
        created_at: "2026-07-12T09:00:00.000Z",
      },
    ],
    warehouses,
    suppliers,
    purchases: [],
    creditNotes: [],
    productCategories: demoCategories(),
    invoiceEmails: [],
    recurringInvoices: [],
  };
}

/** The demo shop's own category tree (shows the category manager with real rows). */
function demoCategories(): ProductCategoryRow[] {
  const tree: [string, string[]][] = [
    ["Kitchen Care", ["Dishwash", "Surface sprays"]],
    ["Hand & Body Care", ["Handwash", "Sanitiser"]],
    ["Floor & Surface", ["Floor cleaners", "Bathroom", "Glass"]],
    ["Laundry", ["Liquid detergent", "Powder", "Softener"]],
    ["Car Care", ["Car shampoo", "Wax & polish"]],
    ["Accessories", ["Cloths & sponges", "Mops & buckets"]],
    ["Services", ["Deep cleaning", "Office cleaning"]],
  ];
  const rows: ProductCategoryRow[] = [];
  tree.forEach(([cat, subs], i) => {
    const parentId = `demo-cat-${i}`;
    rows.push({ id: parentId, name: cat, parent_id: null, sort_order: i, created_at: "2026-01-05T10:00:00.000Z" });
    subs.forEach((sub, j) =>
      rows.push({
        id: `${parentId}-${j}`,
        name: sub,
        parent_id: parentId,
        sort_order: j,
        created_at: "2026-01-05T10:00:00.000Z",
      })
    );
  });
  return rows;
}

const globalKey = "__kayyro_demo_store_v12__";
const seededKey = "__kayyro_demo_seeded_v12__";

function getStore(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  if (!g[globalKey]) g[globalKey] = seed();
  const s = g[globalKey]!;
  if (!s.productCosts) s.productCosts = [];
  if (!s.otherExpenses) s.otherExpenses = [];
  if (!s.businessDataEntries) s.businessDataEntries = [];
  if (!s.warehouses) {
    s.warehouses = [
      {
        id: W1,
        name: "Main warehouse",
        code: "MAIN",
        address: null,
        is_default: true,
        is_active: true,
        created_at: "2026-01-01T10:00:00.000Z",
      },
    ];
  }
  if (!s.suppliers) s.suppliers = [];
  if (!s.purchases) s.purchases = [];
  if (!s.creditNotes) s.creditNotes = [];
  if (!s.productCategories) s.productCategories = demoCategories();
  if (!s.invoiceEmails) s.invoiceEmails = [];
  if (!s.recurringInvoices) s.recurringInvoices = [];
  if (s.purchaseSeq == null) s.purchaseSeq = 0;
  if (s.creditNoteSeq == null) s.creditNoteSeq = 0;
  if (!s.organization) {
    s.organization = {
      id: s.company.id,
      name: s.company.company_name,
      slug: "kayyro-demo",
      tax_id: s.company.tax_id || null,
      country: s.company.country,
      currency: s.company.currency,
      prices_include_vat: s.company.prices_include_vat,
      address: s.company.address || null,
      state: s.company.state,
      bank_details: null,
      logo_url: null,
      plan: "business",
      subscription_status: "active" as const,
      trial_ends_at: "2027-07-31T00:00:00.000Z",
      created_at: "2026-01-01T10:00:00.000Z",
      brand_name: s.company.brand_name,
      city: s.company.city,
      pincode: s.company.pincode,
      phone: s.company.phone,
      email: s.company.email,
      bank_name: s.company.bank_name,
      bank_account: s.company.bank_account,
      bank_ifsc: s.company.bank_swift,
      bank_branch: s.company.bank_branch,
      invoice_prefix: s.company.invoice_prefix,
      upi_id: "",
      updated_at: s.company.updated_at,
      razorpay_customer_id: null,
      razorpay_subscription_id: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      business_type: "general",
    };
    s.company = organizationToCompanySettings(s.organization);
  }
  if (!s.organization.business_type) {
    s.organization.business_type = "general";
    s.company = organizationToCompanySettings(s.organization);
  }
  if (!s.payments) s.payments = [];

  // Sample sales so every demo screen (dashboard, reports, ledgers) has life.
  const flags = globalThis as unknown as Record<string, boolean | undefined>;
  if (!flags[seededKey]) {
    flags[seededKey] = true;
    seedSampleActivity(s);
  }
  return s;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Oldest first, so invoice numbers climb with the dates. */
function seedSampleActivity(s: Store) {
  // Deterministic, so every demo visit tells the same story.
  let state = 20260707;
  const rnd = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rnd() * items.length)]!;
  const product = (pid: string) => s.products.find((p) => p.id === pid)!;
  const modes: PaymentMode[] = ["bank_transfer", "card", "cash", "cheque"];

  // Regulars buy more often; the walk-in counter buys small.
  const customers = [C3, C3, C4, C4, C5, C1, C1, C6, C6, C2, C2];
  const bundles: string[][] = [
    [P3, P14, P10],
    [P1, P5, P12],
    [P4, P9, P11],
    [P2, P8, P12],
    [P6, P10, P3],
    [P7, P12],
    [P13],
    [P11, P4],
  ];

  const qtyFor = (pid: string, walkIn: boolean) => {
    const unit = product(pid).unit;
    if (unit === "kg") return Math.round((walkIn ? 2 + rnd() * 6 : 12 + rnd() * 40) * 4) / 4;
    if (unit === "l") return Math.round((walkIn ? 1 + rnd() * 4 : 8 + rnd() * 30) * 2) / 2;
    if (unit === "hour") return 2 + Math.floor(rnd() * 7);
    return walkIn ? 1 + Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 22);
  };

  const restock = (pid: string, need: number, date: string) => {
    const p = product(pid);
    const qty = Math.ceil((need + (p.unit === "kg" || p.unit === "l" ? 300 : 120)) / 10) * 10;
    const po = demoDb.createPurchase({
      supplier_id: pid === P12 ? S2 : S1,
      purchase_date: date,
      user_id: DEMO_ADMIN.id,
      items: [{ product_id: pid, quantity: qty, unit_cost: Math.round(p.base_price * 0.58 * 100) / 100 }],
    });
    po.created_at = `${date}T08:30:00.000Z`;
    for (const m of s.movements) if (m.reference === po.purchase_number) m.created_at = po.created_at;
  };

  for (let daysAgo = 120; daysAgo >= 0; daysAgo--) {
    const date = isoDaysAgo(daysAgo);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    // Every day of the last ten is billed (a live streak); earlier days are busy but not perfect.
    const busy = daysAgo <= 9 ? 1 : weekday === 5 ? 0.3 : 0.62 + (120 - daysAgo) / 600;
    let count = rnd() < busy ? 1 : 0;
    if (count && rnd() < 0.35 + (120 - daysAgo) / 400) count += 1;
    if (daysAgo === 0) count = 2;

    for (let n = 0; n < count; n++) {
      const customer = pick(customers);
      const walkIn = customer === C2;
      const lines = pick(bundles)
        .filter(() => rnd() < 0.85)
        .slice(0, walkIn ? 2 : 3);
      if (!lines.length) lines.push(P1);
      const items = lines.map((pid) => ({ product_id: pid, quantity: qtyFor(pid, walkIn) }));
      for (const it of items) {
        const p = product(it.product_id);
        if (!p.is_service && (s.stock[it.product_id] ?? 0) < it.quantity) {
          restock(it.product_id, it.quantity, date);
        }
      }
      const inv = demoDb.createInvoice({
        customer_id: customer,
        invoice_date: date,
        user_id: DEMO_ADMIN.id,
        prefix: DEFAULT_INVOICE_PREFIX,
        items: items.map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          unit: product(it.product_id).unit,
          unit_price: product(it.product_id).base_price,
          price_overridden: false,
        })),
      });
      const hour = 9 + Math.floor(rnd() * 9);
      const stamp = `${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00.000Z`;
      const stored = s.invoices.find((x) => x.id === inv.id)!;
      stored.created_at = stamp;
      for (const m of s.movements) if (m.reference === inv.invoice_number) m.created_at = stamp;

      // Older bills are mostly settled; recent ones are still being collected.
      const r = rnd();
      const overdueStory = daysAgo === 74 || daysAgo === 96 || daysAgo === 45;
      const pay: "full" | "part" | "none" = overdueStory
        ? "none"
        : daysAgo > 30
          ? r < 0.88 ? "full" : r < 0.95 ? "part" : "none"
          : daysAgo > 10
            ? r < 0.62 ? "full" : r < 0.82 ? "part" : "none"
            : r < 0.35 ? "full" : r < 0.55 ? "part" : "none";
      if (walkIn) {
        // Counter sales are paid on the spot
        demoDb.recordPayment({
          customer_id: customer,
          invoice_id: inv.id,
          amount: inv.grand_total,
          payment_date: date,
          payment_mode: "cash",
          user_id: DEMO_ADMIN.id,
        }).created_at = stamp;
        continue;
      }
      if (pay === "none") continue;
      const amount = pay === "full" ? inv.grand_total : Math.round(inv.grand_total * 0.5 * 100) / 100;
      const payDate = isoDaysAgo(Math.max(0, daysAgo - Math.floor(rnd() * 6)));
      const payment = demoDb.recordPayment({
        customer_id: customer,
        invoice_id: inv.id,
        amount,
        payment_date: payDate,
        payment_mode: pick(modes),
        user_id: DEMO_ADMIN.id,
      });
      payment.created_at = `${payDate}T15:00:00.000Z`;
    }
  }

  // Leave a couple of shelves running low so stock alerts have something to say.
  const lowStock: [string, number][] = [
    [P9, 6],
    [P7, 4],
    [P12, 0],
  ];
  for (const [pid, qty] of lowStock) {
    demoDb.adjust({
      product_id: pid,
      new_quantity: qty,
      reason: "Physical count (demo)",
      user_id: DEMO_ADMIN.id,
      current_stock: s.stock[pid] ?? 0,
    });
  }

  // A few invoices were already emailed, so the email log is not empty.
  for (const inv of s.invoices.slice(0, 6)) {
    const customer = s.customers.find((c) => c.id === inv.customer_id);
    if (!customer?.email) continue;
    inv.last_emailed_at = new Date(new Date(inv.created_at).getTime() + 4 * 60_000).toISOString();
    inv.email_count = 1;
    s.invoiceEmails.unshift({
      id: id(),
      invoice_id: inv.id,
      customer_id: customer.id,
      kind: "invoice",
      to_email: customer.email,
      cc: null,
      subject: `Tax invoice ${inv.invoice_number} from ${s.organization.brand_name}`,
      status: "sent",
      provider: "demo",
      provider_message_id: null,
      error: null,
      sent_by: DEMO_ADMIN.id,
      created_at: inv.last_emailed_at,
    });
  }
}

function withStock(p: Product): Product {
  return { ...p, current_stock: getStore().stock[p.id] ?? 0 };
}

export const demoDb = {
  getProducts(): Product[] {
    return getStore()
      .products.map(withStock)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getProduct(productId: string): Product | null {
    const p = getStore().products.find((x) => x.id === productId);
    return p ? withStock(p) : null;
  },

  upsertProduct(payload: Partial<Product> & { name: string }): Product {
    const s = getStore();
    if (payload.id) {
      const idx = s.products.findIndex((p) => p.id === payload.id);
      if (idx < 0) throw new Error("Product not found");
      const old = s.products[idx];
      if (payload.base_price != null && payload.base_price !== old.base_price) {
        s.priceHistory.unshift({
          id: id(),
          product_id: old.id,
          old_price: old.base_price,
          new_price: payload.base_price,
          changed_by: DEMO_ADMIN.id,
          changed_at: now(),
        });
      }
      const rest = { ...payload } as Record<string, unknown>;
      delete rest.current_stock;
      delete rest.created_at;
      s.products[idx] = {
        ...old,
        ...(rest as Partial<Product>),
        updated_at: now(),
      };
      return withStock(s.products[idx]);
    }
    const product: Product = {
      id: id(),
      name: payload.name,
      category: payload.category ?? "Other",
      subcategory: payload.subcategory ?? null,
      unit: payload.unit ?? "pcs",
      variant: payload.variant ?? null,
      sku: payload.sku ?? `SKU-${Date.now()}`,
      pack_size: payload.pack_size ?? "500ml",
      hsn_code: payload.hsn_code ?? "34013000",
      base_price: payload.base_price ?? 0,
      manufacturing_cost: payload.manufacturing_cost ?? null,
      vat_rate: payload.vat_rate ?? 5,
      vat_category: payload.vat_category ?? "standard",
      reorder_threshold: payload.reorder_threshold ?? 10,
      is_active: payload.is_active ?? true,
      image_url: payload.image_url ?? null,
      barcode: payload.barcode ?? null,
      mfg_date: payload.mfg_date || null,
      exp_date: payload.exp_date || null,
      imei_serial: payload.imei_serial || null,
      batch_number: payload.batch_number || null,
      is_service: Boolean(payload.is_service),
      created_at: now(),
      updated_at: now(),
    };
    s.products.push(product);
    s.stock[product.id] = 0;
    return withStock(product);
  },

  deleteProduct(productId: string) {
    const s = getStore();
    s.products = s.products.filter((p) => p.id !== productId);
    delete s.stock[productId];
  },

  getPriceHistory(productId: string) {
    return getStore().priceHistory.filter((h) => h.product_id === productId);
  },

  getMovements(productId?: string): StockMovement[] {
    const s = getStore();
    return s.movements
      .filter((m) => !productId || m.product_id === productId)
      .map((m) => ({
        ...m,
        product: s.products.find((p) => p.id === m.product_id),
        user: s.users.find((u) => u.id === m.created_by) ?? DEMO_ADMIN,
        editor: m.edited_by
          ? s.users.find((u) => u.id === m.edited_by) ?? DEMO_ADMIN
          : undefined,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  updateMovement(input: {
    id: string;
    quantity: number;
    reason?: string | null;
    reference?: string | null;
    batch_number?: string | null;
    mfg_date?: string | null;
    exp_date?: string | null;
    edited_by: string;
  }) {
    const s = getStore();
    const m = s.movements.find((x) => x.id === input.id);
    if (!m) throw new Error("Movement not found");

    const oldQty = m.quantity;
    let nextQty = input.quantity;
    if (m.movement_type === "in") nextQty = Math.abs(input.quantity);
    if (m.movement_type === "out") nextQty = -Math.abs(input.quantity);

    s.stock[m.product_id] = (s.stock[m.product_id] ?? 0) - oldQty + nextQty;
    m.quantity = nextQty;
    if (input.reason !== undefined) m.reason = input.reason;
    if (input.reference !== undefined) m.reference = input.reference;
    if (input.batch_number !== undefined) m.batch_number = input.batch_number;
    if (input.mfg_date !== undefined) m.mfg_date = input.mfg_date;
    if (input.exp_date !== undefined) m.exp_date = input.exp_date;
    m.edited_at = now();
    m.edited_by = input.edited_by;
    return m;
  },

  stockIn(input: {
    product_id: string;
    quantity: number;
    source: "production" | "purchase";
    batch_number?: string | null;
    mfg_date?: string | null;
    exp_date?: string | null;
    notes?: string | null;
    user_id: string;
    warehouse_id?: string | null;
  }) {
    const s = getStore();
    s.stock[input.product_id] = (s.stock[input.product_id] ?? 0) + input.quantity;
    s.movements.unshift({
      id: id(),
      product_id: input.product_id,
      movement_type: "in",
      quantity: input.quantity,
      reference: input.source === "production" ? "Production batch" : "Purchase",
      reason: input.notes ?? null,
      batch_number: input.batch_number ?? null,
      mfg_date: input.mfg_date || null,
      exp_date: input.exp_date || null,
      created_by: input.user_id,
      created_at: now(),
      warehouse_id: input.warehouse_id ?? s.warehouses.find((w) => w.is_default)?.id ?? null,
    });
  },

  stockOut(input: {
    product_id: string;
    quantity: number;
    reason: string;
    notes?: string | null;
    user_id: string;
    warehouse_id?: string | null;
  }) {
    const s = getStore();
    const current = s.stock[input.product_id] ?? 0;
    if (current < input.quantity) throw new Error("Insufficient stock");
    s.stock[input.product_id] = current - input.quantity;
    s.movements.unshift({
      id: id(),
      product_id: input.product_id,
      movement_type: "out",
      quantity: -Math.abs(input.quantity),
      reference: "Manual out",
      reason: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
      batch_number: null,
      mfg_date: null,
      exp_date: null,
      created_by: input.user_id,
      created_at: now(),
      warehouse_id: input.warehouse_id ?? s.warehouses.find((w) => w.is_default)?.id ?? null,
    });
  },

  adjust(input: {
    product_id: string;
    new_quantity: number;
    reason: string;
    user_id: string;
    current_stock: number;
    warehouse_id?: string | null;
  }) {
    const delta = input.new_quantity - input.current_stock;
    if (delta === 0) return;
    const s = getStore();
    s.stock[input.product_id] = input.new_quantity;
    s.movements.unshift({
      id: id(),
      product_id: input.product_id,
      movement_type: "adjustment",
      quantity: delta,
      reference: "Physical stock count",
      reason: input.reason,
      batch_number: null,
      mfg_date: null,
      exp_date: null,
      created_by: input.user_id,
      created_at: now(),
      warehouse_id: input.warehouse_id ?? s.warehouses.find((w) => w.is_default)?.id ?? null,
    });
  },

  getCustomers(): Customer[] {
    return [...getStore().customers].sort((a, b) => a.name.localeCompare(b.name));
  },

  getCustomer(customerId: string): Customer | undefined {
    return getStore().customers.find((c) => c.id === customerId);
  },

  getPayments(customerId?: string): Payment[] {
    const all = getStore().payments;
    return customerId ? all.filter((p) => p.customer_id === customerId) : [...all];
  },

  recordPayment(input: {
    customer_id: string;
    invoice_id?: string | null;
    amount: number;
    payment_date: string;
    payment_mode: PaymentMode;
    notes?: string | null;
    user_id: string;
  }): Payment {
    const s = getStore();
    const customer = s.customers.find((c) => c.id === input.customer_id);
    if (!customer) throw new Error("Customer not found");
    if (input.amount <= 0) throw new Error("amount must be > 0");

    let invoice: Invoice | undefined;
    if (input.invoice_id) {
      invoice = s.invoices.find((i) => i.id === input.invoice_id);
      if (!invoice) throw new Error("Invoice not found");
      if (invoice.customer_id !== input.customer_id) {
        throw new Error("Invoice does not belong to this customer");
      }
      if (invoice.status === "cancelled") {
        throw new Error("Cannot record payment on a cancelled invoice");
      }
    }

    const payment: Payment = {
      id: id(),
      customer_id: input.customer_id,
      invoice_id: input.invoice_id ?? null,
      amount: input.amount,
      payment_date: input.payment_date || today(),
      payment_mode: input.payment_mode,
      notes: input.notes ?? null,
      created_by: input.user_id,
      created_at: now(),
      invoice: invoice
        ? { invoice_number: invoice.invoice_number, grand_total: invoice.grand_total }
        : null,
      customer: { name: customer.name, phone: customer.phone },
    };
    s.payments.unshift(payment);

    if (invoice) {
      const newPaid = Math.min(
        invoice.grand_total,
        (invoice.amount_paid ?? 0) + input.amount
      );
      invoice.amount_paid = newPaid;
      invoice.status = invoiceStatusFromPaid(newPaid, invoice.grand_total);
    }

    return payment;
  },

  upsertCustomer(
    payload: Partial<Customer> & { name: string; state: string; customer_type: "b2b" | "b2c" }
  ): Customer {
    const s = getStore();
    if (payload.id) {
      const idx = s.customers.findIndex((c) => c.id === payload.id);
      if (idx < 0) throw new Error("Customer not found");
      const rest = { ...payload } as Record<string, unknown>;
      delete rest.created_at;
      s.customers[idx] = { ...s.customers[idx], ...(rest as Partial<Customer>) };
      return s.customers[idx];
    }
    const customer: Customer = {
      id: id(),
      name: payload.name,
      phone: payload.phone || null,
      email: payload.email || null,
      billing_address: payload.billing_address || null,
      state: payload.state,
      tax_id: payload.tax_id || null,
      country: payload.country || "AE",
      customer_type: payload.customer_type,
      created_at: now(),
    };
    s.customers.push(customer);
    return customer;
  },

  deleteCustomer(customerId: string) {
    getStore().customers = getStore().customers.filter((c) => c.id !== customerId);
  },

  getInvoices(): Invoice[] {
    const s = getStore();
    return [...s.invoices]
      .map((inv) => ({
        ...inv,
        customer: s.customers.find((c) => c.id === inv.customer_id),
        creator: s.users.find((u) => u.id === inv.created_by) ?? DEMO_ADMIN,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  getInvoice(invoiceId: string): Invoice | null {
    const s = getStore();
    const inv = s.invoices.find((i) => i.id === invoiceId);
    if (!inv) return null;
    return {
      ...inv,
      customer: s.customers.find((c) => c.id === inv.customer_id),
      creator: s.users.find((u) => u.id === inv.created_by) ?? DEMO_ADMIN,
      items: (inv.items ?? []).map((it) => ({
        ...it,
        product: s.products.find((p) => p.id === it.product_id),
      })),
    };
  },

  createInvoice(payload: CreateInvoicePayload & { user_id: string; prefix: string }): Invoice {
    const s = getStore();
    const customer = s.customers.find((c) => c.id === payload.customer_id);
    if (!customer) throw new Error("Customer not found");

    for (const item of payload.items) {
      if (!item.product_id) continue;
      const product = s.products.find((p) => p.id === item.product_id);
      if (product?.is_service) continue;
      const stock = s.stock[item.product_id] ?? 0;
      if (stock < item.quantity) {
        throw new Error(
          `Insufficient stock for ${product?.name ?? "product"} (have ${stock}, need ${item.quantity})`
        );
      }
    }

    const lineInputs = payload.items.map((item) => {
      const product = s.products.find((p) => p.id === item.product_id)!;
      return {
        quantity: item.quantity,
        unitPrice: item.unit_price,
        vatRate: product.vat_rate,
        vatCategory: product.vat_category,
      };
    });
    const totals = calcInvoiceTotals(lineInputs, demoCalcOptions(payload));

    s.invoiceSeq += 1;
    const fy = numberingPeriodLabel(s.organization.numbering_period ?? "calendar");
    const invoiceNumber = `${payload.prefix || DEFAULT_INVOICE_PREFIX}/${fy}/${String(s.invoiceSeq).padStart(4, "0")}`;

    const invoiceId = id();
    const items: InvoiceItem[] = payload.items.map((item, idx) => {
      const product = s.products.find((p) => p.id === item.product_id)!;
      const line = totals.lines[idx];
      return {
        id: id(),
        invoice_id: invoiceId,
        product_id: item.product_id,
        hsn_code: product.hsn_code,
        quantity: item.quantity,
        unit: item.unit ?? product.unit ?? "pcs",
        unit_price: item.unit_price,
        price_overridden: item.price_overridden,
        taxable_value: line.taxableValue,
        vat_rate: line.vatRate,
        vat_amount: line.vatAmount,
        vat_category: line.vatCategory,
        line_total: line.lineTotal,
        imei_serial: item.imei_serial ?? null,
        batch_number: item.batch_number ?? null,
        variant_tag: item.variant_tag ?? null,
        check_in_date: item.check_in_date ?? null,
        check_out_date: item.check_out_date ?? null,
        guest_id_proof: item.guest_id_proof ?? null,
        product,
      };
    });

    const invoice: Invoice = {
      id: invoiceId,
      invoice_number: invoiceNumber,
      customer_id: payload.customer_id,
      invoice_date: payload.invoice_date || today(),
      subtotal: totals.subtotal,
      total_vat: totals.totalVat,
      round_off: totals.roundOff,
      grand_total: totals.grandTotal,
      currency: s.organization.currency,
      prices_include_vat: !!payload.prices_include_vat,
      ...demoTaxFields(payload),
      status: "issued",
      amount_paid: 0,
      cancelled_reason: null,
      notes: payload.notes ?? null,
      created_by: payload.user_id,
      created_at: now(),
      warehouse_id: payload.warehouse_id ?? null,
      customer,
      creator: DEMO_ADMIN,
      items,
    };

    s.invoices.unshift(invoice);

    for (const item of payload.items) {
      if (!item.product_id) continue;
      const product = s.products.find((p) => p.id === item.product_id);
      if (product?.is_service) continue;
      s.stock[item.product_id] = (s.stock[item.product_id] ?? 0) - item.quantity;
      s.movements.unshift({
        id: id(),
        product_id: item.product_id,
        movement_type: "out",
        quantity: -Math.abs(item.quantity),
        reference: invoiceNumber,
        reason: `Invoice ${invoiceNumber}`,
        batch_number: null,
        mfg_date: null,
        exp_date: null,
        created_by: payload.user_id,
        created_at: now(),
        warehouse_id: payload.warehouse_id ?? null,
      });
    }

    return invoice;
  },

  updateInvoice(
    invoiceId: string,
    payload: CreateInvoicePayload & { user_id: string; force?: boolean }
  ): Invoice {
    const s = getStore();
    const inv = s.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new Error("Invoice not found");

    if (inv.status !== "issued" && !payload.force) {
      throw new Error(`Only issued invoices can be edited (status=${inv.status})`);
    }

    const customer = s.customers.find((c) => c.id === payload.customer_id);
    if (!customer) throw new Error("Customer not found");

    // Reverse old invoice stock movements (outs + any void restores)
    for (const item of inv.items ?? []) {
      if (!item.product_id) continue;
      const product = s.products.find((p) => p.id === item.product_id);
      if (product?.is_service) continue;
      s.stock[item.product_id] = (s.stock[item.product_id] ?? 0) + item.quantity;
    }
    s.movements = s.movements.filter((m) => {
      if (m.reference !== inv.invoice_number) return true;
      const reason = m.reason ?? "";
      if (m.movement_type === "out" && reason.startsWith("Invoice ")) return false;
      if (m.movement_type === "in" && reason.startsWith("Void restore")) {
        // undo restore effect on stock if still present
        s.stock[m.product_id] = (s.stock[m.product_id] ?? 0) - Math.abs(m.quantity);
        return false;
      }
      return true;
    });

    for (const item of payload.items) {
      if (!item.product_id) continue;
      const product = s.products.find((p) => p.id === item.product_id);
      if (product?.is_service) continue;
      const stock = s.stock[item.product_id] ?? 0;
      if (stock < item.quantity) {
        throw new Error(
          `Insufficient stock for ${product?.name ?? "product"} (have ${stock}, need ${item.quantity})`
        );
      }
    }

    const lineInputs = payload.items.map((item) => {
      const product = s.products.find((p) => p.id === item.product_id)!;
      return {
        quantity: item.quantity,
        unitPrice: item.unit_price,
        vatRate: product.vat_rate,
        vatCategory: product.vat_category,
      };
    });
    const totals = calcInvoiceTotals(lineInputs, demoCalcOptions(payload));

    const items: InvoiceItem[] = payload.items.map((item, idx) => {
      const product = s.products.find((p) => p.id === item.product_id)!;
      const line = totals.lines[idx];
      return {
        id: id(),
        invoice_id: inv.id,
        product_id: item.product_id,
        hsn_code: product.hsn_code,
        quantity: item.quantity,
        unit: item.unit ?? product.unit ?? "pcs",
        unit_price: item.unit_price,
        price_overridden: item.price_overridden,
        taxable_value: line.taxableValue,
        vat_rate: line.vatRate,
        vat_amount: line.vatAmount,
        vat_category: line.vatCategory,
        line_total: line.lineTotal,
        imei_serial: item.imei_serial ?? null,
        batch_number: item.batch_number ?? null,
        variant_tag: item.variant_tag ?? null,
        check_in_date: item.check_in_date ?? null,
        check_out_date: item.check_out_date ?? null,
        guest_id_proof: item.guest_id_proof ?? null,
        product,
      };
    });

    inv.customer_id = payload.customer_id;
    inv.invoice_date = payload.invoice_date || inv.invoice_date;
    inv.subtotal = totals.subtotal;
    inv.total_vat = totals.totalVat;
    inv.prices_include_vat = !!payload.prices_include_vat;
    inv.round_off = totals.roundOff;
    inv.grand_total = totals.grandTotal;
    inv.notes = payload.notes ?? null;
    inv.edited_at = now();
    inv.edited_by = payload.user_id;
    inv.items = items;
    inv.customer = customer;
    Object.assign(inv, demoTaxFields(payload));
    if (payload.warehouse_id !== undefined) {
      inv.warehouse_id = payload.warehouse_id ?? null;
    }

    for (const item of payload.items) {
      if (!item.product_id) continue;
      const product = s.products.find((p) => p.id === item.product_id);
      if (product?.is_service) continue;
      s.stock[item.product_id] = (s.stock[item.product_id] ?? 0) - item.quantity;
      s.movements.unshift({
        id: id(),
        product_id: item.product_id,
        movement_type: "out",
        quantity: -Math.abs(item.quantity),
        reference: inv.invoice_number,
        reason: `Invoice ${inv.invoice_number}`,
        batch_number: null,
        mfg_date: null,
        exp_date: null,
        created_by: payload.user_id,
        created_at: now(),
        warehouse_id: inv.warehouse_id ?? null,
      });
    }

    return this.getInvoice(invoiceId)!;
  },

  updateInvoiceStatus(input: {
    id: string;
    status: "issued" | "paid" | "partially_paid" | "cancelled";
    cancelled_reason?: string;
    user_id: string;
    restoreStock?: boolean;
  }) {
    const s = getStore();
    const inv = s.invoices.find((i) => i.id === input.id);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "cancelled") throw new Error("Invoice is already cancelled");

    if (input.status === "paid") {
      const remaining = Math.max(0, inv.grand_total - (inv.amount_paid ?? 0));
      if (remaining > 0) {
        this.recordPayment({
          customer_id: inv.customer_id,
          invoice_id: inv.id,
          amount: remaining,
          payment_date: today(),
          payment_mode: "cash",
          notes: "Marked paid",
          user_id: input.user_id,
        });
        return;
      }
      inv.amount_paid = inv.grand_total;
    }

    inv.status = input.status;
    inv.cancelled_reason =
      input.status === "cancelled" ? input.cancelled_reason ?? null : null;

    if (input.status === "cancelled" && input.restoreStock) {
      for (const item of inv.items ?? []) {
        if (!item.product_id) continue;
        s.stock[item.product_id] = (s.stock[item.product_id] ?? 0) + item.quantity;
        s.movements.unshift({
          id: id(),
          product_id: item.product_id,
          movement_type: "in",
          quantity: Math.abs(item.quantity),
          reference: inv.invoice_number,
          reason: `Void restore - ${input.cancelled_reason ?? ""}`,
          batch_number: null,
          mfg_date: null,
          exp_date: null,
          created_by: input.user_id,
          created_at: now(),
          warehouse_id: inv.warehouse_id ?? null,
        });
      }
    }
  },

  getWarehouses(): Warehouse[] {
    return [...getStore().warehouses].sort((a, b) => a.name.localeCompare(b.name));
  },

  upsertWarehouse(payload: Partial<Warehouse> & { name: string; code: string }): Warehouse {
    const s = getStore();
    if (payload.is_default) {
      for (const w of s.warehouses) {
        if (w.id !== payload.id) w.is_default = false;
      }
    }
    if (payload.id) {
      const idx = s.warehouses.findIndex((w) => w.id === payload.id);
      if (idx < 0) throw new Error("Warehouse not found");
      const rest = { ...payload } as Record<string, unknown>;
      delete rest.created_at;
      s.warehouses[idx] = { ...s.warehouses[idx], ...(rest as Partial<Warehouse>) };
      return s.warehouses[idx];
    }
    const warehouse: Warehouse = {
      id: id(),
      name: payload.name,
      code: payload.code,
      address: payload.address ?? null,
      is_default: payload.is_default ?? false,
      is_active: payload.is_active ?? true,
      created_at: now(),
    };
    s.warehouses.push(warehouse);
    return warehouse;
  },

  getSuppliers(): Supplier[] {
    return [...getStore().suppliers].sort((a, b) => a.name.localeCompare(b.name));
  },

  upsertSupplier(payload: Partial<Supplier> & { name: string }): Supplier {
    const s = getStore();
    if (payload.id) {
      const idx = s.suppliers.findIndex((x) => x.id === payload.id);
      if (idx < 0) throw new Error("Supplier not found");
      const rest = { ...payload } as Record<string, unknown>;
      delete rest.created_at;
      s.suppliers[idx] = { ...s.suppliers[idx], ...(rest as Partial<Supplier>) };
      return s.suppliers[idx];
    }
    const supplier: Supplier = {
      id: id(),
      name: payload.name,
      phone: payload.phone || null,
      email: payload.email || null,
      tax_id: payload.tax_id || null,
      country: payload.country || "AE",
      address: payload.address || null,
      state: payload.state || "",
      notes: payload.notes || null,
      is_active: payload.is_active ?? true,
      created_at: now(),
    };
    s.suppliers.push(supplier);
    return supplier;
  },

  removeSupplier(supplierId: string) {
    getStore().suppliers = getStore().suppliers.filter((x) => x.id !== supplierId);
  },

  getPurchases(): Purchase[] {
    const s = getStore();
    return [...s.purchases]
      .map((p) => ({
        ...p,
        supplier: s.suppliers.find((x) => x.id === p.supplier_id),
        warehouse: p.warehouse_id
          ? s.warehouses.find((w) => w.id === p.warehouse_id)
          : undefined,
        items: (p.items ?? []).map((it) => ({
          ...it,
          product: s.products.find((pr) => pr.id === it.product_id),
        })),
      }))
      .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));
  },

  createPurchase(payload: {
    supplier_id: string;
    warehouse_id?: string | null;
    purchase_date: string;
    notes?: string;
    user_id: string;
    items: {
      product_id: string;
      quantity: number;
      unit_cost: number;
      batch_number?: string | null;
      mfg_date?: string | null;
      exp_date?: string | null;
    }[];
  }): Purchase {
    const s = getStore();
    const supplier = s.suppliers.find((x) => x.id === payload.supplier_id);
    if (!supplier) throw new Error("Supplier not found");

    for (const item of payload.items) {
      const product = s.products.find((p) => p.id === item.product_id);
      if (!product) throw new Error("Product not found");
    }

    const lineInputs = payload.items.map((item) => {
      const product = s.products.find((p) => p.id === item.product_id)!;
      return {
        quantity: item.quantity,
        unitPrice: item.unit_cost,
        vatRate: product.vat_rate,
        vatCategory: product.vat_category,
      };
    });
    const ctx = resolveTaxContext({
      sellerCountry: s.organization.country,
      sellerState: s.organization.state,
      sellerTaxId: s.organization.tax_id,
      currency: s.organization.currency,
      customer: supplier,
      treatment: "domestic",
    });
    const totals = calcInvoiceTotals(lineInputs, calcOptionsFor(ctx, false));

    s.purchaseSeq += 1;
    const fy = numberingPeriodLabel(s.organization.numbering_period ?? "calendar");
    const purchaseNumber = `PO/${fy}/${String(s.purchaseSeq).padStart(4, "0")}`;
    const purchaseId = id();
    const warehouseId = payload.warehouse_id || null;

    const items: PurchaseItem[] = payload.items.map((item, idx) => {
      const product = s.products.find((p) => p.id === item.product_id)!;
      const line = totals.lines[idx];
      return {
        id: id(),
        purchase_id: purchaseId,
        product_id: item.product_id,
        hsn_code: product.hsn_code,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        taxable_value: line.taxableValue,
        vat_rate: line.vatRate,
        vat_amount: line.vatAmount,
        line_total: line.lineTotal,
        batch_number: item.batch_number || null,
        mfg_date: item.mfg_date || null,
        exp_date: item.exp_date || null,
        product,
      };
    });

    const purchase: Purchase = {
      id: purchaseId,
      purchase_number: purchaseNumber,
      supplier_id: payload.supplier_id,
      warehouse_id: warehouseId,
      purchase_date: payload.purchase_date || today(),
      subtotal: totals.subtotal,
      total_vat: totals.totalVat,
      round_off: totals.roundOff,
      grand_total: totals.grandTotal,
      currency: s.organization.currency,
      tax_country: ctx.country.code,
      tax_split: ctx.split,
      status: "received",
      notes: payload.notes || null,
      created_by: payload.user_id,
      created_at: now(),
      supplier,
      warehouse: warehouseId
        ? s.warehouses.find((w) => w.id === warehouseId)
        : undefined,
      items,
    };

    s.purchases.unshift(purchase);

    for (const item of payload.items) {
      if (!item.product_id) continue;
      s.stock[item.product_id] = (s.stock[item.product_id] ?? 0) + item.quantity;
      s.movements.unshift({
        id: id(),
        product_id: item.product_id,
        movement_type: "in",
        quantity: Math.abs(item.quantity),
        reference: purchaseNumber,
        reason: `Purchase ${purchaseNumber}`,
        batch_number: item.batch_number || null,
        mfg_date: item.mfg_date || null,
        exp_date: item.exp_date || null,
        created_by: payload.user_id,
        created_at: now(),
        warehouse_id: warehouseId,
      });
    }

    return purchase;
  },

  getCreditNotes(): CreditNote[] {
    const s = getStore();
    return [...s.creditNotes]
      .map((cn) => ({
        ...cn,
        customer: s.customers.find((c) => c.id === cn.customer_id),
        invoice: s.invoices.find((i) => i.id === cn.invoice_id),
        items: (cn.items ?? []).map((it) => ({
          ...it,
          product: s.products.find((p) => p.id === it.product_id),
        })),
      }))
      .sort((a, b) => b.credit_date.localeCompare(a.credit_date));
  },

  createCreditNote(payload: {
    invoice_id: string;
    credit_date: string;
    reason?: string;
    user_id: string;
    items: {
      product_id: string;
      quantity: number;
      unit_price: number;
    }[];
  }): CreditNote {
    const s = getStore();
    const inv = s.invoices.find((i) => i.id === payload.invoice_id);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "cancelled") {
      throw new Error("Cannot credit a cancelled invoice");
    }

    const invItems = inv.items ?? [];
    for (const item of payload.items) {
      const orig = invItems.find((i) => i.product_id === item.product_id);
      if (!orig) throw new Error("Product not on original invoice");
      if (item.quantity > orig.quantity) {
        throw new Error(
          `Return qty for ${orig.product?.name ?? "product"} exceeds invoiced qty`
        );
      }
    }

    const customer = s.customers.find((c) => c.id === inv.customer_id);
    const lineInputs = payload.items.map((item) => {
      const orig = invItems.find((i) => i.product_id === item.product_id)!;
      return {
        quantity: item.quantity,
        unitPrice: item.unit_price,
        vatRate: orig.vat_rate,
        vatCategory: normalizeVatCategory(orig.vat_category, orig.vat_rate),
      };
    });
    const totals = calcInvoiceTotals(lineInputs, calcOptionsForDocument(inv, !!inv.prices_include_vat));

    s.creditNoteSeq += 1;
    const fy = numberingPeriodLabel(s.organization.numbering_period ?? "calendar");
    const cnNumber = `CN/${fy}/${String(s.creditNoteSeq).padStart(4, "0")}`;
    const cnId = id();

    const items: CreditNoteItem[] = payload.items.map((item, idx) => {
      const orig = invItems.find((i) => i.product_id === item.product_id)!;
      const line = totals.lines[idx];
      return {
        id: id(),
        credit_note_id: cnId,
        product_id: item.product_id,
        hsn_code: orig.hsn_code,
        quantity: item.quantity,
        unit_price: item.unit_price,
        taxable_value: line.taxableValue,
        vat_rate: line.vatRate,
        vat_amount: line.vatAmount,
        line_total: line.lineTotal,
        product: s.products.find((p) => p.id === item.product_id),
      };
    });

    const cn: CreditNote = {
      id: cnId,
      credit_note_number: cnNumber,
      invoice_id: inv.id,
      customer_id: inv.customer_id,
      warehouse_id: inv.warehouse_id ?? null,
      credit_date: payload.credit_date || today(),
      subtotal: totals.subtotal,
      total_vat: totals.totalVat,
      round_off: totals.roundOff,
      grand_total: totals.grandTotal,
      currency: inv.currency,
      ...copiedTaxFields(inv),
      reason: payload.reason || null,
      status: "issued",
      created_by: payload.user_id,
      created_at: now(),
      invoice: inv,
      customer,
      items,
    };

    s.creditNotes.unshift(cn);

    for (const item of payload.items) {
      if (!item.product_id) continue;
      s.stock[item.product_id] = (s.stock[item.product_id] ?? 0) + item.quantity;
      s.movements.unshift({
        id: id(),
        product_id: item.product_id,
        movement_type: "in",
        quantity: Math.abs(item.quantity),
        reference: cnNumber,
        reason: `Credit note ${cnNumber} (return)`,
        batch_number: null,
        mfg_date: null,
        exp_date: null,
        created_by: payload.user_id,
        created_at: now(),
        warehouse_id: inv.warehouse_id ?? null,
      });
    }

    return cn;
  },

  getRecurringInvoices(): RecurringInvoice[] {
    const s = getStore();
    return s.recurringInvoices.map((r) => {
      const c = s.customers.find((x) => x.id === r.customer_id);
      return { ...r, customer: c ? { id: c.id, name: c.name } : null };
    });
  },

  upsertRecurringInvoice(input: Partial<RecurringInvoice> & { id?: string }): RecurringInvoice {
    const s = getStore();
    if (input.id) {
      const row = s.recurringInvoices.find((r) => r.id === input.id);
      if (!row) throw new Error("Recurring invoice not found");
      Object.assign(row, input);
      return { ...row };
    }
    const row: RecurringInvoice = {
      id: id(),
      customer_id: input.customer_id ?? "",
      source_invoice_id: input.source_invoice_id ?? null,
      name: input.name ?? "",
      frequency: input.frequency ?? "monthly",
      next_run_date: input.next_run_date ?? now().slice(0, 10),
      end_date: input.end_date ?? null,
      items: input.items ?? [],
      prices_include_vat: !!input.prices_include_vat,
      warehouse_id: input.warehouse_id ?? null,
      notes: input.notes ?? null,
      active: input.active ?? true,
      last_invoice_id: null,
      last_run_at: null,
      run_count: 0,
      created_at: now(),
    };
    s.recurringInvoices.push(row);
    return { ...row };
  },

  deleteRecurringInvoice(recurringId: string) {
    const s = getStore();
    s.recurringInvoices = s.recurringInvoices.filter((r) => r.id !== recurringId);
  },

  getProductCategories(): ProductCategoryRow[] {
    return [...getStore().productCategories];
  },

  upsertProductCategory(input: { id?: string; name: string; parent_id?: string | null }): ProductCategoryRow {
    const s = getStore();
    const name = input.name.trim();
    if (!name) throw new Error("Name is required");
    const parentId = input.parent_id ?? null;
    const clash = s.productCategories.find(
      (c) => c.id !== input.id && c.parent_id === parentId && c.name.toLowerCase() === name.toLowerCase()
    );
    if (clash) throw new Error(`"${name}" already exists here`);
    if (input.id) {
      const row = s.productCategories.find((c) => c.id === input.id);
      if (!row) throw new Error("Category not found");
      const oldName = row.name;
      row.name = name;
      // Keep products pointing at the renamed category / subcategory
      const parent = row.parent_id ? s.productCategories.find((c) => c.id === row.parent_id) : null;
      for (const p of s.products) {
        if (!row.parent_id && p.category === oldName) p.category = name;
        if (row.parent_id && parent && p.category === parent.name && p.subcategory === oldName) p.subcategory = name;
      }
      return { ...row };
    }
    const row: ProductCategoryRow = {
      id: id(),
      name,
      parent_id: parentId,
      sort_order: s.productCategories.filter((c) => c.parent_id === parentId).length,
      created_at: now(),
    };
    s.productCategories.push(row);
    return { ...row };
  },

  deleteProductCategory(categoryId: string) {
    const s = getStore();
    s.productCategories = s.productCategories.filter(
      (c) => c.id !== categoryId && c.parent_id !== categoryId
    );
  },

  getInvoiceEmails(invoiceId?: string): InvoiceEmailLog[] {
    const all = getStore().invoiceEmails;
    return (invoiceId ? all.filter((e) => e.invoice_id === invoiceId) : all).map((e) => ({ ...e }));
  },

  /** Demo "send": records the email exactly like the real API would, nothing leaves the browser. */
  logInvoiceEmail(input: Omit<InvoiceEmailLog, "id" | "created_at" | "provider_message_id" | "error" | "status" | "provider">) {
    const s = getStore();
    const row: InvoiceEmailLog = {
      ...input,
      id: id(),
      status: "sent",
      provider: "demo",
      provider_message_id: null,
      error: null,
      created_at: now(),
    };
    s.invoiceEmails.unshift(row);
    const inv = input.invoice_id ? s.invoices.find((i) => i.id === input.invoice_id) : null;
    if (inv) {
      inv.last_emailed_at = row.created_at;
      inv.email_count = (inv.email_count ?? 0) + 1;
    }
    return row;
  },

  getCompany(): CompanySettings {
    return organizationToCompanySettings(getStore().organization);
  },

  updateCompany(payload: Partial<CompanySettings> & { id: string }): CompanySettings {
    const org = this.updateOrganization({
      id: payload.id,
      ...companySettingsToOrganizationPatch(payload),
    });
    return organizationToCompanySettings(org);
  },

  getOrganization(): Organization {
    return { ...getStore().organization };
  },

  updateOrganization(payload: Partial<Organization> & { id: string }): Organization {
    const s = getStore();
    s.organization = { ...s.organization, ...payload, updated_at: now() };
    s.company = organizationToCompanySettings(s.organization);
    return { ...s.organization };
  },

  getUsers(): AppUser[] {
    return [...getStore().users];
  },

  getProductCosts(productId?: string): ProductCost[] {
    const s = getStore();
    return s.productCosts
      .filter((c) => !productId || c.product_id === productId)
      .map((c) => ({
        ...c,
        cost_price: Number(c.cost_price),
        product: s.products.find((p) => p.id === c.product_id),
      }))
      .sort((a, b) => {
        const d = b.purchase_date.localeCompare(a.purchase_date);
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      });
  },

  getBusinessDataEntries(opts: {
    section: "product_costs" | "other_expenses";
    from?: string;
    to?: string;
  }): BusinessDataEntry[] {
    return getStore()
      .businessDataEntries
      .filter((e) => {
        if (opts.section === "product_costs") {
          if (e.category !== "product_purchase") return false;
        } else if (e.category === "product_purchase") {
          return false;
        }
        if (opts.from && e.entry_date < opts.from) return false;
        if (opts.to && e.entry_date > opts.to) return false;
        return true;
      })
      .map((e) => ({ ...e, amount: Number(e.amount) }))
      .sort((a, b) => {
        const d = b.entry_date.localeCompare(a.entry_date);
        return d !== 0 ? d : b.created_at.localeCompare(a.created_at);
      });
  },

  addBusinessDataEntry(input: {
    company_person_name: string;
    category: BusinessDataCategory;
    item_name: string;
    expense_name: string;
    payment_method: PaymentMode;
    amount: number;
    note?: string | null;
    entry_date: string;
    created_by: string;
  }): BusinessDataEntry {
    const s = getStore();
    const row: BusinessDataEntry = {
      id: id(),
      company_person_name: input.company_person_name.trim(),
      category: input.category,
      item_name: input.item_name.trim(),
      expense_name: input.expense_name.trim(),
      payment_method: input.payment_method,
      amount: Number(input.amount),
      note: input.note?.trim() || null,
      entry_date: input.entry_date,
      created_by: input.created_by,
      created_at: now(),
    };
    s.businessDataEntries.unshift(row);
    return { ...row };
  },

  updateBusinessDataEntry(
    payload: Partial<BusinessDataEntry> & { id: string }
  ): BusinessDataEntry {
    const s = getStore();
    const idx = s.businessDataEntries.findIndex((e) => e.id === payload.id);
    if (idx < 0) throw new Error("Entry not found");
    const rest = { ...payload } as Record<string, unknown>;
    delete rest.id;
    delete rest.created_at;
    delete rest.created_by;
    const patch = rest as Partial<BusinessDataEntry>;
    s.businessDataEntries[idx] = {
      ...s.businessDataEntries[idx],
      ...patch,
      amount:
        patch.amount != null
          ? Number(patch.amount)
          : s.businessDataEntries[idx].amount,
      company_person_name:
        patch.company_person_name != null
          ? patch.company_person_name.trim()
          : s.businessDataEntries[idx].company_person_name,
      item_name:
        patch.item_name != null
          ? patch.item_name.trim()
          : s.businessDataEntries[idx].item_name,
      expense_name:
        patch.expense_name != null
          ? patch.expense_name.trim()
          : s.businessDataEntries[idx].expense_name,
      note:
        patch.note !== undefined
          ? patch.note?.trim() || null
          : s.businessDataEntries[idx].note,
    };
    return { ...s.businessDataEntries[idx] };
  },

  deleteBusinessDataEntry(entryId: string) {
    const s = getStore();
    s.businessDataEntries = s.businessDataEntries.filter((e) => e.id !== entryId);
  },
};