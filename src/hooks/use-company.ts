"use client";

import { isDemoMode } from "@/lib/demo/mode";
import { requireOrganizationId } from "@/lib/org";
import {
  companySettingsToOrganizationPatch,
  organizationToCompanySettings,
} from "@/lib/organization";
import { createClient } from "@/lib/supabase/client";
import type { CompanySettings, Organization } from "@/lib/types";
import { resolveBusinessType } from "@/lib/business-type-storage";
import { useAuth } from "@/components/auth-provider";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { demoDb } from "@/lib/demo/store";
import { useMemo } from "react";
import { setDefaultCurrency } from "@/lib/utils";
import { mapOrgRow } from "@/lib/organization-row";

/** @deprecated Prefer useOrganization - kept for invoice PDF / settings call sites. */
export function useCompanySettings() {
  return useOrganizationAsCompany();
}

export function useOrganization() {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ["organization", user?.organization_id ?? ""],
    enabled: !authLoading && (!!user?.organization_id || isDemoMode()),
    queryFn: async (): Promise<Organization> => {
      if (isDemoMode()) {
        const demoOrg = demoDb.getOrganization();
        setDefaultCurrency(demoOrg.currency);
        return demoOrg;
      }

      const orgId = requireOrganizationId(user);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", orgId)
        .maybeSingle();

      if (error) {
        if (/relation|does not exist|schema cache/i.test(error.message)) {
          throw new Error(
            "organizations table missing. Run supabase/migrations/016_organizations.sql then 017–019."
          );
        }
        throw error;
      }

      if (!data) {
        throw new Error(
          "Organization not found for your account. Run migrations 016–019 and ensure your user has organization_id."
        );
      }

      const org = mapOrgRow(data as Record<string, unknown>);
      setDefaultCurrency(org.currency);
      return org;
    },
  });
}

function useOrganizationAsCompany() {
  const q = useOrganization();
  const data = useMemo(() => {
    if (!q.data) return undefined;
    return {
      ...organizationToCompanySettings(q.data),
      business_type: resolveBusinessType(q.data.business_type, q.data.id),
    };
  }, [q.data]);

  return {
    ...q,
    data,
  };
}

export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<CompanySettings> & { id: string }) => {
      if (isDemoMode()) {
        const org = demoDb.updateOrganization({
          id: payload.id,
          ...companySettingsToOrganizationPatch(payload),
        });
        return organizationToCompanySettings(org);
      }

      const supabase = createClient();
      const { id, ...rest } = payload;
      const patch = {
        ...companySettingsToOrganizationPatch(rest),
        updated_at: new Date().toISOString(),
      };

      let { data, error } = await supabase
        .from("organizations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();

      // Column not migrated yet - strip unknown cols and retry
      if (error && /business_type|signature_url|tax_id|country|currency|prices_include_vat|schema cache|Could not find the .* column/i.test(error.message)) {
        if (rest.business_type) {
          const { writeLocalBusinessType } = await import("@/lib/business-type-storage");
          const { normalizeBusinessType } = await import("@/lib/business-types");
          const { notifyBusinessTypeLocalChange } = await import("@/hooks/use-business-type");
          writeLocalBusinessType(id, normalizeBusinessType(rest.business_type));
          notifyBusinessTypeLocalChange();
        }
       const wantedSignature = rest.signature_url !== undefined;
        
        const safePatch = { ...patch } as Record<string, unknown>;
        delete safePatch.business_type;
        delete safePatch.signature_url;
        if (/tax_id|country|currency|prices_include_vat/i.test(error.message)) {
          throw new Error(
            "VAT settings need a database update. Run supabase/migrations/037_vat_gcc.sql in Supabase, then try again."
          );
        }
        const retry = await supabase
          .from("organizations")
          .update(safePatch)
          .eq("id", id)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
        if (!error && wantedSignature) {
          throw new Error(
            "Other settings saved, but signature storage needs a DB update. Run PASTE_028_org_signature.sql in Supabase, then try again."
          );
        }
      }

      if (error) {
        if (/permission|policy|RLS/i.test(error.message)) {
          throw new Error("Permission denied - only an admin can update organization settings.");
        }
        throw error;
      }

      // Always keep local mirror so UI respects chosen type even if DB column is missing/defaulted
      if (rest.business_type) {
        const { writeLocalBusinessType } = await import("@/lib/business-type-storage");
        const { normalizeBusinessType } = await import("@/lib/business-types");
        const { notifyBusinessTypeLocalChange } = await import("@/hooks/use-business-type");
        writeLocalBusinessType(id, normalizeBusinessType(rest.business_type));
        notifyBusinessTypeLocalChange();
      }

      return organizationToCompanySettings(mapOrgRow(data as Record<string, unknown>));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization"] });
      qc.invalidateQueries({ queryKey: ["company_settings"] });
    },
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Organization> & { id: string }) => {
      if (isDemoMode()) {
        return demoDb.updateOrganization(payload);
      }
      const supabase = createClient();
      const { id, ...rest } = payload;
      const { data, error } = await supabase
        .from("organizations")
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapOrgRow(data as Record<string, unknown>);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization"] });
      qc.invalidateQueries({ queryKey: ["company_settings"] });
    },
  });
}