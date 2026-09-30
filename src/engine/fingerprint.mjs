// fingerprint: how a page COMPOSES its design tokens, and which pages of a site compose them unlike the rest.
// The design rules check each element against allowed values; a page can pass every one of them (right fonts, colours,
// spacing) and still look like it came from another site: rounded, shadowed, gradient cards and centred emoji headings on
// a sharp Swiss grid. The fingerprint measures that vocabulary per page from what collect() already read; styleOutliers()
// compares every page with the others. Deterministic, no model: a finding says exactly which numbers differ.
// Advisory: it never changes a run's exit code (see docs/CONSISTENCY.md for how it is measured).

const EMOJI = /\p{Extended_Pictographic}/u;
const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const share = (hits, of, min) => (of >= min ? +(hits / of).toFixed(3) : null);
const family = (ff) => String(ff || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();

// Per feature: its family (features in one family are one signal: corners, depth, ...), whether it may flag a page on
// its own (strong) or only next to another family (weak: centring and heading style also differ by page type), the
// spread below which pages count as equal (floor), the smallest difference worth saying (min), how far beyond every
// other page it must be (margin), and the difference that is obvious on its own (extreme).
const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${Math.round(v)}px`;
const weight = (v) => String(Math.round(v));
const em = (v) => `${v.toFixed(2)}em`;
export const FEATURES = {
  containerRounded: { family: 'corners', tier: 'strong', floor: 0.08, min: 0.35, margin: 0.15, extreme: 0.6, what: 'rounded corners (8px+) on cards and panels', fmt: pct },
  containerRadius: { family: 'corners', tier: 'strong', floor: 2, min: 6, margin: 4, extreme: 12, what: 'typical card corner radius', fmt: px },
  pill: { family: 'corners', tier: 'strong', floor: 0.1, min: 0.4, margin: 0.2, extreme: 0.7, what: 'pill-shaped buttons', fmt: pct },
  controlRadius: { family: 'corners', tier: 'strong', floor: 2, min: 6, margin: 4, extreme: 12, what: 'typical button / field corner radius', fmt: px },
  shadow: { family: 'depth', tier: 'strong', floor: 0.08, min: 0.35, margin: 0.15, extreme: 0.6, what: 'drop shadows on cards and panels', fmt: pct },
  gradient: { family: 'depth', tier: 'strong', floor: 0.05, min: 0.2, margin: 0.1, extreme: 0.5, what: 'gradient fills on surfaces', fmt: pct },
  emoji: { family: 'voice', tier: 'strong', floor: 0.1, min: 0.6, margin: 0.3, extreme: 0.6, what: 'emoji use (none / some / throughout)', fmt: (v) => (v === 0 ? 'none' : v < 1 ? 'some' : 'throughout') },
  fontShare: { family: 'type', tier: 'strong', floor: 0.08, min: 0.35, margin: 0.15, extreme: 0.6, what: 'text in the site\'s main typeface', fmt: pct },
  headingWeight: { family: 'type', tier: 'strong', floor: 50, min: 200, margin: 100, what: 'heading weight', fmt: weight }, // one heading style per site, whatever the page type
  headingTracking: { family: 'type', tier: 'weak', floor: 0.01, min: 0.03, margin: 0.015, what: 'heading letter-spacing', fmt: em },
  centered: { family: 'layout', tier: 'weak', floor: 0.1, min: 0.35, margin: 0.15, what: 'centred text', fmt: pct },
};

// One page -> its fingerprint. els: collect() output for the page in light mode. A feature is null when the page has too
// little of the thing to say (an article page with two buttons has no meaningful "button style").
export function fingerprint(els) {
  const box = (e) => !e.isControl && !e.isButton && e.tag !== 'body' && e.tag !== 'html' && e.rect.w >= 40 && e.rect.h >= 24 && (e.look?.viewportShare ?? 1) < 0.95
    && ((e.look?.bgAlpha ?? 0) > 0.05 || (e.look?.border ?? 0) >= 2 || e.look?.shadow || e.look?.gradient);
  const containers = els.filter(box);
  const buttons = els.filter((e) => (e.isButton || (e.isLink && (e.look?.bgAlpha ?? 0) > 0.05)) && e.rect.h >= 16);
  const filled = (e) => e.look?.gradient || ((e.look?.bgAlpha ?? 0) > 0.05 && (e.look?.bgLight ?? 1) < 0.9);
  const controls = els.filter((e) => e.isButton || e.isControl);
  const texts = els.filter((e) => e.hasText && e.text && !e.srOnly && !e.ariaHidden);
  const rmax = (e) => Math.max(0, ...(e.radii || []).filter((x) => x != null));
  const chars = (e) => Math.max(1, e.text.length);
  const totalChars = texts.reduce((a, e) => a + chars(e), 0);
  const bodySize = median(texts.flatMap((e) => Array(Math.min(chars(e), 40)).fill(e.fontSize))) || 16;
  const headings = texts.filter((e) => /^h[1-3]$/.test(e.tag) || e.fontSize >= bodySize * 1.5);
  const fonts = {};
  for (const e of texts) { const f = family(e.fontFamily); fonts[f] = (fonts[f] || 0) + chars(e); }
  return {
    // One card or one button already shows how the site styles them: pages with little on them still compare.
    containerRounded: share(containers.filter((e) => rmax(e) >= 8).length, containers.length, 1),
    containerRadius: containers.length ? median(containers.map(rmax)) : null,
    pill: share(buttons.filter((e) => rmax(e) >= e.rect.h / 2 - 1).length, buttons.length, 1),
    controlRadius: controls.length ? median(controls.map((e) => Math.min(rmax(e), e.rect.h / 2))) : null,
    shadow: share(containers.filter((e) => e.look?.shadow).length, containers.length, 1),
    // of the surfaces a gradient could be on (cards and filled buttons, not white secondary buttons)
    gradient: share([...containers, ...buttons.filter(filled)].filter((e) => e.look?.gradient).length, containers.length + buttons.filter(filled).length, 2),
    // whether the page uses emoji at all, not how much of its text does (that depends on the content): 0, 1/3, 2/3, 1
    emoji: texts.length >= 3 ? +(Math.min(texts.filter((e) => EMOJI.test(e.text)).length, 3) / 3).toFixed(3) : null,
    centered: totalChars >= 200 ? +(texts.filter((e) => e.look?.centered).reduce((a, e) => a + chars(e), 0) / totalChars).toFixed(3) : null,
    headingWeight: headings.length ? median(headings.map((e) => e.fontWeight)) : null,
    headingTracking: headings.length ? median(headings.map((e) => e.look?.tracking ?? 0)) : null,
    fonts, // family -> characters of text; turned into fontShare against the site's main typeface in styleOutliers
    support: { containers: containers.length, buttons: buttons.length, controls: controls.length, texts: texts.length, headings: headings.length },
  };
}

// Pages -> the ones whose style does not match the others. pages: [{ path, fp }]. Each page is compared with the OTHER
// pages (so an outlier cannot pull the baseline towards itself). A feature counts only when the page is beyond every
// other page by a margin, the difference is worth saying, and it is far outside how much the others vary. A page is
// flagged when an obvious difference stands alone, or when a strong difference is backed by a second family.
export function styleOutliers(pages, { minPages = 4, features = FEATURES } = {}) {
  const usable = pages.filter((p) => p.fp);
  if (usable.length < minPages) return { checked: false, reason: `style consistency needs at least ${minPages} pages to compare; ${usable.length} measured`, pages: usable.length, outliers: [] };
  const outliers = [];
  for (const p of usable) {
    const others = usable.filter((o) => o !== p);
    // the site's main typeface, from the other pages
    const siteFonts = {};
    for (const o of others) for (const [f, n] of Object.entries(o.fp.fonts || {})) siteFonts[f] = (siteFonts[f] || 0) + n;
    const main = Object.entries(siteFonts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const fontShare = (fp) => { const all = Object.values(fp.fonts || {}).reduce((a, b) => a + b, 0); return main && all >= 80 ? +((fp.fonts[main] || 0) / all).toFixed(3) : null; };
    const valueOf = (fp, k) => (k === 'fontShare' ? fontShare(fp) : fp[k]);
    const diffs = [];
    for (const [k, f] of Object.entries(features)) {
      const x = valueOf(p.fp, k);
      const vals = others.map((o) => valueOf(o.fp, k)).filter((v) => v != null);
      if (x == null || vals.length < minPages - 1) continue;
      const med = median(vals), lo = Math.min(...vals), hi = Math.max(...vals);
      const mad = median(vals.map((v) => Math.abs(v - med)));
      const z = (x - med) / Math.max(1.4826 * mad, f.floor);
      const effect = Math.abs(x - med);
      const beyond = x > hi + f.margin || x < lo - f.margin;
      if (Math.abs(z) >= 3 && effect >= f.min && beyond) {
        diffs.push({ feature: k, family: f.family, tier: f.tier, value: x, others: { median: med, min: lo, max: hi }, z: +z.toFixed(1), obvious: f.extreme != null && effect >= f.extreme, text: `${k === 'fontShare' && main ? `text in ${main}` : f.what}: ${f.fmt(x)} here, ${lo === hi ? f.fmt(lo) : `${f.fmt(lo)}–${f.fmt(hi)}`} on the other pages` });
      }
    }
    const families = new Set(diffs.map((d) => d.family));
    const strong = diffs.filter((d) => d.tier === 'strong');
    const flagged = diffs.some((d) => d.obvious) || (strong.length > 0 && families.size >= 2);
    if (flagged) outliers.push({ path: p.path, score: +diffs.reduce((a, d) => a + Math.min(Math.abs(d.z), 10), 0).toFixed(1), families: [...families], differences: diffs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)) });
  }
  return { checked: true, pages: usable.length, outliers: outliers.sort((a, b) => b.score - a.score) };
}
