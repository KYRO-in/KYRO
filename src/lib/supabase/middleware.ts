import { isDemoMode } from "@/lib/demo/mode";
import { clientIp, memoryLimit } from "@/lib/security/rate-limit";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function hasSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(
    url &&
      key &&
      !url.includes("YOUR_PROJECT") &&
      key !== "your-anon-key" &&
      url.startsWith("http")
  );
}

/** Pages only an organization admin may open (data is also protected by RLS). */
const ADMIN_PATHS = ["/settings", "/users", "/warehouses", "/staff", "/attendance"];

/** Server-to-server callers that legitimately post from another origin. */
const CROSS_ORIGIN_POST_ALLOWED = [
  "/api/billing/webhook",
  "/api/billing/stripe/webhook",
  // Supabase pg_cron (secret-protected) and one-click unsubscribe from mail apps
  "/api/collect/run",
  "/api/collect/opt-out",
  // Customer replies (360dialog, Resend receiving), each verified by its own secret
  "/api/collect/inbound/",
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isAdminPath(path: string) {
  return ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Cross-site request forgery guard: a browser always sends Origin (or at least
 * Sec-Fetch-Site) on a cross-site POST. Reject any state-changing API call
 * that did not come from a page on this site.
 */
function isCrossSiteWrite(request: NextRequest, path: string) {
  if (!MUTATING.has(request.method) || !path.startsWith("/api/")) return false;
  if (CROSS_ORIGIN_POST_ALLOWED.some((p) => path.startsWith(p))) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site";
}

/** Coarse per-IP flood protection. Sensitive routes add shared limits on top. */
function floodLimited(request: NextRequest, path: string) {
  const ip = clientIp(request);
  if (path.startsWith("/api/")) {
    return memoryLimit(`mw:api:${ip}`, 180, 60_000);
  }
  if (path.startsWith("/i/")) {
    return memoryLimit(`mw:i:${ip}`, 40, 60_000);
  }
  return null;
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (isCrossSiteWrite(request, path)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  const limited = floodLimited(request, path);
  if (limited && !limited.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  const isAuthPage = path.startsWith("/login") || path.startsWith("/signup");
  // Password reset pages handle their own session state
  const isPasswordPage = path.startsWith("/forgot-password") || path.startsWith("/reset-password");
  const isAuthCallback = path.startsWith("/auth/callback");
  const isCompleteSetup = path.startsWith("/complete-setup");
  const isMarketingPage =
    path === "/" ||
    path.startsWith("/pricing") ||
    path.startsWith("/how-it-works") ||
    path.startsWith("/countries") ||
    path.startsWith("/contact");
  const isLegalPage =
    path.startsWith("/privacy") ||
    path.startsWith("/privacy-policy") ||
    path.startsWith("/terms") ||
    path.startsWith("/refunds") ||
    path.startsWith("/refund-policy");
  const isSetupPage = path.startsWith("/setup");
  // Public links: invoice short links, and each employee's private phone check-in page
  const isShortLink = path.startsWith("/i/") || path.startsWith("/checkin/") || path.startsWith("/u/") || path.startsWith("/pay/");
  const isPublicAsset =
    path.startsWith("/_next") ||
    path.startsWith("/marketing") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||
    path === "/manifest.json" ||
    /\.(json|webmanifest|txt|xml|ico|mp4|webm|woff2?|ttf|pdf|wasm)$/i.test(path) ||
    path.startsWith("/api");

  // Demo mode: skip Supabase entirely, allow the app through
  if (isDemoMode()) {
    if (isSetupPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    if (isAuthPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request: { headers: request.headers } });
  }

  if (!hasSupabaseEnv()) {
    if (
      isSetupPage ||
      isPublicAsset ||
      isShortLink ||
      isLegalPage ||
      isMarketingPage ||
      isAuthCallback
    ) {
      return NextResponse.next({ request: { headers: request.headers } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    return NextResponse.redirect(url);
  }

  // Configured deployments never show the setup instructions page
  if (isSetupPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Middleware auth timed out")), 8000)
      ),
    ]);
    user = result.data.user;
  } catch {
    // Fail closed: anything that is not public goes to the login page
    if (
      !isAuthPage &&
      !isPasswordPage &&
      !isCompleteSetup &&
      !isPublicAsset &&
      !isShortLink &&
      !isLegalPage &&
      !isMarketingPage &&
      !isAuthCallback
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return response;
  }

  const isPublic =
    isAuthPage ||
    isPasswordPage ||
    isCompleteSetup ||
    isPublicAsset ||
    isShortLink ||
    isLegalPage ||
    isMarketingPage ||
    isAuthCallback;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!user && isCompleteSetup) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Two-step verification: with 2FA on, the authenticator code comes before any app page.
  // (The database enforces the same rule - migration 044 - so the API is covered too.)
  // API routes are included: several act with the service role after reading the
  // signed-in user's profile, so the database rule alone would not stop them.
  const isApi = path.startsWith("/api/");
  if (user && (isApi || (!isPublic && !isCompleteSetup)) && !path.startsWith("/mfa")) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      if (isApi) {
        return NextResponse.json(
          { error: "Enter your two-step verification code first." },
          { status: 403 }
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = "/mfa";
      url.search = `?next=${encodeURIComponent(path)}`;
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  // Admin-only pages: check the role on the server, not just in the browser
  if (user && isAdminPath(path)) {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  return response;
}
