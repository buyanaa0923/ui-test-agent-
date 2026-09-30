# Competition plan (rubric mapping)

Status as of 2026-09-30 (MVP).

| Rubric (100) | What we show | Status |
|---|---|---|
| Verified business outcome (30) | Plug into Hefesto `DEV_TEST`/`UAT_TEST` stages (today they only ask an agent to run tests; no machine check). Evidence files + NOT_RUN=FAIL. Pilot = 15, production = 30 | `mole ci` + run book ready (`PILOT.md`); not yet in a real stage. First real-project fix loop done (azzuro, a Next.js site: 12 contrast failures to 0, 14 mobile defects to 8, rest intentional). Manual review time per page not measured yet (`config/outcome.json`) |
| Quality & reliability (25) | Mutation benchmark (220 pages, precision/recall 1, 0% FP), determinism 11/11, seeded smoke 11/11, 195 tests; real-app accuracy from two engineers' labels | synthetic proof done; real-app labels not collected (`LABELLING.md`) |
| Autonomy & improvement (25) | Scheduled runs + logs, intervention counts, feedback loop from reviewer verdicts | fix loop in Claude Code works (find, fix, re-check); scheduled runs and the feedback loop not started |
| Knowledge sharing (20) | Other engineers install it and use it on their own projects | Claude Code plugin installable (`INSTALL.md`), design contract per project, docs current; first outside project tested; other engineers not yet |

Eligibility reminders: OKR/KPI >= 70%, >= 2 real AI use cases, 100% policy compliance (keep the written approval for any external model such as Jev).
