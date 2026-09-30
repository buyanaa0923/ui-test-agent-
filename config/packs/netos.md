# NetOS (built-in pack)

The netsecure-design system (`@netos/netsecure-design`), on top of the modern-web pack. The values come from
`config/tokens.json`, which `npm run import-tokens` generates from the design-system repo; do not copy them here.

```mole
extends: modern-web
tokens: ../tokens.json
```

- Fonts: Inter, Montserrat, JetBrains Mono.
- Colours: only the palette in the tokens file, in inline styles.
- Buttons: the fixed height scale; controls 36px or shorter use text of 14px or less.
- Radius: the radius scale from the tokens file.
- Contrast: WCAG AA, as in modern-web. Note: white text on the primary `#008779` is 4.43:1, just under 4.5:1.
