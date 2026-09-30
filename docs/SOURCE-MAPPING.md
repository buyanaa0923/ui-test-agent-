# From defect to `file:line`

Every `dig` finding carries `where`: the place in the project's source that wrote the element, so a person or Claude
can open it and fix it instead of hunting for a CSS selector.

```text
● [high] control-unlabeled input.field-input form control has no label  → src/components/LoginForm.tsx:8
```

```json
"where": { "file": "src/components/LoginForm.tsx", "line": 8, "confidence": "high", "via": "search", "why": ["placeholder", "class", "context"] }
```

MCP results give the same as `location`, `locationConfidence` and, when two places look alike, `alternatives`.

## How it is found (`src/engine/locate.mjs`)

**1. Exact: what the dev build already knows.** Read from the DOM node, never changing it:

| Source | Gives |
| :- | :- |
| `data-mole-src="src/x.tsx:12"` (add it yourself, or with any build plugin) | file, line |
| `data-insp-path` (code-inspector-plugin), `data-v-inspector` (vite-plugin-vue-inspector), `data-inspector-*` (react-dev-inspector) | file, line, column |
| React 18 and earlier, dev build: the fiber's `_debugSource` | file, line, column, component |
| React 19: the fiber's component name (the source is gone) | component (used by the search) |
| Vue 3 / Vue 2 dev: the component's `__file` | file (line from the search) |
| Svelte dev: `__svelte_meta` | file, line, column (untested: no fixture yet) |

A reported path is only trusted if that file exists under the project root; otherwise the search decides.

**2. Search: the project's own source.** The element's facts are looked up in `.jsx/.tsx/.vue/.svelte/.html/...` files
(and in `.json/.yaml` locale files for translated text), then scored:

| Evidence | Weight | Names a place? |
| :- | :- | :- |
| `id="..."` | 10 | yes |
| `aria-label="..."` | 8 | yes |
| its own text (12+ characters) | 6 (3 if shorter) | yes |
| text found in a locale file, then its key used in code (`t('login.forgot')`) | 5 | yes |
| `name` / `placeholder` | 5 | yes |
| 2+ of its classes on one line | 4-7 | yes |
| one specific class (`login-forgot`, not `flex`) | 3 | supports only |
| an ancestor's id or class nearby (`header.app-header`) | 3 | supports only |
| the component's definition nearby, or its file | 3 | supports only |

Evidence within 6 lines counts as the same element: in full on the candidate line itself, at 60% a few lines away
(an ancestor's class counts in full, since it is expected a few lines up). Two lines that share three utility classes
therefore lose to the line that has all of the element's classes.

**Page-aware (Next.js App Router).** The URL tells Mole which files render the page: `/en` is `app/[locale]/page.tsx`
plus every layout above it (route groups `(x)` are transparent, `[param]` and catch-alls match), and everything those
files import, following `tsconfig` `paths` aliases such as `@/*`. Candidates in those files gain 3 points, others lose 3,
so identical markup in two components resolves to the one this page renders. The run notes how many files render it.

**Penalties.** Test, story and fixture files lose 3 points; folders named legacy, deprecated, archive, backup or old lose
4; folders the project's `tsconfig.json` / `jsconfig.json` `exclude` are not searched at all.

**Confidence:** `exact` (dev-build metadata) · `high` (score 10+, no rival close) · `medium` (score 6+, or the only
candidate) · `low` (weak). When the runner-up scores within 80% of the best, confidence is capped at `medium` and the rivals are
listed in `alternatives`. Under a score of 5 there is no location at all: Mole says nothing rather than guess.

## The root

`--src <folder>` (MCP `root`), else `MOLE_SRC_ROOT`, else the project that holds the `DESIGN.md` (the nearest folder
with a `package.json` or `.git`), else the working directory. `--src none` switches it off. `node_modules`, build output
(`dist`, `build`, `.next`, ...), `runs/` and files over 512 KB are skipped. The index stops after 8000 files or 4 seconds, and the
run says so in a note. A home folder or a drive root is never indexed.

## Limits

- Hashed CSS-in-JS classes (`css-1x2y3z`) are ignored; text, labels and ids still work.
- Text built at runtime (`{count} items`) is only found through other evidence.
- A shared component (one `Button.tsx` used everywhere) is where the element is written, but the fix may belong at
  the call site. Claude should read the `location` in context, as the skill says.
