import './env.mjs';

// Which judge to use. Auto: the Jev -> Claude cascade when both keys are configured, otherwise rules only.
export function resolveTriage(v) {
  if (v['no-model']) return 'none';
  if (v.judge) return 'claude';
  if (v.cascade) return 'cascade';
  const haveJev = !!process.env.TYPESAFE_API_KEY;
  const haveClaude = !!process.env.ANTHROPIC_API_KEY || process.env.JUDGE_MODE === 'cli';
  return haveJev && haveClaude ? 'cascade' : 'none';
}
