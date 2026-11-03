# Spec Document — Spec 38: RefSite-style Theme Refresh + Design System

> Saved to `.agents/specs/38-refsite-style-theme-refresh.md`
> Companion plan: `.agents/plans/38-refsite-style-theme-refresh.md`
> Branch (planned): `feature/refsite-style-theme-refresh` (off `main`)
> Status: **SPEC DRAFT — pending human approval before implementation (D9)**

## 1. Overview

**What**: A visual/UX overhaul of TradeNext to adopt the design language of RefSite (a Next.js + Tailwind 4 reference app): a full design-token system (light + dark), Outfit/Inter typography, layered card/header shadows, brand-tinted page glow, semantic up/down color tokens, an 8-color chart palette, heat-map tiers, button micro-interactions, a wider responsive container, and a manual dark-mode class toggle. Plus a deep-research appendix documenting every RefSite screen, its data contract, and its UI behavior, so the Market Pulse / Strength dashboards (Spec 37) can ship with this look.

**Why**: TradeNext currently ships a minimal token set (6 CSS variables, Arial font, blue primary, flat cards, `prefers-color-scheme` dark mode). RefSite demonstrates a noticeably more polished, "calm" trading UI — layered shadows, brand glow, semantic color tokens, smooth scroll, pill buttons, and a consistent 14px card radius — that improves perceived quality and readability of dense market data. The user explicitly requested "implement similar styling features".

**Scope**:
- IN: design tokens (CSS variables, light + `.dark`), Tailwind 4 config wiring, font swap (Outfit + Inter via `next/font`), header (sticky 56px + shadow-header), card component (`surface-card` + glow + 14px radius), button micro-interactions, page glow, up/down color tokens applied to P&L/gains/alerts, chart palette tokens, main container (max-w 1800px, responsive padding), dark-mode class toggle, heat-map tiers (token only, component later).
- OUT: No data/feature changes. No new routes. No migration. No new packages except optionally `lenis` (deferred). No Crypto/Gold (NSE-only product). The actual Market Pulse / Strength dashboards are Spec 37 (separate).

**Depends on**: Tailwind CSS 4.x (already), `tailwind.config.ts` (exists), `app/globals.css` (exists), `app/layout.tsx` (exists). Nothing else.

## 2. Routes

No new or modified routes. Purely presentational.

## 3. Database Schema

No changes.

## 4. Functions to Implement

### A. `app/globals.css` — token block

Replace the current 6-variable `:root` + `prefers-color-scheme` block with the full RefSite token set. See **Appendix A** for the exact values.

Structure:
```css
@import "tailwindcss";
@config "../tailwind.config.ts";

:root {
  /* brand */
  --brand: var(--brand-custom-light, #512feb);
  --brand-foreground: #fff;
  --brand-deep: #512feb;
  --brand-mid: #725adb;
  --brand-tint: #efecfb;
  --brand-glow: #512feb1f;
  --electric: #4000ff;

  /* surfaces */
  --background: #f6f6f8;
  --section-from: #f6f6f8;
  --section-to: #f1f1f5;
  --foreground: #0b0b10;
  --foreground-secondary: #3b3a45;
  --muted-foreground: #64636f;
  --subtle-foreground: #75747f;
  --surface: #fff;
  --surface-2: #fafafc;
  --surface-3: #f1f1f5;
  --surface-raised: #fff;
  --surface-muted: #ececf1;
  --surface-muted-2: #e3e3ea;
  --fill: #14103c0a;
  --fill-faint: #14103c05;
  --hairline: #281e6e12;
  --hairline-strong: #281e6e1f;
  --border: #0f0f2314;
  --border-strong: #0f0f2324;

  /* semantic */
  --up: #15803d;
  --up-bright: #16a34a;
  --up-glow: #16a34a29;
  --down: #dc2626;
  --flat: #64636f;
  --warn: #b45309;
  --info: #0369a1;

  /* charts */
  --chart-1: #6a4cf0;
  --chart-2: #ea6a1a;
  --chart-3: #079cd8;
  --chart-4: #db2777;
  --chart-5: #3b82f6;
  --chart-6: #b07a06;
  --chart-7: #d946ef;
  --chart-8: #0d9488;
  --chart-grid: #14103c0f;
  --chart-axis: #75747f;

  /* heat map */
  --heat-mid: #ececf1;
  --heat-down-1: #ef4444;
  --heat-down-2: #ef4444;
  --heat-down-3: #b91c1c;
  --heat-up-1: #16a34a;
  --heat-up-2: #16a34a;
  --heat-up-3: #15803d;

  /* ramp */
  --ramp-seq-1: #e9e4fd;
  --ramp-seq-2: #c4b5fd;
  --ramp-seq-3: #8b6cf6;
  --ramp-seq-4: #5b3fd6;
  --ramp-seq-5: #2e1a8a;

  /* radius */
  --radius: .625rem;
  --header-h: 3.5rem;

  /* shadows */
  --shadow-card: 0 0 0 1px #281e6e0f, 0 1px 2px #14103c0a, 0 10px 28px -18px #14103c29;
  --shadow-raised: 0 0 0 1px #512feb24, 0 2px 4px #14103c0d, 0 18px 40px -20px #14103c3d;
  --shadow-pop: 0 0 0 1px #281e6e14, 0 4px 10px #14103c0f, 0 24px 56px -16px #14103c3d;
  --shadow-glow: 0 24px 80px -36px var(--brand-glow);
  --shadow-inset: inset 0 1px 2px #14103c0f, inset 0 0 0 1px #0f0f230f;
  --shadow-control: 0 0 0 1px #0f0f2314, 0 1px 2px #14103c0f, inset 0 1px 0 #fffc;
  --shadow-header: 0 1px 0 #0f0f2314, 0 8px 24px -12px #14103c2e;

  /* page glow */
  --page-glow: radial-gradient(1100px 480px at 15% -14%, #512feb12, transparent 62%), radial-gradient(900px 420px at 100% -10%, #079cd80a, transparent 60%);
  --spotlight: #512feb0f;
  --spotlight-border: #512feb73;

  /* shadcn-compat aliases */
  --card: var(--surface);
  --card-foreground: var(--foreground);
  --popover: #fff;
  --popover-foreground: var(--foreground);
  --primary: var(--brand);
  --primary-foreground: var(--brand-foreground);
  --secondary: var(--surface-muted);
  --secondary-foreground: var(--foreground);
  --muted: var(--surface-muted);
  --accent: var(--surface-3);
  --accent-foreground: var(--foreground);
  --destructive: var(--down);
  --input: #0f0f231a;
  --ring: var(--brand);
  --sidebar: var(--surface);
  --sidebar-foreground: var(--foreground);
  --sidebar-primary: var(--brand);
  --sidebar-primary-foreground: var(--brand-foreground);
  --sidebar-accent: var(--brand-tint);
  --sidebar-accent-foreground: var(--foreground);
  --sidebar-border: var(--border);
  --sidebar-ring: var(--ring);
  --surface-sheen: linear-gradient(180deg, #ffffffe6, #fff0 38%);
}

.dark {
  --brand: var(--brand-custom, #8b5cf6);
  --brand-deep: #8b5cf6;
  --brand-mid: #a78bfa;
  --brand-tint: #1e1a33;
  --brand-glow: #8b5cf61f;
  --background: #030303;
  --section-from: #030303;
  --section-to: #0a0a0d;
  --foreground: #f4f3f8;
  --foreground-secondary: #c8c7d0;
  --muted-foreground: #8a8996;
  --subtle-foreground: #75747f;
  --surface: #0d0d10;
  --surface-2: #131318;
  --surface-3: #1a1a20;
  --surface-raised: #151519;
  --surface-muted: #1f1f26;
  --surface-muted-2: #2a2a33;
  --fill: #ffffff0d;
  --fill-faint: #ffffff06;
  --hairline: #ffffff12;
  --hairline-strong: #ffffff1f;
  --border: #ffffff12;
  --border-strong: #ffffff1f;
  --up: #22c55e;
  --up-bright: #4ade80;
  --up-glow: #22c55e29;
  --down: #ef4444;
  --flat: #8a8996;
  --warn: #fbbf24;
  --info: #38bdf8;
  --chart-grid: #ffffff0f;
  --chart-axis: #8a8996;
  --heat-mid: #1f1f26;
  --shadow-card: 0 0 0 1px #ffffff0f, 0 1px 2px #00000040, 0 10px 28px -18px #00000060;
  --shadow-raised: 0 0 0 1px #8b5cf624, 0 2px 4px #00000040, 0 18px 40px -20px #00000070;
  --shadow-pop: 0 0 0 1px #ffffff14, 0 4px 10px #00000040, 0 24px 56px -16px #00000070;
  --shadow-glow: 0 24px 80px -36px #8b5cf61f;
  --shadow-header: 0 1px 0 #ffffff12, 0 8px 24px -12px #00000060;
  --popover: #151519;
  --popover-foreground: var(--foreground);
  --input: #ffffff1a;
  --sidebar: var(--surface);
  --sidebar-foreground: var(--foreground);
  --sidebar-primary: var(--brand);
  --sidebar-primary-foreground: var(--brand-foreground);
  --sidebar-accent: var(--brand-tint);
  --sidebar-accent-foreground: var(--foreground);
  --sidebar-border: var(--border);
  --sidebar-ring: var(--ring);
  --surface-sheen: linear-gradient(180deg, #ffffff0a, #fff0 38%);
  --page-glow: radial-gradient(1100px 480px at 15% -14%, #8b5cf612, transparent 62%), radial-gradient(900px 420px at 100% -10%, #079cd80a, transparent 60%);
  --spotlight: #8b5cf60f;
  --spotlight-border: #8b5cf673;
}

body {
  color: var(--foreground);
  background: var(--background);
  background-image: var(--page-glow);
  background-attachment: fixed;
  font-family: var(--font-body, 'Inter'), ui-sans-serif, system-ui, sans-serif;
}

/* Smooth scroll (optional, requires lenis) */
html.lenis { height: auto; }
.lenis.lenis-smooth { scroll-behavior: auto; }
```

### B. `tailwind.config.ts` — extend theme

Add `colors`, `fontFamily`, `borderRadius`, `boxShadow`, `spacing` tokens so utilities resolve:
```ts
theme: {
  extend: {
    colors: {
      background: 'var(--background)',
      foreground: 'var(--foreground)',
      surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)', 3: 'var(--surface-3)', raised: 'var(--surface-raised)', muted: 'var(--surface-muted)', 'muted-2': 'var(--surface-muted-2)' },
      border: 'var(--border)',
      'border-strong': 'var(--border-strong)',
      hairline: 'var(--hairline)',
      fill: 'var(--fill)',
      muted: { DEFAULT: 'var(--surface-muted)', foreground: 'var(--muted-foreground)' },
      primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
      up: { DEFAULT: 'var(--up)', bright: 'var(--up-bright)', glow: 'var(--up-glow)' },
      down: 'var(--down)',
      flat: 'var(--flat)',
      warn: 'var(--warn)',
      info: 'var(--info)',
      chart: { 1:'var(--chart-1)', 2:'var(--chart-2)', 3:'var(--chart-3)', 4:'var(--chart-4)', 5:'var(--chart-5)', 6:'var(--chart-6)', 7:'var(--chart-7)', 8:'var(--chart-8)' },
      heat: { mid:'var(--heat-mid)', 'down-1':'var(--heat-down-1)', 'down-2':'var(--heat-down-2)', 'down-3':'var(--heat-down-3)', 'up-1':'var(--heat-up-1)', 'up-2':'var(--heat-up-2)', 'up-3':'var(--heat-up-3)' },
      brand: { DEFAULT:'var(--brand)', deep:'var(--brand-deep)', mid:'var(--brand-mid)', tint:'var(--brand-tint)', glow:'var(--brand-glow)' },
    },
    fontFamily: {
      sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      heading: ['var(--font-heading)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    borderRadius: { DEFAULT: 'var(--radius)', card: '14px', pill: '9999px' },
    boxShadow: {
      card: 'var(--shadow-card)',
      raised: 'var(--shadow-raised)',
      pop: 'var(--shadow-pop)',
      glow: 'var(--shadow-glow)',
      inset: 'var(--shadow-inset)',
      control: 'var(--shadow-control)',
      header: 'var(--shadow-header)',
    },
  },
}
```

### C. `app/layout.tsx` — fonts + dark class

```tsx
import { Outfit, Inter } from 'next/font/google';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-heading', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

// html className: `${outfit.variable} ${inter.variable}` + (dark ? 'dark' : '')
```

Dark mode: read persisted preference from `localStorage` (key `theme`) on mount, apply `.dark` to `<html>`. Default = light (RefSite default). Provide a `useTheme()` hook + toggle button in Header.

### D. `app/components/ui/Button.tsx` — micro-interactions

Add classes: `transition-[color,background-color,box-shadow,transform,opacity] duration-150 ease-out active:not-disabled:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`.

### E. `app/Header.tsx` — sticky 56px + shadow-header

Add `sticky top-0 z-40 h-14 bg-surface shadow-header` and a dark-mode toggle button.

### F. `app/components/ui/Card.tsx` (or `.surface-card` utility)

```css
.surface-card {
  background: var(--surface);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: 1.25rem 1.75rem;
}
.glow-brand { box-shadow: var(--shadow-card), var(--shadow-glow); }
```

### G. Main container

`<main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col px-3 pt-5 pb-8 sm:px-6 sm:pt-7">`

### H. Chart config

Feed `--chart-1..8` into Recharts `colors` / TradingView lightweight-charts series colors.

### I. Heat-map tiers (token only)

Expose `--heat-up-1/2/3` and `--heat-down-1/2/3` + `--heat-mid`; component implementation deferred to Spec 37 (Market Pulse sector treemap).

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `app/globals.css` | Modified | Full token block (light + `.dark`), body font + page glow |
| `tailwind.config.ts` | Modified | Extend colors/fonts/radius/shadows |
| `app/layout.tsx` | Modified | Outfit + Inter via next/font, html classes, theme init script |
| `app/Header.tsx` | Modified | Sticky 56px, shadow-header, dark toggle |
| `app/components/ui/Button.tsx` | Modified | Micro-interactions |
| `app/components/ui/Card.tsx` | Created/Modified | `surface-card` + glow |
| Various chart components | Modified | Use `--chart-*` tokens |
| `lib/hooks/useTheme.ts` | Created | Theme toggle hook (localStorage) |

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None (required) | — | All via Tailwind 4 + next/font |
| `lenis` (optional, deferred) | latest | Smooth scroll — can add later |

### Internal Dependencies

| Module | Used For |
|--------|----------|
| `@/lib/logger` | Theme change logging (optional) |

## 7. API Contract

N/A — no API changes.

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `Button` | `app/components/ui/Button.tsx` | Shared button with micro-interactions |
| `Card` / `surface-card` | `app/components/ui/Card.tsx` | Layered shadow card |
| `ThemeToggle` | `app/Header.tsx` | Light/dark switch |

### States

- **Loading**: unchanged (skeleton)
- **Empty**: unchanged
- **Error**: unchanged
- **Data**: new card/shadow treatment

### Responsive

- Desktop (1440px): full layout, max-w 1800px
- Tablet (768px): stacked, px-6
- Mobile (375px): single column, px-3, no horizontal overflow

### Dark mode

- Manual toggle via `.dark` class on `<html>` (not `prefers-color-scheme`).
- Persisted in `localStorage` key `theme`.
- Default: light.
- All tokens swap via `.dark` selector.

## 9. Rules & Guardrails

- [ ] No Prisma in client components (N/A — no DB)
- [ ] All colors via CSS variables (no hardcoded hex in components)
- [ ] Dark mode tested for every touched component
- [ ] `npx tsc --noEmit` 0 new errors
- [ ] `npm run lint` 0 errors
- [ ] Responsive at 375/768/1440
- [ ] No console errors

## 10. Expected Behavior

1. All existing pages render with the new token-based theme (light by default).
2. Toggling dark mode swaps every color/shadow via `.dark` class without a page reload.
3. Cards show layered shadow + brand glow; header shows shadow-header.
4. Buttons scale to 0.97 on active press with 150ms ease-out.
5. Page background shows the brand-tinted radial glow.
6. Outfit renders for headings, Inter for body.
7. Up/down P&L values use `--up`/`--down` tokens (green/red) consistently.
8. Chart series use `--chart-1..8` palette.
9. No horizontal overflow at 375px.
10. Dark mode persists across reloads via localStorage.

## 11. Error Handling

N/A — presentational only. No failure modes beyond missing font (fallback to system-ui).

## 12. Test Strategy

### Unit Tests
- `useTheme` hook: toggles class, persists to localStorage, reads initial.

### E2E Tests (`e2e/`)
- Theme toggle switches `.dark` class on `<html>`.
- Dark mode persists after reload.
- No console errors on home/portfolio/screener in light + dark.
- Responsive: no horizontal overflow at 375px in light + dark.

## 13. Performance Considerations

- Fonts: `display: 'swap'`, self-hosted via next/font (no FOUT, no external request).
- Page glow: `background-attachment: fixed` (single paint).
- Shadows: CSS-only, no JS.
- Lenis deferred (optional, not in v1).

## 14. Security Considerations

N/A — no auth/data changes.

## 15. Definition of Done

- [ ] All tokens in `globals.css` (light + `.dark`)
- [ ] `tailwind.config.ts` extended with colors/fonts/radius/shadows
- [ ] Fonts wired in `layout.tsx`
- [ ] Header sticky 56px + shadow-header + dark toggle
- [ ] Card component with surface-card + glow
- [ ] Button micro-interactions
- [ ] Page glow on body
- [ ] Main container max-w 1800px + responsive padding
- [ ] Up/down tokens applied to P&L/gains/alerts
- [ ] Chart palette wired into chart configs
- [ ] `npx tsc --noEmit` 0 new errors
- [ ] `npm run test` all pass
- [ ] `npm run lint` 0 errors
- [ ] Playwright: light + dark + 375/768/1440, 0 console errors
- [ ] Documentation updated

---

# Appendix A — RefSite design tokens (full reference)

(Source: live capture of `https://refsite.com/pulse/` on 2026-11-03 via Playwright + `getComputedStyle`.)

## A.1 Light theme (`:root`)

| Token | Value |
|---|---|
| `--radius` | `.625rem` |
| `--header-h` | `3.5rem` |
| `--brand` | `var(--brand-custom-light, #512feb)` |
| `--brand-foreground` | `#fff` |
| `--brand-deep` | `#512feb` |
| `--brand-mid` | `#725adb` |
| `--brand-tint` | `#efecfb` |
| `--brand-glow` | `#512feb1f` |
| `--electric` | `#4000ff` |
| `--background` | `#f6f6f8` |
| `--section-from` | `#f6f6f8` |
| `--section-to` | `#f1f1f5` |
| `--foreground` | `#0b0b10` |
| `--foreground-secondary` | `#3b3a45` |
| `--muted-foreground` | `#64636f` |
| `--subtle-foreground` | `#75747f` |
| `--surface` | `#fff` |
| `--surface-2` | `#fafafc` |
| `--surface-3` | `#f1f1f5` |
| `--surface-raised` | `#fff` |
| `--surface-muted` | `#ececf1` |
| `--surface-muted-2` | `#e3e3ea` |
| `--fill` | `#14103c0a` |
| `--fill-faint` | `#14103c05` |
| `--hairline` | `#281e6e12` |
| `--hairline-strong` | `#281e6e1f` |
| `--border` | `#0f0f2314` |
| `--border-strong` | `#0f0f2324` |
| `--up` | `#15803d` |
| `--up-bright` | `#16a34a` |
| `--up-glow` | `#16a34a29` |
| `--down` | `#dc2626` |
| `--flat` | `#64636f` |
| `--warn` | `#b45309` |
| `--info` | `#0369a1` |
| `--chart-1`..`--chart-8` | `#6a4cf0, #ea6a1a, #079cd8, #db2777, #3b82f6, #b07a06, #d946ef, #0d9488` |
| `--chart-grid` | `#14103c0f` |
| `--chart-axis` | `#75747f` |
| `--heat-mid` | `#ececf1` |
| `--heat-down-1/2/3` | `#ef4444, #ef4444, #b91c1c` |
| `--heat-up-1/2/3` | `#16a34a, #16a34a, #15803d` |
| `--ramp-seq-1..5` | `#e9e4fd, #c4b5fd, #8b6cf6, #5b3fd6, #2e1a8a` |
| `--shadow-card` | `0 0 0 1px #281e6e0f, 0 1px 2px #14103c0a, 0 10px 28px -18px #14103c29` |
| `--shadow-raised` | `0 0 0 1px #512feb24, 0 2px 4px #14103c0d, 0 18px 40px -20px #14103c3d` |
| `--shadow-pop` | `0 0 0 1px #281e6e14, 0 4px 10px #14103c0f, 0 24px 56px -16px #14103c3d` |
| `--shadow-glow` | `0 24px 80px -36px #512feb1f` |
| `--shadow-inset` | `inset 0 1px 2px #14103c0f, inset 0 0 0 1px #0f0f230f` |
| `--shadow-control` | `0 0 0 1px #0f0f2314, 0 1px 2px #14103c0f, inset 0 1px 0 #fffc` |
| `--shadow-header` | `0 1px 0 #0f0f2314, 0 8px 24px -12px #14103c2e` |
| `--page-glow` | `radial-gradient(1100px 480px at 15% -14%, #512feb12, transparent 62%), radial-gradient(900px 420px at 100% -10%, #079cd80a, transparent 60%)` |
| `--spotlight` | `#512feb0f` |
| `--spotlight-border` | `#512feb73` |
| `--surface-sheen` | `linear-gradient(180deg, #ffffffe6, #fff0 38%)` |

## A.2 Dark theme (`.dark`)

| Token | Value |
|---|---|
| `--brand` | `var(--brand-custom, #8b5cf6)` |
| `--brand-deep` | `#8b5cf6` |
| `--brand-mid` | `#a78bfa` |
| `--brand-tint` | `#1e1a33` |
| `--brand-glow` | `#8b5cf61f` |
| `--background` | `#030303` |
| `--section-from` | `#030303` |
| `--section-to` | `#0a0a0d` |
| `--foreground` | `#f4f3f8` |
| `--foreground-secondary` | `#c8c7d0` |
| `--muted-foreground` | `#8a8996` |
| `--subtle-foreground` | `#75747f` |
| `--surface` | `#0d0d10` |
| `--surface-2` | `#131318` |
| `--surface-3` | `#1a1a20` |
| `--surface-raised` | `#151519` |
| `--surface-muted` | `#1f1f26` |
| `--surface-muted-2` | `#2a2a33` |
| `--fill` | `#ffffff0d` |
| `--fill-faint` | `#ffffff06` |
| `--hairline` | `#ffffff12` |
| `--hairline-strong` | `#ffffff1f` |
| `--border` | `#ffffff12` |
| `--border-strong` | `#ffffff1f` |
| `--up` | `#22c55e` |
| `--up-bright` | `#4ade80` |
| `--up-glow` | `#22c55e29` |
| `--down` | `#ef4444` |
| `--flat` | `#8a8996` |
| `--warn` | `#fbbf24` |
| `--info` | `#38bdf8` |
| `--chart-grid` | `#ffffff0f` |
| `--chart-axis` | `#8a8996` |
| `--heat-mid` | `#1f1f26` |
| `--shadow-card` | `0 0 0 1px #ffffff0f, 0 1px 2px #00000040, 0 10px 28px -18px #00000060` |
| `--shadow-raised` | `0 0 0 1px #8b5cf624, 0 2px 4px #00000040, 0 18px 40px -20px #00000070` |
| `--shadow-pop` | `0 0 0 1px #ffffff14, 0 4px 10px #00000040, 0 24px 56px -16px #00000070` |
| `--shadow-glow` | `0 24px 80px -36px #8b5cf61f` |
| `--shadow-header` | `0 1px 0 #ffffff12, 0 8px 24px -12px #00000060` |
| `--popover` | `#151519` |
| `--popover-foreground` | `var(--foreground)` |
| `--input` | `#ffffff1a` |
| `--surface-sheen` | `linear-gradient(180deg, #ffffff0a, #fff0 38%)` |
| `--page-glow` | `radial-gradient(1100px 480px at 15% -14%, #8b5cf612, transparent 62%), radial-gradient(900px 420px at 100% -10%, #079cd80a, transparent 60%)` |
| `--spotlight` | `#8b5cf60f` |
| `--spotlight-border` | `#8b5cf673` |

## A.3 Typography

- Heading font: **Outfit** (weights 400–700), `--font-heading`
- Body font: **Inter** (weights 400–600), `--font-body`
- Base size: 16px
- H2 (section heading): 24px / 600 / `text-balance`
- H1 (page title in nav): 13px / 600 / `tracking-[-0.005em]` (muted-foreground) — RefSite uses small uppercase-ish page titles in the header, large headings inside content
- Body: 14–16px
- Numeric/tabular: default (no special tabular-nums observed, but recommended for prices)

## A.4 Spacing & layout

- Header height: 56px (`--header-h: 3.5rem`), `sticky top-0 z-40`
- Main container: `max-w-[1800px]`, `px-3 pt-5 pb-8` (mobile) → `sm:px-6 sm:pt-7` (tablet+)
- Card padding: `p-5 sm:p-7` (20px / 28px)
- Card grid gap: `gap-6` (24px) → `md:gap-8` (32px)
- Nav gap: `gap-2` (8px) between items
- Button padding: icon buttons `size-8` (32px), `rounded-full`

## A.5 UI behavior observations

- **Dark mode**: manual toggle button in header ("Switch to dark theme"); applies `.dark` class to `<html>`; persisted (likely localStorage). Default = light. NOT `prefers-color-scheme`.
- **Command palette**: `Ctrl+K` opens a modal ("Jump to a screen, open a symbol or run an action").
- **Presentation mode**: "auto-rotate every 20s" button — cycles screens.
- **Display settings**: button in header.
- **Search**: "Search screens and symbols" button.
- **Market status pill**: "NSE · Closed · opens 7h 35m" in header.
- **Account menu**: avatar initials (LG) → dropdown with email.
- **"More" menu**: dropdown with Screeners / Strength Boards / Trading Journal / F&O Academy / Support RefSite.
- **View toggles**: radiogroup (Overview / Money flow / Order flow) on Pulse.
- **Buttons**: `active:not-disabled:scale-[0.97]`, 150ms ease-out transition, focus-visible 2px ring offset 2, disabled opacity 45%.
- **Cards**: `overflow-hidden`, relative, grid layout, `glow-brand` adds brand glow shadow.
- **Smooth scroll**: Lenis (`html.lenis`, `.lenis.lenis-smooth { scroll-behavior: auto }`).
- **Tooltips/notifications**: region "Notifications alt+T".
- **Loading**: skeleton (implied by `loader_delay: 180` in config).
- **Responsive**: mobile-first with `sm:` (640px) breakpoint; nav collapses to hamburger (`lg:hidden`); main padding reduces.

## A.6 RefSite screen inventory (deep research)

(See the analysis in the conversation; full data contracts captured. Summary of routes + data endpoints:)

| Route | Title | Data endpoint(s) |
|---|---|---|
| `/pulse/` | Market Pulse | `pulse.json`, `flow.json` |
| `/news/` | Market News | `news.json` |
| `/options/` | Option Pulse | `options@symbol-X.json` |
| `/radar/` | Stock Radar | `radar@symbol-X.json` |
| `/calm/` | Calm Zone | `calm.json` |
| `/crypto/` | Crypto & Gold | `crypto.json`, `live.json` |
| `/liquidity/` | Liquidity Map | `liq@symbol-X__tf-Y.json` |
| `/oi-flow/` | OI Flow | `oiflow@symbol-X.json` |
| `/strength/` | Strength Boards | `strength.json` |
| `/screeners/basis/` | Futures basis | `screen_basis@mode-...__par-...__series-....json` |
| `/journal/` | Trading Journal | client-side (no endpoint) |
| `/academy/` | F&O Academy | client-side content |
| `/` (support) | — | external (buymeacoffee) |

Refresh cadence (from `config.json`): `pulse_live 17s`, `pulse_closed 10min`, `pulse_sim 4s`, `flow_live 27s`, `flow_closed 10min`, `flow_sim 3.5s`, `opt 62s`, `radar 143s`, `live 12s`, `live_sim 1.5s`, `liq_live 92s`, `liq_closed 10min`, `liq_crypto 284s`, `liq_book 30s`, `oiflow_live 62s`, `oiflow_closed 10min`, `oiflow_sim 20s`, `screen_fast 62s`, `screen 62s`, `screen_slow 143s`, `quotes 12s`, `strength 62s`, `strength_closed 10min`. Market hours `09:15–15:30` IST, tz `Asia/Kolkata`.

## A.7 Buildup taxonomy (F&O)

- **SB** = Short Buildup (price down, OI up)
- **LU** = Long Unwinding (price down, OI down)
- **SC** = Short Covering (price up, OI down)
- **LB** = Long Buildup (price up, OI up)

Used in both Liquidity Map and OI Flow screens. TradeNext's F&O analytics can adopt these labels.

## A.8 Component-score pattern (Radar / Crypto)

Each analysis screen exposes:
- `comp[]`: `{ name, score (number), reason (string) }` — named component with numeric score + one-line reason
- `verdict`: string summary
- `plan`: `{ entry, stop, targets, nearest_support, nearest_resistance }`
- `axes[]` (Radar only): `{ k, v (0–100), line }` — 8 axes
- `levels[]`: `{ p, t (label), k (sup/res/poc) }`
- `series`: OHLC + VWAP per timeframe
- `conviction`: 0–100

This is the same shape TradeNext's `swing-agent` / `recommendation-agent` produce, but RefSite surfaces the breakdown to the user.

## B. Pulse view variants

The Pulse page supports three views via the `?view=` query param:
- `?view=overview` (default) — Market Pulse (mood, indices, sector treemap, VIX)
- `?view=flow` — Money flow view (money rotation, sector flow table)
- `?view=orderflow` — Order flow view (per-stock order book / volume profile / order blocks)

Data endpoints:
- Overview: `pulse.json` + `flow.json`
- Flow: `pulse.json` + `flow.json` (same)
- Orderflow: `orderflow.json` (index) + `orderflow_p1.json` … `orderflow_p11.json` (shards, ~19 stocks each, 218 total)

### B.1 `orderflow.json` (index) schema

```json
{
  "open": false,
  "ts": "2026-11-02 15:34:32",
  "candle_min": 3,
  "shards": 12,
  "sources": ["yfinance 1-minute OHLCV ...", "NSE public quote API top-5 market depth ..."],
  "stocks": [
    {
      "symbol": "RELIANCE",
      "name": "Reliance Industries Limited",
      "sector": "Refineries & Marketing",
      "ltp": 1274.5,
      "prev": 1164.9,
      "chg_pct": 9.41,
      "poc": 1255.87,
      "vah": 1275.0,
      "val": 1232.72,
      "vwap": 1245.55,
      "cvd": 3852550,
      "buy_pct": 53.14,
      "sh": 6,
      "tv": 7643,
      "imb": 0.5,
      "levels": [
        { "kind": "s", "label": "S1", "price": 1261.91 },
        { "kind": "s", "label": "S2", "price": 1237.75 },
        { "kind": "s", "label": "S3", "price": 1217.62 }
      ],
      "ob": { "bull": 2, "bear": 0, "str": 4.4, "near": 1.02, "nb": true }
    }
  ]
}
```

Fields:
- `poc`: Point of Control (price with highest volume)
- `vah` / `val`: Value Area High / Low
- `vwap`: Volume Weighted Average Price
- `cvd`: Cumulative Volume Delta (buy − sell)
- `buy_pct`: % of volume that is buy-side (estimated)
- `sh`: strength score (0–? )
- `tv`: total volume
- `imb`: order book imbalance (bids vs asks)
- `levels`: S1/S2/S3 support + R1/R2/R3 resistance + POC/VAH/VAL/VWAP + Bid/Ask walls (price + qty)
- `ob`: order blocks `{ bull, bear, str (strength), near (proximity), nb (new block) }`

### B.2 `orderflow_pN.json` (shard) schema

```json
{
  "open": false,
  "ts": "2026-11-02 15:34:32",
  "candle_min": 3,
  "sources": ["yfinance 1-minute OHLCV ...", "NSE public quote API top-5 market depth ..."],
  "stocks": [
    {
      "symbol": "ABB",
      "name": "ABB India Limited",
      "sector": "Heavy Electrical Equipment",
      "ltp": 6600,
      "prev": 6413,
      "chg_pct": 2.92,
      "candles": [[ts, o, h, l, c, vol, delta, cumdelta], ...],
      "profile": { "lo": 6340.5, "step": 8.4167, "buy": [...], "sell": [...] },
      "poc": 6538.29,
      "vah": 6584.58,
      "val": 6483.58,
      "vwap": 6505.61,
      "cvd": 18818,
      "buy_pct": 56.14,
      "levels": [
        { "kind": "poc", "label": "POC", "price": 6538.29 },
        { "kind": "vah", "label": "VAH", "price": 6584.58 },
        { "kind": "val", "label": "VAL", "price": 6483.58 },
        { "kind": "vwap", "label": "VWAP", "price": 6505.61 },
        { "kind": "s", "label": "S1", "price": 6580.38 },
        { "kind": "wall_bid", "label": "Bid wall", "price": 6525, "qty": 519 },
        { "kind": "wall_ask", "label": "Ask wall", "price": 6515, "qty": 273 }
      ],
      "depth": null,
      "sh": 1
    }
  ]
}
```

Candle fields (8): `[ts (epoch), open, high, low, close, volume, delta (buy−sell), cumdelta]`.
Profile: volume-at-price histogram (`lo` = lowest price, `step` = bin size, `buy[]`/`sell[]` = per-bin buy/sell volume).
`depth`: top-5 market depth (null when not available; populated for ~40 stocks/min rotating).

### B.3 Order flow UI (per stock)

Header: symbol, name, sector, LTP, % change, bias badge (BULL/BEAR + score), "SUPPORT/RANK/CONV/FLOW" metric tiles.

Metric tiles:
- SUPPORT (price level)
- RANK (#X/218 by % chg)
- CONV (X/5 conviction)
- FLOW (buy% vs sell%, e.g. "53% buy · 47% sell")
- Δ (cumulative delta in lakhs, ▲ above VWAP)
- VWAP, POC, Z/S1 (zone/support), BID/ASK range, VA (value area range)

Charts:
- Cumulative delta (est.) line
- Market depth (top 5) — bids vs asks bar
- Volume profile (price × volume histogram) with value area shading
- 3-minute candle chart with overlays:
  - Value area (violet shaded)
  - POC (amber line)
  - Support S1–S3 (green shaded)
  - Resistance R1–R3 (red shaded)
  - VWAP (dotted line)
  - Order blocks (OB bubbles: green = bullish, red = bearish, faded/dashed when mitigated, size scales with volume)

Order blocks list: `OB ▲ ₹1,235.60–1,240.00 · 10:15 am · untested` / `mitigated`.

Footer disclaimer: "Volume at price and buy/sell split are estimated from 1-minute bars, not exchange tick-by-tick trades."

BULL/BEAR counts how many computed signals agree (price vs VWAP, price vs POC, buy share, cumulative delta, book imbalance when market open). "Describes the flow and is not a trade recommendation."

### B.4 Reverse-engineering notes

- Order flow is entirely **estimated** from yfinance 1-min OHLCV + NSE top-5 depth (rotating ~40 stocks/min). TradeNext already has NSE quote + depth (F&O analytics), so a similar estimation is feasible without new data sources.
- The `profile` (volume-at-price histogram) requires 1-min bar aggregation by price bin — TradeNext's `daily_prices` is EOD only, so this needs intraday data (not currently stored). Either (a) fetch 1-min bars on demand via NSE (rate-limited, fragile) or (b) skip the volume profile and reuse daily OHLC. **Recommendation: defer the volume-profile chart; ship the simpler order-book + delta view first.**
- Order blocks (OB) detection is a pattern-recognition algorithm (last down candle before a strong up move that broke the recent high). TradeNext's technical-analysis module can be extended.
- `cvd` (cumulative volume delta) requires tick-level buy/sell classification, which NSE doesn't expose publicly. RefSite estimates it from 1-min bar direction (up bar = buy, down bar = sell). TradeNext can replicate with the same heuristic.

---

## C. Additional RefSite screens discovered (beyond initial inventory)

| Route | Title | Data endpoint(s) | Notes |
|---|---|---|---|
| `/pulse/?view=flow` | Market Pulse (flow view) | `pulse.json`, `flow.json` | Money rotation + sector flow table |
| `/pulse/?view=orderflow` | Market Pulse (order flow view) | `orderflow.json` + `orderflow_p1..p11.json` | Per-stock order book / volume profile / order blocks (218 stocks, sharded) |
| `/screeners/basis/` | Futures basis | `screen_basis@mode-raw__par-0.05__series-nxt.json` | Futures basis screener: spot, futures, basis, basis%, annualised, fair value, vs carry, OI, ΔOI%, price chg%, tag (long/short buildup/covering), bucket (premium/discount), thin flag, alt expiry |
| `/journal/` | Trading Journal | none (client-side) | Trading journal |
| `/academy/` | F&O Academy | none (client-side content) | F&O education content |

---

**End of Spec 38.** Implementation pending human approval (D9).

