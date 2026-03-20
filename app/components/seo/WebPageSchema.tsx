// app/components/seo/WebPageSchema.tsx
/**
 * WebPage Schema for Structured Data
 * Provides metadata about specific pages
 */

interface WebPageSchemaProps {
  baseUrl?: string;
  path: string;
  name: string;
  description: string;
  image?: string;
  type?: "WebPage" | "ItemPage";
}

export function WebPageSchema({
  baseUrl = "https://tradenext6.netlify.app",
  path,
  name,
  description,
  image = `${baseUrl}/og-image.png`,
  type = "WebPage",
}: WebPageSchemaProps) {
  const url = `${baseUrl}${path}`;
  const datePublished = "2026-01-01";
  const dateModified = new Date().toISOString().split("T")[0];

  const schema = {
    "@context": "https://schema.org",
    "@type": type,
    url,
    name,
    description,
    image: {
      "@type": "ImageObject",
      url: image,
      width: 1200,
      height: 630,
    },
    datePublished,
    dateModified,
    author: {
      "@type": "Organization",
      name: "TradeNext",
      url: baseUrl,
    },
    publisher: {
      "@id": `${baseUrl}/#organization`,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    inLanguage: "en-IN",
    isAccessibleForFree: "True",
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default WebPageSchema;
