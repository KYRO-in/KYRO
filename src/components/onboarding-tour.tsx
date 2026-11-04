"use client";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { isDemoMode } from "@/lib/demo/mode";
import {
  consumeOnboardingReplay,
  readOnboardingSeen,
  writeOnboardingSeen,
} from "@/lib/onboarding-storage";
import { createClient } from "@/lib/supabase/client";
import { APP_NAME } from "@/lib/brand";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type TourStep = {
  title: string;
  body: string;
  target: string | null;
  href: string;
  adminOnly?: boolean;
};

const ALL_STEPS: TourStep[] = [
  {
    title: `Welcome to ${APP_NAME}`,
    body: "This short tour explains every section in everyday words. Use Next, or click any item in the left menu - both work. Skip anytime.",
    target: null,
    href: "/dashboard",
  },
  {
    title: "Dashboard",
    body: "Your home screen. See how much you sold, what stock is low, and money customers still owe - without digging through menus.",
    target: "tour-dashboard",
    href: "/dashboard",
  },
  {
    title: "Products",
    body: "This is your product list - everything you sell. Add each item once with its name, price, and tax details. Later you’ll pick them when making a bill.",
    target: "tour-products",
    href: "/products",
  },
  {
    title: "Inventory",
    body: "Shows how many of each product you have left. When numbers get low, you’ll get a warning so you can restock in time.",
    target: "tour-inventory",
    href: "/inventory",
  },
  {
    title: "Warehouses",
    body: "If you store goods in more than one place (godown, shop, etc.), manage those locations here. Most businesses start with one main warehouse.",
    target: "tour-warehouses",
    href: "/warehouses",
    adminOnly: true,
  },
  {
    title: "Customers",
    body: "Save the people and shops you sell to - name, phone, and address. Next time you bill them, you just pick their name instead of typing again.",
    target: "tour-customers",
    href: "/customers",
  },
  {
    title: "Suppliers",
    body: "These are the vendors you buy stock from. Keep their details here so purchase bills stay organised.",
    target: "tour-suppliers",
    href: "/suppliers",
  },
  {
    title: "Purchases",
    body: "Record stock you bought from suppliers. This increases your inventory so sales don’t go out of stock by mistake.",
    target: "tour-purchases",
    href: "/purchases",
  },
  {
    title: "Invoices",
    body: "Create customer bills here in simple steps: who it’s for → what they bought → check totals → send. You can print, download PDF, or share on WhatsApp.",
    target: "tour-invoices",
    href: "/invoices",
  },
  {
    title: "Credit notes",
    body: "If a customer returns goods or you need to reduce a bill, create a credit note here. It keeps your accounts clean.",
    target: "tour-credit-notes",
    href: "/credit-notes",
  },
  {
    title: "Reports",
    body: "See sales and tax summaries for any date range. Includes your VAT return summary (VAT 201 in the UAE) for your accountant when it's time to file.",
    target: "tour-reports",
    href: "/reports",
  },
  {
    title: "Business Data",
    body: "Internal notes for costs and business figures that are not part of customer invoices - for your team only.",
    target: "tour-business-data",
    href: "/business-data",
  },
  {
    title: "Settings",
    body: "Your company name, address, tax number (TRN or VAT number) and bank details. These appear on tax invoices - keep them up to date.",
    target: "tour-settings",
    href: "/settings",
    adminOnly: true,
  },
  {
    title: "Billing (your plan)",
    body: `Manage your ${APP_NAME} subscription - trial, upgrades, and plan limits. Only admins need this screen.`,
    target: "tour-billing",
    href: "/settings/billing",
    adminOnly: true,
  },
  {
    title: "Users",
    body: "Invite teammates and choose who is an admin. Staff can bill day-to-day; admins can change settings and users.",
    target: "tour-users",
    href: "/users",
    adminOnly: true,
  },
  {
    title: "You’re ready!",
    body: "That’s every main section. Start with Products and Customers, then create your first Invoice. You can replay this tour anytime from Settings.",
    target: "tour-invoices",
    href: "/invoices",
  },
];

function clearTourHighlight() {
  document.querySelectorAll("[data-tour-active]").forEach((el) => {
    el.removeAttribute("data-tour-active");
  });
}

function highlightTourTarget(target: string | null) {
  clearTourHighlight();
  if (!target) return;
  const nodes = Array.from(document.querySelectorAll(`[data-tour="${target}"]`));
  // Prefer the visible desktop sidebar link (avoid the hidden mobile clone)
  const el =
    nodes.find((n) => n instanceof HTMLElement && n.offsetParent !== null) ??
    nodes[0];
  if (!(el instanceof HTMLElement)) return;
  el.setAttribute("data-tour-active", "true");
  try {
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch {
    /* ignore */
  }
}

function stepIndexForPath(steps: TourStep[], pathname: string): number {
  // Longest matching href wins (e.g. /settings/billing over /settings).
  // For "/" prefer the Dashboard tip (has a target) over the Welcome tip.
  let best = -1;
  let bestLen = -1;
  let bestHasTarget = false;
  steps.forEach((s, i) => {
    if (s.href === "/") {
      if (pathname !== "/") return;
      const hasTarget = Boolean(s.target);
      if (best < 0 || (hasTarget && !bestHasTarget)) {
        best = i;
        bestLen = 1;
        bestHasTarget = hasTarget;
      }
      return;
    }
    if (pathname === s.href || pathname.startsWith(s.href + "/")) {
      if (s.href.length > bestLen) {
        best = i;
        bestLen = s.href.length;
        bestHasTarget = Boolean(s.target);
      }
    }
  });
  return best;
}

export function OnboardingTour() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [forceActive, setForceActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const pathSyncRef = useRef(pathname);

  const userId = user?.id;

  const steps = useMemo(
    () => ALL_STEPS.filter((s) => !s.adminOnly || isAdmin),
    [isAdmin]
  );

  useEffect(() => {
    if (!userId) {
      setOpen(false);
      setReady(false);
      return;
    }

    if (dismissed) {
      setOpen(false);
      setForceActive(false);
      clearTourHighlight();
      setReady(true);
      return;
    }

    const forceReplay = consumeOnboardingReplay();
    if (forceReplay || forceActive) {
      if (forceReplay) {
        setForceActive(true);
        setIndex(0);
      }
      setOpen(true);
      setReady(true);
      return;
    }

    const seen = Boolean(user?.has_seen_onboarding) || readOnboardingSeen(userId);
    setOpen(!seen);
    setReady(true);
  }, [userId, user?.has_seen_onboarding, dismissed, forceActive]);

  // Sync tip only when the route changes (sidebar clicks). Do NOT re-run on
  // index changes - that trapped Next on Welcome↔Dashboard (both href "/").
  useEffect(() => {
    if (!open || steps.length === 0) return;
    if (pathSyncRef.current === pathname) return;
    pathSyncRef.current = pathname;
    const matched = stepIndexForPath(steps, pathname);
    if (matched >= 0) setIndex(matched);
  }, [pathname, open, steps]);

  // Sidebar section click - update tip even when already on that route
  useEffect(() => {
    if (!open || steps.length === 0) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tour]");
      if (!el) return;
      const tourId = el.getAttribute("data-tour");
      if (!tourId) return;
      const matched = steps.findIndex((s) => s.target === tourId);
      if (matched < 0) return;
      setIndex(matched);
      pathSyncRef.current = steps[matched]?.href ?? pathname;
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open, steps, pathname]);

  const step = steps[Math.min(index, Math.max(0, steps.length - 1))];

  useEffect(() => {
    if (!open) {
      clearTourHighlight();
      return;
    }
    const id = window.requestAnimationFrame(() => highlightTourTarget(step?.target ?? null));
    return () => window.cancelAnimationFrame(id);
  }, [open, step?.target, pathname, index]);

  // Prefetch quietly - never auto-navigate
  useEffect(() => {
    if (!open) return;
    for (const s of steps) router.prefetch(s.href);
  }, [open, steps, router]);

  const finish = async () => {
    clearTourHighlight();
    setDismissed(true);
    setForceActive(false);
    setOpen(false);
    if (userId) writeOnboardingSeen(userId);

    if (isDemoMode() || !userId) return;
    try {
      const supabase = createClient();
      await supabase.from("users").update({ has_seen_onboarding: true }).eq("id", userId);
    } catch (e) {
      console.warn("[onboarding] could not save flag:", e);
    }
  };

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    const href = steps[clamped]?.href;
    setIndex(clamped);
    // Keep path sync ref aligned so Next→same-path steps aren't overwritten
    if (href) pathSyncRef.current = href;
    // Only navigate when the user presses Next/Back - sidebar Links work on their own
    if (href && href !== pathname) {
      router.push(href);
    }
  };

  if (!ready || !open || !step) return null;

  const sectionLabel =
    step.href === "/"
      ? index === 0
        ? "Start"
        : "Dashboard"
      : step.href.replace(/^\//, "").replace(/\//g, " › ");
  const progress = ((index + 1) / steps.length) * 100;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[210] flex justify-center p-3 sm:p-4 md:pl-64"
      role="dialog"
      aria-label="Welcome tour"
    >
      <div className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-lift">
        <div className="h-1 bg-border">
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate">
            Tip {index + 1} of {steps.length}
            <span className="ml-2 normal-case tracking-normal text-slate-dim">
              · {sectionLabel}
            </span>
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold text-ink sm:text-xl">
            {step.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate sm:text-[15px]">{step.body}</p>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => void finish()}>
              Skip tour
            </Button>
            <div className="flex gap-2">
              {index > 0 && (
                <Button type="button" variant="secondary" onClick={() => goTo(index - 1)}>
                  Back
                </Button>
              )}
              {index < steps.length - 1 ? (
                <Button type="button" onClick={() => goTo(index + 1)}>
                  Next
                </Button>
              ) : (
                <Button type="button" onClick={() => void finish()}>
                  Got it
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
