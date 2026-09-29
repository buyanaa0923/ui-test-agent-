# Running this on a new machine (work Mac)

About 10 minutes. Nothing here needs the personal machine, the personal Claude account, or any old key.

## 1. Get the folder onto the machine
Unzip `ui-test-agent-mvp.zip` (or clone the company GitLab repo once it exists). The zip has no keys, no `node_modules`, no old run results.

## 2. Set up
```bash
cd ui-test-agent
bash setup.sh
```
This installs dependencies, downloads Playwright's Chromium (if the download is blocked it falls back to an installed Google Chrome or Edge), creates `.env`, and runs `npm run doctor`.

## 3. Keys (in `.env`, never in chat, never committed)
| Variable | Where it comes from |
|---|---|
| `TYPESAFE_API_KEY` | TypeSafe console: the key issued to you or the team |
| `ANTHROPIC_API_KEY` | The **work** Anthropic Console (Settings, API keys). A Claude chat/Code subscription does not include API access. |

Without a Claude key, set `JUDGE_MODE=cli` to use the company `claude -p` runner instead (costs then show as "unpriced").
With neither key, the deterministic design checks still run; the model steps are skipped and say so.

## 4. Check the machine
```bash
npm run doctor                      # tools, browser, keys present, network reachability
npm run doctor -- --live            # also one real Jev call and one real Claude call (~$0.001)
npm run doctor -- --url http://localhost:5200/dashboard --live    # also checks the app you want to test is reachable
```
Every line is a tick, a warning or a cross with the exact fix. If Jev or Claude shows "refused by a network filter", the machine's network blocks the host: ask IT to allow it, or if a proxy is set try `NODE_USE_ENV_PROXY=1 npm run doctor` (Node 24+).

## 5. Prove it works here
```bash
npm run evidence                    # tests, mutation benchmark, determinism, seeded-defect smoke test (no keys needed)
npm run eval:jev -- --claude        # Jev vs Claude vs cascade on labelled cases (needs both keys, about $0.13)
npm run dashboard                   # http://localhost:4173 (live run) and /scorecard (judge scorecard)
```

## 6. Test a real app
```bash
npm run scan -- http://localhost:5200/dashboard --cascade       # design-system conformance, light + dark, Jev then Claude on the unsure cases
npm run flow -- http://localhost:5200/dashboard --max 20 --picker jev --risk-screen
```
Start the app first. Runs are written to `runs/<run>/` (report, screenshots, decisions log).

## Common problems
- **`Node ... too old`**: install Node 20.11 or newer.
- **Browser will not launch**: `npx playwright install chromium`, or install Google Chrome, or set `CHROMIUM_PATH` in `.env`.
- **"NOT RUN" / 0 elements**: the app did not render (wrong port, login wall, still starting). NOT RUN counts as a failure on purpose.
- **Jev or Claude call fails**: the run continues, that decision escalates or is marked unjudged, and the reason is in `runs/<run>/decisions.jsonl`.
- **Design system changed**: `npm run import-tokens -- /path/to/netsecure-design` regenerates `config/tokens.json`.

## Before showing numbers to anyone
The labelled sets in `eval/` were written by the project author. Have an engineer review the Mongolian labels and add real findings from your apps first; the scorecard says so on its face.

## Pages behind login
```bash
# 1. log in once in a Playwright context and save the session OUTSIDE the repo (mode 600), e.g. ~/.uta/hefesto.state.json
# 2. pass it to scan/flow:
UTA_STORAGE_STATE=~/.uta/hefesto.state.json npm run flow -- http://localhost:5181/ --max 15 --picker heuristic --risk-screen
# or: npm run scan -- <url> --storage-state ~/.uta/hefesto.state.json
```
A page that redirects to a login page, shows a password field, or says login is required is reported as NOT RUN (exit 2), never as "0 violations".
Note: Hefesto's own admin UI (:5181) is built on Ant Design, so the design-token rules do not apply to it; use `flow` there.

### Apps that keep the token in memory only (the NetOS shell)
A saved cookie session is not enough on a fresh page load. Tell the tool which button signs in; it clicks it after every load and re-checks:
```bash
export UTA_STORAGE_STATE=~/.uta/shell.state.json UTA_SSO_BUTTON=SSO     # or --storage-state / --sso-button
npm run scan -- http://localhost:5200/apps/netwrk-web/sales --cascade
npm run flow -- http://localhost:5200/apps/netwrk-web/sales --max 30 --picker jev --risk-screen --allow-origin http://localhost:5300
```
`flow` blocks requests to other origins (it must never wander off the app). A hub loads its modules from other ports, so name them with `--allow-origin` (repeatable, or `UTA_ALLOW_ORIGINS=a,b`). The report lists every blocked origin under "Not tested". If the session cannot be re-established mid-run, the run stops with `session-lost` and says so.

Flow picker chain: Jev, then (if unsure) the free heuristic, and if Jev fails Claude, then the heuristic. `PICK_ESCALATE=claude` makes an unsure Jev ask Claude instead. Each fallback is written to `runs/<run>/escalations.jsonl` and counted on the scorecard.
