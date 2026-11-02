# RefSite Reference — Complete Design & Data Specification

> **Purpose**: Single source of truth for agents implementing RefSite-style features in TradeNext.
> All screenshots, data contracts, styling tokens, and UI behavior notes captured via Playwright on 2026-11-03.
> **Screenshots**: `./screenshots/refsite-*.png` (14 full-page captures).

---

## 1. Overview

RefSite (https://refsite.com) is a Next.js App Router + Turbopack analytics dashboard for Indian (NSE) markets. It uses a **cron-fed static JSON data plane** (`data.refsite.com/data/*.json`) with per-screen refresh cadences, a **manual dark-mode class toggle**, **Outfit + Inter** typography, and a rich design-token system. TradeNext (also Next.js + Tailwind 4) can adopt both the data architecture and the visual language.

**Stack**: Next.js App Router, Turbopack, Tailwind CSS 4, TradingView Lightweight Charts, Cloudflare, Lenis smooth scroll.

**Auth**: Cookie session. `GET /api/auth/me` → 200/401. Login = email + 10-digit phone number. No NextAuth.

---

## 2. Screenshot Index

| File | Screen | Route |
|------|--------|-------|
| `screenshots/refsite-pulse-full.png` | Market Pulse (overview) | `/pulse/` |
| `screenshots/refsite-pulse-flow-full.png` | Market Pulse (flow view) | `/pulse/?view=flow` |
| `screenshots/refsite-options-full.png` | Option Pulse | `/options/` |
| `screenshots/refsite-radar-full.png` | Stock Radar | `/radar/` |
| `screenshots/refsite-calm-full.png` | Calm Zone | `/calm/` |
| `screenshots/refsite-crypto-full.png` | Crypto & Gold | `/crypto/` |
| `screenshots/refsite-liquidity-full.png` | Liquidity Map | `/liquidity/` |
| `screenshots/refsite-oiflow-full.png` | OI Flow | `/oi-flow/` |
| `screenshots/refsite-strength-full.png` | Strength Boards | `/strength/` |
| `screenshots/refsite-screeners-full.png` | Futures basis screener | `/screeners/basis/` |
| `screenshots/refsite-news-full.png` | Market News | `/news/` |
| `screenshots/refsite-journal-full.png` | Trading Journal | `/journal/` |
| `screenshots/refsite-academy-full.png` | F&O Academy | `/academy/` |
| `screenshots/refsite-screen-full.png` | 404 page | `/screen/` (not found) |

---

## 3. Screen Inventory & Data Contracts

### 3.1 Market Pulse (`/pulse/`)

**Sections**: Mood gauge (0–100, 4 drivers), NIFTY/BANKNIFTY cards (spot, chg, spark, expected range, put/call walls), sector treemap (size=turnover, colour=%chg), India VIX gauge + 30-session spark + percentile, money rotation (leaving/arriving), money flow link, one-line AI headline.

**Data endpoints**: `pulse.json` + `flow.json`

**pulse.json schema**: `mood { score, label, parts { breadth, flow, nifty, vix } }`, `headline`, `indices[] { symbol, spot, chg, chg_pct, bias, norm, expiry, range, iv1, walls, conviction, spark { t[], c[] } }`, `vix { available, last, chg, chg_pct, prev, yhi, ylo, src, pctile, spark, regime, nifty_daily_move_pct }`, `atr { points, pct, median60, ratio, state }`, `sectors[] { g, tv, p, f, n, surge, top[] }`, `adv, dec, inflow, outflow, ts, open, sim, _published`.

**flow.json schema**: `ts, oi_ts, fetched, open, status, n, n_fo, adv, dec, unch, inflow, outflow, summary, sectors[] { g, f, fin, fout, tv, n, adv, dec, p, spd, vel, dens, surge }`.

### 3.2 News (`/news/`)

RSS aggregator. `news.json`: `{ updated, sources[], items[] { title, source, link, published, summary } }`.

### 3.3 Option Pulse (`/options/`)

Option chain viewer. `options@symbol-X.json`: `{ symbol, spot, chg, chg_pct, expiry, expiries[], bars[] { k, coi, poi, cchg, pchg, civ, piv }, smile[] { k, civ, piv }, pcr, pcr_chg, max_pain, atm_iv, straddle, range, walls, iv1, conviction, verdict, bias, confidence, bullets[], chain_ts, lot }`.

### 3.4 Stock Radar (`/radar/`)

Per-stock composite analysis. `radar@symbol-X.json`: `{ symbol, spot, chg, chg_pct, bias, norm, verdict, axes[] { k, v, line }, range, iv1, conviction, expiry, levels[] { p, t, k }, series { 15m, 1h, 1d } { c[][], vwap[] }, plan { atr, entry, stop, targets }, comps[] { name, score, reason }, chain_ts }`.

8 axes: OI, Options, VWAP, Vol profile, RSI, Price action, VIX/ATR calm, S/R room.

### 3.5 Calm Zone (`/calm/`)

Low-volatility screener. `calm.json`: `{ asof, expiry, days, rows[] { s, rank, score, calm, rv, inr, atr, beta, iv, ivr, oi, earn, earn_before, earn_text, verdict, prem, st }, top }`.

### 3.6 Crypto & Gold (`/crypto/`)

BTC/ETH/GOLD. `crypto.json`: `{ BTC/ETH/GOLD: { symbol, bias, norm, last, comp[], plan { entry, stop, targets, nearest_support, nearest_resistance }, spark[], spark_t[], srcs, updated, line, live { price, chg_pct, tick_ms, open, src } } }`. `live.json`: `{ GOLD: { price, tick_ms, open, src } }`.

### 3.7 Liquidity Map (`/liquidity/`)

Price + futures OI buildup + option walls. `liq@symbol-X__tf-Y.json`: `{ symbol, kind, tf, bars[] { t, o, h, l, c, v }, spot, chain_ts, expiry, expiries, walls { max_pain, ce[], pe[], range, strikes[], med, spot }, buildup[] { t, k }, buildup_src, chips { support, resistance, bias }, read, has_volume, open, asof, units, srcs }`.

Buildup types: SB (Short Buildup), LU (Long Unwinding), SC (Short Covering), LB (Long Buildup).

### 3.8 OI Flow (`/oi-flow/`)

Animated intraday OI flow. `oiflow@symbol-X.json`: `{ symbol, sim, open, frames[] { ts, t, spot, fut { ltp, chg, oi, doi, exp }, strikes[] { k, coi, cchg, cltp, cpx, ct, cti, cv, ca, poi, pchg, pltp, ppx, pt, pti, pv, pa } }, step, vmax, read, summary, interval_note, disclaimer, expiry, expiries, chain_ts, src }`.

### 3.9 Strength Boards (`/strength/`)

Relative strength ranking. `strength.json`: `{ ts, open, status, tf, top, method { adr_days, oneside, impulse_adr }, breadth { adv, dec, unch, n, bull, bear, choppy }, sectors[] { g, st, p, n, up }, bull[] { s, g, p, lp, o, st, adr, mv, rk, drk, new, setup { zone, prior[], support, resistance, liquidity, invalid, rr } }, bear[] (same), charts (symbol → OHLC[][]), dots[] [symbol, mv, st, group], _published }`.

### 3.10 Screeners — Futures basis (`/screeners/basis/`)

`screen_basis@mode-raw__par-0.05__series-nxt.json`: `{ rows[] { s, idx, spot, fut, exp, basis, bp, ann, fair, vs_carry, oi, doi, doi_pct, pchg, tag, bucket, thin, alt { exp, bp, ann, tag } } }`.

### 3.11 Order Flow view (`/pulse/?view=orderflow`)

Per-stock order book. `orderflow.json` (index, 218 stocks): `{ open, ts, candle_min, shards, sources, stocks[] { symbol, name, sector, ltp, prev, chg_pct, poc, vah, val, vwap, cvd, buy_pct, sh, tv, imb, levels[], ob { bull, bear, str, near, nb } } }`.

`orderflow_pN.json` (shards, ~19 stocks each): `{ open, ts, candle_min, sources, stocks[] { symbol, name, sector, ltp, prev, chg_pct, candles[][] [ts,o,h,l,c,vol,delta,cumdelta], profile { lo, step, buy[], sell[] }, poc, vah, val, vwap, cvd, buy_pct, levels[], depth, sh } }`.

### 3.12 Journal & Academy

Client-side only (no data endpoints). Journal = trading journal (localStorage). Academy = F&O education content.

---

## 4. Refresh Cadence (from config.json)

| Screen | Live | Closed | Sim |
|--------|------|--------|-----|
| Pulse | 17s | 10min | 4s |
| Flow | 27s | 10min | 3.5s |
| Options | 62s | — | — |
| Radar | 143s | — | — |
| Live quotes | 12s | — | 1.5s |
| Liquidity | 92s | 10min | — |
| Liquidity (crypto) | 284s | — | — |
| Liquidity (book) | 30s | — | — |
| OI Flow | 62s | 10min | 20s |
| Screeners (fast) | 62s | — | — |
| Screeners (slow) | 143s | — | — |
| Strength | 62s | 10min | — |

Market hours: 09:15–15:30 IST. Timezone: Asia/Kolkata.

---

## 5. Design Tokens (full reference)

### 5.1 Light theme (`:root`)

| Token | Value |
|-------|-------|
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
| `--chart-1` | `#6a4cf0` |
| `--chart-2` | `#ea6a1a` |
| `--chart-3` | `#079cd8` |
| `--chart-4` | `#db2777` |
| `--chart-5` | `#3b82f6` |
| `--chart-6` | `#b07a06` |
| `--chart-7` | `#d946ef` |
| `--chart-8` | `#0d9488` |
| `--chart-grid` | `#14103c0f` |
| `--chart-axis` | `#75747f` |
| `--heat-mid` | `#ececf1` |
| `--heat-down-1` | `#ef4444` |
| `--heat-down-2` | `#ef4444` |
| `--heat-down-3` | `#b91c1c` |
| `--heat-up-1` | `#16a34a` |
| `--heat-up-2` | `#16a34a` |
| `--heat-up-3` | `#15803d` |
| `--ramp-seq-1` | `#e9e4fd` |
| `--ramp-seq-2` | `#c4b5fd` |
| `--ramp-seq-3` | `#8b6cf6` |
| `--ramp-seq-4` | `#5b3fd6` |
| `--ramp-seq-5` | `#2e1a8a` |
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

### 5.2 Dark theme (`.dark`)

| Token | Value |
|-------|-------|
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
| `--input` | `#ffffff1a` |
| `--surface-sheen` | `linear-gradient(180deg, #ffffff0a, #fff0 38%)` |
| `--page-glow` | `radial-gradient(1100px 480px at 15% -14%, #8b5cf612, transparent 62%), radial-gradient(900px 420px at 100% -10%, #079cd80a, transparent 60%)` |
| `--spotlight` | `#8b5cf60f` |
| `--spotlight-border` | `#8b5cf673` |

### 5.3 Typography

- **Heading**: Outfit (400–700), `--font-heading`
- **Body**: Inter (400–600), `--font-body`
- Base: 16px
- H2 (section): 24px / 600 / `text-balance`
- H1 (page title in header): 13px / 600 / `tracking-[-0.005em]` (muted-foreground)
- Body: 14–16px
- Recommended: use `tabular-nums` for price columns

### 5.4 Spacing & layout

- Header: 56px (`--header-h`), `sticky top-0 z-40`
- Main container: `max-w-[1800px]`, `px-3 pt-5 pb-8` (mobile) → `sm:px-6 sm:pt-7`
- Card padding: `p-5 sm:p-7` (20px/28px)
- Card grid gap: `gap-6` (24px) → `md:gap-8` (32px)
- Nav gap: `gap-2` (8px)
- Button (icon): `size-8` (32px), `rounded-full`

### 5.5 Shadows

- `--shadow-card`: 3-layer (1px hairline + 1px 2px + 10px 28px -18px)
- `--shadow-raised`: elevated card (brand-tinted border)
- `--shadow-pop`: modal/popover
- `--shadow-glow`: brand glow (24px 80px -36px)
- `--shadow-header`: 1px bottom hairline + 8px 24px -12px
- `--shadow-control`: button/control (1px + 1px 2px + inset highlight)
- `--shadow-inset`: inset shadow for inputs

### 5.6 UI behavior

- **Dark mode**: manual toggle button in header; applies `.dark` class to `<html>`; persisted (localStorage). Default = light. NOT `prefers-color-scheme`.
- **Command palette**: `Ctrl+K` opens modal ("Jump to a screen, open a symbol or run an action").
- **Presentation mode**: auto-rotate every 20s button.
- **Display settings**: button in header.
- **Search**: "Search screens and symbols" button.
- **Market status pill**: "NSE · Closed · opens 7h 35m" in header.
- **Account menu**: avatar initials → dropdown with email.
- **"More" menu**: dropdown (Screeners / Strength Boards / Trading Journal / F&O Academy / Support RefSite).
- **View toggles**: radiogroup (Overview / Money flow / Order flow) on Pulse.
- **Buttons**: `active:not-disabled:scale-[0.97]`, 150ms ease-out transition, focus-visible 2px ring offset 2, disabled opacity 45%.
- **Cards**: `overflow-hidden`, relative, grid layout, `glow-brand` adds brand glow.
- **Smooth scroll**: Lenis (`html.lenis`, `.lenis.lenis-smooth { scroll-behavior: auto }`).
- **Notifications**: region "Notifications alt+T".
- **Loading**: skeleton (implied by `loader_delay: 180` in config).
- **Responsive**: mobile-first with `sm:` (640px) breakpoint; nav collapses to hamburger (`lg:hidden`).

---

## 6. Buildup Taxonomy (F&O)

| Code | Meaning | Condition |
|------|---------|-----------|
| SB | Short Buildup | price down, OI up |
| LU | Long Unwinding | price down, OI down |
| SC | Short Covering | price up, OI down |
| LB | Long Buildup | price up, OI up |

Used in Liquidity Map and OI Flow screens.

---

## 7. Component-Score Pattern (Radar / Crypto)

Each analysis screen exposes:
- `comp[]`: `{ name, score (number), reason (string) }` — named component with numeric score + one-line reason
- `verdict`: string summary
- `plan`: `{ entry, stop, targets, nearest_support, nearest_resistance }`
- `axes[]` (Radar only): `{ k, v (0–100), line }` — 8 axes
- `levels[]`: `{ p, t (label), k (sup/res/poc) }`
- `series`: OHLC + VWAP per timeframe
- `conviction`: 0–100

This is the same shape TradeNext's `swing-agent` / `recommendation-agent` produce, but RefSite surfaces the breakdown to the user.

---

## 8. Feasibility Notes for TradeNext

| Feature | v1 (feasible) | Deferred (v2) |
|---------|---------------|---------------|
| Pulse (mood, indices, VIX, sector treemap, money flow) | ✅ Uses existing `daily_prices`, NSE indices, VIX | — |
| Radar (composite, plan, levels) | ✅ Uses daily data + technical analysis | Intraday VWAP/series (needs intraday bars) |
| Calm Zone (low-vol screener) | ✅ Uses `daily_prices` + technical indicators | IV/IVR per stock (heavy API calls) |
| Order Flow (volume profile, delta, OBs) | ⚠️ Simplified (daily approx, no volume profile) | Full version needs `intraday_prices` table |
| Liquidity Map (price + OI buildup + walls) | ⚠️ Simplified (daily bars + OI walls) | Intraday OI buildup overlay |

---

## 9. Reverse-Engineering Notes

- **Order flow** is entirely estimated from yfinance 1-min OHLCV + NSE top-5 depth (rotating ~40 stocks/min). TradeNext already has NSE quote + depth (F&O analytics), so a similar estimation is feasible without new data sources.
- **Volume profile** requires 1-min bar aggregation by price bin. TradeNext's `daily_prices` is EOD only. Recommend deferring the volume-profile chart; ship the simpler order-book + delta view first.
- **Order blocks (OB)** detection is pattern recognition (last down candle before a strong up move that broke the recent high). TradeNext's technical-analysis module can be extended.
- **CVD** (cumulative volume delta) requires tick-level buy/sell classification, which NSE doesn't expose publicly. RefSite estimates from 1-min bar direction (up bar = buy, down bar = sell). TradeNext can replicate with the same heuristic.

---

## 10. Related Specs

- **Spec 37** — Market Pulse + Strength dashboards (data contracts)
- **Spec 38** — RefSite-style theme refresh (design tokens + components)
- **Spec 39** — Advanced Analytics dashboard (Pulse, Radar, Calm, Orderflow, Liquidity as NSE features)

---

**End of RefSite Reference.** Last updated: 2026-11-03.
