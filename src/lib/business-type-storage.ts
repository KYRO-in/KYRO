import {
  normalizeBusinessType,
  type BusinessType,
} from "@/lib/business-types";

const STORAGE_PREFIX = "kayyro-business-type:";

/** Local fallback when organizations.business_type column is not migrated yet. */
export function readLocalBusinessType(orgId: string | null | undefined): BusinessType | null {
  if (!orgId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + orgId);
    if (!raw) return null;
    return normalizeBusinessType(raw);
  } catch {
    return null;
  }
}

export function writeLocalBusinessType(
  orgId: string | null | undefined,
  type: BusinessType
): void {
  if (!orgId || typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + orgId, normalizeBusinessType(type));
  } catch {
    /* ignore */
  }
}

export function resolveBusinessType(
  orgType: unknown,
  orgId?: string | null
): BusinessType {
  // Prefer explicit local choice (survives missing DB column)
  const local = readLocalBusinessType(orgId);
  if (local) return local;
  return normalizeBusinessType(orgType);
}
