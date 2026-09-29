// Pure decisions of the flow explorer, kept out of the script so they can be tested.

// "click produced no visible change" is only a defect when a change was expected.
// A control that marks the current page (aria-current/selected/pressed), or a link to the URL we are already on, has nothing to change.
export function shouldReportDeadClick({ clickError, changed, errors, active, selfLink }) {
  return !clickError && !changed && !(errors && errors.length) && !active && !selfLink;
}

// The explorer aborts requests that leave the app's origin. Chromium then logs "Failed to load resource: net::ERR_FAILED",
// which is our doing, not the app's. Drop at most as many such errors as requests we blocked; everything else stays an error.
export function dropToolCausedErrors(errors, blockedCount) {
  let budget = blockedCount, toolBlocked = 0;
  const kept = [];
  for (const e of errors) {
    if (budget > 0 && /Failed to load resource: net::ERR_FAILED/.test(e)) { budget--; toolBlocked++; } else kept.push(e);
  }
  return { errors: kept, toolBlocked };
}

// Requests the explorer lets through: the app's own origin, data: URLs, and origins the operator allowed on purpose (e.g. a hub's remotes).
export function isAllowedRequest(url, allowedOrigins) {
  if (url.startsWith('data:')) return true;
  try { return allowedOrigins.has(new URL(url).origin); } catch { return false; }
}

// An error seen while the tool was blocking a request cannot be blamed on the app with confidence: keep it visible, but low severity.
export function errorFindingRule(blockedCount) {
  return blockedCount > 0 ? { rule: 'js-error-blocked-context', severity: 'low' } : { rule: 'js-error', severity: 'high' };
}
