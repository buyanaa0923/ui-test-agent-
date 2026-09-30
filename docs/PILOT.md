# Pilot: Mole as the machine check inside Hefesto `DEV_TEST` / `UAT_TEST`

## Why this is the point of the project
Today those two stages tell an AI agent "run smoke + contract tests, report `RESULT: success=true` if all pass". Nothing
machine-checks that a UI test ran, and the runner trusts the agent's own last line (`docs/internal/WORK-STATUS.md` section 4;
Hefesto's own numbers: `DEV_TEST` 38 done / 14 skipped / 0 failed). Mole turns that sentence into a command that returns an
exit code and leaves evidence. It follows the precedent already in pipeline 5's `VERIFY` stage: named command, evidence under
`evidence/runs/<run-id>/`, **NOT_RUN is a failure**, no way around the check.

## What the stage runs
```bash
mole ci --urls pilot/urls.txt --out evidence/runs/<run-id> --result-line
```

| Exit | Meaning | Stage result |
| :- | :- | :- |
| 0 | every page tested and clean | `success=true` |
| 1 | defects found | `success=false` |
| 2 | not run (app down, login wall, blank page, missing session) | `success=false` (never a pass) |

The last stdout line is already in the runner's format:
`RESULT: success=false summary=mole 3 page(s): 2 clean, 1 with defects, 0 not run; 7 defect(s) on 1 page(s); evidence <dir>`

The evidence folder contains `summary.json` (verdict, per-page status, tool stamp with rules/tokens hashes, cost, time),
each page's `report.json`, screenshots (`light.png`, `dark.png`) and `trace.jsonl` (replayable with `mole replay`).

## Suggested stage instruction (paste into `pipeline_stages.instruction`)
This lives in the Hefesto DB / admin UI on their side; we have not edited it.

> Run the UI check with exactly this command from the Mole folder, and do not skip, reorder or replace it:
> `node bin/mole.mjs ci --urls pilot/urls.txt --out evidence/runs/$RUN_ID --result-line`
> Report `success=true` **only if the command exits 0**. If it exits 1 or 2, report `success=false`. Exit 2 means nothing was
> tested and is a failure, not a pass. Copy the command's final `RESULT:` line as your result and attach `evidence/runs/$RUN_ID`.
> Do not edit `pilot/urls.txt` or the tool to make it pass.

Set `RUN_TRIGGER=scheduled` for scheduled runs so the scorecard can count them separately from manual ones.

## Pilot scope (start small, prove it, then widen)
1. Copy `pilot/urls.example.txt` to `pilot/urls.txt`. Start with the pages of one Hefesto-generated module mounted in the shell
   (target order from `docs/internal/WORK-STATUS.md`: shell `:5200`, then `netwrk-web` routes via the shell).
2. Pages behind login need a saved session made from a **test account**, stored outside the repo:
   `--storage-state ~/.uta/shell.state.json` (and `--sso-button` for apps that keep the token in memory). Never put credentials in the file or the instruction.
3. Antd-based screens (Hefesto's own admin UI) are out of scope for the design-token rules; use `--tunnel` there, or leave them out.
4. Add `--tunnel` once the design pass is stable, to also catch dead buttons, JS errors and failed requests. Use only on
   non-production data: it clicks real controls (a safety screen skips delete/pay/logout; nothing is typed or submitted).

## Proof to collect from the first real run (for the submission)
- [ ] The stage instruction text you used (before/after).
- [ ] One run where Mole **failed** the stage on a real defect, and the same stage passing after the fix. This is the "verified business outcome".
- [ ] The evidence folder for both (`summary.json` + screenshots) and the runner's `RESULT:` line.
- [ ] A run with the app stopped, showing exit 2 / `success=false` instead of a silent pass.
- [ ] Cost and time from `summary.json` (`totals.totalUsd`, `totals.totalMs`).

## Known limits to state honestly
- A server-side check that the evidence file exists is a later step and is Hefesto's decision; the pilot relies on the stage instruction.
- Scans see the initial page state; dialogs and tabs opened by a click are not scanned yet.
- Model accuracy on real findings is not measured until two engineers label the set (`docs/LABELLING.md`).
