// The design contract: what "correct" means for the page under test. Resolved from, in order,
//   built-in packs (config/packs/*.md, e.g. modern-web)  ->  a tokens file  ->  the project's own design.md.
// A design.md is ordinary markdown with one ```mole block holding the checkable facts (a small YAML subset);
// the prose around it is kept for people (and, later, for a model's taste pass) but never drives a rule.
// Resolution is deterministic and hashed, so every report says exactly which contract produced it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P } from '../core/paths.mjs';
import { parseYaml } from '../core/yaml.mjs';

export const PLATFORMS = ['desktop', 'mobile'];
export const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const DESIGN_FILES = ['DESIGN.md', 'design.md', '.mole/design.md', 'docs/DESIGN.md', 'docs/design.md'];
const DEFAULT_EXTENDS = ['modern-web']; // used only when no design.md is found; the report says so. NetOS apps say `extends: netos`

export class ContractError extends Error {}

// ---- reading ----------------------------------------------------------------------------------------------------

export function parseDesignMd(text, file = 'design.md') {
  const blocks = [...text.matchAll(/^```mole[^\n]*\n([\s\S]*?)^```/gm)];
  if (blocks.length > 1) throw new ContractError(`${file}: more than one \`\`\`mole block; keep one`);
  let raw = {};
  if (blocks.length) {
    try { raw = parseYaml(blocks[0][1]) || {}; } catch (e) { throw new ContractError(`${file}: ${e.message} (inside the \`\`\`mole block)`); }
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new ContractError(`${file}: the \`\`\`mole block must be a map of keys`);
  }
  const prose = (blocks.length ? text.replace(blocks[0][0], '') : text).trim();
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file);
  return { raw, prose, title, hasBlock: blocks.length > 0 };
}

export function findDesignFile(cwd = process.cwd()) {
  if (process.env.MOLE_DESIGN) return path.resolve(cwd, process.env.MOLE_DESIGN);
  for (const f of DESIGN_FILES) { const p = path.join(cwd, f); if (fs.existsSync(p)) return p; }
  return null;
}

// Mole's tokens.json (generated from the design-system repo) as a contract fragment.
export function fromTokens(tokens) {
  const n = tokens.netos || {};
  return {
    fonts: n.allowedFonts, colors: n.allowedHex,
    buttons: { heights: n.buttonHeightsPx, 'small-max-height': n.smallButtonMaxHeightPx, 'small-max-font': n.smallButtonMaxFontPx },
    radius: n.radiiPx, contrast: n.contrast,
  };
}

// ---- merging and normalising -------------------------------------------------------------------------------------

const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isMap(v) && isMap(out[k]) ? merge(out[k], v) : v;
  return out;
}
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/_/g, '-');
function kebabKeys(v) {
  if (Array.isArray(v)) return v.map(kebabKeys);
  if (!isMap(v)) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k === 'rules' ? k : kebab(k), k === 'rules' ? x : kebabKeys(x)]));
}

// A value may be one number for every platform or { desktop, mobile }.
const pick = (v, platform) => (isMap(v) ? (v[platform] ?? null) : v ?? null);
const nums = (v, what) => {
  if (v == null) return null;
  const a = Array.isArray(v) ? v : [v];
  if (!a.every((x) => Number.isFinite(Number(x)))) throw new ContractError(`${what} must be numbers, got ${JSON.stringify(v)}`);
  return a.map(Number);
};
const num = (v, what) => { if (v == null) return null; if (!Number.isFinite(Number(v))) throw new ContractError(`${what} must be a number, got ${JSON.stringify(v)}`); return Number(v); };
const hexes = (v) => {
  if (v == null) return null;
  const list = isMap(v) ? Object.values(v).flatMap((x) => (isMap(x) ? Object.values(x) : x)) : v;
  const out = (Array.isArray(list) ? list : [list]).map(String);
  const bad = out.filter((h) => !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h));
  if (bad.length) throw new ContractError(`colors must be #rgb or #rrggbb hex values, got ${bad.slice(0, 3).join(', ')}`);
  return out;
};
const SEVERITIES = ['off', 'low', 'medium', 'high'];

// CSS-ish ignore patterns: ".ant-*" or plain "ant-*" (class prefix) is expanded; anything else must be a valid selector
// (checked in the page).
const classPrefix = (p) => `[class^="${p}"],[class*=" ${p}"]`;
export const toSelector = (s) => {
  const v = String(s).trim();
  if (/^[A-Za-z_][\w-]*\*$/.test(v)) return classPrefix(v.slice(0, -1));
  return v.replace(/\.([A-Za-z0-9_-]+)\*/g, (_, p) => classPrefix(p));
};

export function normalize(raw, { platform = 'desktop', name = 'contract', sources = [], prose = '', notes = [] } = {}) {
  const r = kebabKeys(raw);
  if (!PLATFORMS.includes(platform)) throw new ContractError(`platform must be one of ${PLATFORMS.join(', ')}, got "${platform}"`);
  const type = r.type || {}, buttons = r.buttons || {}, contrast = r.contrast || {};
  const rules = {};
  for (const [k, v] of Object.entries(r.rules || {})) {
    const s = String(v).toLowerCase();
    if (!SEVERITIES.includes(s)) throw new ContractError(`rules.${k} must be one of ${SEVERITIES.join(', ')}, got "${v}"`);
    rules[k] = s;
  }
  const c = {
    name, platform, sources, notes, prose,
    fonts: r.fonts == null ? null : (Array.isArray(r.fonts) ? r.fonts : [r.fonts]).map(String),
    colors: hexes(r.colors),
    buttons: { heights: nums(buttons.heights, 'buttons.heights'), smallMaxHeight: num(buttons['small-max-height'], 'buttons.small-max-height'), smallMaxFont: num(buttons['small-max-font'], 'buttons.small-max-font') },
    radii: nums(r.radius, 'radius'),
    contrast: { normal: num(contrast.normal, 'contrast.normal') ?? 4.5, large: num(contrast.large, 'contrast.large') ?? 3 },
    type: {
      scale: nums(pick(type.scale, platform), 'type.scale'),
      min: num(pick(type.min, platform), 'type.min'),
      bodyMin: num(pick(type['body-min'], platform), 'type.body-min'),
      lineHeightMin: num(pick(type['line-height-min'], platform), 'type.line-height-min'),
      maxLineChars: num(pick(type['max-line-chars'], platform), 'type.max-line-chars'),
      maxSizes: num(pick(type['max-sizes'], platform), 'type.max-sizes'),
    },
    targets: num(pick(r.targets, platform), 'targets'),
    spacing: num(pick(r.spacing, platform), 'spacing'),
    inputZoom: platform === 'mobile' && r['input-zoom'] !== false,
    ignore: (r.ignore == null ? [] : Array.isArray(r.ignore) ? r.ignore : [r.ignore]).map(toSelector),
    rules,
  };
  c.hash = crypto.createHash('sha256').update(JSON.stringify({ ...c, prose: undefined, notes: undefined, sources: undefined })).digest('hex').slice(0, 12);
  return c;
}

// ---- resolving ---------------------------------------------------------------------------------------------------

function loadPack(name, seen) {
  if (seen.has(name)) throw new ContractError(`packs extend each other in a loop (${[...seen, name].join(' -> ')})`);
  const file = path.join(P.config, 'packs', `${name}.md`);
  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) {
    const have = fs.readdirSync(path.join(P.config, 'packs')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
    throw new ContractError(`unknown pack "${name}" in extends (built-in packs: ${have.join(', ')})`);
  }
  return layer(parseDesignMd(fs.readFileSync(file, 'utf8'), file), path.dirname(file), new Set([...seen, name]), { kind: 'pack', name, path: file });
}

// One file's contribution: its packs first, then its tokens file, then its own keys.
function layer(doc, dir, seen, source) {
  const r = kebabKeys(doc.raw);
  const ext = r.extends == null ? [] : Array.isArray(r.extends) ? r.extends : [r.extends];
  let raw = {}; const sources = [];
  for (const e of ext) { const p = loadPack(String(e), seen); raw = merge(raw, p.raw); sources.push(...p.sources); }
  if (r.tokens) {
    const f = path.resolve(dir, String(r.tokens));
    if (!fs.existsSync(f)) throw new ContractError(`tokens file not found: ${f}`);
    let t; try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new ContractError(`tokens file ${f} is not valid JSON: ${e.message}`); }
    raw = merge(raw, fromTokens(t));
    sources.push({ kind: 'tokens', name: t.source ? `${t.source.package}@${t.source.version}` : path.basename(f), path: f });
  }
  const { extends: _e, tokens: _t, ...own } = r;
  raw = merge(raw, own);
  sources.push(source);
  return { raw, sources };
}

// design: a path to a design.md, or null to look for one in cwd (then MOLE_DESIGN), else the built-in default.
// platform: desktop | mobile; when not given, the design.md's own `platform:` or desktop.
export function resolveContract({ design = null, platform = null, cwd = process.env.MOLE_PROJECT_DIR || process.cwd() } = {}) {
  const notes = [];
  const file = design ? path.resolve(cwd, design) : findDesignFile(cwd);
  let doc, dir, source;
  if (file) {
    if (!fs.existsSync(file)) throw new ContractError(`design file not found: ${file}`);
    doc = parseDesignMd(fs.readFileSync(file, 'utf8'), file);
    if (!doc.hasBlock) {
      notes.push(`${path.basename(file)} has no \`\`\`mole block, so only the modern-web defaults apply; run /mole:design (or mole design init) to add one`);
      doc.raw = { extends: 'modern-web' };
    }
    dir = path.dirname(file); source = { kind: 'design', name: doc.title, path: file };
  } else {
    notes.push('no DESIGN.md found: checking modern-web best practice only (no brand fonts, colours or sizes). Run /mole:design to check against your own design');
    doc = { raw: { extends: DEFAULT_EXTENDS }, prose: '', title: 'Modern web (built-in default)' };
    dir = P.config; source = { kind: 'default', name: 'built-in default', path: null };
  }
  const { raw, sources } = layer(doc, dir, new Set(), source);
  const plat = platform || kebabKeys(raw).platform || 'desktop';
  return normalize(raw, { platform: Array.isArray(plat) ? plat[0] : plat, name: doc.title, sources, prose: doc.prose, notes });
}

// The contract a legacy caller gets when it passes Mole's tokens.json straight to runRules (benchmark, smoke, tests):
// exactly the original design-system checks, none of the best-practice pack.
export const contractFromTokens = (tokens) => normalize(fromTokens(tokens), { name: tokens.source ? `${tokens.source.package}@${tokens.source.version}` : 'tokens' });

// What a report, the terminal and an MCP client get to know about the contract.
export const contractSummary = (c) => ({
  name: c.name, platform: c.platform, hash: c.hash, notes: c.notes,
  sources: c.sources.map((s) => (s.path ? `${s.kind}: ${s.name} (${path.relative(process.cwd(), s.path) || s.path})` : `${s.kind}: ${s.name}`)),
});
