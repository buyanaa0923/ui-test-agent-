// Deterministic design checks against a design contract (engine/contract.mjs). No model involved.
// collect(page): read facts from the live page. runRules(): turn facts + contract into violations.
import fs from 'node:fs';
import { exemptReason } from './exemptions.mjs';
import { contractFromTokens } from './contract.mjs';

export function loadTokens(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ignore: CSS selectors whose elements (and descendants) are out of scope, e.g. a third-party widget.
export async function collect(page, { ignore = [] } = {}) {
  return page.evaluate((ignore) => {
    for (const sel of ignore) { try { document.querySelector(sel); } catch { throw new Error(`design contract: ignore entry "${sel}" is not a valid CSS selector`); } }
    const ignoreSel = ignore.join(',');
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    // Normalise any CSS color (rgb, oklch, color-mix...) to [r,g,b,a] through a canvas pixel.
    const rgba = (str) => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = str;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], +(d[3] / 255).toFixed(3)];
    };
    const over = (top, bot) => {
      const a = top[3] + bot[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const ch = (i) => Math.round((top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a);
      return [ch(0), ch(1), ch(2), a];
    };
    const effectiveBg = (el) => {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradient/image: cannot judge
        layers.push(rgba(cs.backgroundColor));
      }
      let acc = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };
    // What is really painted behind this text? Look at every layer at its center point (siblings and overlays too,
    // not just ancestors). Gradients, images and video make the background unknowable, so those are skipped.
    const bgAt = (el, r) => {
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const inView = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
      const stack = inView ? document.elementsFromPoint(x, y) : [];
      const at = stack.indexOf(el);
      if (at < 0) return effectiveBg(el);
      const layers = [];
      for (const n of stack.slice(at)) {
        if (['IMG', 'VIDEO', 'CANVAS'].includes(n.tagName)) return null;
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        layers.push(rgba(cs.backgroundColor));
      }
      let acc = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };
    const textLines = (el) => {
      const tops = new Set();
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const q of r.getClientRects()) if (q.width > 0) tops.add(Math.round(q.top));
      }
      return tops.size;
    };
    const skip = new Set(['HTML', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'SVG', 'PATH']);
    const px = (v) => parseFloat(v) || 0;
    // Overlays are usually pointer-events:none, which hides them from elementsFromPoint. Make them hittable while we measure.
    const st = document.createElement('style');
    st.textContent = '*{pointer-events:auto !important}';
    document.head.appendChild(st);
    const out = [];
    const BODY_TAGS = new Set(['p', 'li', 'dd', 'blockquote', 'figcaption']);
    const TARGET_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option']);
    // Lines a block of running text occupies, counting inline children (links, <b>), not just its own text nodes.
    const blockLines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const tops = new Set();
      for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) tops.add(Math.round(q.top));
      return tops.size;
    };
    // Where this element was written, from what dev builds already put on DOM nodes. Read-only; null when nothing says.
    const fileLine = (s, via) => { const m = String(s).match(/^(.*?):(\d+)(?::(\d+))?(?::[^:]*)?$/); return m ? { file: m[1], line: +m[2], column: m[3] ? +m[3] : null, via } : null; };
    const compName = (t) => (t && (t.displayName || t.name || t.__name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name)) || null;
    const srcHint = (el) => {
      const a = (n) => el.getAttribute(n);
      if (a('data-mole-src')) return fileLine(a('data-mole-src'), 'data-mole-src');
      if (a('data-insp-path')) return fileLine(a('data-insp-path'), 'code-inspector');
      if (a('data-v-inspector')) return fileLine(a('data-v-inspector'), 'vue-inspector');
      if (a('data-inspector-relative-path') && a('data-inspector-line')) return { file: a('data-inspector-relative-path'), line: +a('data-inspector-line'), column: +a('data-inspector-column') || null, via: 'react-dev-inspector' };
      const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fk) {
        const f = el[fk];
        let component = null;
        for (let n = f?.return, i = 0; n && i < 30 && !component; n = n.return, i++) if (typeof n.type === 'function' || (n.type && typeof n.type === 'object')) component = compName(n.type);
        const d = f?._debugSource; // React <= 18 dev builds; React 19 dropped it, so only the component name is left
        return d ? { file: d.fileName, line: d.lineNumber, column: d.columnNumber ?? null, via: 'react', component } : component ? { file: null, line: null, via: 'react', component } : null;
      }
      const vue = el.__vueParentComponent?.type || el.__vue__?.$options;
      if (vue) return { file: vue.__file || null, line: null, via: 'vue', component: compName(vue) };
      const sv = el.__svelte_meta?.loc;
      if (sv) return { file: sv.file, line: sv.line + 1, column: sv.column + 1, via: 'svelte' }; // svelte dev meta is zero-based
      return null;
    };
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    for (const el of document.querySelectorAll('body, body *')) {
      if (skip.has(el.tagName.toUpperCase())) continue;
      if (ignoreSel && el.closest(ignoreSel)) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0;
      if (!visible) continue;
      const tag = el.tagName.toLowerCase();
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      const type = (el.getAttribute('type') || '').toLowerCase();
      const isControl = ['input', 'select', 'textarea'].includes(tag) && !['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
      const isButton = tag === 'button' || el.getAttribute('role') === 'button';
      const hasLabel = isControl && !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length) || el.closest('label'));
      const buttonName = isButton ? (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim() || el.querySelector('img[alt]')?.getAttribute('alt') || '') : null;
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      const isLink = tag === 'a' && el.hasAttribute('href');
      const role = el.getAttribute('role');
      const isTarget = isButton || isLink || isControl || tag === 'summary' || (!!role && TARGET_ROLES.has(role));
      // A link inside a sentence (WCAG 2.5.8 inline exception): inline, and its parent has text of its own.
      const inlineInText = isTarget && cs.display === 'inline' && !!el.parentElement && [...el.parentElement.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      // Clicking a control's <label> works too, so the hit area of a checkbox is the box plus its labels.
      let hit = { x: r.x, y: r.y, r: r.right, b: r.bottom };
      if (isControl && el.labels) for (const l of el.labels) { const q = l.getBoundingClientRect(); if (q.width && q.height) hit = { x: Math.min(hit.x, q.x), y: Math.min(hit.y, q.y), r: Math.max(hit.r, q.right), b: Math.max(hit.b, q.bottom) }; }
      const isBody = hasText && BODY_TAGS.has(tag);
      const bLines = isBody ? blockLines(el) : 0;
      const padY = px(cs.paddingTop) + px(cs.paddingBottom);
      out.push({
        label: el.id ? `${tag}#${el.id}` : `${tag}${cls}`,
        id: el.id || null,
        // Facts for finding the element in the source (engine/locate.mjs).
        hint: {
          classes: typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 12) : [],
          ownText: hasText ? ownText(el) : '', ariaLabel: el.getAttribute('aria-label') || null, name: el.getAttribute('name') || null,
          placeholder: el.getAttribute('placeholder') || null, src: srcHint(el),
        },
        tag,
        text: hasText ? el.textContent.trim().slice(0, 40) : '',
        hasText,
        isControl,
        isButton,
        hasLabel,
        buttonName,
        rect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
        inlineStyle: el.getAttribute('style') || '',
        hasTitle: !!(el.getAttribute('title') || el.getAttribute('aria-label')),
        lines: hasText ? textLines(el) : 0,
        disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        ariaHidden: !!el.closest('[aria-hidden="true"]'),
        role: el.getAttribute('role') || null,
        srOnly: (r.width <= 1 && r.height <= 1) || (!!cs.clip && cs.clip !== 'auto' && cs.clip.startsWith('rect(0')),
        describedBy: !!el.getAttribute('aria-describedby'),
        ancestors: (() => { const a = []; for (let n = el.parentElement; n && a.length < 3 && n !== document.body; n = n.parentElement) a.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/)[0] : '')); return a; })(),
        overflowX: cs.overflowX,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        display: cs.display,
        clientW: el.clientWidth,
        scrollW: el.scrollWidth,
        fontFamily: cs.fontFamily,
        fontSize: px(cs.fontSize),
        fontWeight: Number(cs.fontWeight) || 400,
        color: hasText ? rgba(cs.color) : null,
        bg: hasText ? bgAt(el, r) : null,
        radii: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map((k) => (cs[k].includes('%') ? null : px(cs[k]))),
        isLink, isTarget, inlineInText,
        hitRect: { x: Math.round(hit.x), y: Math.round(hit.y), w: Math.round(hit.r - hit.x), h: Math.round(hit.b - hit.y) },
        inputType: isControl ? (tag === 'input' ? type || 'text' : tag) : null,
        isBody, blockLines: bLines,
        textLen: isBody ? el.textContent.replace(/\s+/g, ' ').trim().length : 0,
        // The real line box: the declared value, or for "normal" the measured height per line.
        lineHeight: cs.lineHeight !== 'normal' ? px(cs.lineHeight) : bLines ? +((el.clientHeight - padY) / bLines).toFixed(2) : null,
        spacing: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.rowGap, cs.columnGap].map((v) => px(v)),
      });
      if (out.length >= 4000) break;
    }
    st.remove();
    return out;
  }, ignore);
}

const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
export const contrastRatio = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

const COLOR_PROP = /(color|background|border|fill|stroke)/i;
const hexKey = (h) => {
  let x = h.replace('#', '').toLowerCase();
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const v = parseInt(x, 16);
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
};
// Colors written in an inline style, as "r,g,b" keys. Non-sRGB notations are returned as "other".
function colorLiterals(style) {
  const keys = [];
  for (const m of style.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) keys.push(hexKey(m[0]));
  for (const m of style.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) keys.push(`${m[1]},${m[2]},${m[3]}`);
  if (/(hsla?|oklch|oklab)\(/i.test(style)) keys.push('other');
  return keys;
}

// Every rule, with where its threshold comes from and the usual fix. `tier`: standard (a published requirement),
// practice (widely agreed design practice), system (the project's own design system). Travels with each finding.
export const RULES = {
  'contrast': { tier: 'standard', ref: 'WCAG 2.2 SC 1.4.3', fix: 'darken the text or lighten the background (pick a darker token) until it meets the ratio' },
  'target-size': (c) => (c.platform === 'mobile'
    ? { tier: 'practice', ref: 'Apple HIG 44pt / Material 48dp touch targets', fix: `make the hit area at least ${c.targets}x${c.targets}px (min-height/min-width or padding)` }
    : { tier: 'standard', ref: 'WCAG 2.2 SC 2.5.8', fix: `make the hit area at least ${c.targets}x${c.targets}px, or space it away from other targets` }),
  'button-unnamed': { tier: 'standard', ref: 'WCAG 2.2 SC 4.1.2', fix: 'add an aria-label (or visible text) that says what the button does' },
  'control-unlabeled': { tier: 'standard', ref: 'WCAG 2.2 SC 1.3.1 / 4.1.2', fix: 'add a <label for> or aria-label; a placeholder is not a label' },
  'text-overflow': { tier: 'practice', ref: 'layout integrity', fix: 'let the box grow, wrap the text, or truncate with an ellipsis and a title' },
  'text-truncated-no-title': { tier: 'practice', ref: 'truncated content must stay reachable', fix: 'add a title (or aria-describedby) with the full text' },
  'button-text-wrap': { tier: 'practice', ref: 'button labels stay on one line', fix: 'shorten the label or widen the button (white-space: nowrap)' },
  'text-too-small': { tier: 'practice', ref: 'Apple HIG 11pt / Material 12sp minimum', fix: 'use the smallest type token or larger' },
  'body-text-small': { tier: 'practice', ref: 'body text 14px desktop / 16px mobile (Material, GOV.UK, iOS)', fix: 'use the body type token for running text' },
  'line-height-tight': { tier: 'practice', ref: 'WCAG 1.4.8 (AAA) 1.5; typographic practice 1.4-1.6', fix: 'set line-height to at least the contract minimum for multi-line text' },
  'line-length': { tier: 'practice', ref: 'WCAG 1.4.8 (AAA) max 80 characters; practice 45-75', fix: 'cap the text width (e.g. max-width: 65ch)' },
  'font-size-sprawl': { tier: 'practice', ref: 'a type scale has 6-8 steps', fix: 'map the sizes onto the type scale tokens' },
  'input-font-zoom': { tier: 'practice', ref: 'iOS Safari zooms on focus below 16px', fix: 'use 16px (or larger) text in inputs on mobile' },
  'font-family': { tier: 'system', ref: 'design contract: fonts', fix: 'use one of the contract fonts (the font token)' },
  'raw-color-literal': { tier: 'system', ref: 'design contract: colors', fix: 'replace the literal with a colour token' },
  'button-height': { tier: 'system', ref: 'design contract: buttons.heights', fix: 'use a button size from the design system' },
  'button-font-size': { tier: 'system', ref: 'design contract: buttons.small-max-font', fix: 'use the small button text size' },
  'radius-scale': { tier: 'system', ref: 'design contract: radius', fix: 'use a radius token' },
  'type-scale': { tier: 'system', ref: 'design contract: type.scale', fix: 'use the nearest size from the type scale' },
  'spacing-grid': { tier: 'system', ref: 'design contract: spacing', fix: 'use spacing tokens on the grid' },
};
// When a rule applies under a contract: universal rules always, the others only when the contract gives their value.
const APPLIES = {
  'target-size': (c) => c.targets != null, 'text-too-small': (c) => c.type.min != null, 'body-text-small': (c) => c.type.bodyMin != null,
  'line-height-tight': (c) => c.type.lineHeightMin != null, 'line-length': (c) => c.type.maxLineChars != null, 'font-size-sprawl': (c) => c.type.maxSizes != null,
  'input-font-zoom': (c) => c.inputZoom, 'font-family': (c) => !!c.fonts, 'raw-color-literal': (c) => !!c.colors, 'button-height': (c) => !!c.buttons.heights,
  'button-font-size': (c) => c.buttons.smallMaxHeight != null && c.buttons.smallMaxFont != null, 'radius-scale': (c) => !!c.radii,
  'type-scale': (c) => !!c.type.scale, 'spacing-grid': (c) => c.spacing != null,
};
// Every rule and whether this contract turns it on (for `mole design show` and the plugin).
export const activeRules = (c) => Object.keys(RULES).map((rule) => {
  const on = (APPLIES[rule] ? APPLIES[rule](c) : true) && c.rules[rule] !== 'off';
  return { rule, on, ...ruleMeta(rule, c), severity: c.rules[rule] && c.rules[rule] !== 'off' ? c.rules[rule] : null };
});
export const ruleMeta = (rule, c) => { const m = RULES[rule]; return typeof m === 'function' ? m(c) : m || { tier: 'practice', ref: '', fix: '' }; };

const round = (n) => Math.round(n * 100) / 100;
const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const circleTouches = (cx, cy, rad, q) => {
  const dx = Math.max(q.x - cx, 0, cx - (q.x + q.w)), dy = Math.max(q.y - cy, 0, cy - (q.y + q.h));
  return dx * dx + dy * dy < rad * rad;
};

// contract: a resolved design contract, or (legacy callers: benchmark, smoke) Mole's tokens.json, which means
// exactly the original design-system rules and none of the best-practice pack.
export function runRules(elements, contract, { mode = 'light' } = {}) {
  const c = contract.netos ? contractFromTokens(contract) : contract;
  const allowedColors = c.colors ? new Set(c.colors.map(hexKey)) : null;
  const suffix = mode === 'light' ? '' : `@${mode}`;
  const seen = new Set();
  const out = [];
  const add = (el, rule, severity, detail) => {
    const sev = c.rules[rule] || severity;
    if (sev === 'off') return;
    const key = `${el.id || el.label}|${rule}${suffix}`;
    if (seen.has(key)) return;
    if (exemptReason(rule, el)) return; // structural exemptions are decided here, never by a model
    seen.add(key);
    const { tier, ref, fix } = ruleMeta(rule, c);
    out.push({ key, rule, severity: sev, tier, ref, fix, element: el.label, text: el.text, mode, detail, rect: el.rect,
      ...(el.hint ? { hint: { ...el.hint, id: el.id, tag: el.tag, context: el.ancestors } } : {}),
      ctx: { tag: el.tag, role: el.role, disabled: el.disabled, ariaHidden: el.ariaHidden, srOnly: el.srOnly, describedBy: el.describedBy, ancestors: el.ancestors, fontSize: el.fontSize, fontFamily: el.fontFamily.split(',')[0].replace(/['"]/g, '').trim() } });
  };
  // Target facts (hitRect...) only exist in fact lists from the current collector; without them the rule does not apply.
  const targets = c.targets ? elements.filter((e) => e.isTarget && e.hitRect) : [];
  const undersized = (e) => e.hitRect.w < c.targets - 0.5 || e.hitRect.h < c.targets - 0.5;
  const small = targets.filter((e) => !e.inlineInText && undersized(e));

  for (const el of elements) {
    // 1. Off-palette color literals in inline styles. On-palette values are skipped on purpose: they may come from
    //    useTheme().primaryHex (allowed by the design system); telling those apart from a hand-typed hex needs a source scan.
    if (allowedColors && el.inlineStyle && COLOR_PROP.test(el.inlineStyle)) {
      const bad = colorLiterals(el.inlineStyle).find((k) => !allowedColors.has(k));
      if (bad) add(el, 'raw-color-literal', 'high', `inline style uses a color outside the design system (${bad}): ${el.inlineStyle.slice(0, 50)}`);
    }

    // 2. Font family
    if (c.fonts && el.hasText) {
      const first = el.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (!c.fonts.some((f) => f.toLowerCase() === first.toLowerCase())) {
        add(el, 'font-family', 'medium', `font is "${first}", allowed: ${c.fonts.join(', ')}`);
      }
    }

    // 3. Button contracts
    if (el.isButton) {
      const hasVisibleText = !!el.buttonName && el.hasText;
      const heights = c.buttons.heights;
      if (heights && hasVisibleText && !heights.some((h) => Math.abs(h - el.rect.h) <= 0.6)) {
        add(el, 'button-height', 'medium', `height ${el.rect.h}px, allowed: ${heights.join(', ')}`);
      }
      if (c.buttons.smallMaxHeight != null && c.buttons.smallMaxFont != null && el.rect.h <= c.buttons.smallMaxHeight && el.fontSize > c.buttons.smallMaxFont) {
        add(el, 'button-font-size', 'medium', `${el.fontSize}px text in a ${el.rect.h}px button`);
      }
      if (!el.buttonName) add(el, 'button-unnamed', 'high', 'icon-only button has no aria-label or title');
      if (el.lines > 1) add(el, 'button-text-wrap', 'medium', `button text wraps onto ${el.lines} lines`);
    }

    // 4. Every form control needs a label
    if (el.isControl && !el.hasLabel) add(el, 'control-unlabeled', 'high', 'form control has no label or aria-label');

    // 5. Radius scale
    if (c.radii && el.radii.some((r) => r != null && r > 0 && r < 999 && !c.radii.includes(r))) {
      const bad = el.radii.find((r) => r != null && r > 0 && r < 999 && !c.radii.includes(r));
      add(el, 'radius-scale', 'low', `radius ${bad}px is not on the scale (${c.radii.join(', ')})`);
    }

    // 6. Text overflow / truncation
    if (el.hasText && el.display !== 'inline' && el.clientW > 0 && el.scrollW > el.clientW + 1) {
      if (el.overflowX === 'visible') add(el, 'text-overflow', 'high', `text spills out of its box (${el.scrollW}px in ${el.clientW}px)`);
      else if (el.textOverflow === 'ellipsis' && !el.hasTitle) add(el, 'text-truncated-no-title', 'low', 'truncated text has no title attribute');
    }

    // 7. Contrast (WCAG AA)
    if (el.hasText && el.color && el.bg && !el.disabled) { // WCAG 1.4.3: inactive (disabled) components are exempt
      const fg = el.color[3] < 1 ? overC(el.color, el.bg) : el.color;
      const ratio = contrastRatio(fg, el.bg);
      const large = el.fontSize >= 24 || (el.fontSize >= 18.66 && el.fontWeight >= 700);
      const need = large ? c.contrast.large : c.contrast.normal;
      if (ratio < need) add(el, 'contrast', 'medium', `contrast ${ratio.toFixed(2)}:1, needs ${need}:1 (${mode} mode)`);
    }

    // 8. Target size. Desktop keeps WCAG 2.5.8's spacing exception: an undersized target passes when a circle of the
    //    minimum diameter on its centre touches no other target and no other undersized target's circle.
    //    Mobile follows the HIG: the hit area itself must be big enough.
    if (small.includes(el)) {
      const h = el.hitRect, cx = h.x + h.w / 2, cy = h.y + h.h / 2;
      const others = targets.filter((o) => o !== el && !contains(o.hitRect, h) && !contains(h, o.hitRect)); // nested targets are one target
      const crowded = c.platform === 'mobile'
        || others.some((o) => circleTouches(cx, cy, c.targets / 2, o.hitRect))
        || small.some((o) => o !== el && others.includes(o) && Math.hypot(o.hitRect.x + o.hitRect.w / 2 - cx, o.hitRect.y + o.hitRect.h / 2 - cy) < c.targets);
      if (crowded) add(el, 'target-size', 'medium', `hit area ${h.w}x${h.h}px, needs ${c.targets}x${c.targets}px${c.platform === 'mobile' ? ' on mobile' : ' (or space around it)'}`);
    }

    // 9. Typography
    if (el.hasText && !el.srOnly && c.type.min != null && el.fontSize < c.type.min - 0.01) {
      add(el, 'text-too-small', 'medium', `${round(el.fontSize)}px text, smallest allowed is ${c.type.min}px`);
    } else if (el.isBody && c.type.bodyMin != null && el.fontSize < c.type.bodyMin - 0.01) {
      add(el, 'body-text-small', 'low', `${round(el.fontSize)}px running text, body text needs ${c.type.bodyMin}px on ${c.platform}`);
    }
    if (el.isBody && el.blockLines >= 2 && el.lineHeight && c.type.lineHeightMin != null && el.lineHeight / el.fontSize < c.type.lineHeightMin - 0.01) {
      add(el, 'line-height-tight', 'low', `line height ${round(el.lineHeight / el.fontSize)}x the font size over ${el.blockLines} lines, needs ${c.type.lineHeightMin}x`);
    }
    if (el.isBody && el.blockLines >= 3 && c.type.maxLineChars != null && el.textLen / el.blockLines > c.type.maxLineChars) {
      add(el, 'line-length', 'low', `about ${Math.round(el.textLen / el.blockLines)} characters per line, max ${c.type.maxLineChars}`);
    }
    if (c.type.scale && el.hasText && !el.srOnly && !c.type.scale.some((z) => Math.abs(z - el.fontSize) <= 0.5)) {
      add(el, 'type-scale', 'low', `${round(el.fontSize)}px is not on the type scale (${c.type.scale.join(', ')})`);
    }
    if (c.inputZoom && el.inputType && !['checkbox', 'radio', 'range', 'color', 'file'].includes(el.inputType) && el.fontSize < 16) {
      add(el, 'input-font-zoom', 'medium', `${round(el.fontSize)}px text in a ${el.inputType} input: iOS zooms the page on focus below 16px`);
    }

    // 10. Spacing grid (only when the contract names one)
    if (c.spacing && el.spacing) {
      const off = el.spacing.filter((v) => v > 1 && Math.abs(v / c.spacing - Math.round(v / c.spacing)) > 0.01);
      if (off.length) add(el, 'spacing-grid', 'low', `padding/gap ${[...new Set(off.map(round))].join(', ')}px is off the ${c.spacing}px grid`);
    }
  }

  // 11. Page level: too many distinct text sizes means sizes are picked by hand, not from a scale.
  if (c.type.maxSizes != null) {
    const sizes = [...new Set(elements.filter((e) => e.hasText && !e.srOnly).map((e) => Math.round(e.fontSize * 2) / 2))].sort((a, b) => a - b);
    const body = elements.find((e) => e.tag === 'body') || { label: 'body', id: null, tag: 'body', text: '', rect: { x: 0, y: 0, w: 0, h: 0 }, fontFamily: '' };
    if (sizes.length > c.type.maxSizes) add(body, 'font-size-sprawl', 'low', `${sizes.length} distinct text sizes (${sizes.join(', ')}), max ${c.type.maxSizes}`);
  }
  return out;
}

function overC(top, bot) {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i] * a + bot[i] * (1 - a)));
}
