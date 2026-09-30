import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRealEval, cascadeDecision } from '../../src/eval/real-eval.mjs';

const G = { confirm: 0.8, dismiss: 0.9 };
const jev = (pred, confidence) => ({ pred, confidence, p: pred ? confidence : 1 - confidence });
const row = (id, positive, j, claudeVerdict, cluster = id) => ({ id, positive, cluster, kind: 'design', jev: j, claude: claudeVerdict ? { verdict: claudeVerdict } : null });

test('cascade: Jev settles a confirmation at 0.8 but a dismissal only at 0.9 (asymmetric gates)', () => {
  assert.deepEqual(cascadeDecision(jev(true, 0.82), null, G), { verdict: 'real', by: 'jev', escalatedToClaude: false, escalatedToHuman: false });
  assert.equal(cascadeDecision(jev(false, 0.85), 'false_positive', G).by, 'claude'); // 0.85 is not enough to dismiss
  assert.equal(cascadeDecision(jev(false, 0.92), null, G).verdict, 'false_positive');
});
test('cascade: Claude decides what Jev is unsure about; needs_human and unjudged go to a person, never to a guess', () => {
  assert.deepEqual(cascadeDecision(jev(true, 0.5), 'real', G), { verdict: 'real', by: 'claude', escalatedToClaude: true, escalatedToHuman: false });
  assert.deepEqual(cascadeDecision(jev(true, 0.5), 'needs_human', G), { verdict: 'needs_human', by: 'human', escalatedToClaude: true, escalatedToHuman: true });
  assert.equal(cascadeDecision(jev(true, 0.5), 'unjudged', G).escalatedToHuman, true);
  assert.equal(cascadeDecision(null, null, G).escalatedToHuman, true); // both models unavailable: fail safe
});
test('accuracy per arm is exact on a hand-computed set, with n and a Wilson interval', () => {
  const rows = [
    row('a', true, jev(true, 0.95), 'real'), row('b', true, jev(false, 0.95), 'real'),      // Jev wrong (confident), Claude right
    row('c', false, jev(false, 0.95), 'false_positive'), row('d', false, jev(true, 0.6), 'false_positive'), // d: Jev unsure, Claude right
  ];
  const r = scoreRealEval(rows, G);
  assert.equal(r.n, 4);
  assert.equal(r.jev.accuracy.k, 2); assert.equal(r.jev.accuracy.n, 4); // a, c right; b and d wrong (raw prediction, gate ignored)
  assert.equal(r.claude.accuracy.k, 4);
  assert.equal(r.cascade.decided, 4); // nothing escalated to a human
  assert.equal(r.cascade.accuracyOnDecided.k, 3); // b is settled by Jev, wrongly (confident dismissal)
  assert.ok(r.jev.accuracy.lo < 0.5 && r.jev.accuracy.hi > 0.5);
  assert.equal(r.jev.atGate.settled, 3); // a, b, c are confident; d is not
  assert.equal(r.jev.atGate.accuracyOnSettled.k, 2);
});
test('cascade reports accuracy on what it decided AND a strict number that counts human escalations as misses', () => {
  const rows = [row('a', true, jev(true, 0.95), 'real'), row('b', true, jev(true, 0.5), 'needs_human'), row('c', false, jev(false, 0.95), 'false_positive'), row('d', false, jev(true, 0.4), 'real')];
  const c = scoreRealEval(rows, G).cascade;
  assert.equal(c.escalatedToHuman, 1);
  assert.equal(c.accuracyOnDecided.k, 2); assert.equal(c.accuracyOnDecided.n, 3); // a, c right; d wrong
  assert.equal(c.strictAccuracy.k, 2); assert.equal(c.strictAccuracy.n, 4);
});
test('precision of the deterministic rules is the share of findings people labelled real, per rule and overall', () => {
  const rows = [row('a', true, null, null), row('b', true, null, null), row('c', false, null, null)].map((r, i) => ({ ...r, rule: i < 2 ? 'contrast' : 'dead-click' }));
  const r = scoreRealEval(rows, G);
  assert.equal(r.rules.overall.k, 2); assert.equal(r.rules.overall.n, 3);
  assert.equal(r.rules.byRule.contrast.k, 2); assert.equal(r.rules.byRule['dead-click'].k, 0);
});
test('shared root causes are visible: cluster count and a cluster-weighted accuracy', () => {
  const rows = [row('a', true, jev(true, 0.95), 'real', 'X'), row('b', true, jev(true, 0.95), 'real', 'X'), row('c', true, jev(true, 0.95), 'real', 'X'), row('d', true, jev(false, 0.95), 'real', 'Y')];
  const r = scoreRealEval(rows, G);
  assert.equal(r.clusters, 2);
  assert.ok(Math.abs(r.jev.clusterWeightedAccuracy - 0.5) < 1e-9); // X: 3/3 right, Y: 0/1 right -> (1 + 0) / 2
});
test('no labelled rows means no numbers, never a made-up zero or one', () => {
  assert.equal(scoreRealEval([], G), null);
});
test('the 90% target is reported as met only with a point estimate >= 0.9 AND n >= 30; otherwise PRELIMINARY', () => {
  const many = Array.from({ length: 30 }, (_, i) => row(`r${i}`, true, jev(true, 0.95), 'real'));
  assert.equal(scoreRealEval(many, G).target.status, 'met');
  assert.equal(scoreRealEval(many.slice(0, 10), G).target.status, 'preliminary');
  const bad = Array.from({ length: 30 }, (_, i) => row(`b${i}`, i < 20, jev(true, 0.95), 'real'));
  assert.equal(scoreRealEval(bad, G).target.status, 'not_met');
});

test('findings that never go to the models (flow findings) count in rule precision but not in the model arms or the cascade', () => {
  const rows = [
    { ...row('a', true, jev(true, 0.95), 'real'), rule: 'contrast' },
    { ...row('b', true, jev(true, 0.95), 'real'), rule: 'contrast' },
    { id: 'f', positive: false, cluster: 'f', kind: 'flow', rule: 'dead-click', modelEligible: false, jev: null, claude: null },
  ];
  const r = scoreRealEval(rows, G);
  assert.equal(r.n, 3);
  assert.equal(r.nModelEligible, 2);
  assert.equal(r.rules.overall.n, 3);
  assert.equal(r.cascade.escalatedToHuman, 0); // the flow finding was never offered to a model, so it is not a "human escalation"
  assert.equal(r.cascade.strictAccuracy.n, 2);
});
