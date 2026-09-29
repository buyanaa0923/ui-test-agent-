// Deterministic design checks for pages built on the netOS design system. No model involved.
// collect(page): read facts from the live page. runRules(): turn facts + tokens into violations.
import fs from 'node:fs';
import { exemptReason } from './exemptions.mjs';

export function loadTokens(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export async function collect(page) {
  return page.evaluate(() => {
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
    for (const el of document.querySelectorAll('body, body *')) {
      if (skip.has(el.tagName.toUpperCase())) continue;
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
      out.push({
        label: el.id ? `${tag}#${el.id}` : `${tag}${cls}`,
        id: el.id || null,
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
        radii: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map((k) => (cs[k].includes('%') ? null : px(cs[k])))
      });
      if (out.length >= 4000) break;
    }
    st.remove();
    return out;
  });
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

export function runRules(elements, tokens, { mode = 'light' } = {}) {
  const n = tokens.netos;
  const allowedColors = new Set(n.allowedHex.map(hexKey));
  const suffix = mode === 'light' ? '' : `@${mode}`;
  const seen = new Set();
  const out = [];
  const add = (el, rule, severity, detail) => {
    const key = `${el.id || el.label}|${rule}${suffix}`;
    if (seen.has(key)) return;
    if (exemptReason(rule, el)) return; // structural exemptions are decided here, never by a model
    seen.add(key);
    out.push({ key, rule, severity, element: el.label, text: el.text, mode, detail, rect: el.rect,
      ctx: { tag: el.tag, role: el.role, disabled: el.disabled, ariaHidden: el.ariaHidden, srOnly: el.srOnly, describedBy: el.describedBy, ancestors: el.ancestors, fontSize: el.fontSize, fontFamily: el.fontFamily.split(',')[0].replace(/['"]/g, '').trim() } });
  };

  for (const el of elements) {
    // 1. Off-palette color literals in inline styles. On-palette values are skipped on purpose: they may come from
    //    useTheme().primaryHex (allowed by the design system); telling those apart from a hand-typed hex needs a source scan.
    if (el.inlineStyle && COLOR_PROP.test(el.inlineStyle)) {
      const bad = colorLiterals(el.inlineStyle).find((k) => !allowedColors.has(k));
      if (bad) add(el, 'raw-color-literal', 'high', `inline style uses a color outside the design system (${bad}): ${el.inlineStyle.slice(0, 50)}`);
    }

    // 2. Font family
    if (el.hasText) {
      const first = el.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (!n.allowedFonts.some((f) => f.toLowerCase() === first.toLowerCase())) {
        add(el, 'font-family', 'medium', `font is "${first}", allowed: ${n.allowedFonts.join(', ')}`);
      }
    }

    // 3. Button contracts
    if (el.isButton) {
      const hasVisibleText = !!el.buttonName && el.hasText;
      if (hasVisibleText && !n.buttonHeightsPx.some((h) => Math.abs(h - el.rect.h) <= 0.6)) {
        add(el, 'button-height', 'medium', `height ${el.rect.h}px, allowed: ${n.buttonHeightsPx.join(', ')}`);
      }
      if (el.rect.h <= n.smallButtonMaxHeightPx && el.fontSize > n.smallButtonMaxFontPx) {
        add(el, 'button-font-size', 'medium', `${el.fontSize}px text in a ${el.rect.h}px button`);
      }
      if (!el.buttonName) add(el, 'button-unnamed', 'high', 'icon-only button has no aria-label or title');
      if (el.lines > 1) add(el, 'button-text-wrap', 'medium', `button text wraps onto ${el.lines} lines`);
    }

    // 4. Every form control needs a label
    if (el.isControl && !el.hasLabel) add(el, 'control-unlabeled', 'high', 'form control has no label or aria-label');

    // 5. Radius scale
    if (el.radii.some((r) => r != null && r > 0 && r < 999 && !n.radiiPx.includes(r))) {
      const bad = el.radii.find((r) => r != null && r > 0 && r < 999 && !n.radiiPx.includes(r));
      add(el, 'radius-scale', 'low', `radius ${bad}px is not on the scale (${n.radiiPx.join(', ')})`);
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
      const need = large ? n.contrast.large : n.contrast.normal;
      if (ratio < need) add(el, 'contrast', 'medium', `contrast ${ratio.toFixed(2)}:1, needs ${need}:1 (${mode} mode)`);
    }
  }
  return out;
}

function overC(top, bot) {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i] * a + bot[i] * (1 - a)));
}
