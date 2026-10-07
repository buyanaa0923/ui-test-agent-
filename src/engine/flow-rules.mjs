// Pure decisions of the flow explorer, kept out of the script so they can be tested.
import { detectAuthWall } from './guard.mjs';

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

// A request that answers an HTTP error also makes Chromium log "Failed to load resource: ... status of 404". That is the
// same defect as the broken link / failed request / failed submit already reported, not a JS error: drop at most one
// such line per failed response.
export function dropNavLoadErrors(errors, navFailures) {
  let budget = navFailures;
  return errors.filter((e) => !(budget > 0 && /Failed to load resource: the server responded with a status of \d+/.test(e) && budget--));
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

// ---- following the pages a click reaches (tunnel --depth) ----

// One key per route, so the explorer visits /users/17 and /users/18 once, not once per row. Numeric, UUID and long hex
// segments become :id; query values are dropped (keys stay: ?tab= is a different screen from none); a hash counts
// only when it is a hash-router route (#/x, #!/x).
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;
const normPath = (p) => p.replace(/\/+$/, '').split('/').map((s) => (ID_SEGMENT.test(s) ? ':id' : s)).join('/') || '/';
export function routeKey(url) {
  try {
    const u = new URL(url);
    const q = [...new Set(u.searchParams.keys())].sort().join('&');
    const hash = /^#!?\//.test(u.hash) ? '#' + normPath(u.hash.replace(/^#!?/, '').replace(/\?.*$/, '')) : '';
    return `${u.origin}${normPath(u.pathname)}${q ? '?' + q : ''}${hash}`;
  } catch { return url; }
}

// What a person would call the page: path, query and hash, without the origin.
export function pathOf(url) {
  try { const u = new URL(url); return u.protocol === 'file:' ? u.pathname.split('/').pop() || '/' : u.pathname + u.search + u.hash; } catch { return url; }
}

export function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

// A link whose target ends a session or destroys data is skipped like a risky label ("Exit" -> /logout).
// Path words only: a label rule catches "Pay", but /payments is a list page a banking app must be tested on.
const RISKY_PATH = /\/(logout|log-out|signout|sign-out|sign_out|delete|destroy|remove)(\/|$|\?|#)/i;
export const isRiskyPath = (target) => !!target && RISKY_PATH.test(target);

// A control whose label destroys data, spends money, ends the session or changes a record's state for good is never
// clicked, and neither is the inline "Yes, ..." that confirms such an action outside a dialog ("Лацдах", then
// "Тийм, лацдах" on the page itself). Mongolian words are stems, since case endings follow: лацд- seal, батал-/батла-
// approve, цуцл- cancel (an order or request; "Болих" closes a dialog and stays clickable), татгалз- reject, түгж- lock,
// архивл- archive, шилжүүл- transfer. A wrong skip costs coverage; a wrong click costs data.
const RISKY_LABEL = /(delete|remove|устгах|pay|төлбөр|logout|log out|sign out|гарах|reset|drop|seal|лацд|approve|батал|батла|reject|татгалз|revoke|цуцл|lock|түгж|archive|архивл|deactivate|идэвхгүй болго|transfer|шилжүүл)/i;
const CONFIRM_LABEL = /^\s*(yes|confirm)\b|^\s*(тийм|зөвшөөр)/i;
export const isRiskyLabel = (label) => !!label && (RISKY_LABEL.test(label) || CONFIRM_LABEL.test(label));

// Controls whose kind alone says a click cannot commit anything, so the risk screen does not ask a model about them:
// a tab, an accordion's summary, a same-origin link (a GET; risky paths and labels were already skipped), and the
// button that closes or cancels the dialog it sits in (the exact word only: "Бүртгэл хаах" closes an account).
const CLOSE_LABEL = /^\s*(close|close (modal|dialog)|cancel|dismiss|хаах|болих)\s*$/i;
export function isStructurallySafe(c) {
  if (c.role === 'tab' || c.role === 'summary') return true;
  if (c.role === 'link' && c.target && !isRiskyPath(c.target)) return true;
  return !!c.inDialog && CLOSE_LABEL.test(c.label || '');
}

// What the risk screen is told about a control besides its label: where it sits and on which page. Without it a
// sidebar item and a "commit" button look alike, and the model stays unsure about both.
export function riskContext(c, { page = null, state = null } = {}) {
  const where = c.inDialog ? `inside ${state || 'a dialog'}` : c.global ? 'in the app navigation (sidebar, header or footer)' : state ? `inside ${state}` : 'in the page content';
  return [where, c.target ? `links to ${c.target}` : null, page ? `on page ${page}` : null].filter(Boolean).join(', ');
}

// Login and identity pages are never explored: clicking through them would test the wall, not the app.
const AUTH_PATH = /\/(login|log-in|signin|sign-in|sso|auth|oauth2?|realms)(\/|$|\?)/i;
export const isAuthPath = (url) => AUTH_PATH.test(pathOf(url));

// A click that navigates has only worked if the page it lands on is a real page. Checked in this order:
// the document answered an HTTP error; it redirected to a login wall; it rendered nothing; it says "not found"
// (a client-side router's 404 answers HTTP 200). A password field alone is NOT a wall here: a settings page may have one.
const NOT_FOUND = /\b404\b|page not found|could not be found|not found|does not exist|хуудас олдсонгүй/i;
export function arrivalProblem({ status = null, requestedUrl, finalUrl, probe = null, minElements = 5 }) {
  const to = pathOf(finalUrl);
  if (status && status >= 400) return { rule: 'broken-link', severity: 'high', detail: `went to ${to}, which answered HTTP ${status}` };
  if (!probe) return null;
  const wall = detectAuthWall({ requestedUrl: requestedUrl || finalUrl, finalUrl, hasPasswordField: false, text: probe.text });
  if (wall) return { rule: 'lands-on-login', severity: 'medium', detail: `went to ${to}: ${wall}` };
  if (probe.elements < minElements) return { rule: 'blank-page', severity: 'high', detail: `went to ${to}, which rendered only ${probe.elements} element(s)` };
  const said = [probe.title, ...(probe.headings || [])].find((s) => s && NOT_FOUND.test(s));
  if (said) return { rule: 'not-found-page', severity: 'high', detail: `went to ${to}, which says "${said.slice(0, 80)}"` };
  return null;
}
