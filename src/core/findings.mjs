// Findings helpers shared by the engine and every display.
// The same rule on the same element with the same measurement in light and dark mode is ONE defect, not two.

const MODE_SUFFIX = /\s*\((?:light|dark) mode\)/;

export const findingKey = (f) => `${f.rule}|${f.element}|${String(f.detail).replace(MODE_SUFFIX, '')}`;
export const stripMode = (detail) => String(detail).replace(MODE_SUFFIX, '');

// One entry per distinct defect; `members` are the per-mode findings it stands for.
export function groupFindings(findings) {
  const map = new Map();
  for (const f of findings) {
    const k = findingKey(f);
    const g = map.get(k);
    if (g) {
      g.modes.push(f.mode); g.members.push(f);
      // a group is dismissed only if every member was; otherwise it takes the first non-dismissed member's verdict
      if (g.verdict === 'false_positive' && f.verdict !== 'false_positive') Object.assign(g, { verdict: f.verdict, by: f.by, confidence: f.confidence, pending: f.pending });
    } else map.set(k, { ...f, modes: [f.mode], members: [f] });
  }
  return [...map.values()];
}

export const uniqueCounted = (findings) => groupFindings(findings).filter((g) => g.verdict !== 'false_positive');

// For judging: send each distinct defect to the models once, then copy the verdict onto its twins.
export function dedupeForJudging(findings) {
  const groups = groupFindings(findings);
  return {
    unique: groups.map((g) => g.members[0]),
    spread(judgedUnique) {
      const verdictOf = new Map(judgedUnique.map((j) => [findingKey(j), j]));
      return findings.map((f) => {
        const j = verdictOf.get(findingKey(f));
        if (!j || j.key === f.key) return j || f;
        // keep this member's own identity and measurement, take only the verdict
        return { ...f, verdict: j.verdict, by: j.by, p: j.p, confidence: j.confidence, reason: j.reason };
      });
    },
  };
}
