---
description: Dig a page for UI bugs against the project's design (light and dark mode), with the live Mole panel
argument-hint: "<url> [mobile] [none] [quiet] [fix]"
allowed-tools: mcp__plugin_mole_mole__mole_dig
---

Run the `mole_dig` tool on the page the user named: `$ARGUMENTS`

- The first word is the URL. If no URL was given, ask for one. If the app runs locally, `http://localhost:<port>` is fine.
- `mobile` → pass `platform: "mobile"` (phone viewport, 44px touch targets, 16px body text).
- `none` → pass `model: "none"` (rules only, free).
- Pass `watch: true` so the user sees the Mole panel check the page in a real browser, unless the word `quiet` is given
  (then `watch: false`).
- The project's `DESIGN.md` and source folder are found automatically; do not pass `design` or `root`.

Then report back in this shape, short and scannable:

1. One line: the verdict exactly as the tool states it, the design contract it used, plus time and cost.
2. A compact table of the defects, highest severity first: severity, rule, `file:line` (or the element when no
   location was found), the measurement, the source (WCAG / HIG / the design) and who confirmed it (rule / Jev / Claude).
3. If defects were found:
   - with the word `fix`, or when you just built or changed this page yourself in this conversation: open each defect's
     location (for `medium` / `low` confidence, confirm the spot renders that element, else try its `alternatives` or
     search for its id/classes/text), fix it using the tool's fix hint and the project's tokens,
     then run `mole_dig` again with the same arguments and show before → after. Stop after two rounds and report what is left.
   - otherwise: offer to fix them. Do not start editing until the user says yes.

Rules you must follow:

- **NOT RUN means nothing was tested.** Say so plainly, give the reason from the tool, and never describe it as a pass. Suggest `/mole:doctor`, or a saved login session (`storageState`) if the page needs login.
- Do not tell the user a page is "clean" or "passes" unless the verdict says SURFACED.
- Findings marked "needs a person" are unresolved, not dismissed: list them.
- If the tool notes that no design.md was found, mention it once and suggest `/mole:design`.
