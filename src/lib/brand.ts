/** Display-only brand constants (not DB schema). */
export const APP_NAME = "Kayyro";
export const APP_TAGLINE = "Smart billing for every business";
export const APP_TITLE = "Kayyro - VAT billing for the GCC";
export const APP_DESCRIPTION =
  "VAT invoicing, inventory and customers for businesses in the UAE, Saudi Arabia, Bahrain, Oman, Qatar and Kuwait.";

/** Default invoice number prefix for new orgs (editable in Settings). */
export const DEFAULT_INVOICE_PREFIX = "KY";

/** Transparent Kayyro mark - works on light and dark backgrounds. */
export const BRAND_LOGO_ICON = "/logo/kayyro-icon.png";
/** Mark + navy wordmark, for light backgrounds. */
export const BRAND_LOGO_FULL = "/logo/kayyro-full.png";
/** Mark + white wordmark, for dark backgrounds. */
export const BRAND_LOGO_FULL_WHITE = "/logo/kayyro-full-white.png";
export const BRAND_LOGO_MARK = BRAND_LOGO_ICON;

/** Legal entity that operates Kayyro (Privacy Policy / Terms). */
export const LEGAL_ENTITY_NAME = "Focused Folks Solutions LLP";
export const LEGAL_ENTITY_ADDRESS =
  "236, Seventh Heaven, Ahmedabad, Gujarat, 380055";
/** TODO: replace with the real Kayyro support mailbox once the domain is chosen. */
export const LEGAL_SUPPORT_EMAIL = "support@kayyro.example";
/** Governing law / courts named in the Terms - DRAFT, confirm with counsel. */
export const LEGAL_GOVERNING_LAW = "the United Arab Emirates";
export const LEGAL_JURISDICTION = "Dubai, United Arab Emirates";
export const LEGAL_PRIVACY_UPDATED = "7 October 2026";
export const LEGAL_TERMS_UPDATED = "7 October 2026";
export const LEGAL_REFUNDS_UPDATED = "7 October 2026";

/**
 * Brand colors - single JS source of truth for PDF / non-CSS surfaces.
 * Keep in sync with `:root` tokens in `src/app/globals.css`
 * (`--brand-purple-dark`, `--brand-purple-light`, `--ink`, `--slate`).
 */
export const BRAND_COLORS = {
  /** Primary accent (matches --brand-purple-dark / --primary in light theme) */
  primary: "#7C1CF0",
  /** Lighter brand purple (matches --brand-purple-light) */
  primaryLight: "#B65CFF",
  /** Body text (matches --ink light theme) */
  ink: "#0B1023",
  /** Muted text (matches --slate) */
  muted: "#64748B",
  /** Soft table header wash - light, printer-friendly */
  tableHeader: "#F5F0FF",
  /** Hairline borders */
  border: "#E2E8F0",
} as const;

/** App UI fonts (Next.js). PDF uses Inter when registered; Helvetica is the print fallback. */
export const BRAND_FONTS = {
  display: "Plus Jakarta Sans",
  sans: "Inter",
  mono: "JetBrains Mono",
  /** Registered family name for @react-pdf/renderer */
  pdfSans: "Inter",
  pdfFallback: "Helvetica",
} as const;

