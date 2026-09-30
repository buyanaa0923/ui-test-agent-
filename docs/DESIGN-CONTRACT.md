# The design contract

Mole checks a page against a **design contract**: what "correct" means for this product. It is resolved, in order, from

1. **built-in packs** in `config/packs/` (`modern-web`: widely agreed practice; `netos`: netsecure-design on top of it),
2. a **tokens file** a design names (`tokens: ./tokens.json`, Mole's `config/tokens.json` format),
3. the project's own **`DESIGN.md`**: later values win, maps merge key by key, lists replace.

Where Mole looks: `--design <file>` (MCP: `design`), else `MOLE_DESIGN`, else `DESIGN.md`, `design.md`, `.mole/design.md`,
`docs/DESIGN.md` in the working directory, else the built-in NetOS contract. Every run prints which contract it used and
stamps its hash into `report.json`, so a result can always be traced to the exact rules that produced it.

## The file

A `DESIGN.md` is ordinary markdown with **one** ```` ```mole ```` block. The block is what Mole measures. The prose is for
people (and later for a model's taste review); it never drives a rule.

| Key | Meaning | Example |
| :- | :- | :- |
| `extends` | packs to start from | `modern-web`, `netos`, or a list |
| `platform` | default platform for this product | `desktop` / `mobile` |
| `tokens` | a tokens file, relative to the design file | `./tokens.json` |
| `fonts` | allowed font families | `[Inter, JetBrains Mono]` |
| `colors` | colours allowed in inline styles (list or named map) | `{ primary: "#0f766e" }` |
| `type.scale` | allowed font sizes (px) | `[12, 14, 16, 20, 24, 32]` |
| `type.min` / `type.body-min` | smallest text / smallest running text | `12` / `{ desktop: 14, mobile: 16 }` |
| `type.line-height-min` | minimum line height for multi-line text | `1.4` |
| `type.max-line-chars` | longest average line | `80` |
| `type.max-sizes` | most distinct text sizes on one page | `10` |
| `targets` | minimum hit area (px) | `{ desktop: 24, mobile: 44 }` |
| `buttons` | `heights`, `small-max-height`, `small-max-font` | `{ heights: [32, 36, 40] }` |
| `radius` | allowed border radii | `[0, 4, 8, 9999]` |
| `spacing` | padding and gaps on this grid (px); opt-in | `4` |
| `contrast` | `normal` and `large` ratios | `{ normal: 4.5, large: 3 }` |
| `input-zoom` | the iOS 16px input rule on mobile (default on) | `false` |
| `ignore` | selectors out of scope; `.x-*` = any class starting with `x-` | `[".ant-*", "#legacy"]` |
| `rules` | switch a rule off or set its severity | `{ line-length: off, contrast: high }` |

Any number can be one value or `{ desktop, mobile }`. The block is a small YAML subset (maps, lists, `[a, b]`, `{ a: 1 }`,
`# comments`); hex colours need no quotes. A mistake stops the run with the line number (exit 64). Mole never quietly
falls back to a default when your contract is broken.

## The rules

`mole design show` lists them with what is on for the current contract. Each finding carries its `tier`, `source` and a `fix` hint.

| Rule | Tier | Needs |
| :- | :- | :- |
| `contrast` | standard (WCAG 1.4.3) | always |
| `target-size` | standard on desktop (WCAG 2.5.8, with its spacing and inline exceptions), practice on mobile (HIG 44pt) | `targets` |
| `button-unnamed`, `control-unlabeled` | standard (WCAG 4.1.2 / 1.3.1) | always |
| `text-overflow`, `text-truncated-no-title`, `button-text-wrap` | practice | always |
| `text-too-small`, `body-text-small`, `line-height-tight`, `line-length`, `font-size-sprawl` | practice | `type.*` |
| `input-font-zoom` | practice (mobile only) | `platform: mobile` |
| `font-family`, `raw-color-literal`, `button-height`, `button-font-size`, `radius-scale`, `type-scale`, `spacing-grid` | system | the design's own value |

Tiers: **standard** = a published requirement; **practice** = widely agreed design practice (the pack cites it);
**system** = this product's own design system. Exemptions (screen-reader-only, disabled, `aria-hidden`, inline links) are
decided by rules, never by a model.

## Mobile

`--platform mobile` (MCP `platform: "mobile"`) opens a 390x844 phone viewport with touch and mobile-viewport emulation,
and applies the mobile values: 44px targets without the desktop spacing exception, 16px body text, and the iOS input
zoom rule.

## Adding a rule

Measure the fact in `collect()` (`src/engine/design-checks.mjs`), add the rule to `RULES` (tier, source, fix) and
`APPLIES`, give its threshold a key in `normalize()` (`src/engine/contract.mjs`) and a value in a pack, then seed it in a
fixture with a decoy that must not fire (see `test-pages/modern.html`). Legacy callers that pass `tokens.json` straight
to `runRules` (the mutation benchmark) never see practice rules, so the benchmark stays comparable.
