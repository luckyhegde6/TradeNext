// app/robots.ts
import { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://tradenext6.netlify.app";

/**
 * robots.ts - Search Engine + LLM Crawler Configuration
 *
 * Security & SEO:
 * - Allows all major search engines and LLM crawlers
 * - Explicitly allows /llms.txt (machine-readable site index for LLMs/agents)
 * - Blocks: API routes, admin routes, user routes, internal/tooling paths
 * - Points to sitemap for discovery
 *
 * Production boundary: the deploy publish dir is `.next` (app/ output + public/),
 * so repo-internal docs (.agents/, *.md, logs) never ship — the disallows below
 * are defense-in-depth in case such content is ever added to public/.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // LLM/agent index must always be crawlable (first rule wins for each UA)
      {
        userAgent: "*",
        allow: "/llms.txt",
      },
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
          "/favicon.ico",
          "/apple-touch-icon.png",
          "/icon-192.png",
          "/icon-512.png",
          "/manifest.json",
          "/robots.txt",
          "/sitemap.xml",
          // Internal/tooling paths — never published, blocked defensively
          "/.agents/",
          "/docs/",
          "/*.md",
          "/*.log",
        ],
      },
      // LLM/agent crawlers — allow public content + llms.txt, block internals
      {
        userAgent: [
          "GPTBot",
          "ClaudeBot",
          "anthropic-ai",
          "PerplexityBot",
          "Google-Extended",
          "FacebookBot",
          "Applebot-Extended",
          "Bytespider",
        ],
        allow: ["/", "/llms.txt"],
        disallow: [
          "/api/",
          "/admin/",
          "/users/",
          "/_next/",
          "/.agents/",
          "/docs/",
          "/*.md",
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