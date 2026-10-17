const isDev = process.env.NODE_ENV !== "production";
/** Vercel serves only HTTPS; plain-http local runs must not force https. */
const isVercel = Boolean(process.env.VERCEL);

/** Origin of the Supabase project (API, auth, storage, realtime). */
function supabaseOrigins() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

const supabase = supabaseOrigins();
const razorpay = "https://*.razorpay.com";

/**
 * Content Security Policy: the browser only loads scripts, frames and data
 * from the places Kayyro actually uses, which blunts XSS and data exfiltration.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""} ${razorpay} https://vercel.live`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase[0] ?? ""} ${razorpay}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' data: blob: ${supabase.join(" ")} ${razorpay} https://cdn.jsdelivr.net https://vercel.live${isDev ? " ws: wss:" : ""}`,
  `frame-src 'self' blob: ${razorpay} https://vercel.live`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isVercel ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self), usb=(), browsing-topics=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a second dev server (e.g. demo mode on another port) use its own cache
  // instead of corrupting the main one: NEXT_DIST_DIR=.next-demo next dev -p 3002
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Do not advertise the framework in every response
  poweredByHeader: false,
  // Never ship readable source maps of the app to browsers
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  compiler: {
    // Debug logging stays out of production bundles (errors and warnings are kept)
    removeConsole: isDev ? false : { exclude: ["error", "warn"] },
  },
  eslint: {
    // Disables ESLint errors during production builds on Vercel
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // API responses carry private data: never cache them in shared caches
        // (the public exchange-rate feed keeps its own hourly cache)
        source: "/api/((?!exchange-rates).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
