// Seeded generator of small multi-page sites for the style-consistency benchmark (scripts/quality/consistency.mjs).
// Every site is built in one base style from the SAME tokens (fonts, colours, spacing): the pages differ only in how
// they compose them, and in what a page of their type legitimately looks like (a landing page centres its hero, an
// article has few surfaces, a table page is dense). A "mutated" site has exactly one page built in a different style
// vocabulary, like a page generated in another session: the fingerprint must find that page and only that page.
// Ground truth is known by construction; same seed, same sites.
import { rng } from './generate.mjs';

const INK = '#111827', MUTED = '#374151', PRIMARY = '#0f766e', LINE = '#e2e8f0', SURFACE = '#ffffff', TINT = '#f8fafc', TINT2 = '#e6f4f2';

export const STYLES = {
  swiss: { cardRadius: 0, ctlRadius: 0, cardShadow: 'none', cardBorder: `2px solid ${INK}`, cardBg: SURFACE, gradient: false, centered: false, emoji: false, hWeight: 700, hTracking: '-0.01em', bodyFont: 'Inter', btnBg: INK },
  corporate: { cardRadius: 8, ctlRadius: 6, cardShadow: '0 1px 3px rgba(15,23,42,.12)', cardBorder: `1px solid ${LINE}`, cardBg: SURFACE, gradient: false, centered: false, emoji: false, hWeight: 600, hTracking: '0', bodyFont: 'Inter', btnBg: PRIMARY },
  soft: { cardRadius: 20, ctlRadius: 999, cardShadow: '0 12px 32px rgba(15,118,110,.18)', cardBorder: 'none', cardBg: `linear-gradient(135deg, ${TINT}, ${TINT2})`, gradient: true, centered: true, emoji: true, hWeight: 800, hTracking: '-0.02em', bodyFont: 'Inter', btnBg: PRIMARY },
};

// What one off-style page changes. Each is a way a page drifts while every value stays inside the tokens.
export const MUTATIONS = {
  'off-style': (base) => (base === 'soft' ? STYLES.swiss : STYLES.soft), // the whole vocabulary of another style
  rounded: () => ({ cardRadius: 16, ctlRadius: 12 }),
  shadow: () => ({ cardShadow: '0 10px 30px rgba(15,23,42,.18)' }),
  'pill-centered': () => ({ ctlRadius: 999, centered: true }),
  emoji: () => ({ emoji: true }),
  font: () => ({ bodyFont: 'JetBrains Mono' }),
  flat: () => ({ cardRadius: 0, ctlRadius: 0, cardShadow: 'none', cardBorder: `2px solid ${INK}`, cardBg: SURFACE, gradient: false }),
};
// Which drifts make sense on which base style (a swiss site cannot drift to "flat": it already is).
const APPLIES = { swiss: ['off-style', 'rounded', 'shadow', 'pill-centered', 'emoji', 'font'], corporate: ['off-style', 'flat', 'pill-centered', 'emoji', 'font'], soft: ['off-style', 'flat', 'font'] };

const TITLES = ['Loan applications', 'Customer overview', 'Repayment schedule', 'Branch performance', 'Account settings', 'Team members', 'Monthly report', 'Support'];
const WORDS = 'Every account is reviewed within two working days and the result is sent by email to the address on file. Rates depend on the term and the amount, and they are fixed for the whole loan.'.split(' ');
const ICONS = ['🚀', '✨', '💡', '📈', '🎯', '⚡'];

function makeSite(R, base, mutation) {
  const pick = (a) => a[Math.floor(R() * a.length)];
  const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const sentence = (n = int(10, 22)) => { const s = Array.from({ length: n }, () => pick(WORDS)).join(' '); return s[0].toUpperCase() + s.slice(1).replace(/[.,]$/, '') + '.'; };

  // Each page has its own seed, so the drifted page can be rendered again without the drift from the same content.
  const page = (type, st, seed) => {
    const P = rng(seed);
    const pick = (a) => a[Math.floor(P() * a.length)];
    const int = (lo, hi) => lo + Math.floor(P() * (hi - lo + 1));
    const sentence = (n = int(10, 22)) => { const s = Array.from({ length: n }, () => pick(WORDS)).join(' '); return s[0].toUpperCase() + s.slice(1).replace(/[.,]$/, '') + '.'; };
    const align = st.centered ? 'text-align:center;' : '';
    const h = (lvl, text, size) => `<h${lvl} style="margin:0 0 12px;font-size:${size}px;font-weight:${st.hWeight};letter-spacing:${st.hTracking};${align}">${st.emoji ? pick(ICONS) + ' ' : ''}${text}</h${lvl}>`;
    const p = (text) => `<p style="margin:0 0 12px;color:${MUTED};${align}">${text}</p>`;
    const btn = (label, primary = true) => `<button style="height:40px;padding:0 20px;border:${primary ? '0' : `1px solid ${INK}`};border-radius:${st.ctlRadius}px;background:${primary ? (st.gradient ? `linear-gradient(135deg, ${PRIMARY}, #0e7490)` : st.btnBg) : SURFACE};color:${primary ? '#fff' : INK};font-size:15px;font-weight:600;margin-right:8px">${st.emoji ? pick(ICONS) + ' ' : ''}${label}</button>`;
    const card = (inner, pad = 24) => `<div style="background:${st.cardBg};border:${st.cardBorder};border-radius:${st.cardRadius}px;box-shadow:${st.cardShadow};padding:${pad}px;margin-bottom:16px">${inner}</div>`;
    const field = (label, i) => `<div style="margin-bottom:12px"><label for="f${i}" style="display:block;font-size:14px;margin-bottom:4px">${label}</label><input id="f${i}" style="height:40px;width:320px;border:1px solid #6b7280;border-radius:${Math.min(st.ctlRadius, 20)}px;padding:0 12px;font-size:16px"></div>`;
    const grid = (items) => `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${items.join('')}</div>`;
    const title = pick(TITLES);
    let main;
    if (type === 'dashboard') main = h(1, title, 32) + p(sentence()) + grid(Array.from({ length: int(3, 6) }, () => card(h(3, pick(TITLES), 18) + p(sentence(int(6, 12)))))) + btn('Export') + btn('Filter', false);
    else if (type === 'table') {
      const rows = Array.from({ length: int(4, 8) }, (_, i) => `<tr><td style="padding:10px;border-bottom:1px solid ${LINE}">${pick(TITLES)}</td><td style="padding:10px;border-bottom:1px solid ${LINE}">${int(100, 999)}</td><td style="padding:10px;border-bottom:1px solid ${LINE}">${btn('View', false)}</td></tr>`).join('');
      main = h(1, title, 32) + p(sentence()) + btn('New entry') + card(`<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:10px;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Name</th><th style="text-align:left;padding:10px;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>`, 0);
    } else if (type === 'form' || type === 'contact') {
      const labels = type === 'contact' ? ['Full name', 'Email', 'Phone', 'Message'] : ['Account name', 'Branch', 'Owner', 'Limit', 'Start date'].slice(0, int(3, 5));
      main = h(1, type === 'contact' ? 'Contact us' : title, 32) + p(sentence()) + card(h(2, type === 'contact' ? 'Send us a message' : 'Details', 22) + labels.map(field).join('') + btn(type === 'contact' ? 'Send message' : 'Save') + btn('Cancel', false));
    } else if (type === 'article') main = h(1, title, 32) + Array.from({ length: int(4, 7) }, () => p(sentence(int(25, 45)))).join('') + (R() < 0.5 ? card(p(sentence())) : '') + btn('Read more', false);
    else if (type === 'landing') // a centred hero is what a landing page legitimately does, in any style
      main = `<section style="text-align:center;padding:64px 0;background:${TINT};margin:0 -32px 24px">${`<h1 style="margin:0 0 12px;font-size:44px;font-weight:${st.hWeight};letter-spacing:${st.hTracking}">${st.emoji ? pick(ICONS) + ' ' : ''}${title}</h1>`}<p style="margin:0 auto 20px;max-width:560px;color:${MUTED}">${sentence()}</p>${btn('Get started')}${btn('Learn more', false)}</section>` + grid(Array.from({ length: 3 }, () => card(h(3, pick(TITLES), 18) + p(sentence(int(6, 12))))));
    return main;
  };

  const types = ['landing', ...Array.from({ length: int(4, 6) }, () => pick(['dashboard', 'table', 'form', 'article', 'contact', 'dashboard', 'table']))];
  const baseStyle = STYLES[base];
  const odd = mutation ? int(1, types.length - 1) : -1; // any page but the first can be the drifted one
  const nav = (st) => `<header style="display:flex;gap:24px;align-items:center;padding:16px 32px;border-bottom:1px solid ${LINE}"><strong style="font-weight:${st.hWeight}">Northwind</strong>${['Home', 'Loans', 'Reports', 'Contact'].map((x) => `<a href="#" style="color:${INK};text-decoration:none">${x}</a>`).join('')}</header>`;
  // the shared header comes from the site's own component: it stays in the base style even on the drifted page
  const doc = (type, st, seed) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${type}</title><style>body{margin:0;font-family:${st.bodyFont},sans-serif;color:${INK};background:${SURFACE};font-size:16px;line-height:1.5} main{max-width:1100px;margin:0 auto;padding:32px}</style></head><body>${nav(baseStyle)}<main>${page(type, st, seed)}</main></body></html>`;
  const seeds = types.map(() => Math.floor(R() * 2 ** 31));
  return types.map((type, i) => {
    const html = doc(type, i === odd ? { ...baseStyle, ...MUTATIONS[mutation](base) } : baseStyle, seeds[i]);
    // A drift with nothing to change (shadows on a page without cards) leaves the page as it was: no detector can see it.
    const invisible = i === odd && html.replace(/[\u{1F300}-\u{1FAFF}\u2728\u26A1] /gu, '') === doc(type, baseStyle, seeds[i]);
    return { path: `/${i === 0 ? '' : `${type}-${i}`}`, type, odd: i === odd, invisible, html };
  });
}

// cases: clean sites (no page may be flagged) and one-drifted-page sites, over every base style and applicable drift.
export function generateSites({ seed = 1, perCombo = 8, cleanPerStyle = 12 } = {}) {
  const R = rng(seed);
  const cases = [];
  for (const base of Object.keys(STYLES)) {
    for (let i = 0; i < cleanPerStyle; i++) cases.push({ base, mutation: null, pages: makeSite(R, base, null) });
    for (const m of APPLIES[base]) for (let i = 0; i < perCombo; i++) cases.push({ base, mutation: m, pages: makeSite(R, base, m) });
  }
  return cases;
}
