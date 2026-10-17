import type { SupabaseClient } from "@supabase/supabase-js";

let confirmed = false;

/**
 * Countries other than the UAE, reverse charge, exports, India's split and
 * 3-decimal currencies all need migration 042. Check once per session so a
 * missing migration gives a clear message instead of a half-saved document.
 */
export async function ensureTaxSchema(supabase: SupabaseClient): Promise<void> {
  if (confirmed) return;
  const { data, error } = await supabase.rpc("kayyro_schema_version");
  if (error || Number(data) < 42) {
    throw new Error(
      "Your database needs one update for this country's tax rules. Run supabase/migrations/042_multi_country_tax.sql in the Supabase SQL Editor, then try again."
    );
  }
  confirmed = true;
}

/** True when a document uses anything beyond a plain 2-decimal UAE local sale. */
export function needsTaxSchema(fields: {
  tax_country?: string | null;
  tax_treatment?: string | null;
  tax_split?: string | null;
  decimals?: number;
}): boolean {
  return (
    (!!fields.tax_country && fields.tax_country !== "AE") ||
    (!!fields.tax_treatment && fields.tax_treatment !== "domestic") ||
    (!!fields.tax_split && fields.tax_split !== "single") ||
    (fields.decimals ?? 2) > 2
  );
}
