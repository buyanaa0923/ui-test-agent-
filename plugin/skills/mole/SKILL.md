---
name: mole
description: Test a web UI for real defects against the project's design. Use after changing frontend code, when asked to check, test, audit or verify a page or flow, before shipping a UI change, or when a design-system, typography, touch-target, contrast, accessibility, dead-button or console-error problem is suspected. Runs Mole's dig (design contract checks in light and dark, desktop or mobile) and tunnel (click-through) tools.
---

# Mole: digs up UI bugs

Mole drives a real browser against a running app and reports **distinct, evidence-backed defects**. It checks the page
against a **design contract**: the project's `DESIGN.md` on top of Mole's built-in modern-web best practices (WCAG
contrast and target size, readable type, line height and length, iOS input zoom). Every check is a measurement on the
live page; a ladder (**rules -> Jev -> Claude -> a person**) only judges the doubtful ones.

## Tools

| Tool | Use it to |
| :- | :- |
| `mole_dig` | scan one page against the design contract, light and dark; `platform: "mobile"` for the phone layout |
| `mole_tunnel` | walk the app: follow the pages clicks reach (`depth`, default 2), open dialogs / tabs / accordions (`stateDepth`, default 2), run the `mole_dig` checks on each, and click every control: design defects, dead buttons, broken links, JS errors, failed requests |
| `mole_doctor` | find out why a run cannot start, and the exact fix |
| `mole_report` | re-read the previous run without re-running it |

The user can also run `/mole:dig`, `/mole:tunnel`, `/mole:watch`, `/mole:design` (draft the DESIGN.md) and `/mole:doctor`.

## When to run it

- After you change UI code and the app is running: `mole_dig` on the affected page, and `mole_tunnel` if you changed behaviour.
  If the page is meant for phones, also dig with `platform: "mobile"`.
- Before you say a UI change is done. Evidence beats "it should look right".
- Start the dev server first if it is not running; Mole needs a reachable URL.

## How to call it

- **Project, design and source are automatic:** Mole knows the project Claude Code is open in, finds its `DESIGN.md`
  (or `design.md`, `.mole/design.md`) there, and maps every defect to its `location` (`file:line`) in that project. Pass
  `design` or `root` only to point somewhere else. If the result notes that no DESIGN.md was found, tell the user once
  and suggest `/mole:design`.
- **Watching:** the Mole panel opens by default (the user's plugin setting). Pass `watch: false` for quick re-checks
  inside a fix loop if the user wants speed, and in unattended runs.
- **Video:** `record: true` saves the run as a video in the run folder (with `watch`, at human pace).

## The fix loop (when you built or changed the page)

1. `mole_dig` the page.
2. For each defect: open its `location`. `exact` and `high` point at the element itself; with `medium` or `low`, read
   the spot and check it renders that element (compare the text / classes), and look at `alternatives` if it does not.
   No location: search for the element's id, classes or text yourself. Then fix it with the finding's `fix` hint, using
   the project's tokens (the contract's colours, type scale, radius), not new literal values.
3. `mole_dig` again with the same arguments but `watch: false` (the user already watched the first run; a re-check
   without the paced tour is several times faster). A defect that is gone in the re-run is evidence; a claim is not.
4. At most two rounds; then report what is fixed, what is left, and why.

When the user did not ask for changes, report and offer to fix instead.

## Reading results

- **SURFACED**: nothing found in what was tested. Only then may you say the page is clean, and only for the pages, modes and platform that were tested.
- **NUGGETS FOUND**: distinct defects. A defect seen in both light and dark is listed once. Each one has a measurement
  (for example `hit area 16x16px, needs 24x24px`), a `source` (WCAG, Apple HIG, or the design itself) and a `fix`.
  Tier `standard` = a published requirement; `practice` = widely agreed practice; `system` = this project's design.
- **NOT RUN**: nothing was tested (login wall, app down, blank page). This is a failure, never a pass. Report the reason; do not retry blindly.
- "needs a person" means the models were unavailable or unsure: list it as unresolved, do not drop it.

## Rules

- Never claim a pass without a SURFACED verdict from this run.
- Pages behind login need a saved session (`storageState`, made from a test account and kept outside the repo). Never ask for or type credentials.
- `mole_tunnel` clicks real controls. Do not point it at production unless the user says so.
- `forms: "fill"` types obvious test data and sends nothing; use it when the user wants forms checked. `forms: "submit"` **creates records in the app**: use it only when the user explicitly asks for forms to be submitted, and never add a `submitHosts` entry the user did not name. After a submit run, tell the user where the ledger is (`submissions.jsonl` in the run folder) so they can remove the test data.
- A finding on a third-party widget the team does not style is out of scope: suggest adding it to `ignore` in the DESIGN.md instead of "fixing" it.
- Never edit the DESIGN.md to make a finding go away unless the user agrees the design itself should change.
