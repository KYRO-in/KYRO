// Used in the browser and on the server (automatic reminders render invoice PDFs there).
import { Font } from "@react-pdf/renderer";
import { BRAND_FONTS } from "@/lib/brand";

let registered = false;
let registerFailed = false;
let arabicRegistered = false;
/** On the server, fonts are loaded from the site itself (set by ensureInvoicePdfFonts). */
let serverOrigin = "";

/** Arabic glyphs (self-hosted in public/fonts/pdf). Used as a fallback for any Arabic text. */
export const PDF_ARABIC_FAMILY = "KayyroArabic";

function fontUrl(path: string) {
  if (typeof window !== "undefined") return `${window.location.origin}${path}`;
  return serverOrigin ? `${serverOrigin}${path}` : path;
}

/**
 * Register Inter for invoice PDFs (matches app body font) plus IBM Plex Sans
 * Arabic, so Arabic labels and Arabic customer / product names render with
 * correct letter joining. Safe to call multiple times. Falls back to Helvetica
 * if CDN fonts fail.
 */
export function ensureInvoicePdfFonts(origin?: string): void {
  if (origin) serverOrigin = origin.replace(/\/$/, "");
  if (!arabicRegistered) {
    try {
      Font.register({
        family: PDF_ARABIC_FAMILY,
        fonts: [
          { src: fontUrl("/fonts/pdf/ibm-plex-sans-arabic-400.ttf"), fontWeight: 400 },
          { src: fontUrl("/fonts/pdf/ibm-plex-sans-arabic-600.ttf"), fontWeight: 600 },
          { src: fontUrl("/fonts/pdf/ibm-plex-sans-arabic-700.ttf"), fontWeight: 700 },
        ],
      });
      arabicRegistered = true;
    } catch {
      /* Arabic text falls back to the main font */
    }
  }
  if (registered || registerFailed) return;
  try {
    Font.register({
      family: BRAND_FONTS.pdfSans,
      fonts: [
        {
          src: "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-400-normal.ttf",
          fontWeight: 400,
        },
        {
          src: "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-600-normal.ttf",
          fontWeight: 600,
        },
        {
          src: "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.5/latin-700-normal.ttf",
          fontWeight: 700,
        },
      ],
    });
    registered = true;
  } catch {
    registerFailed = true;
  }
}

export function invoicePdfFontFamily(): string {
  return registered ? BRAND_FONTS.pdfSans : BRAND_FONTS.pdfFallback;
}

/** Font stack for PDF text: the main font first, Arabic glyphs from the fallback. */
export function invoicePdfFontStack(bold = false): string[] {
  const base = invoicePdfFontFamily();
  const main = bold && base === BRAND_FONTS.pdfFallback ? "Helvetica-Bold" : base;
  return arabicRegistered ? [main, PDF_ARABIC_FAMILY] : [main];
}
