// Collects every number the judge scorecard shows, from files the tool already writes. Nothing is typed in by hand:
// a section with no evidence says "not yet measured" instead of showing a guess.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const INTERNAL = /^(bench|smoke|eval-jev|determinism)/;

export function collect(root) {
  const runsDir = path.join(root, 'runs');
  const mutation = readJson(path.join(runsDir, 'benchmark-mutation.json'));
  const determinism = readJson(path.join(runsDir, 'determinism.json'));
  const smoke = readJson(path.join(runsDir, 'benchmark.json'));
  const tests = readJson(path.join(runsDir, 'tests.json'));
  const evalJev = readJson(path.join(runsDir, 'eval-jev.json'));
  const realEval = readJson(path.join(runsDir, 'eval-real.json'));
  const realLabels = readJson(path.join(runsDir, 'real-labels.json'));
  const realSet = readJson(path.join(root, 'eval/real-findings.meta.json'));
  const outcome = readJson(path.join(root, 'config/outcome.json'), {});
  const pricing = readJson(path.join(root, 'config/pricing.json'), {});

  // Runs of the tool itself (scans and flows), not its own benchmarks.
  const runs = [];
  if (fs.existsSync(runsDir)) {
    for (const d of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!d.isDirectory() || INTERNAL.test(d.name)) continue;
      const dir = path.join(runsDir, d.name);
      const report = readJson(path.join(dir, 'report.json'));
      if (!report || !['design', 'flow'].includes(report.kind)) continue;
      const events = readJsonl(path.join(dir, 'events.jsonl'));
      const end = events.find((e) => e.type === 'run_end');
      const decisions = readJsonl(path.join(dir, 'decisions.jsonl'));
      const escalations = readJsonl(path.join(dir, 'escalations.jsonl'));
      const findings = report.violations || [];
      runs.push({
        id: d.name, kind: report.kind, url: report.url || null, status: report.status || 'ok',
        at: report.stamp?.at || new Date(fs.statSync(dir).mtimeMs).toISOString(),
        trigger: report.stamp?.trigger || 'manual',
        totalMs: end?.totalMs ?? null, findings: findings.length,
        verdicts: findings.reduce((o, f) => { const k = f.verdict || 'none'; o[k] = (o[k] || 0) + 1; return o; }, {}),
        by: findings.reduce((o, f) => { if (f.by) o[f.by] = (o[f.by] || 0) + 1; return o; }, {}),
        fallbacks: escalations.filter((e) => /fallback|escalation_failed|jev_failed|jev_unsure/.test(e.event)).length + decisions.filter((x) => x.event === 'jev_failed' || x.decision === 'skipped_fail_safe').length,
        escalated: escalations.filter((e) => e.event === 'escalation').length + decisions.filter((x) => x.escalated === true).length
      });
    }
  }
  runs.sort((a, b) => a.at.localeCompare(b.at));
  const completed = runs.filter((r) => r.status !== 'not_run');
  const served = completed.filter((r) => r.url && !r.url.startsWith('file:'));
  const perDay = {};
  for (const r of completed) { const day = r.at.slice(0, 10); (perDay[day] ||= { manual: 0, scheduled: 0 })[r.trigger === 'scheduled' ? 'scheduled' : 'manual']++; }

  // Autonomy: of everything the tool judged, how much did it settle itself, how much needed a person.
  const judged = completed.flatMap((r) => Object.entries(r.verdicts).map(([v, n]) => ({ v, n })));
  const sumV = (f) => judged.filter(f).reduce((s, x) => s + x.n, 0);
  const totalFindings = completed.reduce((s, r) => s + r.findings, 0);
  const needsHuman = sumV((x) => x.v === 'needs_human' || x.v === 'unjudged');
  const modelJudged = sumV((x) => x.v !== 'none'); // findings that actually went through triage

  const manualMin = Number.isFinite(outcome.manualMinutesPerPage) ? outcome.manualMinutesPerPage : null;
  const medianScanMs = median(completed.filter((r) => r.kind === 'design' && r.totalMs).map((r) => r.totalMs));
  const pagesChecked = completed.filter((r) => r.kind === 'design').length;
  const timeSavedMin = manualMin != null && medianScanMs != null ? Math.round(pagesChecked * (manualMin - medianScanMs / 60000) * 10) / 10 : null;

  const evidence = {
    outcome: outcome.stage === 'production' ? 'production' : outcome.stage === 'pilot' ? 'pilot' : 'prototype',
    quality: mutation && tests && determinism ? (evalJev ? 'measured' : 'partial') : 'partial',
    autonomy: perDay && Object.values(perDay).some((d) => d.scheduled) ? 'partial' : 'notyet',
    knowledge: (outcome.adoption || []).length ? 'partial' : 'notyet'
  };

  return {
    generatedAt: new Date().toISOString(),
    stamp: evalJev?.stamp || mutation?.stamp || tests?.stamp || null,
    pricing: { jevInputPerM: pricing['jev-1.13']?.inputPerM ?? null, claudeModel: 'claude-sonnet-5-5' },
    outcome: {
      stage: outcome.stage || 'prototype', pilotTarget: outcome.pilotTarget || null, notes: outcome.notes || '',
      manualMinutesPerPage: manualMin, manualMinutesSource: manualMin != null ? outcome.manualMinutesSource : null,
      runsTotal: completed.length, servedAppRuns: served.length, pagesChecked, totalFindings, medianScanMs, timeSavedMin,
      recentRuns: completed.slice(-8).reverse().map(({ id, kind, url, at, totalMs, findings, trigger }) => ({ id, kind, url, at, totalMs, findings, trigger }))
    },
    quality: {
      mutation: mutation && { cases: mutation.cases, positives: mutation.positives, negatives: mutation.negatives, overall: mutation.overall, perRule: mutation.perRule, seed: mutation.seed },
      determinism: determinism && { runs: determinism.runs, pages: determinism.pages, allDeterministic: determinism.allDeterministic },
      smoke: smoke && { seeded: smoke.seeded, caught: smoke.caught, falsePositives: (smoke.falsePositives || []).length },
      tests: tests && { total: tests.total, pass: tests.pass, fail: tests.fail, names: (tests.names || []).map((n) => n.name) },
      // Real findings labelled by two engineers: null until they exist. Nothing here is estimated.
      real: {
        set: realSet && { records: realSet.records, byRule: realSet.byRule, collectedAt: realSet.collectedAt },
        labels: realLabels || null,
        eval: realEval && { mode: realEval.mode, at: realEval.stamp?.at, usd: realEval.costUsd, n: realEval.score?.n, nModelEligible: realEval.score?.nModelEligible, clusters: realEval.score?.clusters, target: realEval.score?.target, rules: realEval.score?.rules, jev: realEval.score?.jev, claude: realEval.score?.claude, cascade: realEval.score?.cascade }
      },
      eval: evalJev && { mode: evalJev.mode, gates: evalJev.gates, sets: evalJev.sets, usd: evalJev.usd, at: evalJev.stamp?.at }
    },
    autonomy: {
      perDay, manualRuns: completed.filter((r) => r.trigger !== 'scheduled').length, scheduledRuns: completed.filter((r) => r.trigger === 'scheduled').length,
      totalFindings, needsHuman, interventionRate: modelJudged ? needsHuman / modelJudged : null,
      fallbacks: completed.reduce((s, r) => s + r.fallbacks, 0), escalations: completed.reduce((s, r) => s + r.escalated, 0),
      modelJudged, feedbackLoop: outcome.feedbackLoop || null
    },
    knowledge: { adoption: outcome.adoption || [] },
    evidence
  };
}
