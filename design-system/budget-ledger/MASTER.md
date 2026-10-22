# Design System Master File — Budget Ledger

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.
>
> **Token contract:** [`TOKENS.md`](./TOKENS.md) — the authoritative list of CSS custom
> properties. All UI code consumes semantic tokens, never raw hex.

---

**Project:** Budget Ledger
**Defined:** 2026-10-21 · category **Personal Finance Tracker**
**Design Dials:** Variance 5/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 8/10 (Dense / Dashboard)

---

## Applied decisions

Two deliberate deviations were approved by the project owner and are the source of truth:

| Area | Starting point | **Applied** | Why |
|------|----------------|-------------|-----|
| Accent | `#059669` profit green | **Teal `#2DD4BF` / `#0D9488`** | Brand identity; teal already carried the "positive" meaning in the UI |
| Typography | Caveat + Quicksand | **Fira Sans + Fira Code** | A dense financial dashboard needs precise, legible figures — the "Dashboard Data" pairing |
| Neutrals | slate palette | **Adopted** | `#0F172A` canvas, `#192134` card — the calm-blue palette |
| Accent family | fixed | **Derived via `color-mix()`** | `12%`/`20%`/`28%`/`42%` variants track the user's custom accent (Settings → Colore accento) |

Style recipe: **Glassmorphism + Dark Mode (OLED)** — backdrop blur `18px` + `saturate(140%)`,
hairline border `rgba(148,163,184,.14)`, inset light reflection, four elevation levels.

---

## Global Rules

### Color Palette (as implemented)

| Role | Token | Dark | Light |
|------|-------|------|-------|
| Background | `--bg` | `#08111f` | `#f1f5f9` |
| Card / panel | `--panel` | `rgba(25,33,52,.72)` | `rgba(255,255,255,.92)` |
| Elevated panel | `--panel-strong` | `rgba(25,33,52,.94)` | `rgba(255,255,255,.98)` |
| Foreground | `--text` | `#f8fafc` | `#0f172a` |
| Muted foreground | `--muted` | `#94a3b8` | `#475569` |
| Primary (brand) | `--accent` | `#2dd4bf` | `#0f766e` |
| Accent strong | `--accent-strong` | `#14b8a6` | `#0d9488` |
| Text on accent | `--pill-primary-text` | `#042f2e` | `#ffffff` |
| Positive | `--success` | `#34d399` | `#047857` |
| Negative | `--danger` | `#f87171` | `#dc2626` |
| Warning | `--warning` | `#fbbf24` | `#b45309` |
| Info | `--info` | `#38bdf8` | `#0369a1` |
| Border | `--border` | `rgba(148,163,184,.14)` | `rgba(15,23,42,.12)` |
| Focus ring | `--focus-ring-color` | `#2dd4bf` | `#0f766e` |
| Destructive | `--danger` | `#f87171` | `#dc2626` |

Never use a raw hex value in component code. The full list lives in
[`TOKENS.md`](./TOKENS.md) and the definitions in `src/renderer/styles.css`.

### Typography

- **UI / labels:** Fira Sans — `var(--font-sans)`, self-hosted in `src/renderer/fonts/`
- **Figures / mono:** Fira Code — `var(--font-mono)`
- Monetary and tabular values use `font-variant-numeric: tabular-nums` (applied globally)
- Scale: `--text-xs` → `--text-4xl`; leadings `--leading-tight` / `--leading-normal` / `--leading-relaxed`

### Spacing

Density 8/10 → 8/16/24/32 rhythm: `--space-1` (4px) … `--space-9` (48px).

### Radii

`--radius-xs` 6 · `--radius-sm` 12 · `--radius-md` fluid 12→18 · `--radius-lg` fluid 16→24 · `--radius-xl` 26 · `--radius-full`

### Elevation

`--shadow-xs` · `--shadow-sm` · `--shadow-md` · `--shadow-lg` · `--shadow-accent`

### Motion

`--duration-fast` 120ms · `--duration-base` 180ms · `--duration-slow` 320ms
`--ease-out cubic-bezier(.16,1,.3,1)` · `--ease-standard cubic-bezier(.2,0,0,1)`
`prefers-reduced-motion` is honoured globally (all transitions collapse to 0.01ms).

---

## Component Specs

### Buttons

```css
.primary-button {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: var(--pill-primary-text);
  border-radius: var(--radius-md);
  font-weight: 700;
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-base) var(--ease-out),
              box-shadow var(--duration-base) var(--ease-out);
}
.primary-button:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.primary-button:active { transform: translateY(0); }
```

### Cards (glass)

```css
.panel {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md), var(--glass-highlight);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
```

### Inputs

```css
.form-field input {
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text);
}
.form-field input:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
```

### Charts

- Categorical series: `--chart-1` … `--chart-8`
- Gains / losses: `--chart-positive` / `--chart-negative`
- Gridlines `--chart-grid`, axis text `--chart-axis`
- Sankey flows: `fill-opacity: var(--chart-flow-opacity)` (0.4–0.6), node labels always visible
- Series are distinguished by hue **and** by direct labels — never by hue alone

---

## Style Guidelines

**Style:** Glassmorphism
**Keywords:** Frosted glass, transparent, blurred background, layered, depth, multi-layer
**Key Effects:** Backdrop blur (10–20px), subtle border, light reflection, Z-depth

---

## Motion

Subtle only (dial 3/10). No scroll-jacking, no parallax, no autoplaying media.
Charts may animate in once on mount; nothing loops.

---

## Pre-delivery checklist

- [x] No emojis as structural icons — Lucide React SVG only
- [x] `cursor: pointer` on every clickable element
- [x] Hover states transition in 120–320ms
- [x] Text contrast ≥ 4.5:1 in both themes
- [x] Visible `:focus-visible` ring on every interactive element
- [x] `prefers-reduced-motion` respected
- [x] Responsive at 375 / 768 / 1024 / 1440 px
- [x] Every colour comes from a semantic token (`python3 scripts/audit_tokens.py`)
