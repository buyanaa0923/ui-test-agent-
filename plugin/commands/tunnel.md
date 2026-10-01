---
description: Tunnel through a page's controls and the pages they lead to; catch dead buttons, broken links, JS errors and failed requests
argument-hint: <url> [max-clicks]
allowed-tools: mcp__plugin_mole_mole__mole_tunnel
---

Run the `mole_tunnel` tool on the page the user named: `$ARGUMENTS`

- The first word is the URL. An optional second word is the maximum number of clicks across all pages (default 30). Mole follows the pages its clicks reach, 2 clicks deep by default; if the user says "this page only", pass `depth: 0`.
- Mole also opens dialogs, tabs, accordions and menus and tests what is inside them; a problem there is named like `button "Help" in dialog "Add user"`.
- If the user says "fill forms", pass `forms: "fill"` (test data typed, nothing sent). Only if they say to submit forms, pass `forms: "submit"` (it creates data; local dev hosts only unless they name a host for `submitHosts`), then point them at `submissions.jsonl`.
- Otherwise Mole clicks controls but never types or submits anything (no form submit buttons, no Save / Create / Confirm inside dialogs), and a safety screen skips anything that could delete data, move money or log out. Still, do not run this against production without the user saying so.

Every page reached is also design-checked (as `mole_dig`); a defect listed "on /, /a, /b" is one shared component, so fix it once.

Report: the verdict line, coverage (controls clicked out of controls found, pages explored and design-checked, and why it stopped), then each problem found: which control on which page, what happened (no effect, broken link, not-found or blank page, login wall, JS error, failed request), and the step number. Mention pages that were found but not explored (`coverage.pagesNotReached`, `pagesBeyondDepth`), so the user knows what was not covered. Note any controls the safety screen skipped, so the user knows what was not exercised.

If the result is NOT RUN, nothing was tested: say so, give the reason, and never call it a pass.
