# CLAUDE.md — mendinovacare-node

Project memory for Claude Code. Updated after every working session.

---

## What this project is

A code generator that reads the **Mendinova Care** Mendix app model via the Mendix Platform SDK and outputs a runnable Node.js / Express / Prisma / EJS application into `app/`.

```
scripts/generate.ts      ← connects to Mendix SDK, orchestrates everything
generator.config.js      ← extraction settings (skipModules, priority lists)
generators/
  layoutGenerator.ts     ← views/layout.ejs  (navbar, CSS)
  pageGenerator.ts       ← views/*.ejs + src/routes/*.ts  (one pair per page)
  appGenerator.ts        ← src/app.ts + src/db.ts
  prismaGenerator.ts     ← prisma/schema.prisma  (models + enum blocks)
  microflowGenerator.ts  ← src/services/*.ts
  packageJsonGenerator.ts
  typesGenerator.ts      ← src/types.ts  (interfaces + union types for enumerations)
lib/
  types.ts               ← shared TypeScript types (MendixWidget, MendixPage, MendixEnumeration, …)
  pageUtils.ts           ← helpers (isNavPage, pluralize, …)
app/                     ← generated output (committed for dev preview)
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run generate` | Connect to Mendix SDK and write all generated files to `app/` (~60–120s) |
| `npm run generate:full` | Generate + copy `.env` + `npm install` + `db:push` + `npm run dev` |
| `npm run demo` | Polished presales demo (simulated, no credentials needed) |
| `npm run demo -- --real` | Full real SDK run with automatic app setup and launch |
| `npm run demo -- --fast` | Skip all delays (useful for testing the demo script) |

### How to regenerate

Requires `MENDIX_PAT` and `MENDIX_USER_ID` in `.env` (project root).

**Quickest path — one command does everything:**

```bash
npm run generate:full     # generate + install + db:push + start app
```

**Or step by step:**

```bash
npm run generate          # connects to Mendix SDK (~60-120s), writes app/
cp app/.env.example app/.env
cd app && npm install && npm run db:push && npm run dev   # http://localhost:3001
```

The generated app's `npm run dev` uses **nodemon** — it watches `app/src/` and restarts automatically when `npm run generate` writes new files. No manual server restart needed.

To kill and restart manually (from `app/`):
```bash
kill $(lsof -ti :3001)
npm run dev
```

After every `npm run generate`, re-apply the post-generation patches described below.

### Demo script (`demo/run.ts`)

Entry point: `demo/run.ts`. Runs with `ts-node --esm` using `demo/tsconfig.json` (ESM mode required for `@inquirer/prompts` and `cfonts`).

**Simulate mode** (default): hardcoded stats, realistic timing (~60s total), no credentials needed. Safe for live demos.

**Real mode** (`--real`): spawns `scripts/generate.ts` silently in the background (`stdio: ['ignore', 'pipe', 'pipe']`) so raw SDK output never leaks into the TUI. Shows the same auth box → project/output selection → config box → 5-stage progress bar flow as simulate mode. After the SDK finishes, automatically copies `.env`, runs `npm install`, `db:push`, copies image assets, and starts the dev server detached on port 3001. Ends with a browser open prompt and a two-line farewell message.

**Interactive prompts** — two `@inquirer/prompts` `select` calls run before the Configuration box:
1. **Project selection** — three choices in order: `HR Self Service Portal`, `Customer Ticket Manager`, `Mendinova Care - Demo`. The selected name is shown in the Configuration box. In real mode the project is fixed to `Mendinova Care - Demo` (the SDK only converts the configured project ID) but the prompt still appears.
2. **Output type** — five choices: `Go`, `Java`, `Node.js`, `Python`, `.NET`. All are dummy values except `Node.js`; the conversion always produces a Node.js app regardless of selection.

**Working copy cache**: on the first `--real` run, the Mendix temporary working copy ID is saved to `.mendix-wc-id`. Subsequent runs call `app.getWorkingCopy(id).openModel()` to reuse it, skipping the 30–120s creation step. If the cached copy has expired, a new one is created automatically and the cache is updated.

**DEP0190 suppression**: all `spawn` calls use the single-string command form (e.g. `spawn('npm run dev', { shell: true })`) rather than the args-array form, which avoids the Node.js DEP0190 deprecation warning that would otherwise corrupt the TUI output.

Dependencies added for the demo: `chalk@4`, `ora@5`, `@inquirer/prompts`, `open@8`, `cfonts`, `figlet` (in package.json but no longer imported).

#### TUI design

All layout uses a fixed width `W = 74` chars. Colour palette: phosphor green `#00FF41` for all UI chrome and text.

**Banner** — `printBanner()`:
- `cfonts` `3d` font renders **POP** in phosphor green as a single block.
- Below the banner: a dim grey dashed box (`┌┄┄┄┐ / ┆ / └┄┄┄┘`) with two centred lines:
  - `Exit the Mendix platform. Keep the logic.`
  - `Powered by Claude Code, Mendix Platform SDK and Node.js`

**Section boxes** — three variants:
| Function | Corners | Used for |
|----------|---------|----------|
| `boxTop(title)` + `boxBottom()` | `┌┐└┘` green | Authentication, Configuration |
| `sectionBar(title?)` | plain `─` green (no corners) | Conversion Status, DONE dividers |
| `summaryBox(lines)` | `┌┐└┘` green, floating title | Summary stats |

**Animated progress bars** — each conversion stage drives a `setInterval` that fills one `█` per tick (interval = `delay / 22 ms`). Unfilled portion shows dim `░`. On completion `ora.stopAndPersist` swaps in the full `stageRow` with all 22 `█` and `[✔]`.

**Real mode stage 1 hold** — after the bar fills to 100%, if the SDK is still running the spinner keeps animating and a live elapsed counter (`23s`, `24s`…) is appended to the bar text so the user can see it is working, not frozen. Once the SDK resolves the counter stops and the stage row persists.

**Summary box alignment** — all values after `|` are left-aligned with no leading spaces (e.g. `87` not `' 87'`, `58s` not `' 58s'`). This keeps the first digit of every value at the same column. Do not add `padStart` to values in `summaryBox` calls.

**Stage done text width** — `TEXT_W = 28` in both `stageRow` and `buildText`. Done text strings must be ≤28 chars or the progress bar shifts right. Current done texts and their lengths: `Working copy ready` (18), `202 entities, 5 modules` (23), `87 microflows extracted` (23), `152 pages, 8 layouts` (20), `320 files written to app/` (25).

**Farewell message** — two `chalk.dim` lines printed after the browser open prompt:
```
Best of luck with your migration! Thanks for being part of the Mendix community.
If you ever get the itch to come back, we'll have a fresh pot of coffee waiting for you.
```

---

## generator.config.js

Controls extraction behaviour. Loaded at the top of `scripts/generate.ts` via `require()`. Falls back to `generator.config.json` if present, then to hardcoded defaults.

```js
module.exports = {
  skipModules: ['System', 'Administration', 'Marketplace'],
  priority: {
    microflows: ['ACT_ContactFormEntry_Submit'],
    pages: [],
    entities: []
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `skipModules` | `['System', 'Administration', 'Marketplace']` | Module names excluded from all extraction passes |
| `priority.microflows` | `[]` | Microflow names always extracted regardless of the 200-item cap |
| `priority.pages` | `[]` | Reserved — not yet consumed by the generator |
| `priority.entities` | `[]` | Reserved — not yet consumed by the generator |

The file uses `.js` (not `.json`) specifically to allow `//` comments documenting not-yet-implemented extraction types (nanoflows, snippets, published REST services, scheduled events).

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

### `model.allMicroflows()` — registry warmup required
`model.allMicroflows()` returns an empty array unless the SDK's internal `_unitsByType` registry has been populated first. The registry is populated by iterating modules and accessing their sub-objects (e.g. `mod.domainModel`). Since `extractEntities()` already does this loop, call it before `extractMicroflows()` and the registry will be ready.

### `returnType` deleted in Mendix 7.9.0
`Microflows$Microflow.returnType` was removed in Mendix 7.9.0. The property getter calls `assertReadable()` → `reportAvailabilityIssues()` → throws, even with the `?.` optional-chain operator (the throw happens inside the getter before any value is returned). Fix: replace any access to `mf.returnType` with a hardcoded `undefined`.

### `ActionActivity` wrapper
Every action node inside a microflow's `objectCollection.objects` is an `ActionActivity` container. `obj.constructor?.name` always returns `'ActionActivity'`, not the actual action type. The real action object is at `obj.action`. Unwrap before reading type or properties:
```typescript
const wrapperType = obj.constructor?.name || 'Unknown'
const actionObj = wrapperType === 'ActionActivity' ? (obj.action || obj) : obj
const rawType = actionObj.constructor?.name || wrapperType
```

### ShowMessageAction text path
After unwrapping from `ActionActivity`, the popup text lives at:
```
actionObj.template  (ClientTemplate)
  → .text           (texts.Text)
    → .translations[i]
      → .text       (string)
```
Each level requires `.load()`. The message type (`Information` / `Warning` / `Error`) is at `actionObj.type?.toString()`.

### Enumerations
Enumerations live on the domain model, not as top-level SDK objects. Extract them alongside entities:
```typescript
await domainModel.load()
for (const enumObj of domainModel.enumerations || []) {
  await enumObj.load()
  for (const val of enumObj.values || []) {
    await val.load()
    // val.name is the enum value string
  }
}
```
`model.allEnumerations()` also works once the registry is warmed up. The short name (`enumObj.name`) matches the `enumerationName` stored on `MendixAttribute`. `prismaGenerator.ts` emits proper `enum` blocks (only for enumerations referenced by at least one entity attribute); `typesGenerator.ts` emits TypeScript union types.

### Prisma enum support on SQLite
Prisma maps enum types to `TEXT` columns on SQLite — native enums are not required. Prisma `enum` blocks in `schema.prisma` work with SQLite without any special configuration.

---

## Post-generation manual patches

After every `npm run generate` these should be verified:

| File | What to check |
|------|---------------|
| `app/src/routes/Home_Anonymous.ts` | Must contain `GET /home_anonymous` and `POST /contact` only — no `prisma.userrole` calls. The `generateHomeAnonymousRoute()` special-case in `pageGenerator.ts` handles this automatically. |
| `app/src/app.ts` | Must include `app.use(express.static(path.join(__dirname, '../public')))` before routes. Add it if missing. |
| `app/views/Home_Anonymous.ejs` | The generator's `generateHomeAnonymous()` produces the full polished template including the contact form, confirmation modal, and fetch script. Verify the committed version matches if the generator was changed. |

### Image assets

Copy these files from the Mendix deployment into `app/public/img/` after each generation:

```bash
MENDIX_IMG="/path/to/Mendix/Mendinova Care - Demo-main/deployment/web/img"
APP_IMG="app/public/img"
mkdir -p "$APP_IMG"
cp "$MENDIX_IMG/design_module\$Image_collection\$_24_7.svg"               "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$fingerprint.svg"          "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$directContact.svg"        "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$inlogclient.svg"          "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$medewerken.svg"           "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$doctorhelpingolderlylady.png" "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$telefoon.svg"             "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$email.svg"                "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$mendinovaWhite.svg"       "$APP_IMG/"
cp "$MENDIX_IMG/design_module\$Image_collection\$V_V.svg"                  "$APP_IMG/"
```

Image mapping:
| File | Used for |
|------|----------|
| `_24_7.svg` | 24/7 Access feature card icon |
| `fingerprint.svg` | DigiD button icon + Safe & Trusted card icon + NEN badge in hero |
| `directContact.svg` | Direct Contact card icon |
| `inlogclient.svg` | Patient sign in button icon |
| `medewerken.svg` | Employee sign in button icon |
| `doctorhelpingolderlylady.png` | Our mission section side photo |
| `telefoon.svg` | Phone icon in help section |
| `email.svg` | Email icon in help section |
| `mendinovaWhite.svg` | Footer logo (white version) |
| `V_V.svg` | Checkmark icons in mission checklist |

### Homepage like-for-like patch for `app/views/Home_Anonymous.ejs`

Replace the entire generated file with the version committed in the repo. Key differences from the raw generator output:

1. **Hero headings** — `<p>Care that works</p>` / `<p>for you.</p>` → `<h1>` / `<h1 class="hero-subtitle">` (orange via CSS)
2. **Remove inline height** — `height: 420px` removed; `min-height: 480px` is in CSS
3. **Section headings** — "Why choose our portal?", "Our mission…", "Do you need help?" → `<h2>` (orange via CSS)
4. **Feature cards** — `<!-- CustomWidget -->` replaced with `<img>` referencing `/img/...`, titles → `<h3>`, wrapper → `<div class="mx-card">`
5. **Mission section** — `<!-- CustomWidget -->` for the side image replaced with `<img src="/img/...doctorhelpingolderlylady.png">`, checkmarks → `<img src="/img/...V_V.svg">` in `.mx-checklist`
6. **Contact info** — Phone/Email `<!-- CustomWidget -->` → `<img>` icons with `.mx-contact-item` layout, phone number / email address use `.mx-contact-value` (bold)
7. **Contact form** — full `<form id="contactForm">` with `name="Name"`, `name="Email"`, `name="Message"` inputs, wrapped in `.mx-card.mx-contact-form`. On submit: JS intercepts, POSTs JSON to `POST /contact`, resets form, shows confirmation modal. Modal text matches the Mendix `ShowMessageAction`: *"Thank you for contacting us! We will get back to you as soon as possible."*
8. **Footer** — logo `<!-- CustomWidget -->` → `<img src="/img/...mendinovaWhite.svg">`, footer div gets `.mx-footer` class for dark background

### CSS additions to `app/views/layout.ejs`

These CSS rules must be present (already in the committed file):

```css
/* Hero headings */
.mx-image-background h1 { font-size: 3.5rem; font-weight: 700; line-height: 1.1; color: #0A1731; margin-bottom: 0; }
.mx-image-background h1.hero-subtitle { color: #D14200; margin-bottom: 0.5rem; }
.mx-image-background p { font-size: 16px; color: #4A4A4C; margin-top: 1.5rem; margin-bottom: 0; }

/* Card icons, checklist, contact items, mission image, NEN badge, btn-block */
/* (see full layout.ejs for details) */
```

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
5. **Nanoflows not extracted** — Mendix nanoflows (client-side microflows) are not yet extracted. Add to `generator.config.js` `priority` once implemented.
6. **Snippets not extracted** — Reusable page snippets render as their contained widgets without the snippet boundary being preserved.
7. **Published REST services not extracted** — Endpoint definitions, operations, and parameter mappings are not yet generated.
8. **Scheduled events not extracted** — Microflows invoked on a schedule are not yet detected or generated.
