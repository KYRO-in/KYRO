"use client";

import { AuthLegalFooter } from "@/components/auth/auth-legal-footer";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { APP_NAME, BRAND_LOGO_FULL, BRAND_LOGO_FULL_WHITE } from "@/lib/brand";
import {
  BUSINESS_TYPE_OPTIONS,
  DEFAULT_BUSINESS_TYPE,
  type BusinessType,
} from "@/lib/business-types";
import { isDemoMode } from "@/lib/demo/mode";
import { createClient } from "@/lib/supabase/client";
import { countryOptions, getCountryConfig, guessCountryFromTimeZone, isOfferedCountry } from "@/lib/vat/countries";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

export default function CompleteSetupPage() {
  const router = useRouter();
  const { user, loading: authLoading, refresh, signOut, sessionEmail } = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>(DEFAULT_BUSINESS_TYPE);
  const [country, setCountry] = useState<string>("AE");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const demo = isDemoMode();

  useEffect(() => {
    if (demo) router.replace("/dashboard");
  }, [demo, router]);

  useEffect(() => {
    if (authLoading) return;
    if (user?.organization_id) {
      router.replace("/dashboard");
      return;
    }
    if (!sessionEmail && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, sessionEmail, router]);

  // Details typed at sign-up travel in the user's metadata: fill the form and,
  // when everything is there, finish setup without asking again.
  const autoTried = useRef(false);
  useEffect(() => {
    if (demo || authLoading || user?.organization_id || !sessionEmail || autoTried.current) return;
    autoTried.current = true;
    void (async () => {
      const { data } = await createClient().auth.getUser();
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const name = typeof meta.business_name === "string" ? meta.business_name.trim() : "";
      const owner = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
      const type =
        typeof meta.business_type === "string" && BUSINESS_TYPE_OPTIONS.some((o) => o.value === meta.business_type)
          ? (meta.business_type as BusinessType)
          : DEFAULT_BUSINESS_TYPE;
      const metaCountry = isOfferedCountry(meta.country) ? String(meta.country).toUpperCase() : guessCountryFromTimeZone();
      if (name) setBusinessName(name);
      if (owner) setOwnerName(owner);
      setBusinessType(type);
      setCountry(metaCountry);
      if (name.length >= 2 && owner) {
        await submit({ business_name: name, owner_name: owner, business_type: type, country: metaCountry });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, authLoading, user, sessionEmail]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await submit({ business_name: businessName, owner_name: ownerName, business_type: businessType, country });
  };

  const submit = async (values: {
    business_name: string;
    owner_name: string;
    business_type: BusinessType;
    country: string;
  }) => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/complete-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as {
        error?: string;
        organization_id?: string;
        business_type?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Setup failed");
        return;
      }

      if (json.organization_id) {
        const { writeLocalBusinessType } = await import("@/lib/business-type-storage");
        const { normalizeBusinessType } = await import("@/lib/business-types");
        writeLocalBusinessType(
          json.organization_id,
          normalizeBusinessType(json.business_type ?? values.business_type)
        );
      }

      await refresh();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (demo || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cloud text-sm text-slate">
        Loading…
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cloud px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(124,28,240,0.18), transparent), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(182,92,255,0.12), transparent)",
        }}
      />
      <div className="panel relative w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-4 h-14 w-[220px]">
            <Image
              src={BRAND_LOGO_FULL}
              alt={APP_NAME}
              fill
              priority
              className="object-contain object-center dark:hidden"
              sizes="220px"
            />
            <Image
              src={BRAND_LOGO_FULL_WHITE}
              alt=""
              fill
              priority
              className="hidden object-contain object-center dark:block"
              sizes="220px"
            />
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink">
            Finish setting up
          </h1>
          <p className="mt-2 text-xs text-slate">
            You&apos;re signed in
            {sessionEmail ? (
              <>
                {" "}
                as <span className="font-medium text-ink">{sessionEmail}</span>
              </>
            ) : null}
            , but your account isn&apos;t linked to a business yet.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            id="business_name"
            label="Business name"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
          <Input
            id="owner_name"
            label="Your name"
            required
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
          <Select
            id="business_type"
            label="What kind of business is this?"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value as BusinessType)}
            options={BUSINESS_TYPE_OPTIONS.map((o) => ({
              value: o.value,
              label: `${o.emoji}  ${o.label}`,
            }))}
          />
          <Select
            id="country"
            label="Country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            options={countryOptions()}
          />
          <p className="-mt-2 text-[11px] text-slate">
            Sets your currency and tax: {getCountryConfig(country).currency},{" "}
            {getCountryConfig(country).taxSystem === "none"
              ? "no VAT"
              : `${getCountryConfig(country).taxName} ${getCountryConfig(country).standardRate}% standard rate`}
            . You can change it later in Settings.
          </p>
          {error && <p className="text-xs text-rose">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Create business &amp; continue
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-slate">
          Wrong account?{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </p>
        <AuthLegalFooter />
      </div>
    </div>
  );
}
