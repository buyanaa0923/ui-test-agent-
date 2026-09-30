---
description: Tunnel through a page's controls and catch dead buttons, JS errors and failed requests
argument-hint: <url> [max-clicks]
allowed-tools: mcp__plugin_mole_mole__mole_tunnel
---

Run the `mole_tunnel` tool on the page the user named: `$ARGUMENTS`

- The first word is the URL. An optional second word is the maximum number of clicks (default 12).
- Mole clicks controls but never types or submits anything, and a safety screen skips anything that could delete data, move money or log out. Still, do not run this against production without the user saying so.

Report: the verdict line, coverage (controls clicked out of controls found, and why it stopped), then each problem found: which control, what happened (no effect, JS error, failed request), and the step number. Note any controls the safety screen skipped, so the user knows what was not exercised.

If the result is NOT RUN, nothing was tested: say so, give the reason, and never call it a pass.
