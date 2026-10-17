"use client";

import { useOrganization } from "@/hooks/use-company";
import { resolveBusinessType } from "@/lib/business-type-storage";
import {
  getBusinessTypeConfig,
  isHotelBusiness,
  isJewelleryBusiness,
  type BusinessLabels,
  type BusinessType,
  type BusinessTypeConfig,
} from "@/lib/business-types";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return typeof window !== "undefined" ? localStorage.getItem("kayyro-bt-tick") ?? "0" : "0";
}

/** Call after writing local business type so hooks re-read. */
export function notifyBusinessTypeLocalChange() {
  try {
    localStorage.setItem("kayyro-bt-tick", String(Date.now()));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Current org business type + label/field config (defaults to general). */
export function useBusinessType(): {
  businessType: BusinessType;
  config: BusinessTypeConfig;
  labels: BusinessLabels;
  isLoading: boolean;
  isJewellery: boolean;
  isHotel: boolean;
} {
  const { data: org, isLoading } = useOrganization();
  useSyncExternalStore(subscribe, getSnapshot, () => "0");

  const businessType = resolveBusinessType(org?.business_type, org?.id);
  const config = getBusinessTypeConfig(businessType);
  return {
    businessType,
    config,
    labels: config.labels,
    isLoading,
    isJewellery: isJewelleryBusiness(businessType),
    isHotel: isHotelBusiness(businessType),
  };
}
