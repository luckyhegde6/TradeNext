// app/robots.ts
import { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://tradenext6.netlify.app";

/**
 * robots.ts - Search Engine Crawler Configuration
 * 
 * Security & SEO:
 * - Allows all major search engines
 * - Blocks: API routes, admin routes, user routes, internal paths
 * - Points to sitemap for discovery
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // General rules for all crawlers
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",           // API routes
          "/admin/",         // Admin panel
          "/users/",         // User-specific pages
          "/_next/",         // Next.js internals
          "/static/",        // Static assets
          "/favicon.ico",    // Favicon
          "/apple-touch-icon.png",
          "/icon-192.png",
          "/icon-512.png",
          "/manifest.json",
          "/robots.txt",
          "/sitemap.xml",
        ],
      },
      // Google-specific rules
      {
        userAgent: "Googlebot",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/users/",
          "/_next/",
        ],
      },
      // Bing-specific rules
      {
        userAgent: "Bingbot",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/users/",
          "/_next/",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
