---
name: mole
description: Test a web UI for real defects. Use after changing frontend code, when asked to check, test, audit or verify a page or flow, before shipping a UI change, or when a design-system, contrast, accessibility, dead-button or console-error problem is suspected. Runs Mole's dig (design-system checks in light and dark) and tunnel (click-through) tools.
---

# Mole: digs up UI bugs

Mole drives a real browser against a running app and reports **distinct, evidence-backed defects**. It is deterministic first (11 design-system rules measured from the live page), then judged by a ladder: **rules -> Jev (fast, cheap) -> Claude (only the unsure ones) -> a person**.

## Tools

| Tool | Use it to |
| :- | :- |
| `mole_dig` | scan one page: contrast, fonts, sizes, labels, overflow, radius, raw colours, in light and dark |
| `mole_tunnel` | click through controls: dead buttons, JS errors, failed requests |
| `mole_doctor` | find out why a run cannot start, and the exact fix |
| `mole_report` | re-read the previous run without re-running it |

The user can also run `/mole:dig`, `/mole:tunnel`, `/mole:watch` (real browser with the live overlay) and `/mole:doctor`.

## When to run it

- After you change UI code and the app is running: `mole_dig` on the affected page, and `mole_tunnel` if you changed behaviour.
- Before you say a UI change is done. Evidence beats "it should look right".
- Start the dev server first if it is not running; Mole needs a reachable URL.

## Reading results

- **SURFACED**: nothing found in what was tested. Only then may you say the page is clean, and only for the pages and modes that were tested.
- **NUGGETS FOUND**: distinct defects. A defect seen in both light and dark is listed once. "Confirmed by Jev/Claude" is a model's judgement on top of a measured fact; the measurement itself (for example `4.43:1, needs 4.5:1`) is deterministic.
- **NOT RUN**: nothing was tested (login wall, app down, blank page). This is a failure, never a pass. Report the reason; do not retry blindly.
- "needs a person" means the models were unavailable or unsure: list it as unresolved, do not drop it.

## Rules

- Never claim a pass without a SURFACED verdict from this run.
- Pages behind login need a saved session (`storageState`, made from a test account and kept outside the repo). Never ask for or type credentials.
- `mole_tunnel` clicks real controls. Do not point it at production unless the user says so.
- Fix real defects in the source, then re-run the same tool to prove the fix. A defect that disappears in the re-run is evidence; a claim is not.
- A finding on a third-party or non-design-system widget may be out of scope (for example a design-token rule on an Ant Design admin UI). Say so instead of "fixing" it.
