// Writes runs/scorecard.html: the judge scorecard as ONE self-contained file (data embedded), safe to email or attach.
import fs from 'node:fs';
import path from 'node:path';
import { collect } from '../src/scorecard-data.mjs';

const root = path.resolve(import.meta.dirname, '..');
const data = collect(root);
const page = fs.readFileSync(path.join(import.meta.dirname, 'scorecard.html'), 'utf8');
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const out = path.join(root, 'runs', 'scorecard.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page.replace('<script>', `<script>window.__DATA__=${json};</script>\n<script>`));
console.log(`Scorecard written: ${out}`);
