import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";
import { formatAmount, formatDueDate } from "@/lib/collect/templates";
import { PaidClaimForm } from "./paid-claim-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay invoice", robots: { index: false, follow: false } };

type PageData = {
  business: string;
  logo: string | null;
  number: string;
  balance: number;
  currency: string;
  due: string;
  settled: boolean;
  pendingClaim: boolean;
  invoiceUrl: string | null;
  payUrl: string | null;
  bank: { name: string; account: string; swift: string; details: string } | null;
  lang: "en" | "ar";
};

const T = {
  en: {
    title: "Pay invoice",
    amountDue: "Amount due",
    due: "Due",
    view: "View invoice",
    payNow: "Pay now",
    bank: "Bank transfer",
    bankName: "Bank",
    account: "IBAN / account",
    swift: "SWIFT",
    paid: "Thank you, this invoice is paid.",
    pending: "Thank you. We've received your payment details and the business will confirm them shortly. Reminders are paused meanwhile.",
    invalid: "This payment link is not valid.",
    other: "العربية",
    noOnline: "Online payment isn't set up for this business yet. Please use the bank details or contact the business.",
  },
  ar: {
    title: "دفع الفاتورة",
    amountDue: "المبلغ المستحق",
    due: "تاريخ الاستحقاق",
    view: "عرض الفاتورة",
    payNow: "ادفع الآن",
    bank: "تحويل بنكي",
    bankName: "البنك",
    account: "رقم الآيبان / الحساب",
    swift: "سويفت",
    paid: "شكراً لكم، هذه الفاتورة مدفوعة.",
    pending: "شكراً لكم. استلمنا تفاصيل الدفع وستؤكدها الجهة قريباً. التذكيرات متوقفة حتى ذلك الحين.",
    invalid: "رابط الدفع هذا غير صالح.",
    other: "English",
    noOnline: "الدفع عبر الإنترنت غير متاح لهذه الجهة بعد. يرجى استخدام البيانات البنكية أو التواصل مع الجهة.",
  },
};

async function load(token: string, langParam?: string): Promise<PageData | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const pick = (pref?: string | null): "en" | "ar" => (langParam === "ar" || langParam === "en" ? langParam : pref === "ar" ? "ar" : "en");
  if (isDemoMode()) {
    return {
      business: "Kayyro Demo",
      logo: null,
      number: "KY/2026/0042",
      balance: 3150,
      currency: "AED",
      due: "2026-11-03",
      settled: false,
      pendingClaim: false,
      invoiceUrl: null,
      payUrl: null,
      bank: { name: "Emirates NBD", account: "AE07 0331 2345 6789 0123 456", swift: "EBILAEAD", details: "" },
      lang: pick(),
    };
  }
  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select("id, organization_id, customer_id, invoice_number, currency, due_date, invoice_date, status, short_code")
    .eq("collect_pay_token", token)
    .maybeSingle();
  if (!inv) return null;
  const [{ data: org }, { data: cust }, { data: balance }, { count }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, brand_name, logo_url, payment_link_url, bank_name, bank_account, bank_ifsc, bank_details")
      .eq("id", inv.organization_id)
      .single(),
    admin.from("customers").select("preferred_language").eq("id", inv.customer_id).maybeSingle(),
    admin.rpc("collect_invoice_balance", { p_invoice: inv.id }),
    admin.from("payment_claims").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("status", "pending"),
  ]);
  const bal = Number(balance ?? 0);
  const link = typeof org?.payment_link_url === "string" && /^https:\/\//i.test(org.payment_link_url) ? org.payment_link_url : null;
  const hasBank = !!(org?.bank_account || org?.bank_details);
  return {
    business: String(org?.brand_name || org?.name || ""),
    logo: typeof org?.logo_url === "string" && /^https:\/\//.test(org.logo_url) ? org.logo_url : null,
    number: String(inv.invoice_number),
    balance: bal,
    currency: String(inv.currency || "AED"),
    due: String(inv.due_date ?? inv.invoice_date),
    settled: inv.status === "paid" || inv.status === "cancelled" || bal <= 0.0005,
    pendingClaim: (count ?? 0) > 0,
    invoiceUrl: inv.short_code ? `/i/${inv.short_code}` : null,
    payUrl: link,
    bank: hasBank
      ? {
          name: String(org?.bank_name ?? ""),
          account: String(org?.bank_account ?? ""),
          swift: String(org?.bank_ifsc ?? ""),
          details: String(org?.bank_details ?? ""),
        }
      : null,
    lang: pick(cust?.preferred_language),
  };
}

/**
 * The invoice's payment page, linked from every reminder: the amount still
 * owed, "Pay now", bank details, and "I already paid" with proof. English and Arabic.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string; sent?: string }>;
}) {
  const { token } = await params;
  const { lang: langParam, sent } = await searchParams;
  const data = await load(token, langParam);
  const lang = data?.lang ?? (langParam === "ar" ? "ar" : "en");
  const t = T[lang];

  return (
    <main dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="flex min-h-dvh items-start justify-center bg-cloud px-4 py-10 sm:items-center">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-end">
          <Link href={`/pay/${token}?lang=${lang === "ar" ? "en" : "ar"}`} className="text-sm text-primary hover:underline">
            {t.other}
          </Link>
        </div>
        {!data ? (
          <section className="panel p-6">
            <p className="text-sm text-slate">{t.invalid}</p>
          </section>
        ) : (
          <>
            <section className="panel p-6">
              <div className="flex items-center gap-3">
                {data.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.logo} alt="" className="h-10 w-10 rounded-lg object-contain" />
                )}
                <div>
                  <p className="font-display text-lg font-bold text-ink">{data.business}</p>
                  <p className="text-sm text-slate">
                    {t.title} <span dir="ltr">{data.number}</span>
                  </p>
                </div>
              </div>
              {data.settled ? (
                <p className="mt-5 rounded-[10px] bg-sage-soft px-4 py-3 text-sm font-medium text-sage">{t.paid}</p>
              ) : (
                <>
                  <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate">{t.amountDue}</p>
                  <p className="font-display text-3xl font-bold text-ink" dir="ltr">
                    {formatAmount(data.balance, data.currency)}
                  </p>
                  <p className="mt-1 text-sm text-slate">
                    {t.due}: {formatDueDate(data.due, lang)}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {data.payUrl && (
                      <a
                        href={data.payUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 items-center justify-center rounded-[10px] bg-primary px-5 text-sm font-semibold text-white"
                      >
                        {t.payNow}
                      </a>
                    )}
                    {data.invoiceUrl && (
                      <a
                        href={data.invoiceUrl}
                        className="inline-flex h-11 items-center justify-center rounded-[10px] border border-border bg-surface px-5 text-sm font-medium text-ink"
                      >
                        {t.view}
                      </a>
                    )}
                  </div>
                  {!data.payUrl && <p className="mt-3 text-xs text-slate">{t.noOnline}</p>}
                </>
              )}
            </section>

            {!data.settled && data.bank && (
              <section className="panel p-6 text-sm">
                <p className="font-display text-sm font-semibold text-ink">{t.bank}</p>
                <dl className="mt-2 space-y-1 text-slate">
                  {data.bank.name && (
                    <div>
                      {t.bankName}: <span className="text-ink">{data.bank.name}</span>
                    </div>
                  )}
                  {data.bank.account && (
                    <div>
                      {t.account}: <span className="font-mono text-ink" dir="ltr">{data.bank.account}</span>
                    </div>
                  )}
                  {data.bank.swift && (
                    <div>
                      {t.swift}: <span className="font-mono text-ink" dir="ltr">{data.bank.swift}</span>
                    </div>
                  )}
                  {data.bank.details && <p className="whitespace-pre-line text-ink">{data.bank.details}</p>}
                </dl>
              </section>
            )}

            {!data.settled &&
              (data.pendingClaim || sent === "1" ? (
                <section className="panel p-6">
                  <p className="text-sm text-ink">{t.pending}</p>
                </section>
              ) : (
                <PaidClaimForm token={token} lang={lang} />
              ))}
          </>
        )}
      </div>
    </main>
  );
}
