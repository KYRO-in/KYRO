import type { Metadata } from "next";
import { LandingFooter } from "@/components/marketing/landing/landing-footer";
import { LandingNav } from "@/components/marketing/landing/landing-nav";
import { APP_DESCRIPTION, APP_NAME, APP_TITLE } from "@/lib/brand";

export const metadata: Metadata = {
  title: {
    default: APP_TITLE,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    type: "website",
    images: [{ url: "/marketing/kayyro-tour-poster.jpg", width: 1600, height: 900 }],
  },
};

/** One dark, animated shell for every public page: home, pricing, how-to, contact. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark landing relative min-h-screen overflow-x-clip">
      {/* No JavaScript: show everything instead of leaving reveal animations at their hidden start state */}
      <noscript>
        <style>{`.landing [style*="opacity: 0"],.landing [style*="translateY"],.landing [style*="translate"]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <LandingNav />
      {children}
      <LandingFooter />
    </div>
  );
}
