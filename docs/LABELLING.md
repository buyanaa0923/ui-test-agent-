# Labelling real findings (two engineers, independently)

Goal: a set of real findings, labelled by people, that nobody tuned the tool against. The tool's Jev, Claude and cascade accuracy is then measured on it and reported with n and a confidence interval.

## Before you start
- You need two different engineers. If they see each other's answers first, the agreement number means nothing.
- Do not look at the tool's output for these findings. The sheet shows none on purpose.

## Steps
1. Open `review/real-findings/sheet.html` in a browser (double-click, no server needed). If the set was re-collected, always use the newest sheet.
2. Type your name. For each finding choose one:
   - **Real defect**: a designer or QA reviewer would want this fixed (affects users, or breaks the design system).
   - **Not a defect**: intentional, exempt, decorative or hidden, or not a design-system widget.
   - **Unsure**: goes to a third person. Use it rather than guessing.
   Add a note when the reason is not obvious. Answers are saved in your browser as you go.
3. Click **Download my labels (CSV)**. Keep the file (`labels-<name>.csv`).
4. When both are done, from the project folder:
   ```bash
   npm run real:labels -- --a labels-alice.csv --b labels-bob.csv
   ```
   It prints agreement (Cohen's kappa), writes the disagreements to `review/real-findings/disagreements.csv`, and writes `eval/real-findings.labeled.jsonl` with only the findings both agreed on.
5. A third person fills the `label` column of `disagreements.csv` (real / false_positive), then:
   ```bash
   npm run real:labels -- --a labels-alice.csv --b labels-bob.csv --adj review/real-findings/disagreements.csv
   ```
6. Measure (needs both API keys, a few US cents; `npm run eval:real:replay` reruns it from recorded responses for free):
   ```bash
   npm run eval:real
   ```

## Reading the result
- Kappa: below 0.4 means the criteria are unclear, fix that before trusting any accuracy number. 0.6 to 0.8 is substantial, above 0.8 almost perfect.
- The report says PRELIMINARY until there are at least 30 model-judged findings. Do not quote a percentage from a PRELIMINARY run as a result.
- Several findings can share one root cause (for example one brand colour under many buttons). The report shows the number of distinct root causes and a cluster-weighted accuracy next to the plain one.
- Rule precision means "share of findings people agreed were real". Recall on real pages is not measured: a defect a rule misses never appears as a finding. The seeded-defect benchmark measures recall, on seeded defects only.
- The gates (0.8 confirm, 0.9 dismiss) are never changed by these scripts. If you want to change them, that is a separate decision, made on data that is not this set.

## Do not
- Edit `eval/real-findings.jsonl` (labels live in the CSVs; the collect script refuses to overwrite a file that has labels).
- Change a label after seeing model results.
- Re-label the older sets in `eval/risk.jsonl` and `eval/triage.jsonl` to improve a score.
