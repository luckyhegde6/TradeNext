# AMP Implementation Plan for TradeNext

## Executive Summary

This document outlines a comprehensive plan to add Accelerated Mobile Pages (AMP) capabilities to TradeNext for faster loading and better rendering on mobile devices. Given that AMP is being deprecated by Google in favor of newer web standards, this plan recommends **modern alternatives** that achieve the same performance goals.

---

## Current Site Analysis

### Page Structure (Public Pages)
| Route | Type | Priority | AMP Eligible |
|-------|------|----------|--------------|
| `/` (Dashboard) | Dynamic - Server | High | ⚠️ Complex |
| `/markets` | Static/ISR | High | ✅ Yes |
| `/markets/analytics` | Dynamic - Client | High | ⚠️ Complex |
| `/markets/calendar` | Dynamic - Client | Medium | ⚠️ Complex |
| `/markets/screener` | Dynamic - Client | Medium | ⚠️ Complex |
| `/markets/[index]` | Dynamic - Server | High | ⚠️ Complex |
| `/news` | Static/ISR | Medium | ✅ Yes |
| `/contact` | Static | Low | ✅ Yes |
| `/company/[ticker]` | Dynamic - Server | High | ⚠️ Complex |
| `/portfolio` | Dynamic - Auth | High | ❌ No (Auth) |
| `/posts` | Static/ISR | Low | ✅ Yes |

### Performance Bottlenecks Identified
1. **Chunk Load Errors** - 404s on JS/CSS in production (CDN cache issue)
2. **Client-side rendering** - Many pages use `"use client"` with SWR fetching
3. **Large JavaScript bundles** - Chart libraries, analytics, UI components
4. **No static optimization** - Heavy dynamic rendering

---

## Recommended Approach

### Modern Alternatives to Traditional AMP

Since AMP is being deprecated, we'll use **modern web performance techniques** that provide similar benefits:

| AMP Feature | Modern Alternative | Implementation |
|-------------|-------------------|----------------|
| AMP HTML | Next.js Static Export | `output: 'export'` |
| AMP Cache | Vercel/Netlify Edge | Built-in CDN |
| AMP Boilerplate | Tailwind CSS | Reduced CSS |
| AMP Scripts | Partial Hydration | `dynamic = 'force-static'` |
| AMP Analytics | GA4 + lightweight | Optimized GA |
| AMP Boilerplate | ISR/SSG | Static generation |

---

## Implementation Plan

### Phase 1: Static Optimization (Week 1)

#### 1.1 Convert Static Pages to Static Export
```typescript
// next.config.ts
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true, // Required for static export
  },
  // Enable Incremental Static Regeneration
  experimental: {
    isrMemoryCacheGrowth: 10 * 1000 * 1000, // 10MB
  },
}
```

**Pages to convert:**
- `/news` - News feed (high traffic)
- `/contact` - Contact form
- `/posts` - Community posts
- `/docs` - Documentation

#### 1.2 Add Static Generation to Dynamic Pages
Add `export const dynamic = 'force-static'` to eligible pages:

```typescript
// app/markets/page.tsx
export const dynamic = 'force-static';
export const revalidate = 300; // 5 minutes

// This pre-renders the page at build time
// Serves instantly from CDN
```

### Phase 2: Performance Optimization (Week 2)

#### 2.1 Code Splitting & Lazy Loading
```typescript
// Optimize imports
const MarketTable = dynamic(() => import('@/components/MarketTable'), {
  loading: () => <TableSkeleton />,
  ssr: false, // No SSR for charts
})
```

#### 2.2 Image Optimization
- Use `next/image` with proper sizing
- Add `priority` for above-fold images
- Use WebP/AVIF formats

#### 2.3 Font Optimization
- Use `next/font` for Google Fonts
- Preload critical fonts
- Subset fonts (remove unused glyphs)

### Phase 3: Edge Caching (Week 3)

#### 3.1 Configure ISR (Incremental Static Regeneration)
```typescript
// API routes - cache control
export async function GET() {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  })
}
```

#### 3.2 Edge Functions
For dynamic content, use edge functions:
```typescript
// app/api/nse/indexes/route.ts
export const runtime = 'edge'

export async function GET() {
  // Faster than nodejs runtime
}
```

### Phase 4: Analytics & Monitoring (Week 4)

#### 4.1 Core Web Vitals Monitoring
- Track LCP (Largest Contentful Paint)
- Track FID (First Input Delay) 
- Track CLS (Cumulative Layout Shift)
- Use Google PageSpeed Insights

#### 4.2 Optimized Analytics
```typescript
// Replace heavy GA with lightweight alternatives
// Use fetch API with beacon for background reporting
navigator.sendBeacon('/api/analytics', JSON.stringify(data))
```

---

## Implementation Checklist

### Files to Modify

| File | Changes |
|------|---------|
| `next.config.ts` | Add static export, image optimization |
| `app/layout.tsx` | Add font optimization, preload |
| `app/page.tsx` | Add static generation |
| `app/markets/page.tsx` | Add ISR, static params |
| `app/news/page.tsx` | Convert to static export |
| `app/company/[ticker]/page.tsx` | Add ISR, dynamic = 'force-static' |

### New Files to Create

| File | Purpose |
|------|---------|
| `lib/performance.ts` | Performance monitoring utilities |
| `app/components/LazyLoad.tsx` | Lazy loading wrapper |
| `app/metadata.ts` | Static metadata for pages |

### Environment Variables

```bash
# Enable static export for specific pages
STATIC_PAGE_MARKETS=true
STATIC_PAGE_NEWS=true
STATIC_PAGE_CONTACT=true
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Auth pages can't be static | Low | Keep dynamic with edge caching |
| Dynamic data becomes stale | Medium | Use ISR with short revalidation |
| Chart libraries break | High | Use lazy loading, no SSR |
| Build time increases | Medium | Use incremental builds |

---

## Success Metrics

### Performance Targets
- **LCP**: < 2.5 seconds (currently unknown)
- **FID**: < 100ms (currently unknown)  
- **CLS**: < 0.1 (currently unknown)
- **TTFB**: < 500ms (with edge caching)

### Implementation Goals
- **Phase 1**: 3 static pages optimized
- **Phase 2**: All public pages under 100KB JS
- **Phase 3**: Edge caching for all API routes
- **Phase 4**: Core Web Vitals in green

---

## Timeline

| Week | Tasks | Deliverables |
|------|-------|--------------|
| 1 | Static optimization | 4 pages static export |
| 2 | Code splitting | Lazy loaded components |
| 3 | Edge caching | ISR configured |
| 4 | Monitoring | Performance dashboard |

---

## Recommendation

**Start with Phase 1** - convert `/news` and `/contact` to static export as proof of concept. These are high-traffic, low-complexity pages that will demonstrate the performance improvement immediately.

Once proven, proceed with other phases systematically.