---
description: Draft this project's DESIGN.md (the design contract Mole tests against) from the code
argument-hint: "[path, default DESIGN.md] [modern-web|netos]"
allowed-tools: Read, Grep, Glob, Write, Bash(node:*)
---

Write the design contract for this project so `mole_dig` checks pages against **its** design, not a generic one.
Arguments: `$ARGUMENTS` (first: where to write, default `DESIGN.md` in the project root; second: the pack to extend,
default `modern-web`, or `netos` for NetOS / netsecure-design apps).

1. If the file already exists, read it and improve it instead of replacing it. Never delete a value a person wrote.
2. Start from the template: run `node "${CLAUDE_PLUGIN_ROOT}/bin/mole.mjs" design init --out <path> [--extends <pack>]`.
3. Find the real values in the code. Look for, in this order:
   - design tokens: `tokens.json`, style-dictionary / DTCG files, a design-system package in `package.json`
   - `tailwind.config.*` (`theme.fontFamily`, `theme.colors`, `theme.fontSize`, `theme.borderRadius`, `theme.spacing`) and `@theme` blocks in CSS
   - CSS custom properties (`--color-*`, `--font-*`, `--radius-*`, `--space-*`) in global stylesheets
   - a component library's button sizes, and the product's own docs (README, `docs/`, Storybook)
4. Fill the ```mole block with **only values you found**, each one traceable to a file. Leave a key out rather than
   guess; the pack's default then applies. Put the file you took each group from in a short YAML comment.
   - `colors`: every colour the design system allows (hex). `fonts`: the families actually loaded.
   - `type.scale`: the font-size steps. `radius`: the radius steps (add 9999 if pills exist). `buttons.heights` if defined.
   - `spacing: 4` (or 8) only if the project really uses a strict grid.
   - `ignore`: third-party widgets the team does not style (for example `.ant-*` for Ant Design).
   - `platform: mobile` if the product is phone-first.
5. Under "Voice and feel", write two or three sentences from what the product is for. Mark it as a draft.
6. Validate: `node "${CLAUDE_PLUGIN_ROOT}/bin/mole.mjs" design show --design <path>`. Fix any error it reports.
7. Report back: the file path, what each value was taken from, what you left out and why, and suggest running
   `/mole:dig <url>` next. Tell the user to review the file: it becomes the rulebook for every scan.
