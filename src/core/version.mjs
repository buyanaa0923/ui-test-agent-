import fs from 'node:fs';
import path from 'node:path';
import { P } from './paths.mjs';

export const version = () => { try { return JSON.parse(fs.readFileSync(path.join(P.root, 'package.json'), 'utf8')).version; } catch { return ''; } };
