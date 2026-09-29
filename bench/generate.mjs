// Seeded generator of test pages: clean design-system-conformant components, plus exactly one injected defect per case.
// Ground truth is known by construction: expected key = "<id>|<rule>". Same seed => same pages, so anyone can reproduce a number.
import { contrastRatio } from '../src/design-checks.mjs';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BGS = ['#ffffff', '#f8fafc', '#e6f4f2', '#0f172a', '#1e293b'];

export function makeGenerator(tokens, seed) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const n = tokens.netos;
  const allowed = new Set(n.allowedHex);
  const heights = n.buttonHeightsPx;
  const radii = n.radiiPx.filter((r) => r > 0 && r < 999);
  const badRadii = Array.from({ length: 40 }, (_, i) => i + 1).filter((r) => !n.radiiPx.includes(r));
  const badHeights = Array.from({ length: 40 }, (_, i) => i + 18).filter((h) => !heights.some((a) => Math.abs(a - h) <= 1.2));
  const goodFonts = ['Inter', 'Montserrat', 'JetBrains Mono'];
  const badFonts = ['Arial', 'Roboto', 'Georgia', 'Times New Roman', 'Verdana', 'Helvetica', 'Courier New', 'Comic Sans MS'];
  const words = ['Continue', 'Save', 'Approve', 'Details', 'Export', 'Apply now', 'Next', 'Review'];
  const longWords = ['Save changes now', 'Submit new request', 'Confirm the details'];
  const sentences = ['Loan application status', 'Customer profile summary', 'Monthly repayment schedule', 'Account verification pending'];

  // contrast pairs, computed with the same formula the rule uses
  const pairs = { fail: [], edgePass: [], pass: [] };
  for (const bg of BGS) for (const fg of n.allowedHex) {
    const r = contrastRatio(hex2rgb(fg), hex2rgb(bg));
    if (r >= 1.6 && r <= 4.3) pairs.fail.push([fg, bg, r]);
    else if (r >= 4.55 && r <= 5.6) pairs.edgePass.push([fg, bg, r]);
    else if (r > 5.6) pairs.pass.push([fg, bg, r]);
  }

  let uid = 0;
  const id = (p) => `${p}${uid++}`;
  const font = () => `${pick(goodFonts)}, sans-serif`;
  const dark = () => [int(0, 90), int(0, 90), int(0, 90)];
  const offPalette = () => { for (;;) { const c = dark(); const h = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); if (!allowed.has(h)) return { c, h }; } };

  // ---- clean components (must produce zero findings) ----
  const clean = {
    button() { const h = pick(heights); const f = h <= 36 ? pick([13, 14]) : pick([13, 14, 15, 16]); return `<button id="${id('b')}" class="ok" style="height:${h}px;font-size:${f}px;border-radius:${pick(radii)}px">${pick(words)}</button>`; },
    iconButton() { return `<button id="${id('ib')}" class="ok" aria-label="Open menu" style="width:38px;height:38px;padding:0"><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#fff"/></svg></button>`; },
    card() { return `<div id="${id('c')}" class="card" style="border-radius:${pick(radii)}px">${pick(sentences)}</div>`; },
    field() { const i = id('f'); return `<div class="field"><label for="${i}">Full name</label><input id="${i}" type="text" style="border-radius:8px"></div>`; },
    text() { const [fg, bg] = pick(pairs.pass); return `<div style="background:${bg};padding:8px"><p id="${id('t')}" style="margin:0;font-family:${font()};color:${fg}">${pick(sentences)}</p></div>`; },
    edgeText() { const [fg, bg] = pick(pairs.edgePass); return `<div style="background:${bg};padding:8px"><p id="${id('e')}" style="margin:0;color:${fg}">${pick(sentences)}</p></div>`; }, // barely passing: must stay silent
    truncOk() { return `<div id="${id('tr')}" title="${pick(sentences)}" style="width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pick(sentences)} and more words</div>`; },
    largeText() { // 24px text may use 3:1 - must not be flagged at 4.5
      const cand = []; for (const bg of BGS) for (const fg of n.allowedHex) { const r = contrastRatio(hex2rgb(fg), hex2rgb(bg)); if (r >= 3.15 && r < 4.4) cand.push([fg, bg]); }
      const [fg, bg] = pick(cand); return `<div style="background:${bg};padding:8px"><p id="${id('lt')}" style="margin:0;font-size:24px;color:${fg}">${pick(words)}</p></div>`;
    },
    disabledMuted() { return `<button id="${id('dis')}" class="ok" disabled style="background:#e2e8f0;color:#94a3b8">${pick(words)}</button>`; }, // WCAG-exempt: must stay silent
    srOnlyText() { return `<span id="${id('sr')}" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;color:#94a3b8;font-family:Arial">Skip to content</span>`; }, // not rendered visibly
    ariaHiddenIcon() { return `<button id="${id('ah')}" class="ok" aria-hidden="true" tabindex="-1" style="width:38px;height:38px;padding:0"><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#fff"/></svg></button>`; },
    truncDescribed() { return `<div id="${id('td')}" aria-describedby="tip" style="width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pick(sentences)} and more words</div>`; },
    edgeRadius() { return `<div id="${id('er')}" class="card" style="border-radius:${pick([6, 12, 40])}px">Edge radius</div>`; }
  };
  const cleanKeys = Object.keys(clean);

  // ---- mutations: [rule, builder] ----
  const mutate = {
    'button-height': (i) => `<button id="${i}" class="ok" style="height:${pick(badHeights)}px;font-size:13px;border-radius:12px">${pick(words)}</button>`,
    'button-font-size': (i) => `<button id="${i}" class="ok" style="height:${pick([28, 32, 36])}px;font-size:${int(15, 20)}px;border-radius:12px">${pick(words)}</button>`,
    'raw-color-literal': (i) => {
      const { c, h } = offPalette(); const form = pick(['hex', 'rgb']); const col = form === 'hex' ? h : `rgb(${c.join(',')})`;
      return pick([
        () => `<button id="${i}" class="ok" style="background:${col}">${pick(words)}</button>`,
        () => `<div id="${i}" class="card" style="border-color:${col}">Note</div>`,
        () => `<span id="${i}" style="color:${col}">${pick(words)}</span>`
      ])();
    },
    'button-unnamed': (i) => `<button id="${i}" class="ok" style="width:38px;height:38px;padding:0"><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#fff"/></svg></button>`,
    'button-text-wrap': (i) => `<button id="${i}" class="ok" style="width:${int(72, 88)}px;height:38px;white-space:normal;line-height:14px;padding:0 8px">${pick(longWords)}</button>`,
    'radius-scale': (i) => `<div id="${i}" class="card" style="border-radius:${pick(badRadii)}px">${pick(sentences)}</div>`,
    'font-family': (i) => `<p id="${i}" style="margin:0;font-family:${pick(badFonts)}, sans-serif">${pick(sentences)}</p>`,
    'control-unlabeled': (i) => pick([
      () => `<div class="field"><input id="${i}" type="${pick(['text', 'email', 'tel', 'number'])}" placeholder="Phone" style="border-radius:8px"></div>`,
      () => `<div class="field"><select id="${i}" style="height:36px"><option>One</option><option>Two</option></select></div>`,
      () => `<div class="field"><textarea id="${i}" rows="2" placeholder="Notes"></textarea></div>`
    ])(),
    contrast: (i) => { const [fg, bg] = pick(pairs.fail); return `<div style="background:${bg};padding:8px"><p id="${i}" style="margin:0;color:${fg}">${pick(sentences)}</p></div>`; },
    'text-overflow': (i) => `<div id="${i}" class="spill" style="width:${int(80, 130)}px">This label is far too long for its box</div>`,
    'text-truncated-no-title': (i) => `<div id="${i}" style="width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pick(sentences)} and many more words</div>`
  };
  const rules = Object.keys(mutate);

  const CSS = `body{margin:0;padding:24px;background:#fff;color:#0f172a;font:14px Inter,sans-serif}
.wrap{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;width:1100px}
button,input,select,textarea{font-family:inherit} button{border:0;color:#fff;background:#006f63;white-space:nowrap;padding:0 16px;flex:none}
.ok{height:38px;font-size:13px;border-radius:12px}.card{border:1px solid #e2e8f0;padding:12px;width:160px;flex:none}
.field{display:flex;flex-direction:column;gap:4px;flex:none}input{height:36px;padding:0 12px;border:1px solid #cbd5e1;font:inherit}
.spill{white-space:nowrap;border:1px solid #e2e8f0;flex:none}`;

  return {
    rules,
    make(index, rule) { // rule=null -> negative (clean) case
      const parts = Array.from({ length: int(6, 10) }, () => clean[pick(cleanKeys)]());
      let expected = [];
      if (rule) { const mid = `m${index}`; parts.splice(int(0, parts.length), 0, mutate[rule](mid)); expected = [`${mid}|${rule}`]; }
      return { index, rule, expected, html: `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="wrap">${parts.join('\n')}</div>` };
    }
  };
}

// n cases: mostly one-defect pages spread evenly over the rules, ~12% clean pages (false-positive probe).
export function generateCases(tokens, { seed = 1, n = 220 } = {}) {
  const g = makeGenerator(tokens, seed);
  const negatives = Math.round(n * 0.12);
  const cases = [];
  for (let i = 0; i < n - negatives; i++) cases.push(g.make(i, g.rules[i % g.rules.length]));
  for (let i = 0; i < negatives; i++) cases.push(g.make(n - negatives + i, null));
  return cases;
}
