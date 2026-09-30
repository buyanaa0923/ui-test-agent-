# Competition plan (rubric mapping)

| Rubric (100) | What we show | Status |
|---|---|---|
| Verified business outcome (30) | Plug into Hefesto `DEV_TEST`/`UAT_TEST` stages (today they only ask an agent to run tests; no machine check). Evidence files + NOT_RUN=FAIL. Pilot = 15, production = 30 | scanner ready; pipeline hook next |
| Quality & reliability (25) | `npm run smoke` benchmark (11/11, 0 FP), extend to >=90% on a representative set of real Hefesto issues; `escalations.jsonl` is the fallback/escalation log | benchmark v1 done |
| Autonomy & improvement (25) | Scheduled runs + logs, intervention counts, feedback loop from reviewer verdicts | not started |
| Knowledge sharing (20) | Other engineers run it and approve; dashboard link, SETUP.md | in progress |

Eligibility reminders: OKR/KPI >= 70%, >= 2 real AI use cases, 100% policy compliance (keep the written approval for any external model such as Jev).
