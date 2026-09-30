# WORK-STATUS

Updated: 2026-09-30 (Phase 0 done, read-only). Machine: work Mac, Node 25.9.0.
Rule for this file: only things observed. "Not measured" means not measured.

## 1. Tool health on this machine (measured today)
| Check | Result |
|---|---|
| `npm test` | 34/34 pass |
| `npm run evidence` | tests 34/34; mutation bench precision 1 / recall 1 / exact-match 100%, 0.0% false positives on clean pages; determinism 11/11 pages identical over 20 runs; smoke 11/11 seeded bugs caught |
| `npm run doctor -- --live --url http://localhost:5181` | READY: Node, tokens 1.4.1, Playwright + Chromium 153, both keys present (not read), Jev live 281 ms, Claude live ok, app reachable |
| Design tokens | `config/tokens.json` = netsecure-design 1.4.1; local checkout `~/Documents/netsecure-design` is 1.4.1 at `09b92a7 release: v1.4.1` on `main`. No re-import needed |

## 2. What is listening (lsof) and what it is
| Port | What | Path | Notes |
|---|---|---|---|
| 5181 | Hefesto UI (Vite) | `~/Documents/hefesto/frontend` | HTTP 200. **Every route redirects to `/login`** without a session (NetCore login) |
| 8081 | Hefesto backend (Spring, Java 17) | `~/Documents/hefesto/backend` | 404 on `/`, API under `/api/v1` |
| 8098 | gateway-proxy.mjs | `~/.hefesto-dev` | Hefesto dev gateway/Keycloak proxy (not investigated further) |
| 5200 | **netos-shell-dev** (NetOS Web Hub shell, local dev harness, Vite) | `~/Documents/netos-shell-dev` | HTTP 200, **renders dashboard with no login** (208 DOM elements, Mongolian UI). NOT the prod hub (prod is `netos/netos-hubshell`) |
| 51541 / 54874 / 16322 | module-federation dts helper processes of the shell | same | not apps |
| 8083 / 8084 | react-native Metro (network-mobile) | `~/network-mobile/apps/host` | mobile, out of scope |
| 8082 | nothing | | this is why the old doctor default failed. Per Hefesto docs `:8082` is the isolated `hefesto_test` backend, not a UI |
| 5300 | **not running** | `~/Documents/network-web/frontend` (`netwrk-web`, Vite, uses netsecure-design ^1.4.1) | It is the remote the shell mounts under `/apps/netwrk-web/*`. Without it those routes show only the shell chrome (194 elements) |

## 3. Key finding that changes the plan: two different "Hefesto" targets
- **Hefesto's own admin UI (5181) is built on Ant Design (`antd ^5.22.5`), not on netsecure-design.** Our 11 rules check conformance to netsecure-design tokens, so they will report many "violations" there that are not defects (wrong reference system). Do not present those as findings. Use 5181 for the flow/dead-control/JS-error/failed-request part, and treat design-token results on it as out of scope unless you decide otherwise.
- **Hefesto-generated code** (network-web, the modules mounted in the shell) uses `@netos/netsecure-design ^1.4.1`. The shell (5200) migrated to netsecure-design on 2026-09-23 (from the older Mantine-based `@netos/nc-web-design-system`). These are the right targets for token conformance.
- Suggested target order: (1) shell 5200 (works now, no login), (2) network-web on 5300 mounted in the shell (needs `npm run dev` there), (3) Hefesto 5181 for flow only, needs a test account.

## 4. How Hefesto stages work (hook points)
Source: `~/Documents/hefesto/docs/TEST-FLOW.md` (2026-09-30), `scripts/pipeline-integration.sql`, `runner/hefesto-runner.sh`.
- `DEV_TEST` and `UAT_TEST` are **AI-agent stages** (executor AGENT). Their whole instruction is one sentence ("run smoke + contract tests, report, RESULT: success=true if all pass"). Nothing machine-checks that a test ran.
- The runner (`hefesto-runner.sh`) decides success from the last `RESULT: success=true|false summary=...` line the agent prints, and only ever the agent's own claim. It also builds an evidence file (`build_evidence`) but only greps `Tests run:` and `BUILD SUCCESS|FAILURE`.
- Hefesto's own measurement (their doc, DB dump of 2026-09-23): `DEV_TEST` 38 done / 14 skipped / **0 failed**; `UAT_TEST` 7 done / 39 skipped / 0 failed. These are their numbers, not ours.
- **Precedent to copy:** pipeline 5's `VERIFY` stage names its commands, writes evidence to `evidence/runs/<run-id>/`, and states "NOT_RUN is FAIL" and "no way around the check". Our invariants already match that wording.
- **Proposed hook (matches their own recommendation #1/#2 in TEST-FLOW):** put one command in the DEV_TEST/UAT_TEST instruction text, e.g. `node scripts/hook.mjs --urls urls.txt --out evidence/runs/<run-id>`, tell the agent to report `success=true` only on exit 0 and to attach the evidence path. Exit codes: 0 pass, 1 defects, 2 NOT_RUN (= failure). No change to Hefesto backend code is needed for a pilot; a server-side check of the evidence file would be a later step and is Hefesto's decision.
- Pipeline definitions live in the Hefesto DB (`pipeline_stages.instruction`), not in the repo, so editing the instruction is a DB/admin-UI change on their side. Not touched.

## 5. How UI is tested today (so we slot in, not duplicate)
- Hefesto already has a UI scanner: `scripts/ui-scan.sh smoke|responsive` (`ui-smoke.mjs`, `ui-responsive.mjs`, `ui-common.mjs`, 12 DOM detectors: horizontal scroll, overflow, truncated text, overlap, small tap targets, console errors, 4xx/5xx). It does **layout/responsiveness, not design-system conformance**, and explicitly does not click through flows or handle login-gated pages by default (uses `SMOKE_TOKEN` from localStorage `hefesto_auth`).
- It is **already scheduled**: launchd job `mn.netcapital.qa-scan` is loaded on this Mac (132 runs, last exit 0), runs `scripts/ui-scheduled.sh` (`QA_TRIGGER=scheduled`), logs to `scripts/qa-runs.jsonl` and `~/Library/Logs/hefesto-qa-scan.log`. Their own job; I did not touch it. Their trigger/feedback logs (`qa-runs.jsonl` 18 lines, `qa-feedback.jsonl` 1, `regressions.jsonl` 5, `fp-registry.json` 17) are a possible source of real reviewer verdicts for Phase 2.
- Their scanner and ours are complementary: theirs = layout at 3 widths; ours = token conformance + click-through + model triage. Worth saying in the submission, and worth reusing their `RUN_TRIGGER`/`QA_TRIGGER` naming idea.
- Shell CI (`netos-shell-dev/.gitlab-ci.yml`): includes `netos-core` v2.0.4 `ci/npm-publish.yml`; `npm run lint`, `npm test`, `npm run build`, plus `nc-audit` (design-system audit) inside the gate, dependency scan, Harbor image build. No browser UI test job.
- network-web: per Hefesto's doc, 88 `it()` tests that never run in CI.

## 6. Auth needs
| App | Needs login? | Plan |
|---|---|---|
| Shell 5200 | No (dev harness; dashboard renders anonymously). Real Keycloak flow exists in prod config | scan directly |
| network-web via shell | Not observed yet (5300 is down) | start it, then re-check |
| Hefesto 5181 | Yes, NetCore login. No default admin | needs a **test account from you**, stored as a Playwright `storageState` outside the repo (e.g. `~/.uta/hefesto.state.json`). I will not guess or bypass credentials |

## 7. Answers received (2026-09-30) and what was done
1. Main app = shell 5200 + network-web 5300: confirmed. network-web dev server started by me (`npm run dev`, log in the session scratchpad); it only renders **inside the shell**, standalone it is a blank federated remote (3 elements, correctly NOT_RUN).
2. Hefesto test account received in chat. Logged in once through the real form (the only POST went to `localhost:5181/api/v1/auth/login`, proxied to local :8081); session saved to `~/.uta/hefesto.state.json` (mode 600, outside the repo). The password is in no file and not in this document.
3. Design-token rules are out of scope for Hefesto's antd UI: confirmed. Scanning it with a session gives 80 violations on `/issues` that are all "wrong reference system" (raw-color-literal, font-family -apple-system, etc.); not counted as findings.
4. **SSO test account received (2026-09-30), unblocked.** Logged in once through the shell's real SSO button; the credentials went only to `localhost:5200`, which proxies to the local Keycloak. Session cookies are in `~/.uta/shell.state.json` (mode 600, outside the repo); the password is in no file. I did not read the Keycloak realm fixture.

## 8. Phase 1 (real apps) results, all measured today on this Mac
Pages scanned deterministically: shell `/dashboard`, `/admin/registry`, `/admin/surfaces`, `/admin/conformance` (real content, light + dark). `/apps/*` scans were first wrongly "tested" (see bug 1) and are now NOT_RUN.

| Finding | Where | Verdict |
|---|---|---|
| White text on primary `#008779` = **4.43:1** (needs 4.5:1), 11px "NetOS SSO-гоор нэвтрэх" button, every shell page, light and dark | shell sidebar | **True positive**, verified by hand from computed styles. Root cause is the design system's own primary token (`agent/tokens.json` `primary: #008779`) against white text under 18.66px bold; would hit any small white-on-primary text. Worth telling the design-system owners |
| Search input has only a placeholder; the CFT `<select>` has no label at all | `/admin/surfaces` | select = true positive (WCAG 4.1.2 / 1.3.1). Placeholder-only input is **arguable** (browsers use placeholder as last-resort name, WCAG 3.3.2 says it is not a label). Left as a finding; good Phase 2 label case, engineers should decide |
| Cascade on `/admin/surfaces`: Jev confirmed all 6 findings at 0.83-0.89, no escalations, cost $0.000131 | | n=6, no ground truth yet, not an accuracy claim |
| Shell flow (dashboard): 12 of 13 distinct controls exercised, 0 findings after fixes, 1 control skipped by the risk screen ("ГүйлгээNetCore Ledger", Mongolian for "transaction", Claude answered uncertain 0.8) and then judged safe on the second appearance as a link | | model conservatism, fail-safe worked |
| Hefesto flow (admin session, `/` and `/issues`, heuristic picker): 7/11 and 6/12 controls exercised, no JS errors, no failed requests. 4-6 nav buttons skipped by the risk screen (e.g. "Issue" judged risky at 0.6, "Админ", "MD сан", "HFHefesto" logo uncertain at 0.8-0.85). One dead-click: the "Хяналтын самбар" (dashboard) button while on the dashboard: current-page item without `aria-current`, arguable (a11y finding, not a functional bug) | | model mistakes cost coverage, not correctness. Only clicks, no typing or form submits; dialogs opened by "Issue үүсгэх" and "AI туслах" were not submitted |

English UI and a Mongolian/English switch: not found in the shell or Hefesto; all UI seen is Mongolian (`lang=mn`). Light/dark: shell has a toggle (scan checks both); Hefesto has none observed. Not measured for those.

### Bugs found in the tool and fixed (each with tests first; 34 -> 50 tests, benchmark unchanged)
1. **Login walls were scanned as if they were the page** (violated NOT_RUN=FAIL). `/apps/netwrk-web/sales` showed only "login required" chrome and still reported 3 violations. `guard.mjs` now detects redirect to a login/identity path, a password field, or "login required" text (Mongolian and English) and returns NOT_RUN (exit 2). Scanning a login page on purpose is allowed. `test/guard.test.mjs` (7 pure + 1 real-browser test).
2. **Flow silently stopped after 2 of 20 steps.** Claude's picker was shown already-tested controls, picked one, and the loop treated that as "stop". Now Claude sees only untested controls, a tested pick is rejected and falls back to the heuristic, and the report has a `coverage` block (`controlsFound`, `exercised`, `stopReason`). On the shell dashboard this went from 2 to 12 controls.
3. **False dead-click on a link to the current page.** Links whose URL equals the current URL no longer count as dead (`src/flow-rules.mjs`). Grounded in HTML link semantics, not WCAG; you asked for WCAG-grounded exemptions only, so tell me if you want this reverted.
4. **Risk-screen calls were not metered**: Jev and Claude spend was missing from the live cost, the scorecard and the `BUDGET_USD` cap for every `--risk-screen` run. Fixed and tested (a heuristic-picker shell run is $0.0084, nearly all Claude risk escalations, 0 unpriced calls). **Any flow cost quoted before this fix was too low.**
5. Added `--storage-state` / `UTA_STORAGE_STATE` for pages behind login (a missing file is NOT_RUN, never a silent anonymous run).
6. Docs: default app URL `:8082` -> `:5200/dashboard`; login section added to WORK-MAC.md.

### Findings about the models (measured, not tuned)
- **Jev as flow picker is not useful at the 0.8 gate**: on the shell dashboard 12 of 13 picks had Jev confidence 0.40-0.70 and escalated to Claude: picker cost $0.0552 (Claude $0.0548, Jev $0.0004), 50 of 85 seconds. The free heuristic picker got the same coverage (12/13) and the same findings on that page. n = one page. Picks carry no safety weight (the risk screen is the safety gate), so falling back to the heuristic instead of Claude looks right, but that is a design decision I did not make; gates untouched.
- **Risk screen on Mongolian nav labels is conservative**: the fail-safe skips harmless controls when Claude is <0.9 sure. Coverage cost, not a safety problem. Consistent with Mongolian being the weak spot in your earlier eval.

## 9. Phase 1 continued: real Hefesto-generated pages (netwrk-web, via the shell, logged in as the test user)
Setup finding: the shell keeps the access token **in memory only** (by design), so `storageState` alone does not log a fresh page load in. Added `--sso-button` (clicks the app's own sign-in button after each load; still walled = NOT_RUN) and, because `flow` reloads every step, it re-establishes the session each time and stops with `session-lost` if it cannot.

**Cascade scan of 10 real netwrk-web routes** (light + dark, ~$0.06 total, 8-9 s each): `/apps/netwrk-web`, `/branch`, `/sales`, `/performance-career`, `/training-certification`, `/target-cascade`, `/sales/pipeline`, `/sales/proposals`, `/sales/incentives`, `/sales/conduct`. 2-8 findings per page, many of them the same shell element repeating on every page (Phase 2 will de-duplicate by rule + selector + text before labelling).
| Finding | Verdict |
|---|---|
| White 13px text on primary = 4.43:1 on the module's own "Lead бүртгэх" primary button (and on link text `a.underline` 4.43:1 on `/branch`, `/proposals`, `/incentives`) | True positive. **Same root cause as the shell button: the design system's primary `#008779`.** This is a design-system-level finding, not a Hefesto-code finding |
| `/target-cascade`: "эсвэл дугаараар нээх" 11px divider text **2.56:1 light / 3.75:1 dark** | True positive, clearly failing, verified in the screenshot |
| `/target-cascade`: UUID input has only a placeholder, no label | Same placeholder-only pattern as the shell's search box (3 places now); arguable, Phase 2 label |
| `/sales` (and `/pipeline`): truncated table cell text without title | Real but low (Jev 0.86-0.87 confident) |
| `button.w-full` "16px text in a 36px button" on **every** page | It is the shell's sidebar nav wrapper `<button>` (no background, border or padding; the visible row is the child). Label really is 16px, DS says controls <=36px use <=14px. Jev unsure (0.58-0.61) -> Claude -> **needs_human**. I left the rule alone: it is a scope question for a person, and it is exactly the case the ladder should send to L3 |
Cost of the ladder on these 10 pages: Jev settled the confident ones, 2 findings/page went to Claude and ended `needs_human`.

**Flow on `/apps/netwrk-web/sales`** (jev picker, risk screen, `--allow-origin http://localhost:5300`): 25 of 31 distinct controls exercised in 30 steps (stopped at max-steps), $0.032, 145 s. Includes tabs, module nav, theme toggle, and the "Lead бүртгэх" button (it opened a dialog; nothing was typed or submitted). Skipped by the risk screen: "Боломж болгох" ("make it an opportunity"), "Зорилтын тараалт", "Салбарын үйл ажиллагаа" (nav), the Ledger nav entry. No failed requests. Two low findings: the NetLoan and NetBI remotes fail to load (`nc_loans` on :5012, `nc_reports` on :5013, Federation `RUNTIME-008`): those two dev servers are not running on this Mac, so this is environment, not app.

### More tool bugs found and fixed (tests first; 50 -> 62 tests, benchmark unchanged)
7. **The flow explorer blocked the hub's own modules.** It aborts every cross-origin request, and netwrk-web is served from :5300 while the shell is :5200, so the first flow run only clicked the shell chrome, never the module. Now `--allow-origin` (explicit, repeatable) lets named origins through, and the report always lists blocked origins under "Not tested".
8. **Tool-caused errors were reported as app defects.** Requests we block make Chromium log `net::ERR_FAILED`. Those are now dropped (never more than the number of requests we blocked); any other error seen while we blocked something is kept but downgraded to `js-error-blocked-context`, low severity, labelled as unverified.
9. Scorecard counted fallbacks by the old event name; it now counts `jev_unsure` and `jev_failed` too (tested).

### Decisions taken from your answers
- **Picker (your #2):** implemented as Jev -> if unsure, free heuristic; if Jev **fails**, Claude (frontier fallback) -> if that fails too, heuristic. So the frontier model is still the safety net for outages; it is no longer paid for on every unsure pick. `PICK_ESCALATE=claude` restores "unsure asks Claude". Tests cover all five paths. Not yet measured after the change: cost of a full jev-picker flow (the run above shows $0.032 for 30 steps, most of it the Claude risk-screen escalations).
- **Current-page-link exemption (your #3):** kept, and now visible: flow reports how many links were exempted (`coverage.selfLinksNotCountedAsDead`). My reasoning: a link to the URL you are already on cannot change anything by construction; the exemption never applies to buttons or to links to other URLs.

## 10. Phase 2: real labelled set (built today; waiting for two engineers)
**Nothing here is a result yet.** No human has labelled anything, so there is no accuracy number and none is claimed. (I ran the whole pipeline once on throwaway labels I generated myself, only to test the plumbing; those files were not written to `eval/`, `review/` or the scorecard, and the throwaway run was deleted.)

**What exists**
- `eval/real-findings.jsonl`: **18 unlabelled records** (`label` empty, `positive` null), same shape as `triage.jsonl`, plus provenance: pages, modes, source runs, tool stamp, root-cause cluster. 15 design findings (14 shell and netwrk-web pages, light + dark, merged) and 3 flow findings. By rule: contrast 11, control-unlabeled 2, button-font-size 1, text-truncated-no-title 1, dead-click 1, js-error-blocked-context 2. `eval/real-findings.meta.json` records how it was collected (cutoffs, hosts, tool/rules/tokens hashes).
- **Honest size limits:** 18 records in only **8 root-cause clusters**; **10 of the 11 contrast records are the same cause** (white text on the design system's primary `#008779` under many different buttons). Model-eligible n is 15. That is far below the 30 the report requires before it will say "met", and even 30 records from few clusters would be a weak claim.
- Built to keep the set clean: ids are content hashes (re-collecting never shifts a label onto another finding); earlier Jev/Claude verdicts are stripped from the records; Hefesto's own antd UI contributes flow findings only; runs from before the login-wall guard and flow fixes are excluded by explicit cutoffs; `collect` refuses to overwrite a file that carries labels.
- `review/real-findings/sheet.html`: self-contained review page, one card per finding with a cropped screenshot and the measured value, three choices (real / not a defect / unsure), notes, autosave in the browser, "Download my labels (CSV)". Shows no model opinion. Also `labels-template.csv` for spreadsheet users. Checked in a real browser: 18 cards, 15 cropped figures load, export parses, answers survive reload.
- `npm run real:labels -- --a A.csv --b B.csv [--adj file.csv]`: Cohen's kappa (undefined is reported as undefined, never as 1), raw agreement, unsure count, disagreements file for a third person, and `eval/real-findings.labeled.jsonl` with only agreed or adjudicated labels. Refuses two files from the same labeller.
- `npm run eval:real` (and `eval:real:replay`, free, from recorded responses): held-out evaluation of L0 rule precision, Jev, Claude and the production cascade on the human labels, each with n and a 95% Wilson interval, cluster-weighted accuracy, the cascade both "on what it decided" and strict (a finding sent to a person counts as a miss), a per-finding fallback/escalation log (`runs/eval-real-*/escalations.jsonl`), and a target line that says PRELIMINARY below n=30. **Gates are not options of this script**; it reads GATE_CONFIRM/GATE_DISMISS like production. Without a labelled file it exits 2 and prints nothing numeric.
- Scorecard: new "Real-app evaluation" block, "Not yet measured" until labels and an eval exist, then n, kappa, cascade accuracy with interval, human escalations, and the preliminary warning. Both branches rendered and checked.
- `LABELLING.md`: the 6-step protocol for the two engineers and how to read the output.

**Tool bugs found while building it (fixed, tests first)**
10. Screenshots missed everything below the fold on 100vh app shells (the shell has an inner scroller, so `documentElement.scrollHeight` was 800): a labeller would have seen a red box on empty space. New `neededPageHeight` accounts for inner scroll containers. Detection was never affected (synthetic test: a below-the-fold defect was found either way) and the 14 real pages give identical findings and element counts before and after.
11. The flow picker/`since` cutoffs interacted badly when collecting (design and flow tools were fixed at different times); cutoffs are now independent.
12. The eval first counted flow findings as "sent to a person" although they never go to the design-triage models; model-ineligible rows are now excluded from the model arms and cascade, and still count in rule precision.

**Measured today, on the picker change** (shell dashboard, same 12/13 coverage, same findings): $0.0081 and 31 s with the new chain, against about $0.064 and 85 s with the old Jev-then-Claude escalation (that figure includes the risk-screen spend that was unmetered when first measured). One page, one run each.

Test suite: 62 -> 94 tests. `npm run evidence`: tests 94/94, benchmark exact (recall 1, 0.0% false alarms), determinism 11/11, smoke 11/11.

## 11. Still open
- **Two engineers must label** (`LABELLING.md`). This is the step that decides whether Phase 2 produces a number.
- **More findings are needed** to say anything. Ways to grow it honestly: scan more of the 48 registry modules; open the tabs and dialogs the flow reaches and scan those states (today scans see only the initial page state); start the NetLoan (:5012) and NetBI (:5013) remotes; scan more Hefesto-generated apps. I have not done these; say if you want a crawler for it.
- The shared white-on-primary contrast cause should go to the design-system owners; fixing it removes 10 of 18 records at the source (and would be the best "verified business outcome" story we have).
- Two remotes (:5012 nc-lending, :5013 nc-reports) are not running here; the Claude risk screen still skips several harmless Mongolian nav buttons (coverage cost, gate untouched).
- Not done yet: Phase 3 (pilot hook with exit codes 0/1/2, scheduled runs with RUN_TRIGGER=scheduled, scorecard counts). Nothing committed or pushed anywhere; `config/outcome.json` untouched (stage stays "prototype"). The network-web dev server (:5300) I started is still running.
