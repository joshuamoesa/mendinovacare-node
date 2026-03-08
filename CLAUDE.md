# CLAUDE.md — mendinovacare-node

Project memory for Claude Code. Updated after every working session.

---

## What this project is

A code generator that reads the **Mendinova Care** Mendix app model via the Mendix Platform SDK and outputs a runnable Node.js / Express / Prisma / EJS application into `app/`.

```
scripts/generate.ts      ← connects to Mendix SDK, orchestrates everything
generators/
  layoutGenerator.ts     ← views/layout.ejs  (navbar, CSS)
  pageGenerator.ts       ← views/*.ejs + src/routes/*.ts  (one pair per page)
  appGenerator.ts        ← src/app.ts + src/db.ts
  prismaGenerator.ts     ← prisma/schema.prisma
  microflowGenerator.ts  ← src/services/*.ts
  packageJsonGenerator.ts
  typesGenerator.ts
lib/
  types.ts               ← shared TypeScript types (MendixWidget, MendixPage, …)
  pageUtils.ts           ← helpers (isNavPage, pluralize, …)
app/                     ← generated output (committed for dev preview)
```

### How to regenerate

Requires `MENDIX_PAT` and `MENDIX_USER_ID` in `.env` (project root).

```bash
npm run generate          # connects to Mendix SDK (~60-120s), writes app/
cd app && npm run dev     # http://localhost:3001
```

After every `npm run generate`, re-apply the post-generation patches described below.

---

## Mendix SDK — key findings

### DataView.caption
`DataView` has **no `caption` property** in the Mendix Model SDK. The fallback `widget.name` produces internal names like `dataView5`, `dataView3`, etc. These are **not user-visible titles** and must be suppressed.

Fix in `pageGenerator.ts` DataView case:
```typescript
const hasRealCaption = widget.caption && !/^dataView/i.test(widget.caption)
```

### LayoutGridColumn.weight
`LayoutGridColumn.weight` is an integer **1–12** (Bootstrap-style columns). The value **`-1`** means auto/fill width in Mendix. This produces the CSS class `mx-col--1` (double dash) which needs its own rule:
```css
.mx-col--1 { flex: 1; min-width: 0; }
```

### Button captions
Button captions live at `widget.caption.template.translations[0].text` — a lazy SDK proxy chain. Accessing `caption?.template` before `.load()` returns a proxy object, not a string, causing `[object Object]` in output. The extraction must happen only inside the post-load block in `extractWidgetTree`.

### System entities (e.g. UserRole)
The Mendix model contains system entities (UserRole, etc.) that are **not in the Prisma schema**. Detection: system entities are absent from `entityMap` (built from `userEntities` which filters `isSystemEntity: false`).

In `generateRouteFile`, `const hasEntity = !!entityModel` (not `!!page.entityName`) so system-entity pages emit `const userroleList: unknown[] = []` instead of crashing with `prisma.userrole.findMany()`.

In `generateEjsTemplate`, the CustomWidget CRUD fallback is only injected when `entityModel` is defined:
```typescript
if (page.entityName && entityModel && body.includes('<!-- CustomWidget -->'))
```

### LayoutGrid structure
Originally all column children were flattened. Fix in `scripts/generate.ts`: LayoutGrid rows/columns are now synthetic `Container` widgets:
```typescript
{ kind: 'Container', rawType: 'LayoutGridRow',    cssClass: 'mx-row',              children: colWidgets }
{ kind: 'Container', rawType: 'LayoutGridColumn', cssClass: `mx-col mx-col-${weight}`, children: colChildren }
```

### Duplicate hero sections
Mendix pages can contain the **same background-image widget twice** (mobile + desktop variants with different `height` but identical `imageRef`). Both render without deduplication.

Fix in `pageGenerator.ts` — `deduplicateHeroWidgets()` keeps only the first occurrence per `imageRef`:
```typescript
function deduplicateHeroWidgets(widgets: MendixWidget[]): MendixWidget[] {
  const seen = new Set<string>()
  return widgets.filter(w => {
    const isBg = w.cssClass?.includes('mx-image-background') || w.cssClass?.includes('img-cover')
    if (!isBg) return true
    const key = w.imageRef ?? w.inlineStyle ?? '__bg__'
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
```
Called on `page.widgets` before rendering in `generateEjsTemplate`.

### Hero / background-image sections
- Atlas CustomWidget image-background detected via `hasImageDisplayMode = true` in the SDK props + `imageRef` present.
- CSS class combo: `mx-image-background img-cover img-center`.
- **Do not add a dark overlay** — the original background image is light-toned (medical equipment, right-aligned). Text uses dark colours (#0A1731 navy, #D14200 orange).
- Background should be positioned `right center` so text on the left stays on the white area.
- The first `<p>` in `.mx-col-12` inside the hero = main headline (3.5rem, navy).
- The second `<p>` = subtitle (2.5rem, orange #D14200).

### Heading promotion
`extractHeadings()` + `promotedCaptions` promotes the first two visible Text/Label captions to `<h1>` / `.mx-subtitle` above the page body. This is correct for data pages but **wrong for hero/marketing pages** where the page's own h1 lives inside a background-image section.

Fix: `hasHeroSection()` checks the deduped widget tree; if true, `extractHeadings()` returns `[]`.

### Atlas heading CSS classes
Text/Label widgets can carry Atlas design property CSS classes (`h1`, `h2`, `h3`, `h4`). The renderer maps them to semantic elements:
```typescript
if (/\bh1\b/.test(cls)) return `<h1 class="${cls}">…</h1>`
```
However, the design-property-to-CSS mapper in `generate.ts` currently only handles button styles, border shapes, and background display mode. Font/heading style design properties are **not yet mapped** — so most text widgets arrive with no `cssClass`.

---

## Post-generation manual patches

After every `npm run generate` these should be verified (they are now auto-correct due to generator fixes, but confirm):

| File | What to check |
|------|---------------|
| `app/src/routes/Home_Anonymous.ts` | Route now generates `const userroleList: unknown[] = []` (no Prisma call). If it still shows `prisma.userrole.findMany()`, the generator fix wasn't applied. |
| `app/views/Home_Anonymous.ejs` | Should have **one** `mx-image-background` div (no inline `height`). If two appear, the `deduplicateHeroWidgets` fix wasn't applied. After verifying, manually apply section heading and card patches — see below. |

### Homepage like-for-like patches for `app/views/Home_Anonymous.ejs`

After regeneration, the following manual HTML changes are needed to match the original Mendix app:

1. **Remove inline height from hero** — change `height: 600px` → remove it (rely on CSS `min-height: 480px`)
2. **Section headings as h2** — change `<p>Why choose our portal?</p>`, `<p>Our mission:...</p>`, `<p>Do you need help?</p>` → `<h2>`
3. **Feature card titles as h3** — change `<p>24/7 Access</p>`, `<p>Safe & Trusted</p>`, `<p>Direct Contact</p>` → `<h3>`
4. **Add `mx-card` class** to the inner `<div>` container of each feature card item and the contact form
5. **Contact info cards** — wrap Phone and Email items in `<div class="mx-card">`, change `<p>Phone</p>` / `<p>Email</p>` → `<h4>`
6. **Contact form** — replace the placeholder `<p>Contact us</p><button>Submit</button>` with a full form including name/email/message inputs

---

## CSS architecture (generated into `views/layout.ejs`)

All CSS lives in a single `<style>` block in the layout. Key classes:

| Class | Purpose |
|-------|---------|
| `.mx-navbar` | Fixed top navbar, 73px, white |
| `.mx-image-background` | Hero sections — `background-position: right center`, no overlay, `min-height: 480px` |
| `.mx-row` / `.mx-col-N` | 12-column flex grid (LayoutGrid mapping) |
| `.mx-col--1` | Auto-width column (Mendix weight = -1) |
| `.mx-list` / `.mx-list-row` | Card list for entity overviews |
| `.btn`, `.btn-rounded`, `.btn-warning` | Buttons |
| `.mx-card` | Feature/contact cards — white background, grey border, border-radius 8px, subtle shadow |
| `.container > div + div` | Section spacing — `padding: 3rem 0` on all non-hero sections |

Hero text selectors (only fire inside `.mx-image-background`):
```css
.mx-image-background .mx-col-12 > p:first-child  /* 3.5rem, navy   */
.mx-image-background .mx-col-12 > p:nth-child(2) /* 3.5rem, orange */
.mx-image-background .mx-col-12 > p:nth-child(3) /* 16px, grey body text */
```

Container: `max-width: 1200px; margin: 0 auto; padding: 0 2rem 24px` — hero uses `margin: 0 -2rem` to bleed full container width.

---

## Brand colours

| Token | Hex | Usage |
|-------|-----|-------|
| Navy dark | `#0A1731` | Headings, primary text |
| Navy mid | `#102E62` | Nav links, buttons, links |
| Orange | `#D14200` | Accents, "for you." subtitle, btn-warning |
| Grey text | `#4A4A4C` | Body text |
| Border | `#CBD5E1` | Cards, inputs |
| Background | `#fff` | Page background (white) |

---

## Deployment URL

Mendix cloud app: `https://mendinovacare.apps.eu-1c.mendixcloud.com`

Background image served from: `/img/design_module$Image_collection$headerImage.png` (200 OK, no auth required).

---

## Known remaining limitations

1. **Atlas font/heading design properties not mapped** — Text widgets inside the Mendix model can have design properties like `heading1`, `heading2` etc., but these are not yet captured in `generate.ts`. Only button and background display properties are handled.
2. **Conditional visibility ignored** — Mendix widgets can have visibility conditions (show only when logged in, etc.). These are not parsed; all widgets render unconditionally.
3. **CustomWidget slots** — Pluggable widgets with complex slot structures (carousels, charts, icon widgets) render as `<!-- CustomWidget -->` comments.
4. **Section headings below hero** — "Why choose our portal?", "24/7 Access" etc. render as unstyled `<p>` tags because their Atlas design property class is not captured. Post-generation patch is required (see above).
