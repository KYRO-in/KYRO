import type { MetadataRoute } from "next";

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://kayyro.example";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/login", "/signup", "/complete-setup", "/setup"],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
