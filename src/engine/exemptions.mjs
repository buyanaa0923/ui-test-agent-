// Exemptions that follow from structural facts, not judgement. These never go to a model: a model can be wrong
// about them, a rule cannot. Each one is a documented accessibility principle.
const VISUAL = new Set(['contrast', 'text-overflow', 'text-truncated-no-title', 'radius-scale', 'button-height', 'button-font-size', 'button-text-wrap', 'font-family', 'raw-color-literal']);
const NAME = new Set(['button-unnamed', 'control-unlabeled']);

// f: anything with { srOnly, disabled, ariaHidden, describedBy } (an element's facts or a finding's ctx)
export function exemptReason(rule, f = {}) {
  if (process.env.UTA_NO_EXEMPTIONS) return null; // test hook: proves the benchmark notices when exemptions are removed
  if (f.srOnly && VISUAL.has(rule)) return 'visually hidden (screen-reader-only): visual rules do not apply';
  if (rule === 'contrast' && f.disabled) return 'WCAG 1.4.3: inactive (disabled) components are exempt from contrast';
  if (NAME.has(rule) && f.ariaHidden) return 'aria-hidden: not exposed to assistive technology, so it needs no accessible name';
  if (rule === 'text-truncated-no-title' && f.describedBy) return 'has an accessible description (aria-describedby)';
  return null;
}
