// forms: what the explorer does with a form (tunnel --forms fill | submit). Off by default.
// fill   : type test data into the empty fields and check the form takes it (fields accept input, typing throws no
//          errors, the submit button becomes usable). Nothing is sent.
// submit : fill, then submit, and judge what came back (server error, a refusal the page kept quiet about, a submit that
//          did nothing). Opt-in, only against dev hosts, never for credential or payment forms, capped per run, and every
//          submission is written to submissions.jsonl so the data it created can be found and removed.
// The data is obviously test data: "Mole test <tag>", mole.test+<tag>@example.test (a reserved, undeliverable domain).

// ---- pure decisions ----

// Hosts where creating data is expected: the developer's own machine and reserved test names. Anything else must be
// named on purpose (--submit-host).
export function isSandboxHost(hostname, extra = []) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.localhost') || h.endsWith('.test') || extra.map((x) => x.toLowerCase()).includes(h);
}

const hintOf = (f) => [f.name, f.id, f.label, f.placeholder, f.autocomplete].filter(Boolean).join(' ').toLowerCase();

// A form that asks for credentials, payment or one-time codes is never filled, whatever the mode.
const SENSITIVE = /password|passcode|нууц ?үг|card ?(number|no)|карт(ын)? дугаар|\bcvc\b|\bcvv\b|\bcsc\b|\biban\b|account ?number|дансны дугаар|\bpin\b|\botp\b|one[- ]time|verification code|баталгаажуулах код/i;
export function sensitiveReason(fields) {
  for (const f of fields) {
    if (f.type === 'password') return `it has a password field${f.label ? ` ("${f.label}")` : ''}`;
    if (/^cc-|one-time-code/.test(f.autocomplete || '')) return `field "${f.label || f.name}" is a payment or one-time-code field`;
    if (SENSITIVE.test(hintOf(f))) return `field "${f.label || f.name}" looks like a credential or payment field`;
  }
  return null;
}

const fit = (v, f) => {
  let s = String(v);
  if (f.maxLength > 0) s = s.slice(0, f.maxLength);
  if (f.minLength > 0 && s.length < f.minLength) s = s.padEnd(f.minLength, 'x');
  return s;
};
const matches = (v, pattern) => { if (!pattern) return true; try { return new RegExp(`^(?:${pattern})$`, 'u').test(v); } catch { return true; } };

// The test value for one field, from its type and what it is called (English and Mongolian). Deterministic: the same
// form gets the same data, apart from the run tag. Returns { value } | { check } | { select } | { skip }.
export function testValue(f, { tag = 'mole', today = new Date().toISOString().slice(0, 10) } = {}) {
  const t = (f.type || 'text').toLowerCase();
  if (t === 'password') return { skip: 'password' };
  if (t === 'file') return { skip: 'file upload' };
  if (t === 'checkbox' || t === 'radio') return f.checked ? { skip: 'already set' } : f.required ? { check: true } : { skip: 'optional' };
  if (f.value) return { skip: 'already filled' };
  if (t === 'select') {
    const o = (f.options || []).find((x) => x.value !== '' && !x.disabled);
    return o ? { select: o.value } : { skip: 'no option to choose' };
  }
  const h = hintOf(f);
  const num = (x) => (x === '' || x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  let cands;
  if (t === 'email' || /e-?mail|имэйл|цахим шуудан/.test(h)) cands = [`mole.test+${tag}@example.test`];
  else if (t === 'tel' || /phone|mobile|\btel\b|утас/.test(h)) cands = ['99119911', '+97699119911', '5550100', '+15555550100'];
  else if (t === 'url' || /\burl\b|website|вэб/.test(h)) cands = ['https://example.test/mole'];
  else if (t === 'date') cands = [today];
  else if (t === 'datetime-local') cands = [`${today}T09:00`];
  else if (t === 'time') cands = ['09:00'];
  else if (t === 'month') cands = [today.slice(0, 7)];
  else if (t === 'week') return { skip: 'week field' };
  else if (t === 'color') cands = ['#0f766e'];
  else if (t === 'number' || t === 'range' || /amount|qty|quantity|count|\bage\b|дүн|тоо/.test(h)) {
    const lo = num(f.min) ?? 1, hi = num(f.max);
    cands = [String(hi != null ? Math.min(lo, hi) : lo)];
  } else if (/regist|регистр|\bрд\b/.test(h)) cands = ['УБ99119911']; // Mongolian register number: two letters, eight digits
  else if (/first.?name|given.?name|өөрийн нэр/.test(h)) cands = ['Mole'];
  else if (/last.?name|surname|family.?name|овог/.test(h)) cands = ['Tester'];
  else if (/name|нэр/.test(h)) cands = [`Mole Test ${tag}`];
  else if (/zip|postal|шуудангийн код/.test(h)) cands = ['14200'];
  else if (/city|хот/.test(h)) cands = ['Ulaanbaatar'];
  else if (/address|хаяг/.test(h)) cands = ['1 Test Street'];
  else if (t === 'search') cands = ['mole'];
  else cands = [`Mole test ${tag}`];
  const fitted = cands.map((c) => fit(c, f));
  const ok = fitted.find((c) => matches(c, f.pattern));
  return ok != null ? { value: ok } : { value: fitted[0], mismatch: true };
}

// What a submit of valid-looking test data came back with. `writes`: same-origin non-GET responses after the click.
export function submitOutcome({ writes = [], landed = null, changed = false }) {
  const server = writes.find((w) => w.status >= 500);
  if (server) return { outcome: 'defect', rule: 'submit-server-error', severity: 'high', detail: `${server.method} ${server.path} answered ${server.status} to valid test data` };
  const refused = writes.find((w) => w.status >= 400);
  if (refused && !changed && !landed) return { outcome: 'defect', rule: 'submit-silent-failure', severity: 'high', detail: `${refused.method} ${refused.path} answered ${refused.status} and the page showed nothing: the user is not told it failed` };
  if (refused) return { outcome: 'rejected', detail: `the app refused the test data (${refused.method} ${refused.path} → ${refused.status}) and showed it` };
  if (!writes.length && !landed && !changed) return { outcome: 'defect', rule: 'dead-submit', severity: 'medium', detail: 'submitting the filled form did nothing: no request, no navigation, no change on the page' };
  const w = writes.at(-1);
  return { outcome: 'ok', detail: w ? `${w.method} ${w.path} → ${w.status}` : landed ? `went to ${landed}` : 'the page changed' };
}

// ---- in the page ----

// The forms in a scope ('page' | 'dialog' | 'region'): real <form>s, and a dialog that has fields but no <form> (common
// in component libraries), whose submit is its commit button. Fields and submit buttons are tagged for clicking.
export function findForms(page, { scope, chrome, dialogSel, commit }) {
  return page.evaluate(({ scope, chrome, dialogSel, commit }) => {
    for (const a of ['data-mole-form', 'data-mole-field', 'data-mole-submit']) document.querySelectorAll(`[${a}]`).forEach((e) => e.removeAttribute(a));
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 2 && r.height >= 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true })); };
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const dialogs = [...document.querySelectorAll(dialogSel)].filter(shown);
    const root = scope === 'dialog' ? dialogs.at(-1) : scope === 'region' ? document.querySelector('[data-mole-scope]') : document.body;
    if (!root) return [];
    const commitRe = new RegExp(commit.source, commit.flags);
    const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select';
    const labelOf = (el) => text(el.labels?.[0]) || el.getAttribute('aria-label') || text(document.getElementById(el.getAttribute('aria-labelledby') || '')) || el.getAttribute('placeholder') || el.name || el.id || '';
    let fid = 0, fieldNo = 0;
    const out = [];
    const read = (formEl, pseudo) => {
      const radios = new Set();
      const fields = [];
      for (const el of formEl.querySelectorAll(FIELD)) {
        if (pseudo && el.closest('form')) continue; // a real form inside the dialog is its own form
        if (!shown(el) || el.disabled || el.readOnly) continue;
        const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'radio') { // one entry per group, the first radio stands for it
          if (radios.has(el.name)) continue; radios.add(el.name);
          const group = [...formEl.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
          el.setAttribute('data-mole-field', String(fieldNo));
          fields.push({ fid: fieldNo++, type, name: el.name, label: text(el.closest('fieldset')?.querySelector('legend')) || labelOf(el), required: group.some((r) => r.required), checked: group.some((r) => r.checked) });
          continue;
        }
        el.setAttribute('data-mole-field', String(fieldNo));
        fields.push({
          fid: fieldNo++, type, name: el.name || '', id: el.id || '', label: labelOf(el).slice(0, 60), placeholder: el.getAttribute('placeholder') || '', autocomplete: el.getAttribute('autocomplete') || '',
          pattern: el.getAttribute('pattern') || '', min: el.getAttribute('min') ?? '', max: el.getAttribute('max') ?? '', minLength: el.minLength ?? -1, maxLength: el.maxLength ?? -1,
          required: el.required, checked: !!el.checked, value: type === 'checkbox' ? '' : el.value || '',
          ...(type === 'select' ? { options: [...el.options].map((o) => ({ value: o.value, label: o.text.trim(), disabled: o.disabled })) } : {}),
        });
      }
      if (!fields.length) return;
      const buttons = [...formEl.querySelectorAll('button, input[type=submit], [role=button]')].filter((b) => shown(b) && !(pseudo && b.closest('form')));
      const submit = pseudo ? buttons.find((b) => commitRe.test(text(b) || b.getAttribute('aria-label') || '')) : buttons.find((b) => (b.tagName === 'BUTTON' && b.type === 'submit') || (b.tagName === 'INPUT' && b.type === 'submit'));
      if (submit) submit.setAttribute('data-mole-submit', String(fid));
      formEl.setAttribute('data-mole-form', String(fid));
      const inDialog = formEl.closest(dialogSel);
      const name = (formEl.getAttribute('aria-label') || text(formEl.querySelector('legend')) || text(formEl.querySelector('h1, h2, h3, h4, [role=heading]')) || (inDialog && (inDialog.getAttribute('aria-label') || text(inDialog.querySelector('h1, h2, h3, h4')))) || (submit && (text(submit) || submit.value)) || formEl.getAttribute('name') || formEl.id || 'form').slice(0, 40);
      out.push({ fid: fid++, name, pseudo, global: !!formEl.closest(chrome) && !inDialog, fields, submit: submit ? { label: (text(submit) || submit.value || submit.getAttribute('aria-label') || '(no name)').slice(0, 40), disabled: !!submit.disabled || submit.getAttribute('aria-disabled') === 'true' } : null });
    };
    for (const f of root.querySelectorAll('form')) if (shown(f) && (scope !== 'page' || !f.closest(dialogSel))) read(f, false);
    if (scope === 'dialog') read(root, true);
    return out;
  }, { scope, chrome, dialogSel, commit: { source: commit.source, flags: commit.flags } });
}

// After filling: does the form consider itself valid (the browser's own constraint validation), which fields does it
// reject, and is its submit button usable now?
export function formState(page, fid) {
  return page.evaluate((fid) => {
    const f = document.querySelector(`[data-mole-form="${fid}"]`);
    if (!f) return { valid: false, invalid: [], submitDisabled: true, gone: true };
    const fields = [...f.querySelectorAll('[data-mole-field]')];
    const invalid = fields.filter((el) => el.checkValidity && !el.checkValidity()).map((el) => (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.name || el.id || el.type).trim().slice(0, 40));
    const s = document.querySelector(`[data-mole-submit="${fid}"]`);
    return { valid: invalid.length === 0, invalid, submitDisabled: !s || !!s.disabled || s.getAttribute('aria-disabled') === 'true' };
  }, fid);
}
