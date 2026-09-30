# Mole: setup (5 minutes)

New work Mac? `WORK-MAC.md` has the machine-specific notes. `bash setup.sh` does steps 1 and 3 for you, and `.env` is loaded automatically (no `source` needed).

## 1. Install
```bash
npm ci                                  # or: npm install
npx playwright install chromium         # once. Blocked network? An installed Google Chrome or Edge is used automatically
cp .env.example .env                    # then fill in keys (see 3)
npm link                                # optional: puts `mole` on your PATH; otherwise use `node bin/mole.mjs` or `npm run mole --`
mole doctor                             # ticks, warnings, and the exact fix for anything missing
```

## 2. Point it at the real design system (source of truth)
```bash
npm run import-tokens -- /path/to/netsecure-design
```
Regenerates `config/tokens.json` (fonts, hex palette, button heights, radius scale, contracts). Re-run when the design system changes.
The committed `config/tokens.json` was generated from `@netos/netsecure-design@1.4.1`.

## 3. Keys (only for the model steps; rule scans need none)
- **Claude verdicts**: console at platform.claude.com -> Settings -> API keys -> Create key. Put it in `.env` as `ANTHROPIC_API_KEY`. Use your work organization's Console so usage is billed to the company. Pro/Team chat subscriptions do not include API access.
  Alternative with no key: `JUDGE_MODE=cli` uses the `claude -p` runner already used by Hefesto (cost shows as "unpriced").
- **Jev**: `TYPESAFE_API_KEY` from the TypeSafe console (`https://api.typesafe.ai/v1/systemone`). If a call fails the run falls back and logs it.
- With both keys set, `mole dig` uses the Jev -> Claude ladder by default. `--no-model` forces rules only (free).

## 4. Run
```bash
mole dig http://localhost:5200/dashboard              # design-system conformance, light + dark
mole dig <url> --watch                                # same, in a real browser with the live mole overlay
mole tunnel <url> --max 20 --picker jev               # click through controls, find dead buttons / JS errors / failed requests
mole ci --urls urls.txt --out evidence/runs/<id>      # pipeline gate: exit 0 clean / 1 defects / 2 not run
mole replay latest                                    # replay the last run in the terminal, no browser
mole dashboard                                        # http://localhost:4173 - run history, cost, judge scorecard
```
`mole <command> --help` lists every option. `npm run scan` and `npm run flow` still work as aliases of `dig` and `tunnel`.

### Exit codes (the contract a pipeline can rely on)
| Code | Meaning |
| :- | :- |
| 0 | every page tested and clean |
| 1 | defects found |
| 2 | **not run**: nothing (or not everything) was tested. A failure, never a pass |
| 64 | bad usage |

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
Every report carries a `stamp` (tool version, design-system version, token hash, rules hash). `BUDGET_USD` (default 1) caps model spend per run.
The mutation benchmark is synthetic: it proves rule accuracy and false-positive behaviour, not generalisation to real apps. That needs the labelled real-app set.

## What is checked
Deterministic (free, ~1 s): raw off-palette colours, fonts, button height/font scale, unnamed icon buttons, wrapped button text, unlabeled inputs, radius scale, overflow/truncation, WCAG AA contrast (measured from painted pixels, light and dark).
Tunnel: every safe button/tab/link is clicked; JS errors, failed requests and dead clicks are reported. Destructive-looking labels (delete, pay, logout...) are skipped. Nothing is typed or submitted.

## Known limits
- Scans see the initial page state; tabs and dialogs opened by a click are not scanned yet.
- Contrast is skipped on text over images/gradients.
- With `--watch` on a page taller than the screen, the overlay draws boxes for the whole page but you see only what fits the window.
- Contract checks (table needs search+filter+pagination, form action pairs, modal/drawer widths) and a static source scan are not built yet.
