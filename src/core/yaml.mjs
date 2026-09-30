// A small YAML subset, enough for the ```mole block of a design.md, with no dependency:
// nested maps by indentation, block lists (- item), flow lists [a, b], flow maps { a: 1 }, quoted and plain scalars,
// numbers, booleans, null, and # comments. A hex colour (#fff, #008779) is a value, not a comment, so palettes read naturally.
// Anything outside the subset throws with the line number: a design contract must never be half-read silently.

const HEX = /^#[0-9a-f]{3,8}\b/i;

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /[\s[{,]/.test(line[i - 1])) && !HEX.test(line.slice(i))) return line.slice(0, i);
  }
  return line;
}

function scalar(raw) {
  const v = raw.trim();
  if (v === '') return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (/^(null|~)$/i.test(v)) return null;
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no)$/i.test(v)) return false; // "off" stays a string: rules use it as a switch value
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(v)) return Number(v);
  return v;
}

// Split a flow collection body on top-level commas.
function splitFlow(body) {
  const parts = []; let depth = 0, q = null, cur = '';
  for (const c of body) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function value(raw, lineNo) {
  const v = raw.trim();
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`line ${lineNo}: unclosed [`);
    return splitFlow(v.slice(1, -1)).map((p) => value(p, lineNo));
  }
  if (v.startsWith('{')) {
    if (!v.endsWith('}')) throw new Error(`line ${lineNo}: unclosed {`);
    const out = {};
    for (const p of splitFlow(v.slice(1, -1))) {
      const i = p.indexOf(':');
      if (i < 0) throw new Error(`line ${lineNo}: expected key: value inside { }`);
      out[p.slice(0, i).trim().replace(/^["']|["']$/g, '')] = value(p.slice(i + 1), lineNo);
    }
    return out;
  }
  return scalar(v);
}

export function parseYaml(text) {
  const lines = text.split(/\r?\n/).map((l, i) => ({ no: i + 1, raw: stripComment(l).replace(/\s+$/, '') }))
    .filter((l) => l.raw.trim() !== '')
    .map((l) => {
      if (/^\s*\t/.test(l.raw)) throw new Error(`line ${l.no}: use spaces, not tabs, for indentation`);
      return { ...l, indent: l.raw.match(/^ */)[0].length, text: l.raw.trim() };
    });
  let i = 0;

  function block(indent) {
    const first = lines[i];
    if (first.text.startsWith('- ') || first.text === '-') {
      const list = [];
      while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
        const l = lines[i++];
        const rest = l.text.slice(1).trim();
        if (rest === '') list.push(i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : null);
        else list.push(value(rest, l.no));
      }
      return list;
    }
    const map = {};
    while (i < lines.length && lines[i].indent === indent) {
      const l = lines[i++];
      const m = l.text.match(/^("[^"]+"|'[^']+'|[^:]+?)\s*:(\s+(.*)|$)/);
      if (!m) throw new Error(`line ${l.no}: expected "key: value", got "${l.text}"`);
      const key = m[1].replace(/^["']|["']$/g, '');
      const rest = (m[3] || '').trim();
      if (rest !== '') map[key] = value(rest, l.no);
      else if (i < lines.length && lines[i].indent > indent) map[key] = block(lines[i].indent);
      else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) map[key] = block(indent); // list at same indent
      else map[key] = null;
    }
    if (i < lines.length && lines[i].indent > indent) throw new Error(`line ${lines[i].no}: unexpected indentation`);
    return map;
  }

  if (!lines.length) return {};
  const out = block(lines[0].indent);
  if (i < lines.length) throw new Error(`line ${lines[i].no}: unexpected indentation`);
  return out;
}
