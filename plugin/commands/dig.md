---
description: Dig a page for UI bugs (design-system defects in light and dark mode)
argument-hint: <url> [none|cascade]
allowed-tools: mcp__plugin_mole_mole__mole_dig
---

Run the `mole_dig` tool on the page the user named: `$ARGUMENTS`

- The first word is the URL. If a second word is `none`, pass `model: "none"` (rules only, free).
- If no URL was given, ask for one. If the app runs locally, `http://localhost:<port>` is fine.

Then report back in this shape, short and scannable:

1. One line: the verdict exactly as the tool states it, plus time and cost.
2. A compact table of the defects, highest severity first: severity, rule, element, the measurement, and who confirmed it (rule / Jev / Claude).
3. If defects were found, offer to find the source of the worst ones and fix them. Do not start editing until the user says yes.

Rules you must follow:

- **NOT RUN means nothing was tested.** Say so plainly, give the reason from the tool, and never describe it as a pass. Suggest `/mole:doctor`, or a saved login session (`storageState`) if the page needs login.
- Do not tell the user a page is "clean" or "passes" unless the verdict says SURFACED.
- Findings marked "needs a person" are unresolved, not dismissed: list them.
