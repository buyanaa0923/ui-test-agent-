# Demo run book (real models, real app, recorded)

Goal: a 90-second video where every number on screen is real. Do this once on the work Mac with the apps running.

## 0. Preflight (2 minutes)
```bash
cp .env.example .env            # paste TYPESAFE_API_KEY and ANTHROPIC_API_KEY (work Console). Never paste keys in chat.
mole doctor --live --url http://localhost:5200/dashboard
```
Everything should tick. `--live` makes one real Jev call and one real Claude call (about $0.001) to prove the keys work.
If the shell needs login, use the saved session: `--storage-state ~/.uta/shell.state.json --sso-button "NetOS SSO"`.

## 1. Rehearse without spending money
```bash
mole dig http://localhost:5200/dashboard --no-model --watch
```
Check the window: the page stays at its real size; Mole measures it screen by screen (laser pass), then tours the results
screen by screen with red boxes on defects. Resize the terminal to at least 110 columns and 34 rows for the full view (the mole header).

## 2. The takes (in this order)
| # | Command | What the viewer sees |
| :- | :- | :- |
| 0 | in Claude Code, in the app's folder: `/mole:dig <url> fix` | the Mole panel opens and checks the page; Claude gets each defect with its `file:line`, fixes it, re-checks, and shows before → after. The strongest take: the whole loop |
| 1 | `mole dig http://localhost:5200/apps/netwrk-web/sales --watch --record` | laser sweeps every element, defects turn red with the rule name; the HUD feed shows Jev deciding in ~280 ms, unsure ones going to Claude |
| 2 | `mole tunnel http://localhost:5200/apps/netwrk-web/sales --watch --picker jev --allow-origin http://localhost:5300 --max 12` | the mole walks to each control; badges show the picker and the safety screen (safe / skipped) |
| 3 | `mole dig http://localhost:5200/dashboard` (no `--watch`, in the terminal) | the live terminal panel, ladder bars, then the verdict card with time and cost |
| 4 | `mole ci --urls pilot/urls.txt --out evidence/runs/demo --result-line` | the pipeline view: per-page lines, exit code, the `RESULT:` line, evidence folder |
| 5 | stop the app, run take 4 again | exit 2, `success=false`: "not run" is a failure, never a pass |
| 6 | `mole replay latest` | the same run replayed instantly, no browser, no cost |

Videos: `--record` saves a `.webm` in the run folder (`runs/<id>/video/`). For the terminal takes use your screen recorder.

## 3. Numbers to read out (all from the run, none invented)
- Time and cost: bottom of the terminal panel and `runs/<id>/summary.json`.
- Jev latency (p50) and how many findings Jev settled vs Claude vs a person: the ladder rows and the card.
- "Claude-only would cost at least ..." appears on the card only when it is provably higher than the run's cost.
- Rules-only mode is $0; say so.

## 4. After recording
```bash
npm run trace:png -- runs/<the-dig-run> --name netwrk-sales    # real terminal screenshots for the README and slides
```
Replace the fixture screenshots in `docs/assets/` and `README.md` with these.

## What not to claim
- Speed: a watched run is paced for people (about 30 s on a 10-screen page). Unwatched, Mole's own checking of that page
  took about 2.7 s and the whole run about 12 s, most of it the dev server loading the page. That is about 3x end to end, not 100x.
- No accuracy figure for Jev or Claude on real findings until the labelled set is done.
- The mutation benchmark (precision/recall 1) is synthetic: say "rule accuracy on injected defects", not "accuracy on real apps".
- The shared white-on-`#008779` contrast finding is a design-system finding, not a Hefesto-code bug: say which it is.
