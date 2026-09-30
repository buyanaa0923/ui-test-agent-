# Modern web (built-in pack)

What most design systems agree on, whatever the brand. Every number below is measured on the live page by a
deterministic rule; nothing here is a model's opinion. A project's own `design.md` extends this pack and can
change any value, or switch a rule off with `rules: { <rule>: off }`.

```mole
contrast: { normal: 4.5, large: 3 }
targets: { desktop: 24, mobile: 44 }
type:
  min: { desktop: 12, mobile: 12 }
  body-min: { desktop: 14, mobile: 16 }
  line-height-min: 1.4
  max-line-chars: 80
  max-sizes: 10
input-zoom: true
```

## Why these numbers

| Rule | Threshold | Source | Tier |
| :- | :- | :- | :- |
| `contrast` | 4.5:1 for text, 3:1 for large text (≥24px, or ≥18.66px bold) | WCAG 2.2 SC 1.4.3 (AA) | standard |
| `target-size` (desktop) | 24×24 CSS px, unless nothing else is within the 24px circle (the spacing exception) or it is a link inside a sentence | WCAG 2.2 SC 2.5.8 (AA) | standard |
| `target-size` (mobile) | 44×44 px | Apple Human Interface Guidelines (44pt); Material Design asks for 48dp | practice |
| `text-too-small` | nothing under 12px | Apple HIG (11pt minimum), Material type scale (12sp smallest) | practice |
| `body-text-small` | paragraphs and list text at least 14px on desktop, 16px on mobile | Material body sizes, GOV.UK and USWDS body sizes; iOS body text is 17pt | practice |
| `line-height-tight` | line height at least 1.4× the font size in text that runs over two or more lines | WCAG 1.4.8 (AAA) asks for 1.5; typographic practice is 1.4 to 1.6 | practice |
| `line-length` | at most 80 characters per line on average | WCAG 1.4.8 (AAA): no more than 80 characters; typographic practice is 45 to 75 | practice |
| `font-size-sprawl` | at most 10 distinct text sizes on one page | A type scale has 6 to 8 steps; more than 10 sizes means sizes are being picked by hand | practice |
| `input-font-zoom` (mobile) | text inputs at least 16px | iOS Safari zooms the page when an input under 16px gets focus | practice |

Always on, whatever the contract: `button-unnamed` and `control-unlabeled` (WCAG 4.1.2 / 1.3.1), `text-overflow`,
`text-truncated-no-title`, `button-text-wrap`.

Only when a design says so (they need the design's own values): `font-family` (`fonts`), `raw-color-literal`
(`colors`), `button-height` / `button-font-size` (`buttons`), `radius-scale` (`radius`), `type-scale` (`type.scale`),
`spacing-grid` (`spacing`).

## Exemptions (decided by rules, never by a model)

- Visually hidden (screen-reader-only) elements skip every visual rule.
- Disabled controls skip `contrast` (WCAG 1.4.3 exempts inactive components).
- `aria-hidden` content skips the accessible-name rules.
- Links inside running text skip `target-size` (WCAG 2.5.8 inline exception).
