"use client";

import { useAuth } from "@/components/auth-provider";
import { RecurringDueBanner } from "@/components/dashboard/recurring-due-banner";
import { BulkEmailModal } from "@/components/invoices/bulk-email-modal";
import {
  ActivityCard,
  GoalCard,
  MilestonesCard,
  MoneyWaitingCard,
  SalesTrendCard,
  SetupCard,
  StockHealthCard,
  StreakCard,
  TodayCard,
  TopCustomersCard,
  TopProductsCard,
  VatCard,
  type ActivityItem,
  type SetupStep,
  type StockAlert,
  type TrendRange,
} from "@/components/dashboard/insight-cards";
import { useToast } from "@/components/ui/toast";
import { DocumentTitle } from "@/components/ui/document-title";
import { useBusinessType } from "@/hooks/use-business-type";
import { useUpdateOrganization } from "@/hooks/use-company";
import { useDashboardData } from "@/hooks/use-dashboard-insights";
import {
  activityHeatmap,
  addDays,
  agingBuckets,
  billingStreak,
  dayKey,
  debtors,
  greeting,
  milestones,
  monthGoal,
  previousWindow,
  salesByDay,
  salesByMonth,
  suggestGoal,
  summarize,
  topCustomers,
  topProducts,
  vatThisQuarter,
} from "@/lib/insights";
import type { Invoice } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { motion } from "motion/react";
import { CircleAlert, FilePlus2, PackagePlus, RotateCw, UserPlus, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCountryConfig } from "@/lib/vat/countries";

const GOAL_KEY = "kayyro-goal:";

function readLocalGoal(orgId?: string): number | null {
  if (!orgId) return null;
  try {
    const v = Number(localStorage.getItem(GOAL_KEY + orgId));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading dashboard">
      <div className="h-16 w-2/3 animate-pulse rounded-[14px] bg-surface" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[240px] animate-pulse rounded-[16px] bg-surface" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-[380px] animate-pulse rounded-[16px] bg-surface lg:col-span-2" />
        <div className="h-[380px] animate-pulse rounded-[16px] bg-surface" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const d = useDashboardData();
  const { user, isReadOnly } = useAuth();
  const { isHotel } = useBusinessType();
  const updateOrg = useUpdateOrganization();
  const { toast } = useToast();
  const [range, setRange] = useState<TrendRange>("30d");
  const [reminding, setReminding] = useState<Invoice[] | null>(null);
  const [localGoal, setLocalGoal] = useState<number | null>(null);

  useEffect(() => setLocalGoal(readLocalGoal(d.org?.id)), [d.org?.id]);

  const now = useMemo(() => new Date(), []);
  const todayKey = dayKey(now);

  const x = useMemo(() => {
    const inv = d.invoices;
    const today = summarize(inv, todayKey, todayKey);
    const weekAgo = dayKey(addDays(now, -7));
    const sameDayLastWeek = summarize(inv, weekAgo, weekAgo);
    const collectedToday = d.payments
      .filter((p) => p.payment_date === todayKey)
      .reduce((s, p) => s + Number(p.amount), 0);
    const streak = billingStreak(inv, now);
    const monthStart = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthRevenue = summarize(inv, monthStart, todayKey).revenue;
    const aging = agingBuckets(inv, now);
    const owed = debtors(inv, now);
    const names = new Map(d.products.map((p) => [p.id, { name: p.name, unit: p.unit }]));
    const stockAlerts: StockAlert[] = d.products
      .filter((p) => p.is_active && !p.is_service)
      .filter((p) => Number(p.current_stock ?? 0) <= Number(p.reorder_threshold ?? 0))
      .map((p) => ({
        id: p.id,
        name: p.name,
        stock: Number(p.current_stock ?? 0),
        threshold: Number(p.reorder_threshold ?? 0),
        unit: p.unit,
      }))
      .sort((a, b) => a.stock / Math.max(1, a.threshold) - b.stock / Math.max(1, b.threshold));
    const stockable = d.products.filter((p) => p.is_active && !p.is_service);
    const stockValue = stockable.reduce(
      (s, p) => s + Math.max(0, Number(p.current_stock ?? 0)) * Number(p.base_price ?? 0),
      0
    );

    const invoiceById = new Map(inv.map((i) => [i.id, i]));
    const activity: ActivityItem[] = [
      ...[...inv]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 8)
        .map((i) => ({
          id: `inv-${i.id}`,
          kind: "invoice" as const,
          title: `${i.invoice_number} · ${i.customer?.name ?? "Customer"}`,
          detail: i.status === "cancelled" ? "Voided" : "Invoice created",
          amount: Number(i.grand_total),
          at: i.created_at,
          href: `/invoices/${i.id}`,
        })),
      ...[...d.payments]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 6)
        .map((p) => ({
          id: `pay-${p.id}`,
          kind: "payment" as const,
          title: `Payment from ${p.customer?.name ?? "customer"}`,
          detail: p.invoice?.invoice_number ? `Against ${p.invoice.invoice_number}` : "On account",
          amount: Number(p.amount),
          at: p.created_at,
          href: p.customer_id ? `/customers/${p.customer_id}` : undefined,
        })),
      ...d.emails.slice(0, 5).map((e) => ({
        id: `mail-${e.id}`,
        kind: "email" as const,
        title: `${e.kind === "reminder" ? "Reminder" : "Invoice"} emailed`,
        detail: `${invoiceById.get(e.invoice_id ?? "")?.invoice_number ?? ""} → ${e.to_email}`,
        at: e.created_at,
        href: e.invoice_id ? `/invoices/${e.invoice_id}` : undefined,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8);

    return {
      today,
      sameDayLastWeek,
      collectedToday,
      last14: salesByDay(inv, 14, now),
      streak,
      heatmap: activityHeatmap(inv, 17, now),
      monthRevenue,
      aging,
      owed,
      vat: vatThisQuarter(inv, d.purchases, d.org?.currency ?? "AED", now, getCountryConfig(d.org?.country).code),
      customers90: topCustomers(inv, d.since90, todayKey),
      products90: topProducts(d.sold, names),
      stockAlerts,
      stockValue,
      skuCount: stockable.length,
      activity,
      suggested: suggestGoal(inv, now),
      milestones: milestones(inv, streak, monthRevenue, d.org?.currency ?? "AED"),
    };
  }, [d.invoices, d.payments, d.products, d.purchases, d.sold, d.emails, d.org?.currency, d.org?.country, d.since90, now, todayKey]);

  const trend = useMemo(() => {
    const inv = d.invoices;
    if (range === "12m") {
      const series = salesByMonth(inv, 12, now);
      const previous = salesByMonth(inv, 12, new Date(now.getFullYear() - 1, now.getMonth(), 1));
      const from = dayKey(new Date(now.getFullYear(), now.getMonth() - 11, 1));
      const prev = previousWindow(from, todayKey);
      return { series, previous, summary: summarize(inv, from, todayKey), prevSummary: summarize(inv, prev.from, prev.to) };
    }
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const series = salesByDay(inv, days, now);
    const previous = salesByDay(inv, days, addDays(now, -days));
    const from = series[0]!.date;
    const prev = previousWindow(from, todayKey);
    return { series, previous, summary: summarize(inv, from, todayKey), prevSummary: summarize(inv, prev.from, prev.to) };
  }, [d.invoices, range, now, todayKey]);

  const goalValue = d.org?.monthly_sales_goal ?? localGoal ?? x.suggested;
  const goal = useMemo(() => monthGoal(d.invoices, goalValue, now), [d.invoices, goalValue, now]);

  const saveGoal = (value: number) => {
    setLocalGoal(value);
    try {
      if (d.org?.id) localStorage.setItem(GOAL_KEY + d.org.id, String(value));
    } catch {
      /* private mode */
    }
    if (!d.org) return;
    updateOrg.mutate(
      { id: d.org.id, monthly_sales_goal: value },
      {
        onSuccess: () => toast("Goal saved - go get it! 💪"),
        // Older databases (before migration 038) keep the goal in this browser only
        onError: () => toast("Goal saved on this device"),
      }
    );
  };

  if (d.isLoading) return <DashboardSkeleton />;
  if (d.isError) {
    return (
      <div className="panel flex flex-col items-start gap-3 p-6" role="alert">
        <p className="flex items-center gap-2 font-semibold text-rose">
          <CircleAlert className="h-4 w-4" /> We couldn&apos;t load your dashboard.
        </p>
        <button type="button" onClick={() => void d.retry()} className="inline-flex items-center gap-2 rounded-[10px] border border-border px-3 py-2 text-sm font-medium text-ink hover:bg-cloud">
          <RotateCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  const firstName = (user?.full_name ?? "").split(" ")[0] || "there";
  const steps: SetupStep[] = [
    { id: "account", label: "Create your account", done: true, href: "/settings" },
    {
      id: "business",
      label: "Add your tax number & address",
      done: !!(d.org?.tax_id && d.org?.address),
      href: "/settings",
    },
    { id: "product", label: "Add what you sell", done: d.products.length > 0, href: isHotel ? "/room-types" : "/products" },
    { id: "customer", label: "Add a customer", done: d.customers.length > 0, href: "/customers" },
    { id: "invoice", label: "Create your first invoice", done: d.invoices.length > 0, href: "/invoices/new" },
    { id: "email", label: "Email an invoice", done: d.emails.length > 0, href: "/invoices" },
  ];
  const setupDone = steps.every((s) => s.done);

  // One sentence that nudges the most valuable next action
  const insight = (() => {
    if (!d.invoices.length) return "Let's send your first tax invoice - it takes about a minute.";
    if (x.streak.current >= 2 && !x.streak.billedToday)
      return `Bill once today to keep your ${x.streak.current}-day streak alive 🔥`;
    if (goal.hit) return `You've hit your ${new Date().toLocaleDateString("en-GB", { month: "long" })} goal. Everything from here is bonus! 🎉`;
    if (x.aging.total > 0 && x.aging.oldestDays > 45)
      return `${formatCurrency(x.aging.total)} is waiting to be collected - a quick reminder today speeds it up.`;
    return `You're ${formatCurrency(Math.max(0, goal.goal - goal.achieved))} away from this month's goal. Keep going!`;
  })();

  return (
    <div className="space-y-4 pb-6">
      <DocumentTitle title="Dashboard" />
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-[2rem]">
            {greeting(now)}, {firstName} 👋
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate">{insight}</p>
        </div>
        {!isReadOnly && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/invoices/new"
            className="inline-flex h-11 items-center gap-2 rounded-[12px] bg-gradient-to-r from-[#7c1cf0] to-[#b65cff] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(124,28,240,0.55)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_26px_-8px_rgba(124,28,240,0.65)]"
          >
            <FilePlus2 className="h-4 w-4" /> New invoice
          </Link>
          {[
            { href: isHotel ? "/room-types" : "/products", label: "Add item", icon: PackagePlus },
            { href: "/customers", label: "Customer", icon: UserPlus },
            { href: "/outstanding", label: "Collect", icon: Wallet },
          ].map((a) => (
            <Link
              key={a.label}
              href={a.href}
              className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-border bg-surface px-3.5 text-sm font-medium text-ink transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
            >
              <a.icon className="h-4 w-4" /> {a.label}
            </Link>
          ))}
        </div>
        )}
      </motion.header>

      {!setupDone && <SetupCard steps={steps} />}

      {!isReadOnly && <RecurringDueBanner />}

      <div className="grid gap-4 lg:grid-cols-3">
        <TodayCard today={x.today} sameDayLastWeek={x.sameDayLastWeek} collectedToday={x.collectedToday} last14={x.last14} />
        <GoalCard goal={goal} onSaveGoal={saveGoal} saving={updateOrg.isPending} />
        <StreakCard streak={x.streak} heatmap={x.heatmap} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SalesTrendCard
          range={range}
          onRange={setRange}
          series={trend.series}
          previous={trend.previous}
          summary={trend.summary}
          previousSummary={trend.prevSummary}
          taxName={getCountryConfig(d.org?.country).taxName}
        />
        <MoneyWaitingCard
          total={x.aging.total}
          buckets={x.aging.buckets}
          top={x.owed}
          onRemind={(debtor) => setReminding(debtor.invoices)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TopProductsCard items={x.products90} />
        <TopCustomersCard items={x.customers90} />
        {getCountryConfig(d.org?.country).taxSystem !== "none" && (
          <VatCard vat={x.vat} country={getCountryConfig(d.org?.country)} />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!isHotel && <StockHealthCard alerts={x.stockAlerts} stockValue={x.stockValue} skuCount={x.skuCount} />}
        <ActivityCard items={x.activity} />
        <MilestonesCard items={x.milestones} />
      </div>

      <BulkEmailModal open={!!reminding} onClose={() => setReminding(null)} invoices={reminding ?? []} kind="reminder" />
    </div>
  );
}
