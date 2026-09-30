import './env.mjs';

// Which judge to use. Auto: the Jev -> Claude cascade when Jev and a Claude route are configured (or Claude is switched
// off on purpose: then Jev settles what it is sure of and the rest goes to a person), otherwise rules only.
export function resolveTriage(v) {
  if (v['no-model']) return 'none';
  if (v.judge) return 'claude';
  if (v.cascade) return 'cascade';
  const haveJev = !!process.env.TYPESAFE_API_KEY;
  const haveClaude = !!process.env.ANTHROPIC_API_KEY || process.env.JUDGE_MODE === 'cli';
  return haveJev && (haveClaude || process.env.JUDGE_MODE === 'off') ? 'cascade' : 'none';
}
