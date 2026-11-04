import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment reminders", robots: { index: false, follow: false } };

/**
 * Public page from the link in every Kayyro Collect reminder. Shows who sends
 * the reminders and lets the customer stop them (a button, so mail scanners
 * that open links can't opt anyone out by accident). English and Arabic.
 */
export default async function OptOutPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  let business = "";
  let optedOut = false;
  let valid = /^[a-f0-9]{64}$/.test(token);
  if (valid && !isDemoMode()) {
    const admin = createAdminClient();
    const { data: cust } = await admin
      .from("customers")
      .select("organization_id, collect_opted_out_at")
      .eq("collect_token", token)
      .maybeSingle();
    if (!cust) {
      valid = false;
    } else {
      optedOut = !!cust.collect_opted_out_at;
      const { data: org } = await admin.from("organizations").select("name, brand_name").eq("id", cust.organization_id).maybeSingle();
      business = String(org?.brand_name || org?.name || "");
    }
  }
  const stopped = optedOut || done === "1";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-cloud px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        {[
          {
            lang: "en",
            dir: "ltr",
            title: "Payment reminders",
            invalid: "This link is not valid.",
            from: business ? `Reminders about unpaid invoices from ${business}.` : "Reminders about unpaid invoices.",
            stoppedText: "Done. You will no longer receive payment reminders from this business.",
            button: "Stop these reminders",
            note: "You will still receive invoices and receipts.",
          },
          {
            lang: "ar",
            dir: "rtl",
            title: "تذكيرات الدفع",
            invalid: "هذا الرابط غير صالح.",
            from: business ? `تذكيرات بالفواتير غير المدفوعة من ${business}.` : "تذكيرات بالفواتير غير المدفوعة.",
            stoppedText: "تم. لن تصلك بعد الآن تذكيرات بالدفع من هذه الجهة.",
            button: "إيقاف هذه التذكيرات",
            note: "ستستمر في استلام الفواتير والإيصالات.",
          },
        ].map((t) => (
          <section key={t.lang} lang={t.lang} dir={t.dir} className="panel p-6 text-start">
            <h1 className="font-display text-xl font-bold text-ink">{t.title}</h1>
            {!valid ? (
              <p className="mt-2 text-sm text-slate">{t.invalid}</p>
            ) : stopped ? (
              <p className="mt-2 text-sm text-ink">{t.stoppedText}</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-slate">{t.from}</p>
                <form method="post" action={`/api/collect/opt-out`} className="mt-4">
                  <input type="hidden" name="t" value={token} />
                  <button
                    type="submit"
                    className="inline-flex h-11 items-center justify-center rounded-[10px] bg-primary px-5 text-sm font-semibold text-white"
                  >
                    {t.button}
                  </button>
                </form>
                <p className="mt-3 text-xs text-slate">{t.note}</p>
              </>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
