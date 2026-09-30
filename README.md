<p align="center">
  <img src="assets/brand/mole.png" width="180" alt="Mole">
</p>

<h1 align="center">Mole</h1>
<p align="center"><b>Digs up UI bugs before your users do.</b></p>

Mole drives a real browser against your running app and reports **distinct, evidence-backed UI defects**: design-system
violations in light and dark mode, and controls that do nothing, throw errors or fail requests. Deterministic rules find the
facts; a **Jev → Claude → human** ladder judges them, so the fast cheap model settles the obvious cases and the expensive one
only sees the doubtful ones. Every run is timed, costed and replayable.

```bash
mole dig http://localhost:3000                      # what's wrong on this page?
mole dig <url> --watch                              # the same, in a real browser, live
mole dig <url> --platform mobile                    # the phone layout: 44px targets, 16px body text, iOS zoom
mole tunnel <url>                                   # do its buttons actually work?
mole design show                                    # which design contract applies here, and which rules are on
mole ci --urls urls.txt --out evidence/runs/<id>    # pipeline gate: exit 0 clean · 1 defects · 2 not run
```

## It checks against *your* design

Mole knows modern design practice out of the box (the built-in [`modern-web`](config/packs/modern-web.md) pack:
WCAG contrast and target size, readable type, line height and line length, iOS input zoom, each with its source), and
adapts to any project through a **`DESIGN.md`** in the repo:

````markdown
# Design: Acme Bank

```mole
extends: modern-web
fonts: [Inter]
colors: { primary: "#0f766e", ink: "#0f172a", surface: "#ffffff" }
type: { scale: [12, 14, 16, 20, 24, 32], body-min: { desktop: 14, mobile: 16 } }
radius: [0, 4, 8, 12, 9999]
ignore: [".ant-*"]            # third-party widgets are out of scope
rules: { line-length: off }   # off | low | medium | high
```

Calm, dense data screens for analysts.
````

The block is what Mole measures; the prose is for people. `mole design init` writes a starter, `/mole:design` in Claude
Code drafts it from your Tailwind config and tokens, and `mole design show` prints exactly what will be enforced. Without
a `DESIGN.md`, Mole checks modern-web best practice only (no brand fonts, colours or sizes) and says so on every run;
NetOS apps write `extends: netos`. Full reference:
[`docs/DESIGN-CONTRACT.md`](docs/DESIGN-CONTRACT.md).

## Every defect points at its source

```text
● [high] control-unlabeled input.field-input form control has no label or aria-label  → src/components/LoginForm.tsx:8
```

Exact when the dev build knows (React 18 `_debugSource`, Vue `__file`, inspector-plugin attributes, `data-mole-src`);
otherwise a scored search of your source by id, aria-label, text (through i18n keys too), classes and surroundings.
Each location carries its confidence, and rivals when two places look alike; with no good evidence there is no location
rather than a guess. [`docs/SOURCE-MAPPING.md`](docs/SOURCE-MAPPING.md).

## See it work

**In the terminal** (live view; one line per event when piped or in CI):

![mole dig in the terminal](docs/assets/scan-live.png)

**In the browser** (`--watch`, and by default when Claude runs it): the page stays at its real size and Mole measures it
screen by screen with a laser pass, then tours the results screen by screen: green boxes were measured, red boxes are
defects with the rule on them, and the panel keeps a running feed of who decided what (rule, Jev, Claude).

![mole overlay while digging](docs/assets/overlay-dig.png)

**Tunnelling**: the mole walks to each control; badges show which model picked it and whether the safety screen allowed the click.

![mole overlay while tunnelling](docs/assets/overlay-tunnel.png)

Everything on screen is driven by real events from the run. Nothing is scripted; add `--record` for a video.

## Install in Claude Code (Mac or Windows)

```text
/plugin marketplace add buyanaa0923/ui-test-agent-
/plugin install mole@mole
```

Needs Node 20+ and Chrome or Edge. No key is needed; optional keys are stored in your OS keychain. Step by step, with
updates and troubleshooting: [`INSTALL.md`](INSTALL.md).

## Quick start (terminal)

```bash
npm ci && npx playwright install chromium     # an installed Chrome or Edge works too
cp .env.example .env                          # optional keys: TYPESAFE_API_KEY (Jev), ANTHROPIC_API_KEY (Claude)
npm link                                      # optional: puts `mole` on your PATH
mole doctor                                   # ticks, warnings and the exact fix for anything missing
mole dig http://localhost:3000
```

No keys? Mole still runs every deterministic check for free (`--no-model`). With both keys it uses the ladder by default.

## What you get in Claude Code

| | What it does |
| :- | :- |
| `/mole:dig <url> [mobile] [fix]` | scan a page with the live Mole panel on screen; with `fix`, Claude fixes the defects and re-checks to prove it |
| `/mole:design` | draft this project's `DESIGN.md` from its tokens / Tailwind config |
| `/mole:tunnel <url>` | click through controls, report dead buttons / JS errors / failed requests |
| `/mole:watch <url> [record]` | the live browser view for showing someone; `record` saves a video |
| `/mole:doctor` | is this machine ready? |
| MCP tools `mole_dig` `mole_tunnel` `mole_doctor` `mole_report` | Claude calls them itself after changing UI; the project, its `DESIGN.md` and its source are found automatically; every finding comes with its measurement, source (WCAG, HIG, your design), fix hint and `file:line` |
| the `mole` skill | teaches Claude when to test, the find → fix → re-check loop, and that **NOT RUN is never a pass** |

Settings (panel on/off, Jev key, Claude second opinion) are asked when the plugin is enabled and live in `/plugin` >
Installed > mole > Configure options; keys go to the OS keychain. Without the plugin:
`claude mcp add mole -- node /path/to/repo/bin/mole.mjs mcp`.

## How it decides

```
 page ──▶ deterministic rules from the design contract (measured on the live page: contrast, targets, type, labels, overflow, tokens)
              │  a finding = a fact with a measurement, e.g. "contrast 4.43:1, needs 4.5:1"
              ▼
          Jev  (fast, cheap, calibrated)  ── confident? ──▶ settled
              │ unsure
              ▼
         Claude (only the doubtful ones)  ── unsure / down? ──▶ a person
```

- Confirming a defect needs confidence ≥ 0.8; **dismissing needs ≥ 0.9**, because wrongly dismissing a real bug is the costly mistake.
- The same defect in light and dark is judged once and the verdict is shared: half the model calls.
- The click-through has a **safety screen** (Jev, then Claude, then fail-safe skip) so it stays away from delete / pay / logout, in English and Mongolian. Nothing is typed or submitted.
- Spend is capped per run (`BUDGET_USD`) and every model call is metered, including the safety screen.

## Exit codes: a contract for pipelines

| Code | Meaning |
| :- | :- |
| `0` | every page tested and clean |
| `1` | defects found |
| `2` | **not run**: login wall, app down, blank page, missing session. Nothing (or not everything) was tested, so it fails |

`mole ci` writes an evidence folder (`summary.json`, per-page reports, screenshots, traces) so a pipeline stage can attach proof
instead of trusting a sentence.

## Proof, not promises

```bash
npm test               # every test, no keys needed (model calls are mocked)
npm run evidence       # tests + mutation benchmark + determinism + smoke
```

Measured on this repository on 2026-09-30 (see `docs/internal/WORK-STATUS.md` for real-app findings and their honest limits):

| What | Result |
| :- | :- |
| tests | 195 passing (no keys needed), including "the benchmark can fail" (sabotaged rules must be caught) |
| mutation benchmark | 220 generated pages, one injected defect each: precision 1, recall 1, exact-match 100%, 0.0% false positives on clean pages |
| determinism | 11/11 pages identical across 20 fresh runs |
| seeded-bug smoke | 11/11 caught |

The benchmark is synthetic: it proves rule accuracy, not generalisation to real apps. Model accuracy on real findings needs
human labels (`docs/LABELLING.md`) and is reported as **not yet measured** until then.

## Project layout

```
bin/  src/{core,engine,models,eval,ui,cli,mcp}/  plugin/  .claude-plugin/  scripts/{quality,eval,dev}/
test/ (mirrors src)  config/  bench/  eval/  test-pages/  assets/  docs/
```

Dependencies point down only and a test enforces it. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before adding a
command, rule, event or surface. Setup details: [`docs/SETUP.md`](docs/SETUP.md).

## License

ISC
