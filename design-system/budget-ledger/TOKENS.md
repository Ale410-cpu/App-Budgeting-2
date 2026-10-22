# Budget Ledger — Token Contract

> Derived from the design system for the **Personal Finance Tracker**
> profile (Glassmorphism + Dark Mode OLED, dashboard density 8/10, motion 3/10).
> Brand accent remains **teal**. Neutrals come from the calm-blue palette.
>
> All UI code must consume **semantic tokens** (`src/renderer/styles.css`), never raw
> hex values. Raw hex is allowed **only** inside the token definitions themselves.

## Layers

1. **Primitives** — raw ramps and scales (`--teal-400`, `--slate-900`, `--space-4`).
   Never reference these directly from components.
2. **Semantic** — role-based tokens. **This is the only layer components use.**
3. **Component** — reserved for per-component overrides.

## Semantic tokens (identical names in dark and light theme)

### Surfaces
| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--bg` | `#08111f` | `#f1f5f9` | App canvas |
| `--bg-soft` | — | — | Secondary header/footer bands |
| `--panel` | `rgba(25,33,52,.72)` | `rgba(255,255,255,.92)` | Glass cards, modals |
| `--panel-strong` | `rgba(25,33,52,.94)` | `rgba(255,255,255,.98)` | Elevated panels, modals |
| `--panel-card-bg` | `rgba(15,23,42,.72)` | `rgba(248,250,252,.9)` | Nested cards, rows |
| `--mini-card-bg` | — | — | Small stat tiles |
| `--input-bg` | `rgba(8,17,31,.72)` | `#ffffff` | Inputs, selects, search |
| `--bar-track-bg` | — | — | Chart bar tracks |
| `--sidebar-bg` | — | — | Sidebar gradient |
| `--hero-bg` | — | — | Hero panel gradient |
| `--bulk-bg` | — | — | Bulk editor gradient |

### Glass recipe
`--glass-blur` (18px) · `--glass-saturate` (140%) · `--glass-highlight` (inset light reflection)

### Canvas ambience
`--bg-glow-accent` · `--bg-glow-info` — the soft radial washes behind the app shell.

### Text
| Token | Use |
|-------|-----|
| `--text` | Primary text |
| `--muted` | Secondary text, labels, captions |
| `--text-inverse` | Text on inverted surfaces |
| `--on-solid` | Text on a **saturated** fill. Dark theme: dark ink on bright fills (`#042f2e`). Light theme: white on deep fills (`#ffffff`). Never use `--text` here — it flips with the theme and breaks contrast. |

### Brand / status
| Token | Meaning |
|-------|---------|
| `--accent` | Brand teal — CTA surfaces, active states |
| `--accent-strong` | Gradient end-stop / hover |
| `--accent-text` | Teal used as *text* (never as a background) |
| `--pill-primary-text` | Text/icon on an accent-filled surface |
| `--accent-soft` | Tinted accent background (12%) |
| `--accent-soft-strong` | Stronger tinted accent background (20%) |
| `--accent-border` | Accent hairline border |
| `--accent-border-strong` | Accent border for active/selected rows |
| `--accent-glow` | Accent outer glow |
| `--success` / `--success-strong` / `--success-soft` / `--success-border` | Positive values |
| `--danger` / `--danger-strong` / `--danger-soft` / `--danger-border` / `--danger-border-strong` / `--danger-text` | Negative / destructive |
| `--warning` / `--warning-soft` / `--warning-border` | Warnings, budget thresholds |
| `--info` / `--info-soft` / `--info-border` | Informational accents |

> The `--accent-*`, `--success-*`, `--danger-*`, `--warning-*` and `--info-*` families are
> **derived** with `color-mix()` from their base token, so they follow the user's custom
> accent automatically and never drift out of sync between themes.

### Lines & elevation
`--border` · `--border-strong` · `--border-color-fallback` · `--divider` · `--track-bg`
`--shadow-xs` · `--shadow-sm` · `--shadow-md` · `--shadow-lg` · `--shadow` · `--shadow-accent`

### Focus
`--focus-ring` (full box-shadow ring) · `--focus-ring-color` (outline colour)

### Charts
| Token | Use |
|-------|-----|
| `--chart-1` … `--chart-8` | Categorical series palette (teal → sky → violet → amber → pink → blue → green → slate) |
| `--chart-positive` | Gains / assets |
| `--chart-negative` | Losses / liabilities |
| `--chart-neutral` | "Other" / residual series |
| `--chart-grid` | Gridlines |
| `--chart-axis` | Axis labels |
| `--chart-flow-opacity` | Sankey flow fill opacity (0.4–0.6) |

## Typography
- `--font-sans` — Fira Sans (self-hosted in `src/renderer/fonts/`)
- `--font-mono` — Fira Code, for tabular/aligned figures
- Scale: `--text-xs` `--text-sm` `--text-base` `--text-md` `--text-lg` `--text-xl` `--text-2xl` `--text-3xl` `--text-4xl`
- Leadings: `--leading-tight` `--leading-normal` `--leading-relaxed`
- Monetary values: `font-variant-numeric: tabular-nums` is already applied globally.

## Spacing / radii / motion
- `--space-1` … `--space-9` (4 → 48px, 8/16/24/32 rhythm)
- `--radius-xs` `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` `--radius-full`
- `--duration-fast` (120ms) `--duration-base` (180ms) `--duration-slow` (320ms)
- `--ease-out` `--ease-standard`

## Rules
1. No raw hex/rgba in component code — use a semantic token.
2. Text on a **saturated fill** uses `--on-solid`, never `--text`.
3. Meaning is never carried by colour alone: pair with an icon, label, or sign.
4. Interactive elements need a visible `:focus-visible` state (already global).
5. Respect `prefers-reduced-motion` (already global).
6. Light theme must be reachable by overriding the **same** token names.

## Verification

```bash
python3 scripts/audit_tokens.py
```

Checks that every `var()` resolves, that no raw colour literals leak into component
code, and that the light theme only overrides known semantic token names.
