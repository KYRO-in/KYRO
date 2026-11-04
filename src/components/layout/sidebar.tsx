"use client";

import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  Users,
  FileText,
  BarChart3,
  Briefcase,
  Settings,
  UserCog,
  LogOut,
  X,
  Building2,
  Truck,
  ShoppingCart,
  Undo2,
  CreditCard,
  Banknote,
  Gem,
  CalendarRange,
  BedDouble,
  Store,
  Sparkles,
  Contact,
  CalendarCheck,
  HandCoins,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_NAME, APP_TAGLINE, BRAND_LOGO_ICON } from "@/lib/brand";
import type { BusinessLabels } from "@/lib/business-types";
import type { PlanCapabilities } from "@/lib/billing/plans";
import { useBusinessType } from "@/hooks/use-business-type";
import { useOrgAccess } from "@/hooks/use-org-access";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";

const billingNav: {
  href: string;
  label: string;
  labelKey?: keyof BusinessLabels;
  icon: LucideIcon;
  adminOnly?: boolean;
  jewelleryOnly?: boolean;
  hotelOnly?: boolean;
  /** Hide for hotel orgs (inventory/warehouses/products catalog) */
  hideForHotel?: boolean;
  /** Hide unless the org plan includes this capability */
  requiresCapability?: keyof PlanCapabilities;
  tourId?: string;
}[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tourId: "tour-dashboard" },
  { href: "/pos", label: "POS", icon: Store, hideForHotel: true, tourId: "tour-pos" },
  { href: "/assistant", label: "Ask Kayyro", icon: Sparkles, tourId: "tour-assistant" },
  {
    href: "/products",
    label: "Products",
    labelKey: "productPlural",
    icon: Package,
    hideForHotel: true,
    tourId: "tour-products",
  },
  {
    href: "/room-types",
    label: "Room Types",
    icon: BedDouble,
    hotelOnly: true,
    tourId: "tour-room-types",
  },
  { href: "/metal-rates", label: "Today's Rates", icon: Gem, jewelleryOnly: true, tourId: "tour-metal-rates" },
  {
    href: "/inventory",
    label: "Inventory",
    icon: Warehouse,
    hideForHotel: true,
    tourId: "tour-inventory",
  },
  {
    href: "/bookings",
    label: "Bookings",
    icon: CalendarRange,
    hotelOnly: true,
    tourId: "tour-bookings",
  },
  {
    href: "/warehouses",
    label: "Warehouses",
    icon: Building2,
    adminOnly: true,
    hideForHotel: true,
    tourId: "tour-warehouses",
  },
  { href: "/customers", label: "Customers", icon: Users, tourId: "tour-customers" },
  { href: "/outstanding", label: "Outstanding", icon: Banknote, tourId: "tour-outstanding" },
  { href: "/collect", label: "Get Paid", icon: HandCoins, tourId: "tour-collect" },
  {
    href: "/suppliers",
    label: "Suppliers",
    icon: Truck,
    requiresCapability: "purchasesCreditNotes",
    hideForHotel: true,
    tourId: "tour-suppliers",
  },
  {
    href: "/purchases",
    label: "Purchases",
    icon: ShoppingCart,
    requiresCapability: "purchasesCreditNotes",
    hideForHotel: true,
    tourId: "tour-purchases",
  },
  { href: "/invoices", label: "Invoices", icon: FileText, tourId: "tour-invoices" },
  {
    href: "/credit-notes",
    label: "Credit notes",
    icon: Undo2,
    requiresCapability: "purchasesCreditNotes",
    hideForHotel: true,
    tourId: "tour-credit-notes",
  },
  { href: "/reports", label: "Reports", icon: BarChart3, tourId: "tour-reports" },
];

const internalNav: {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  tourId?: string;
}[] = [
  { href: "/business-data", label: "Business Data", icon: Briefcase, tourId: "tour-business-data" },
  { href: "/staff", label: "Staff", icon: Contact, adminOnly: true, tourId: "tour-staff" },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck, adminOnly: true, tourId: "tour-attendance" },
];

const adminNav: {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  tourId?: string;
}[] = [
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true, tourId: "tour-settings" },
  { href: "/settings/billing", label: "Billing", icon: CreditCard, adminOnly: true, tourId: "tour-billing" },
  { href: "/users", label: "Users", icon: UserCog, adminOnly: true, tourId: "tour-users" },
];

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  tourId,
  badge,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onNavigate: () => void;
  tourId?: string;
  /** Small pill after the label, e.g. "Pro" for features on a higher plan */
  badge?: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-tour={tourId}
      className={cn(
        "group flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-200",
        active
          ? "nav-active font-semibold"
          : "text-sidebar-text hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-heading)]"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active ? "text-white" : "text-sidebar-text group-hover:text-[var(--sidebar-heading)]"
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
            active ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { user, isAdmin, signOut } = useAuth();
  const { labels, isJewellery, isHotel } = useBusinessType();
  const { can } = useOrgAccess();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(href + "/");

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const billingItems = billingNav.filter(
    (n) =>
      (!n.adminOnly || isAdmin) &&
      (!n.jewelleryOnly || isJewellery) &&
      (!n.hotelOnly || isHotel) &&
      (!n.hideForHotel || !isHotel)
  );
  const internalItems = internalNav.filter((n) => !n.adminOnly || isAdmin);
  const adminItems = adminNav.filter((n) => !n.adminOnly || isAdmin);
  const initial = (user?.full_name?.trim()?.[0] ?? "U").toUpperCase();

  const resolveLabel = (item: { label: string; labelKey?: keyof BusinessLabels }) =>
    item.labelKey ? labels[item.labelKey] : item.label;

  const NavLinks = (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--sidebar)]">
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[10px] bg-[var(--logo-plate)]">
          <Image
            src={BRAND_LOGO_ICON}
            alt={APP_NAME}
            fill
            sizes="36px"
            priority
            className="object-contain p-1"
          />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold tracking-tight text-[var(--sidebar-heading)]">
            {APP_NAME}
          </p>
          <p className="text-[10px] font-medium tracking-[0.04em] text-sidebar-text">
            {APP_TAGLINE}
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {billingItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={resolveLabel(item)}
            icon={item.icon}
            tourId={item.tourId}
            active={isActive(item.href)}
            onNavigate={close}
            // Always listed so people can find them; the page explains the upgrade
            badge={item.requiresCapability && !can(item.requiresCapability) ? "Pro" : undefined}
          />
        ))}

        <div className="my-3 border-t border-sidebar-border" role="separator" aria-hidden />
        <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-dim">
          Internal
        </p>
        {internalItems.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            tourId={item.tourId}
            active={isActive(item.href)}
            onNavigate={close}
          />
        ))}

        {adminItems.length > 0 && (
          <>
            <div className="my-3 border-t border-sidebar-border" role="separator" aria-hidden />
            {adminItems.map((item) => (
              <NavItem
                key={item.href}
                {...item}
                tourId={item.tourId}
                active={isActive(item.href)}
                onNavigate={close}
              />
            ))}
          </>
        )}
      </nav>

      <div className="mt-auto shrink-0 border-t border-sidebar-border bg-[var(--sidebar)] pt-4">
        <div className="mb-1 flex items-center gap-2.5 rounded-[10px] px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand-purple-dark)] to-[var(--brand-purple-light)] text-xs font-semibold text-white">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--sidebar-heading)]">{user?.full_name}</p>
            <p className="text-[11px] capitalize text-sidebar-text">
              Signed in as {user?.role}
            </p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm text-sidebar-text transition-colors duration-200 hover:bg-rose/15 hover:text-coral"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <MobileTabBar onMore={() => setOpen(true)} />

      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "sidebar-shell fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] flex-col p-4 pt-[max(1rem,env(safe-area-inset-top))] transition-transform duration-200 ease-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <button
          className="absolute right-3 top-[max(0.5rem,env(safe-area-inset-top))] inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm text-sidebar-text hover:text-[var(--sidebar-heading)]"
          onClick={() => setOpen(false)}
        >
          <X className="h-5 w-5" /> Close
        </button>
        {NavLinks}
      </aside>

      <aside className="sidebar-shell sticky top-0 hidden h-screen w-[17rem] shrink-0 flex-col p-4 md:flex">
        {NavLinks}
      </aside>
    </>
  );
}
