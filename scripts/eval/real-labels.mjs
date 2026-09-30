// Combine two engineers' INDEPENDENT labels: agreement (Cohen's kappa), disagreements for a third person, and the final labelled set.
// Usage: node scripts/eval/real-labels.mjs --a labels-alice.csv --b labels-bob.csv [--adj adjudication.csv]
//                                     [--records eval/real-findings.jsonl] [--out eval/real-findings.labeled.jsonl] [--disagreements <file.csv>]
// A label is accepted only if both agree (or a third person settled it). Nothing is guessed; the source records file is never modified.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsv, mergeLabels } from '../../src/eval/agreement.mjs';
import { ROOT } from '../../src/core/paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const root = ROOT;
const recordsFile = path.resolve(opt('records', path.join(root, 'eval/real-findings.jsonl')));
const outFile = path.resolve(opt('out', path.join(root, 'eval/real-findings.labeled.jsonl')));
const disFile = path.resolve(opt('disagreements', path.join(root, 'review/real-findings/disagreements.csv')));
const [aFile, bFile, adjFile] = [opt('a'), opt('b'), opt('adj')];
if (!aFile || !bFile) { console.error('Usage: node scripts/eval/real-labels.mjs --a <labeller A csv> --b <labeller B csv> [--adj <adjudication csv>]'); process.exit(2); }
const read = (f) => { if (!fs.existsSync(f)) { console.error(`File not found: ${f}`); process.exit(2); } return parseCsv(fs.readFileSync(f, 'utf8')); };
const records = fs.readFileSync(recordsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const A = read(aFile), B = read(bFile), adj = adjFile ? read(adjFile) : [];

const who = (rows) => [...new Set(rows.map((r) => (r.labeller || '').trim()).filter(Boolean))];
if (who(A).length === 1 && who(B).length === 1 && who(A)[0].toLowerCase() === who(B)[0].toLowerCase()) { console.error(`Both files were labelled by "${who(A)[0]}". Agreement between one person and themself means nothing: two different engineers are needed.`); process.exit(2); }
const known = new Set(records.map((r) => r.id));
for (const [name, rows] of [['A', A], ['B', B], ['adjudication', adj]]) { const stray = rows.filter((r) => r.id && !known.has(r.id)); if (stray.length) { console.error(`Labeller ${name} has ${stray.length} id(s) that are not in ${path.basename(recordsFile)} (e.g. ${stray[0].id}). Was the set re-collected after the sheet was made?`); process.exit(2); } }

let m;
try { m = mergeLabels(records, A, B, adj); } catch (e) { console.error(e.message); process.exit(2); }

const byId = new Map(records.map((r) => [r.id, r]));
const labelOf = (rows) => new Map(rows.map((r) => [r.id, (r.label || '').trim().toLowerCase()]));
const la = labelOf(A), lb = labelOf(B);
const bothLabelled = records.length - m.unlabeled.length;
console.log(`Records: ${records.length} | labelled by both: ${bothLabelled} | not labelled by both: ${m.unlabeled.length}`);
if (m.kappa.n) console.log(`Agreement (real vs not-a-defect, "unsure" left out): n=${m.kappa.n}, raw ${(m.kappa.observed * 100).toFixed(1)}%, chance ${(m.kappa.expected * 100).toFixed(1)}%, Cohen's kappa ${m.kappa.kappa == null ? 'undefined (one label used throughout)' : m.kappa.kappa.toFixed(2)} (${m.kappa.interpretation})`);
else console.log('Agreement: no records labelled real/not-a-defect by both yet.');
console.log(`Unsure by either: ${m.unsureCount} | need a third person: ${m.needsAdjudication.length} | final labels: ${Object.keys(m.final).length}`);
if (m.kappa.n < 30) console.log(`NOTE: n=${m.kappa.n} is small; a kappa on this few items is a rough guide, not evidence of reliability.`);

const dis = m.needsAdjudication.map((id) => { const r = byId.get(id); return { id, rule: r.finding.rule, page: r.source.pages[0], element: r.finding.element, text: r.finding.text || '', labeller_a: la.get(id), labeller_b: lb.get(id), label: '', notes: '' }; });
if (dis.length) {
  fs.mkdirSync(path.dirname(disFile), { recursive: true });
  fs.writeFileSync(disFile, toCsv(dis, ['id', 'rule', 'page', 'element', 'text', 'labeller_a', 'labeller_b', 'label', 'notes']));
  console.log(`Disagreements for the third person: ${path.relative(root, disFile)} (fill the "label" column, then re-run with --adj)`);
}
const labelled = records.filter((r) => m.final[r.id]).map((r) => ({ ...r, label: m.final[r.id], positive: m.final[r.id] === 'real' }));
if (labelled.length) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, labelled.map((r) => JSON.stringify(r)).join('\n') + '\n'); console.log(`Wrote ${labelled.length} labelled records -> ${path.relative(root, outFile)}`); }
else console.log('No final labels yet, nothing written.');
// Summary for the scorecard: only when writing the real labelled set (a trial run with other paths must not reach it).
if (outFile === path.join(root, 'eval/real-findings.labeled.jsonl')) {
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs/real-labels.json'), JSON.stringify({ at: new Date().toISOString(), records: records.length, bothLabelled, unsure: m.unsureCount, needAdjudication: m.needsAdjudication.length, finalLabels: Object.keys(m.final).length, kappa: m.kappa }, null, 1));
}
