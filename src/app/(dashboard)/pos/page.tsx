"use client";

import { useAuth } from "@/components/auth-provider";
import { CameraScanner } from "@/components/invoices/camera-scanner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyState, LoadingBlock } from "@/components/ui/page-header";
import { ProductSwatch } from "@/components/ui/product-swatch";
import { useToast } from "@/components/ui/toast";
import { useBusinessType } from "@/hooks/use-business-type";
import { useCompanySettings } from "@/hooks/use-company";
import { useCustomerMutations, useCustomers } from "@/hooks/use-customers";
import { useInvoiceMutations } from "@/hooks/use-invoices";
import { usePaymentMutations } from "@/hooks/use-payments";
import { useProducts } from "@/hooks/use-products";
import { useWarehouses } from "@/hooks/use-warehouses";
import { DEFAULT_INVOICE_PREFIX } from "@/lib/brand";
import type { PaymentMode } from "@/lib/constants";
import { isJewelleryProduct } from "@/lib/jewellery";
import { printReceipt, receiptHtml, type ReceiptData } from "@/lib/pos-receipt";
import type { Customer, Invoice, Product } from "@/lib/types";
import { formatQty, getUnit, roundQty } from "@/lib/units";
import { cn, formatCurrency, roundTo } from "@/lib/utils";
import { calcInvoiceTotals } from "@/lib/vat";
import { calcOptionsFor, invoiceTitleFor, resolveTaxContext, taxFieldsFor, taxSummaryRows } from "@/lib/vat/context";
import { getCountryConfig } from "@/lib/vat/countries";
import { zatcaQrDataUrl, zatcaTimestamp } from "@/lib/vat/zatca";
import {
  Banknote,
  CreditCard,
  Landmark,
  Minus,
  PauseCircle,
  Plus,
  Printer,
  ScanLine,
  Search,
  ShoppingBag,
  Split,
  Trash2,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Line = { key: string; product: Product; qty: number; price: number; overridden: boolean };
type Held = {
  id: string;
  at: string;
  customerId: string | null;
  lines: { productId: string; qty: number; price: number; overridden: boolean }[];
};
type Method = "cash" | "card" | "bank_transfer" | "split" | "later";
type Sale = { invoice: Invoice; receipt: ReceiptData; change: number; paymentError?: string };

const HELD_KEY = "kayyro-pos-held";
const WALK_IN = "Walk-in Customer";

const isWalkIn = (c: Customer | null | undefined) => !!c && /^walk[\s-]?in\b/i.test(c.name.trim());

function readHeld(): Held[] {
  try {
    return JSON.parse(localStorage.getItem(HELD_KEY) ?? "[]") as Held[];
  } catch {
    return [];
  }
}
function writeHeld(list: Held[]) {
  try {
    localStorage.setItem(HELD_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* storage blocked */
  }
}

/** Banknote-style amounts just above the total, for quick cash buttons. */
function quickCash(total: number, decimals: number): number[] {
  const steps = decimals === 3 ? [1, 5, 10, 20, 50] : [5, 10, 20, 50, 100, 200, 500];
  const out = new Set<number>([roundTo(total, decimals)]);
  for (const s of steps) {
    const v = Math.ceil(total / s) * s;
    if (v > total) out.add(v);
    if (out.size >= 4) break;
  }
  return Array.from(out).sort((a, b) => a - b);
}

export default function PosPage() {
  const { user, isReadOnly } = useAuth();
  const { toast } = useToast();
  const { isHotel, labels } = useBusinessType();
  const { data: company } = useCompanySettings();
  const { data: products, isLoading } = useProducts(true);
  const { data: customers } = useCustomers();
  const { data: warehouses } = useWarehouses(true);
  const { create } = useInvoiceMutations();
  const { record } = usePaymentMutations();
  const { upsert: upsertCustomer } = useCustomerMutations();

  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<Method>("cash");
  const [tendered, setTendered] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [sale, setSale] = useState<Sale | null>(null);
  const [held, setHeld] = useState<Held[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [editPrice, setEditPrice] = useState<Line | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setHeld(readHeld()), []);

  const currency = company?.currency ?? "AED";
  const pricesIncludeVat = !!company?.prices_include_vat;
  const walkIn = useMemo(() => (customers ?? []).find(isWalkIn) ?? null, [customers]);
  const customer = (customerId ? customers?.find((c) => c.id === customerId) : null) ?? walkIn;

  const taxCtx = useMemo(
    () =>
      resolveTaxContext({
        sellerCountry: company?.country,
        sellerState: company?.state,
        sellerTaxId: company?.tax_id,
        currency,
        customer: customer ?? { country: company?.country ?? "AE", state: company?.state ?? "", tax_id: null },
      }),
    [company?.country, company?.state, company?.tax_id, currency, customer]
  );
  const decimals = taxCtx.decimals;
  const money = useCallback((n: number) => formatCurrency(n, currency), [currency]);

  // Weighed jewellery is priced from today's metal rate - that stays on the full invoice screen
  const sellable = useMemo(() => (products ?? []).filter((p) => !isJewelleryProduct(p)), [products]);
  const skipped = (products?.length ?? 0) - sellable.length;
  const categories = useMemo(
    () => Array.from(new Set(sellable.map((p) => p.category).filter(Boolean))).sort(),
    [sellable]
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sellable
      .filter((p) => !category || p.category === category)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode ?? "").toLowerCase().includes(q) ||
          (p.variant ?? "").toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [sellable, query, category]);

  const totals = useMemo(() => {
    if (!lines.length) return null;
    return calcInvoiceTotals(
      lines.map((l) => ({
        quantity: l.qty,
        unitPrice: l.price,
        vatRate: l.product.vat_rate,
        vatCategory: l.product.vat_category,
      })),
      calcOptionsFor(taxCtx, pricesIncludeVat)
    );
  }, [lines, taxCtx, pricesIncludeVat]);
  const total = totals?.grandTotal ?? 0;
  const itemCount = lines.reduce((s, l) => s + (getUnit(l.product.unit).decimals ? 1 : l.qty), 0);

  const add = useCallback((p: Product, qty = 1) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.product.id === p.id && !l.overridden);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: roundQty(next[i].qty + qty, p.unit) };
        return next;
      }
      return [...prev, { key: `${p.id}-${Date.now()}`, product: p, qty, price: Number(p.base_price), overridden: false }];
    });
  }, []);

  const setQty = (key: string, qty: number) =>
    setLines((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: roundQty(qty, l.product.unit) } : l))
        .filter((l) => l.qty > 0)
    );

  const findByCode = useCallback(
    (code: string) => {
      const c = code.trim().toLowerCase();
      if (!c) return null;
      return sellable.find((p) => (p.barcode ?? "").toLowerCase() === c || p.sku.toLowerCase() === c) ?? null;
    },
    [sellable]
  );

  const onSearchEnter = () => {
    const exact = findByCode(query);
    const pick = exact ?? (shown.length === 1 ? shown[0] : null);
    if (pick) {
      add(pick);
      setQuery("");
    } else if (query.trim()) {
      toast(`Nothing matches "${query.trim()}"`, "error");
    }
  };

  const clearSale = () => {
    setLines([]);
    setCustomerId(null);
    setTendered("");
    setSplitCash("");
    setMethod("cash");
  };

  const hold = () => {
    if (!lines.length) return;
    const next = [
      ...held,
      {
        id: `${Date.now()}`,
        at: new Date().toISOString(),
        customerId,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, price: l.price, overridden: l.overridden })),
      },
    ];
    setHeld(next);
    writeHeld(next);
    clearSale();
    toast("Sale put on hold");
  };

  const resume = (h: Held) => {
    const byId = new Map(sellable.map((p) => [p.id, p]));
    const restored = h.lines
      .map((l, i) => {
        const product = byId.get(l.productId);
        return product ? { key: `${l.productId}-${i}-${Date.now()}`, product, qty: l.qty, price: l.price, overridden: l.overridden } : null;
      })
      .filter((l): l is Line => !!l);
    if (lines.length) hold();
    setLines(restored);
    setCustomerId(h.customerId);
    const next = held.filter((x) => x.id !== h.id);
    setHeld(next);
    writeHeld(next);
    setShowHeld(false);
  };

  // Keyboard: F2 or / to search, F9 to take payment
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select");
      if (e.key === "F2" || (e.key === "/" && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F9" && lines.length && !paying && !sale) {
        e.preventDefault();
        setPaying(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lines.length, paying, sale]);

  const tenderedNum = Number(tendered) || 0;
  const splitCashNum = Math.min(Number(splitCash) || 0, total);
  const change = method === "cash" ? Math.max(0, roundTo(tenderedNum - total, decimals)) : 0;
  const canCharge =
    !!lines.length &&
    !busy &&
    (method !== "cash" || !tendered || tenderedNum >= total) &&
    (method !== "split" || (splitCashNum > 0 && splitCashNum < total)) &&
    (method !== "later" || (!!customer && !isWalkIn(customer)));

  const ensureCustomer = async (): Promise<Customer> => {
    if (customer) return customer;
    return (await upsertCustomer.mutateAsync({
      name: WALK_IN,
      state: company?.state ?? "",
      customer_type: "b2c",
      country: company?.country ?? "AE",
    })) as Customer;
  };

  const buildReceipt = async (invoice: Invoice, buyer: Customer, paid: { label: string; value: string }[]) => {
    const cfg = getCountryConfig(company?.country);
    const rows = taxSummaryRows(taxCtx, totals!.breakdown, money);
    let qr: string | null = null;
    if (cfg.zatcaQr && company?.tax_id) {
      qr = await zatcaQrDataUrl({
        sellerName: company.company_name || company.brand_name,
        vatNumber: company.tax_id,
        timestamp: zatcaTimestamp(invoice.created_at || new Date().toISOString()),
        total: invoice.grand_total,
        vatTotal: invoice.total_vat,
      }).catch(() => null);
    }
    const data: ReceiptData = {
      business: company?.brand_name || company?.company_name || "",
      addressLines: [
        [company?.address, company?.city].filter(Boolean).join(", "),
        company?.phone ? `Tel ${company.phone}` : "",
      ].filter(Boolean),
      taxIdLine: company?.tax_id ? `${cfg.taxIdLabel}: ${company.tax_id}` : null,
      title: taxCtx.taxFree ? "Receipt" : invoiceTitleFor(taxCtx, buyer.tax_id),
      number: invoice.invoice_number,
      dateTime: new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
      cashier: user?.full_name ?? null,
      customer: isWalkIn(buyer) ? null : buyer.name,
      lines: lines.map((l) => ({
        name: l.product.variant ? `${l.product.name} (${l.product.variant})` : l.product.name,
        qty: formatQty(l.qty, l.product.unit),
        price: l.price.toFixed(decimals),
        total: money(totals!.lines[lines.indexOf(l)].lineTotal),
      })),
      totals: [
        { label: taxCtx.taxFree ? "Amount" : `Before ${taxCtx.country.taxName}`, value: money(totals!.subtotal) },
        ...rows.filter((r) => r.kind === "tax").map((r) => ({ label: r.label, value: money(r.amount) })),
        ...(totals!.roundOff ? [{ label: "Round off", value: money(totals!.roundOff) }] : []),
        { label: "TOTAL", value: money(invoice.grand_total), strong: true },
      ],
      payments: paid,
      qrDataUrl: qr,
    };
    return data;
  };

  const charge = async () => {
    if (!user || !totals || !canCharge) return;
    setBusy(true);
    try {
      const buyer = await ensureCustomer();
      const ctx = resolveTaxContext({
        sellerCountry: company?.country,
        sellerState: company?.state,
        sellerTaxId: company?.tax_id,
        currency,
        customer: buyer,
      });
      const methodLabel =
        method === "split" ? "Cash + card" : method === "later" ? "On account" : method === "bank_transfer" ? "Bank transfer" : method === "card" ? "Card" : "Cash";
      const invoice = await create.mutateAsync({
        customer_id: buyer.id,
        invoice_date: new Date().toLocaleDateString("en-CA"),
        notes: `POS sale · ${methodLabel}`,
        warehouse_id: (warehouses ?? []).find((w) => w.is_default)?.id ?? warehouses?.[0]?.id ?? null,
        user_id: user.id,
        prefix: company?.invoice_prefix ?? DEFAULT_INVOICE_PREFIX,
        prices_include_vat: pricesIncludeVat,
        tax: { ...taxFieldsFor(ctx), decimals: ctx.decimals, tax_free: ctx.taxFree },
        items: lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.qty,
          unit: l.product.unit ?? "pcs",
          unit_price: l.price,
          price_overridden: l.overridden,
        })),
      });

      const parts: { mode: PaymentMode; amount: number; label: string }[] =
        method === "later"
          ? []
          : method === "split"
            ? [
                { mode: "cash", amount: splitCashNum, label: "Cash" },
                { mode: "card", amount: roundTo(invoice.grand_total - splitCashNum, decimals), label: "Card" },
              ]
            : [{ mode: method as PaymentMode, amount: invoice.grand_total, label: methodLabel }];

      let paymentError: string | undefined;
      const today = new Date().toLocaleDateString("en-CA");
      for (const p of parts) {
        if (p.amount <= 0) continue;
        try {
          await record.mutateAsync({
            customer_id: buyer.id,
            invoice_id: invoice.id,
            amount: p.amount,
            payment_date: today,
            payment_mode: p.mode,
            notes: "POS",
          });
        } catch (e) {
          paymentError = (e as Error).message;
        }
      }

      const paid = [
        ...parts.map((p) => ({ label: p.label, value: money(p.amount) })),
        ...(method === "cash" && tenderedNum > invoice.grand_total
          ? [
              { label: "Given", value: money(tenderedNum) },
              { label: "Change", value: money(change) },
            ]
          : []),
        ...(method === "later" ? [{ label: "To pay", value: money(invoice.grand_total) }] : []),
      ];
      const receipt = await buildReceipt(invoice, buyer, paid);
      setSale({ invoice, receipt, change, paymentError });
      setPaying(false);
      clearSale();
    } catch (e) {
      const msg = (e as Error).message || "Could not finish the sale";
      toast(msg.includes("stock") ? `${msg} - check stock levels.` : msg, "error");
    } finally {
      setBusy(false);
    }
  };

  if (isReadOnly) return <EmptyState title="View-only account" description="Accountants can't make sales. Ask an admin or staff user." />;
  if (isHotel) {
    return (
      <EmptyState
        title="POS is for shop counters"
        description="Hotels bill room stays from Bookings and New Invoice."
        action={
          <Link href="/invoices/new">
            <Button>New invoice</Button>
          </Link>
        }
      />
    );
  }
  if (isLoading) return <LoadingBlock />;

  const filteredCustomers = (customers ?? [])
    .filter((c) => {
      const q = customerQuery.trim().toLowerCase();
      return !q || c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q);
    })
    .slice(0, 12);

  return (
    <div className="-mx-1 grid grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-8.5rem)] lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ---------- Products ---------- */}
      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onSearchEnter())}
              placeholder={`Search or scan a barcode (F2)`}
              aria-label="Search products or scan a barcode"
              className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-[15px] text-ink outline-none focus:border-primary"
            />
          </div>
          <Button variant="secondary" className="h-12" onClick={() => setScanning(true)} aria-label="Scan with camera">
            <ScanLine className="h-5 w-5" />
            <span className="hidden sm:inline">Camera</span>
          </Button>
        </div>

        {categories.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {[null, ...categories].map((c) => (
              <button
                key={c ?? "all"}
                onClick={() => setCategory(c)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  category === c ? "border-primary bg-primary text-white" : "border-border bg-surface text-slate hover:text-ink"
                )}
              >
                {c ?? "All"}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-2">
          {!sellable.length ? (
            <EmptyState
              title={`No ${labels.productPlural.toLowerCase()} to sell yet`}
              description="Add products with a price first, then they show up here."
              action={
                <Link href="/products">
                  <Button>Add products</Button>
                </Link>
              }
            />
          ) : !shown.length ? (
            <p className="py-10 text-center text-sm text-slate">Nothing matches &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {shown.map((p) => {
                const stock = Number(p.current_stock ?? 0);
                const inCart = lines.filter((l) => l.product.id === p.id).reduce((s, l) => s + l.qty, 0);
                const out = !p.is_service && stock - inCart <= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p)}
                    className={cn(
                      "panel relative flex min-h-[104px] flex-col items-start p-3 text-left transition-transform active:scale-[0.97]",
                      inCart > 0 && "ring-2 ring-primary"
                    )}
                  >
                    {inCart > 0 && (
                      <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
                        {formatQty(inCart, p.unit, false)}
                      </span>
                    )}
                    <ProductSwatch productId={p.id} />
                    <span className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-ink">
                      {p.name}
                      {p.variant ? <span className="text-slate"> · {p.variant}</span> : null}
                    </span>
                    <span className="mt-auto flex w-full items-end justify-between gap-1 pt-1">
                      <span className="font-semibold tabular-nums text-ink">{money(Number(p.base_price))}</span>
                      {!p.is_service && (
                        <span className={cn("text-[11px]", out ? "text-coral-deep" : "text-slate")}>
                          {out ? "Out" : formatQty(stock - inCart, p.unit)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {skipped > 0 && (
            <p className="mt-4 text-xs text-slate">
              {skipped} jewellery item{skipped === 1 ? "" : "s"} priced by weight are billed from{" "}
              <Link href="/invoices/new" className="text-primary hover:underline">
                New invoice
              </Link>
              .
            </p>
          )}
        </div>
      </section>

      {/* ---------- Cart ---------- */}
      <section className="panel flex min-h-0 flex-col overflow-hidden max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:max-h-[70dvh] max-lg:rounded-b-none max-lg:border-x-0 max-lg:pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <button
            onClick={() => setPickCustomer(true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left hover:text-primary"
          >
            <User className="h-4 w-4 shrink-0 text-slate" />
            <span className="truncate text-sm font-medium text-ink">{customer?.name ?? WALK_IN}</span>
            <span className="text-xs text-primary">Change</span>
          </button>
          {held.length > 0 && (
            <button onClick={() => setShowHeld(true)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
              {held.length} on hold
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto max-lg:max-h-[30dvh]">
          {!lines.length ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center text-sm text-slate max-lg:py-4">
              <ShoppingBag className="mb-2 h-8 w-8 opacity-40 max-lg:hidden" />
              Tap a product or scan a barcode to start a sale.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {lines.map((l, i) => {
                const step = getUnit(l.product.unit).decimals ? 0.5 : 1;
                return (
                  <li key={l.key} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{l.product.name}</p>
                      <button onClick={() => setEditPrice(l)} className="text-xs text-slate hover:text-primary" title="Change price">
                        {money(l.price)}
                        {l.overridden && " (changed)"} / {getUnit(l.product.unit).label ?? l.product.unit}
                      </button>
                    </div>
                    <div className="flex items-center rounded-lg border border-border">
                      <button className="p-2 text-slate hover:text-ink" onClick={() => setQty(l.key, l.qty - step)} aria-label="One less">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        value={l.qty}
                        inputMode="decimal"
                        onChange={(e) => setQty(l.key, Number(e.target.value) || 0)}
                        className="w-12 bg-transparent text-center text-sm tabular-nums text-ink outline-none"
                        aria-label={`Quantity of ${l.product.name}`}
                      />
                      <button className="p-2 text-slate hover:text-ink" onClick={() => setQty(l.key, l.qty + step)} aria-label="One more">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="w-20 text-right text-sm font-semibold tabular-nums text-ink">
                      {totals ? money(totals.lines[i].lineTotal) : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          {totals && (
            <div className="mb-3 space-y-1 text-sm max-lg:hidden">
              <div className="flex justify-between text-slate">
                <span>{taxCtx.taxFree ? "Amount" : `Before ${taxCtx.country.taxName}`}</span>
                <span className="tabular-nums">{money(totals.subtotal)}</span>
              </div>
              {taxSummaryRows(taxCtx, totals.breakdown, money)
                .filter((r) => r.kind === "tax")
                .map((r) => (
                  <div key={r.key} className="flex justify-between text-slate">
                    <span>{r.label}</span>
                    <span className="tabular-nums">{money(r.amount)}</span>
                  </div>
                ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="px-3" onClick={hold} disabled={!lines.length} title="Put this sale on hold">
              <PauseCircle className="h-5 w-5" />
            </Button>
            <Button variant="ghost" className="px-3" onClick={clearSale} disabled={!lines.length} title="Clear sale">
              <Trash2 className="h-5 w-5" />
            </Button>
            <Button size="lg" className="flex-1 justify-between" disabled={!lines.length} onClick={() => setPaying(true)}>
              <span className="whitespace-nowrap">
                Charge
                {itemCount ? <span className="ml-1.5 text-xs font-medium opacity-80">({itemCount})</span> : null}
              </span>
              <span className="whitespace-nowrap tabular-nums">{money(total)}</span>
            </Button>
          </div>
        </div>
      </section>

      <CameraScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={(code) => {
          const p = findByCode(code);
          if (p) {
            add(p);
            toast(`Added ${p.name}`);
          } else toast(`No product with barcode ${code}`, "error");
        }}
      />

      {/* ---------- Customer ---------- */}
      {pickCustomer && (
        <Modal open onClose={() => setPickCustomer(false)} title="Who is buying?" size="sm">
          <input
            autoFocus
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            placeholder="Name or phone"
            className="mb-3 h-11 w-full rounded-xl border border-border bg-surface px-3 text-ink outline-none focus:border-primary"
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            <button
              onClick={() => (setCustomerId(walkIn?.id ?? null), setPickCustomer(false))}
              className="w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-primary/5"
            >
              <span className="font-medium text-ink">{WALK_IN}</span>
              <span className="block text-xs text-slate">Counter sale, no name on the receipt</span>
            </button>
            {filteredCustomers
              .filter((c) => !isWalkIn(c))
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => (setCustomerId(c.id), setPickCustomer(false))}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-primary/5"
                >
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className="block text-xs text-slate">{[c.phone, c.tax_id].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
          </div>
          <p className="mt-3 text-xs text-slate">
            New customer?{" "}
            <Link href="/customers" className="text-primary hover:underline">
              Add them in Customers
            </Link>
            .
          </p>
        </Modal>
      )}

      {/* ---------- Price change ---------- */}
      {editPrice && (
        <Modal open onClose={() => setEditPrice(null)} title={`Price for ${editPrice.product.name}`} size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(new FormData(e.currentTarget).get("price"));
              if (!(v >= 0)) return;
              setLines((prev) =>
                prev.map((l) => (l.key === editPrice.key ? { ...l, price: roundTo(v, decimals), overridden: v !== Number(l.product.base_price) } : l))
              );
              setEditPrice(null);
            }}
          >
            <input
              name="price"
              autoFocus
              inputMode="decimal"
              defaultValue={editPrice.price}
              className="h-12 w-full rounded-xl border border-border bg-surface px-3 text-lg tabular-nums text-ink outline-none focus:border-primary"
            />
            <p className="mt-2 text-xs text-slate">
              List price {money(Number(editPrice.product.base_price))} {pricesIncludeVat ? `incl. ${taxCtx.country.taxName}` : `before ${taxCtx.country.taxName}`}.
            </p>
            <div className="mt-4 flex justify-end">
              <Button type="submit">Save price</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Payment ---------- */}
      {paying && totals && (
        <Modal open onClose={() => !busy && setPaying(false)} title="Take payment" size="md">
          <p className="text-center text-sm text-slate">Total to pay</p>
          <p className="text-center font-display text-4xl font-bold tabular-nums text-ink">{money(total)}</p>

          <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(
              [
                { id: "cash", label: "Cash", icon: Banknote },
                { id: "card", label: "Card", icon: CreditCard },
                { id: "bank_transfer", label: "Transfer", icon: Landmark },
                { id: "split", label: "Split", icon: Split },
                { id: "later", label: "Pay later", icon: User },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-sm font-medium transition-colors",
                  method === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-slate hover:text-ink"
                )}
              >
                <m.icon className="h-5 w-5" />
                {m.label}
              </button>
            ))}
          </div>

          {method === "cash" && (
            <div className="mt-5">
              <label className="text-sm font-medium text-ink" htmlFor="pos-tendered">
                Cash given
              </label>
              <input
                id="pos-tendered"
                autoFocus
                inputMode="decimal"
                value={tendered}
                onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && canCharge && (e.preventDefault(), void charge())}
                placeholder={total.toFixed(decimals)}
                className="mt-1 h-12 w-full rounded-xl border border-border bg-surface px-3 text-lg tabular-nums text-ink outline-none focus:border-primary"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {quickCash(total, decimals).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTendered(String(v))}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm tabular-nums text-ink hover:border-primary"
                  >
                    {v === roundTo(total, decimals) ? "Exact" : money(v)}
                  </button>
                ))}
              </div>
              {tendered && tenderedNum < total ? (
                <p className="mt-3 text-sm text-coral-deep">That&apos;s {money(total - tenderedNum)} short.</p>
              ) : change > 0 ? (
                <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-center text-lg font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Change to give: {money(change)}
                </p>
              ) : null}
            </div>
          )}

          {method === "split" && (
            <div className="mt-5">
              <label className="text-sm font-medium text-ink" htmlFor="pos-split">
                Paid in cash
              </label>
              <input
                id="pos-split"
                autoFocus
                inputMode="decimal"
                value={splitCash}
                onChange={(e) => setSplitCash(e.target.value.replace(/[^\d.]/g, ""))}
                className="mt-1 h-12 w-full rounded-xl border border-border bg-surface px-3 text-lg tabular-nums text-ink outline-none focus:border-primary"
              />
              <p className="mt-2 text-sm text-slate">
                On card: <span className="font-semibold tabular-nums text-ink">{money(Math.max(0, total - splitCashNum))}</span>
              </p>
            </div>
          )}

          {method === "later" && (
            <p className={cn("mt-5 rounded-xl px-4 py-3 text-sm", customer && !isWalkIn(customer) ? "bg-primary/5 text-ink" : "bg-rose-soft text-coral-deep")}>
              {customer && !isWalkIn(customer)
                ? `${money(total)} is added to what ${customer.name} owes. It shows in Outstanding.`
                : "Pick a named customer first - walk-in sales can't be paid later."}
            </p>
          )}

          <Button size="lg" className="mt-6 w-full" onClick={charge} loading={busy} disabled={!canCharge}>
            {method === "later" ? "Save sale" : `Charge ${money(total)}`}
          </Button>
        </Modal>
      )}

      {/* ---------- Done ---------- */}
      {sale && (
        <Modal open onClose={() => setSale(null)} title="Sale complete" size="md">
          {sale.change > 0 && (
            <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-center text-xl font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              Give change: {money(sale.change)}
            </p>
          )}
          {sale.paymentError && (
            <p className="mb-4 rounded-xl bg-rose-soft px-4 py-3 text-sm text-coral-deep">
              The invoice was saved, but the payment wasn&apos;t recorded ({sale.paymentError}). Record it from the invoice.
            </p>
          )}
          <iframe
            title="Receipt preview"
            srcDoc={receiptHtml(sale.receipt)}
            className="mx-auto h-80 w-full max-w-[320px] rounded-lg border border-border bg-white"
          />
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button variant="secondary" onClick={() => printReceipt(receiptHtml(sale.receipt))}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Link href={`/invoices/${sale.invoice.id}`}>
              <Button variant="secondary" className="w-full">
                Invoice
              </Button>
            </Link>
            <Button
              className="col-span-2 sm:col-span-1"
              autoFocus
              onClick={() => {
                setSale(null);
                window.setTimeout(() => searchRef.current?.focus(), 50);
              }}
            >
              New sale
            </Button>
          </div>
        </Modal>
      )}

      {/* ---------- Held sales ---------- */}
      {showHeld && (
        <Modal open onClose={() => setShowHeld(false)} title="Sales on hold" size="sm">
          <ul className="space-y-2">
            {held.map((h) => (
              <li key={h.id} className="flex items-center gap-2 rounded-xl border border-border p-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-ink">
                    {h.lines.length} item{h.lines.length === 1 ? "" : "s"} ·{" "}
                    {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="truncate text-xs text-slate">
                    {customers?.find((c) => c.id === h.customerId)?.name ?? WALK_IN}
                  </p>
                </div>
                <Button size="sm" onClick={() => resume(h)}>
                  Resume
                </Button>
                <button
                  onClick={() => {
                    const next = held.filter((x) => x.id !== h.id);
                    setHeld(next);
                    writeHeld(next);
                  }}
                  className="rounded-lg p-2 text-slate hover:text-coral-deep"
                  aria-label="Discard"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
