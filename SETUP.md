# UI Test Agent - setup (5 minutes)

New machine? Read `WORK-MAC.md` instead: `bash setup.sh` does steps 1 and 3 for you, and `.env` is loaded automatically (no `source` needed).

## 1. Install
```bash
cd ui-test-agent
npm install
npx playwright install chromium        # once
cp .env.example .env                    # then fill in keys (see 3)
```

## 2. Point it at the real design system (source of truth)
```bash
npm run import-tokens -- /path/to/netsecure-design
```
Regenerates `config/tokens.json` (fonts, hex palette, button heights, radius scale, contracts). Re-run when the design system changes.
`config/tokens.json` in this zip was already generated from `@netos/netsecure-design@1.4.1`.

## 3. Keys (only needed for the model steps; the design scan works with none)
- **Claude verdicts**: console at platform.claude.com -> Settings -> API keys -> Create key. Put it in `.env` as `ANTHROPIC_API_KEY`. Use your work organization's Console so usage is billed to the company. Pro/Team chat subscriptions do not include API access.
  Alternative with no key: `JUDGE_MODE=cli` uses the `claude -p` runner already used by Hefesto (cost shows as "unpriced").
- **Jev**: `TYPESAFE_API_KEY` from the TypeSafe console (native API, `https://api.typesafe.ai/v1/systemone`). Nothing else depends on it; if a call fails the run falls back and logs it.

## 4. Run
```bash
npm run smoke                                        # 11 seeded defects must all be caught, 0 false positives
npm run scan -- http://localhost:3000 --judge        # design-system conformance, light + dark
npm run flow -- http://localhost:3000 --max 20 --judge   # click through buttons/tabs, find dead ones
npm run dashboard                                    # http://localhost:4173 - live time/cost, findings, screenshots
```
Open the dashboard first, then run a scan in another terminal: the meter moves live.

## Where Jev fits (trust ladder)
Deterministic facts first, then Jev, then Claude, then a human. Jev never has the last word on anything it is unsure about.
- `npm run jev:ping` - one real call: checks the key, latency, tokens and a Mongolian label.
- `npm run scan -- <url> --cascade` - Jev triages each finding (real defect or exempt?). Confident answers stand; uncertain ones go to Claude. Every decision is logged in `runs/<run>/decisions.jsonl`.
- `npm run flow -- <url> --picker jev` - Jev picks the next control, and a risk screen (Jev, then Claude, then fail-safe skip) keeps the explorer away from delete/pay/transfer buttons in English and Mongolian.
- `npm run eval:jev -- --claude` - measures Jev, Claude and the cascade on labelled decisions (accuracy, calibration, coverage, latency, cost). Every model response is recorded in `eval/cache/`, so `npm run eval:replay` reproduces the same numbers offline with no key and no cost. Commit `eval/cache/` so reviewers can rerun it.
- `eval/risk.jsonl` and `eval/triage.jsonl` are starter labels written by the project author. Have an engineer review the Mongolian labels and add real findings from Hefesto apps before quoting numbers as final.

## Evidence (numbers you can show)
```bash
npm test               # 34 tests: model-output validation, retries, circuit breaker, budget cap, cascade, and "the benchmark can fail"
npm run evidence       # tests + benchmark + determinism + smoke, in one command (feeds the scorecard)
npm run bench          # mutation benchmark: 220 generated pages, one injected defect each (+ clean pages); precision/recall/F1 per rule
npm run determinism    # same page, 20 fresh runs, output must be identical
```
The benchmark's ground truth lives in `bench/truth.json` (frozen, reviewed), not in `config/tokens.json`, so a token-import bug or a broken rule fails the benchmark. `npm test` proves this by sabotaging the rules and checking the benchmark notices.
Every report carries a `stamp` (tool version, design-system version, token hash, rules hash). Set `BUDGET_USD` (default 1) to cap model spend per run.
The mutation benchmark is synthetic: it proves rule accuracy and false-positive behaviour, not generalisation to real apps. That needs the labelled real-app set (next step).

## What is checked
Deterministic (free, ~1 s): raw off-palette colors, fonts, button height/font scale, unnamed icon buttons, wrapped button text, unlabeled inputs, radius scale, overflow/truncation, WCAG AA contrast (measured from painted pixels, light and dark).
Flow: every safe button/tab/link is clicked; JS errors, failed requests, dead clicks are reported. Destructive-looking labels (delete, pay, logout...) are skipped.
Claude (`--judge`): rules on each finding: real / false positive / needs human, plus a one-line fix.

## Known limits
- Jev's API shape is verified against the live service (a yes/no answer carries a probability but no separate `confidence`; the client derives it and flags it).
- Contrast is skipped on text over images/gradients.
- Contract checks (table needs search+filter+pagination, form action pairs, modal/drawer widths) and static source scan are not built yet.
