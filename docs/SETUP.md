# Mole: setup from a terminal (5 minutes)

Using Claude Code? Install the plugin instead: [`INSTALL.md`](../INSTALL.md). This page is for running Mole from a
terminal or a pipeline. New work Mac? `WORK-MAC.md` has the machine-specific notes, and `bash setup.sh` does step 1 for you.
`.env` is loaded automatically (no `source` needed).

## 1. Install
```bash
npm ci                                  # or: npm install
npx playwright install chromium         # once. Blocked network? An installed Google Chrome or Edge is used automatically
cp .env.example .env                    # optional: keys for the model steps (see 3)
npm link                                # optional: puts `mole` on your PATH; otherwise use `node bin/mole.mjs`
mole doctor                             # ticks, warnings, and the exact fix for anything missing
```

## 2. Tell Mole what "correct" is: the design contract
Mole checks a page against a **design contract**: the built-in modern-web best practice, plus your project's `DESIGN.md`.
```bash
mole design init --out /path/to/your/app/DESIGN.md     # a starter file; fill in your fonts, colours, type scale, radius
mole design show --design /path/to/your/app/DESIGN.md  # exactly what will be enforced, and where each value came from
```
Without a `DESIGN.md`, only modern-web best practice is checked, and every run says so. Full reference:
[`DESIGN-CONTRACT.md`](DESIGN-CONTRACT.md). NetOS apps write `extends: netos`, which takes fonts, colours, buttons and
radius from `config/tokens.json` (`npm run import-tokens -- /path/to/netsecure-design` regenerates it).

## 3. Keys (only for the model steps; the checks themselves need none)
- **Jev**: `TYPESAFE_API_KEY` from the TypeSafe console.
- **Claude**: either `ANTHROPIC_API_KEY` (an Anthropic Console API key; a chat subscription does not include API access),
  or `JUDGE_MODE=cli`, which uses your own Claude Code login through `claude -p` (no key; cost shows as "unpriced").
- With Jev and a Claude route set, `mole dig` uses the Jev -> Claude ladder by default. `--no-model` forces rules only (free).

## 4. Run
```bash
mole dig http://localhost:3000 --design ./DESIGN.md --src .   # check a page; --src maps each defect to file:line
mole dig <url> --watch                                          # the same, in a real browser with the live Mole panel
mole dig <url> --platform mobile                                # phone viewport: 44px targets, 16px body text, iOS zoom
mole tunnel <url> --max 20                                      # click through controls: dead buttons, JS errors, failed requests
mole ci --urls urls.txt --out evidence/runs/<id>                # pipeline gate: exit 0 clean / 1 defects / 2 not run
mole replay latest                                              # replay the last run in the terminal, no browser
mole dashboard                                                  # http://localhost:4173 - run history, cost, judge scorecard
```
`mole <command> --help` lists every option. `npm run scan` and `npm run flow` still work as aliases of `dig` and `tunnel`.
Run from inside your project folder and `--design` / `--src` are found on their own.

### Exit codes (the contract a pipeline can rely on)
| Code | Meaning |
| :- | :- |
| 0 | every page tested and clean |
| 1 | defects found |
| 2 | **not run**: nothing (or not everything) was tested. A failure, never a pass |
| 64 | bad usage (including a broken `DESIGN.md`: the message names the line) |

## Where Jev fits (trust ladder)
Deterministic facts first, then Jev, then Claude, then a person. Jev never has the last word on anything it is unsure about, and dismissing a finding needs more confidence (0.9) than confirming one (0.8).
- `npm run jev:ping` - one real call: checks the key, latency, tokens and a Mongolian label.
- `mole tunnel <url> --picker jev` - Jev picks the next control (unsure picks fall back to the free heuristic), and a risk screen (Jev, then Claude, then fail-safe skip) keeps the explorer away from delete/pay/transfer buttons in English and Mongolian.
- `npm run eval:jev -- --claude` - measures Jev, Claude and the cascade on labelled decisions. Every model response is recorded in `eval/cache/`, so `npm run eval:replay` reproduces the same numbers offline with no key and no cost.
- `eval/risk.jsonl` and `eval/triage.jsonl` are starter labels written by the project author. Real-app labelling is in `LABELLING.md`.

## Evidence (numbers you can show)
```bash
npm test               # every test, no keys needed (model calls are mocked)
npm run evidence       # tests + mutation benchmark + determinism + smoke, in one command (feeds the scorecard)
npm run bench          # mutation benchmark: 220 generated pages, one injected defect each (+ clean pages)
npm run determinism    # same page, 20 fresh runs, output must be identical
```
The benchmark's ground truth lives in `bench/truth.json` (frozen, reviewed), not in `config/tokens.json`, so a token-import bug or a broken rule fails the benchmark. `npm test` proves this by sabotaging the rules and checking the benchmark notices.
Every report carries a `stamp` (tool version, design contract and its hash, rules hash). `BUDGET_USD` (default 1) caps model spend per run.
The mutation benchmark is synthetic: it proves rule accuracy and false-positive behaviour, not generalisation to real apps. That needs the labelled real-app set.

## What is checked
- **Standards** (WCAG 2.2): text contrast, target size (24px, with the spacing and inline-link exceptions), accessible names for buttons and form controls.
- **Practice** (sources in `config/packs/modern-web.md`): smallest text, body text size, line height, line length, number of text sizes, mobile touch targets (44px), iOS input zoom, overflow and truncation, wrapping button labels.
- **Your design** (only what your `DESIGN.md` defines): fonts (bundler-renamed fonts such as next/font are recognised), colours in inline styles, type scale, radius, button heights, spacing grid.
- Measured on the live page one screen at a time at the real window size, in light mode and, when the page has one, dark mode. Each defect carries its measurement, source, fix hint and `file:line`.
- Tunnel: every safe button/tab/link is clicked; JS errors, failed requests and dead clicks are reported. Destructive-looking labels (delete, pay, logout...) are skipped. Nothing is typed or submitted.

## Known limits
- Scans see the initial page state; tabs and dialogs opened by a click are not scanned yet.
- Contrast is skipped on text over images/gradients.
- Dark mode is detected through the OS setting and a `dark` class; a site that switches theme only through its own JS toggle is checked in light only (the run says so).
- The same component repeated on a page counts as one defect; the watch view marks the first instance.
- Layout, hierarchy and "does this look right" are not judged: Mole checks what can be measured.
