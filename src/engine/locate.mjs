// Where in the source was this element written? Two layers, most certain first:
//   1. exact: what a dev build already put on the DOM node (React _debugSource, Vue __file, Svelte meta,
//      inspector-plugin attributes, data-mole-src), resolved to a real file under the project root;
//   2. search: the element's id, aria-label, name, placeholder, own text (and the i18n key that holds it),
//      class combination and component name, looked up in the project's source and scored.
// It reports how sure it is and why, lists alternatives when two places look alike, and says nothing rather than guess.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODE = /\.(jsx?|tsx?|mjs|cjs|vue|svelte|astro|html?|hbs|handlebars|ejs|erb|php|cshtml|razor|twig|liquid)$/i;
const DATA = /\.(json|ya?ml)$/i; // locale files: text lives here, the code refers to its key
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'runs', 'evidence', 'review', '.next', '.nuxt', '.svelte-kit', '.output',
  '.turbo', '.cache', '.vite', 'vendor', 'storybook-static', 'target', '.venv', '__pycache__', '.idea', '.vscode']);
const SKIP_FILES = /(\.min\.|\.map$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|\.d\.ts$)/i;
const LOW_VALUE = /(^|\/)(__tests__|tests?|spec|e2e|stories|__mocks__|fixtures?|mocks?)(\/|$)|\.(test|spec|stories)\.[a-z]+$/i;
const STALE = /(^|\/)[^/]*\b(legacy|deprecated|archived?|backup|old)\b[^/]*(\/|$)/i; // code kept around but not shipped
const NEAR = 6; // lines: evidence this close belongs to the same element
const NEIGHBOUR = 0.6; // evidence a few lines away counts, but less than evidence on the line itself

// JSON with comments and trailing commas (tsconfig). String-aware: "@/*" and "**/*.ts" are not comments.
export function parseJsonc(text) {
  let out = '', i = 0, str = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (str) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = text.indexOf('*/', i + 2); i = i < 0 ? text.length : i + 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// tsconfig.json / jsconfig.json, or null.
function readTsconfig(root) {
  for (const f of ['tsconfig.json', 'jsconfig.json']) {
    try { return parseJsonc(fs.readFileSync(path.join(root, f), 'utf8')); } catch { /* next */ }
  }
  return null;
}

// Folders the project itself says are not part of the build: tsconfig/jsconfig "exclude" (plain names, not globs).
function projectExcludes(root, ts) {
  return new Set((ts?.exclude || []).filter((e) => typeof e === 'string' && !/[*?]/.test(e)).map((e) => path.resolve(root, e)));
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// Next.js App Router: the files that render this URL (its page and every layout above it), or null for other apps.
// /en -> app/layout.tsx, app/[locale]/layout.tsx, app/[locale]/page.tsx. Route groups (x) are transparent.
export function nextRouteFiles(root, url) {
  let pathname;
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null; pathname = u.pathname; } catch { return null; }
  const segs = pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const pick = (dir, re) => { try { const n = fs.readdirSync(dir).find((x) => re.test(x)); return n ? path.join(dir, n) : null; } catch { return null; } };
  const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  const walk = (dir, rest, trail) => {
    const layout = pick(dir, /^(layout|template)\.[jt]sx?$/);
    const t = layout ? [...trail, layout] : trail;
    if (!rest.length) { const page = pick(dir, /^page\.[jt]sx?$/); if (page) return [...t, page]; }
    const subs = subdirs(dir);
    const tries = [
      ...subs.filter((d) => rest.length && d === rest[0]).map((d) => [d, rest.slice(1)]),
      ...subs.filter((d) => /^\(.+\)$/.test(d)).map((d) => [d, rest]),
      ...subs.filter((d) => rest.length && /^\[[^.\]]+\]$/.test(d)).map((d) => [d, rest.slice(1)]),
      ...subs.filter((d) => /^\[\[?\.\.\./.test(d) && (rest.length || d.startsWith('[['))).map((d) => [d, []]),
    ];
    for (const [d, r] of tries) { const found = walk(path.join(dir, d), r, t); if (found) return found; }
    return null;
  };
  for (const app of ['app', 'src/app'].map((d) => path.join(root, d)).filter(isDir)) { const f = walk(app, segs, []); if (f) return f; }
  return null;
}

// Every project file reachable by imports from `entries` (relative paths and tsconfig "paths" aliases such as @/*).
export function reachableFiles(root, entries, ts = readTsconfig(root), max = 3000) {
  const base = path.resolve(root, ts?.compilerOptions?.baseUrl || '.');
  const aliases = Object.entries(ts?.compilerOptions?.paths || {}).map(([k, v]) => [k.replace(/\*$/, ''), (Array.isArray(v) ? v : [v]).map((t) => path.resolve(base, String(t).replace(/\*$/, '')))]);
  const EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.vue', '.svelte', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
  const resolve = (from, spec) => {
    const bases = spec.startsWith('.') ? [path.resolve(path.dirname(from), spec)] : aliases.filter(([p]) => p && spec.startsWith(p)).flatMap(([p, ts2]) => ts2.map((t) => path.join(t, spec.slice(p.length))));
    for (const b of bases) for (const e of EXTS) if (isFile(b + e)) return b + e;
    return null;
  };
  const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const seen = new Set(), queue = entries.filter(isFile);
  while (queue.length && seen.size < max) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    let text = '';
    try { text = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); } catch { continue; } // commented-out imports render nothing
    for (const m of text.matchAll(IMPORT)) {
      const r = resolve(f, m[1] || m[2] || m[3] || m[4]);
      if (r && !r.includes(`${path.sep}node_modules${path.sep}`) && !seen.has(r)) queue.push(r);
    }
  }
  return seen;
}
const SUPPORT = new Set(['class', 'context', 'component']); // evidence that backs up a location but never names one on its own

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const Q = '["\'`]';
const norm = (s) => s.replace(/\s+/g, ' ');

// url: the page under test. For a Next.js app the files that render it are known, and candidates in them win.
export function createLocator({ root = process.cwd(), url = null, maxFiles = 8000, maxBytes = 512 * 1024, budgetMs = 4000 } = {}) {
  root = path.resolve(root);
  const notes = [];
  let files = null; // [{ rel, lines, text, data }]
  const cache = new Map();
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const ts = readTsconfig(root);
  let onPage; // Set of rel paths rendered by this URL, null when unknown (computed once, lazily)
  const pageFiles = () => {
    if (onPage !== undefined) return onPage;
    onPage = null;
    const entries = url ? nextRouteFiles(root, url) : null;
    if (entries) {
      onPage = new Set([...reachableFiles(root, entries, ts)].map(rel));
      notes.push(`page-aware locations: ${onPage.size} files render ${new URL(url).pathname} (from ${rel(entries.at(-1))})`);
    }
    return onPage;
  };

  function index() {
    if (files) return files;
    files = [];
    if (root === path.parse(root).root || root === os.homedir()) { notes.push(`source search skipped: ${root} is not a project folder (pass root / --src)`); return files; }
    const t0 = Date.now(), stack = [root];
    const excluded = projectExcludes(root, ts);
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (excluded.has(abs)) continue;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(abs); continue; }
        if (!(CODE.test(e.name) || DATA.test(e.name)) || SKIP_FILES.test(e.name)) continue;
        if (files.length >= maxFiles || Date.now() - t0 > budgetMs) { notes.push(`source search stopped after ${files.length} files (limit); results may be incomplete`); return files; }
        try {
          if (fs.statSync(abs).size > maxBytes) continue;
          const text = fs.readFileSync(abs, 'utf8');
          files.push({ rel: rel(abs), text, lines: text.split(/\r?\n/), data: DATA.test(e.name) });
        } catch { /* unreadable: skip */ }
      }
    }
    return files;
  }

  // A path a dev build reported (absolute, /src/... from the dev server, webpack://, /@fs/...) -> a file under root.
  function resolveReported(file) {
    if (!file) return null;
    const f = String(file).replace(/[?#].*$/, '').replace(/^webpack(-internal)?:\/\/\/?(\.\/)?/, '').replace(/^\/@fs\//, '/').replace(/^file:\/\//, '');
    for (const c of [f, path.join(root, f), path.join(root, f.replace(/^\/+/, ''))]) {
      try { if (path.isAbsolute(c) && fs.statSync(c).isFile()) return c.startsWith(root + path.sep) ? rel(c) : c.split(path.sep).join('/'); } catch { /* next */ }
    }
    return null;
  }

  function search(h) {
    const hits = []; // { file, line, kind, w }
    const scan = (needle, re, kind, w, only = 'code') => {
      if (!needle) return;
      for (const f of index()) {
        if ((only === 'code' && f.data) || (only === 'data' && !f.data) || !f.text.includes(needle)) continue;
        f.lines.forEach((l, i) => { const m = re(l); if (m) hits.push({ file: f, line: i + 1, kind, w: typeof m === 'number' ? m : w }); }); // a number is this line's own weight
      }
    };
    const attr = (name, v) => new RegExp(`\\b${name}\\s*[=:]\\s*\\{?\\s*${Q}${esc(v)}${Q}`);
    if (h.id) { const re = attr('id', h.id); scan(h.id, (l) => re.test(l), 'id', 10); }
    if (h.ariaLabel) { const re = new RegExp(`aria-?label\\s*[=:]\\s*\\{?\\s*${Q}${esc(h.ariaLabel)}${Q}`, 'i'); scan(h.ariaLabel, (l) => re.test(l), 'aria-label', 8); }
    if (h.name && ['input', 'select', 'textarea'].includes(h.tag)) { const re = attr('name', h.name); scan(h.name, (l) => re.test(l), 'name', 5); }
    if (h.placeholder) { const re = attr('placeholder', h.placeholder); scan(h.placeholder, (l) => re.test(l), 'placeholder', 5); }
    const text = (h.ownText || '').slice(0, 60);
    if (text.length >= 3) {
      scan(text.split(' ')[0], (l) => norm(l).includes(text), 'text', text.length >= 12 ? 6 : 3);
      // i18n: the text sits in a locale file under a key; the component refers to the key.
      const keyRe = new RegExp(`${Q}?([\\w.-]+)${Q}?\\s*:\\s*${Q}${esc(text)}${Q}`);
      const keys = new Set();
      scan(text.split(' ')[0], (l) => { const m = l.match(keyRe); if (m) keys.add(m[1].split('.').pop()); return false; }, 'i18n', 0, 'data');
      for (const k of [...keys].slice(0, 3)) { const re = new RegExp(`[${'"\'`'}.]${esc(k)}${Q}`); scan(k, (l) => re.test(l), 'i18n key', 5); }
    }
    const cls = (h.classes || []).filter((c) => c.length > 1 && !/^(css|sc|jsx|svelte|emotion)-[\w-]{5,}$/.test(c)); // hashed class names say nothing
    if (cls.length >= 2) {
      const res = cls.map((c) => new RegExp(`(^|[\\s"'\`{])${esc(c)}(?=[\\s"'\`}]|$)`));
      const need = Math.min(cls.length, 3);
      // Worth more the more of the element's classes the line has: all six beats three shared utility classes.
      const needle = [...cls].sort((a, b) => b.length - a.length)[0];
      scan(needle, (l) => { const n = res.filter((re) => re.test(l)).length; return n >= need ? Math.round((2 + 5 * (n / cls.length)) * 10) / 10 : 0; }, 'classes', 0);
    }
    const token = (t) => new RegExp(`(^|[\\s"'\`{])${esc(t)}(?=[\\s"'\`}]|$)`);
    // One specific-looking class (login-forgot, field_input) supports a location; utility classes (flex, p-4) say nothing.
    for (const c of cls.filter((x) => x.length >= 8 && /^[a-z]\w*[-_][\w-]{3,}$/i.test(x)).slice(0, 2)) { const re = token(c); scan(c, (l) => re.test(l), 'class', 3); }
    // The element's surroundings (ancestor ids / first classes, e.g. header.app-header) tell two identical buttons apart.
    for (const a of (h.context || []).slice(0, 3)) {
      const tok = a.match(/[.#]([\w-]{4,})/)?.[1];
      if (tok) { const re = token(tok); scan(tok, (l) => re.test(l), 'context', 3); }
    }
    const comp = h.src?.component;
    if (comp && /^[A-Z][\w$]*$/.test(comp)) { const re = new RegExp(`(function|class)\\s+${esc(comp)}\\b|(const|let|var)\\s+${esc(comp)}\\s*[:=]`); scan(comp, (l) => re.test(l), 'component', 3); }
    return hits;
  }

  function score(hits, comp) {
    const byFile = new Map();
    for (const x of hits) (byFile.get(x.file) || byFile.set(x.file, []).get(x.file)).push(x);
    const cands = [];
    for (const [f, hs] of byFile) {
      const compFile = comp && path.basename(f.rel).replace(/\.[^.]+$/, '') === comp ? 3 : 0;
      const page = pageFiles();
      const onThisPage = page ? (page.has(f.rel) ? 3 : -3) : 0; // Next.js: rendered by this URL or not
      const penalty = (LOW_VALUE.test(f.rel) ? 3 : 0) + (STALE.test(f.rel) ? 4 : 0) - onThisPage;
      let best = null;
      for (const a of hs.filter((x) => !SUPPORT.has(x.kind))) {
        const kinds = new Map();
        for (const x of hs) {
          if (Math.abs(x.line - a.line) > NEAR) continue;
          const w = x.line === a.line || x.kind === 'context' ? x.w : x.w * NEIGHBOUR; // an ancestor is expected a few lines up
          kinds.set(x.kind, Math.max(kinds.get(x.kind) || 0, w));
        }
        const s = Math.round(([...kinds.values()].reduce((p, v) => p + v, 0) + compFile - penalty) * 10) / 10;
        if (!best || s > best.score || (s === best.score && a.w > best.anchorW)) best = { file: f.rel, line: a.line, score: s, anchorW: a.w, why: [...kinds.keys()] };
      }
      if (best) cands.push(best);
    }
    return cands.sort((a, b) => b.score - a.score);
  }

  // hint: { id, tag, classes, ownText, ariaLabel, name, placeholder, src } from collect(). Returns null or
  // { file, line, column?, confidence: exact|high|medium|low, via, why?, alternatives? }.
  function locate(hint) {
    if (!hint) return null;
    const key = JSON.stringify(hint);
    if (cache.has(key)) return cache.get(key);
    let out = null;
    const src = hint.src;
    const reported = src?.file ? resolveReported(src.file) : null;
    if (reported && src.line) out = { file: reported, line: src.line, column: src.column ?? null, confidence: 'exact', via: src.via };
    else {
      const cands = score(search(hint), src?.component);
      const [best, second] = cands;
      if (best && best.score >= 5) {
        const close = second && second.score >= best.score * 0.8;
        // high: strong evidence and nothing else close. medium: decent evidence, or the only place it can be. low: weak and ambiguous.
        const confidence = close ? (best.score >= 10 ? 'medium' : 'low') : best.score >= 10 ? 'high' : best.score >= 6 || cands.length === 1 ? 'medium' : 'low';
        out = { file: best.file, line: best.line, confidence, via: 'search', why: best.why };
        if (close) out.alternatives = cands.slice(1, 4).filter((c) => c.score >= best.score * 0.8).map((c) => `${c.file}:${c.line}`);
      } else if (reported) out = { file: reported, line: null, confidence: 'medium', via: src.via, why: ['component file'] }; // Vue: file known, line not
    }
    if (out && src?.component) out.component = src.component;
    cache.set(key, out);
    return out;
  }

  // The explorer measures many pages with one source index: switching pages only resets what is page-aware.
  function setPage(u) { url = u; onPage = undefined; cache.clear(); }

  return { locate, notes, root, setPage };
}

export const whereText = (w) => (w ? `${w.file}${w.line ? `:${w.line}` : ''}` : null);

// The project a design file (or any folder) belongs to: the nearest folder up with a package.json or .git.
export function projectRoot(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json')) || fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return path.resolve(dir);
  }
}
