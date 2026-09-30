import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mole, fixture, ndjson, tmpDir } from '../helpers/cli.mjs';
import { ROOT } from '../../src/core/paths.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('help, version and usage errors use the documented exit codes', async () => {
  const h = await mole([]);
  assert.equal(h.code, 0);
  for (const c of ['dig', 'tunnel', 'ci', 'replay', 'doctor', 'dashboard']) assert.ok(h.out.includes(c), `help lists ${c}`);
  assert.match(h.out, /0 pass . 1 defects found . 2 not run/);
  assert.equal((await mole(['--version'])).out.trim(), pkg.version);
  assert.equal((await mole(['frobnicate'])).code, 64);
  const noUrl = await mole(['dig']); assert.equal(noUrl.code, 64); assert.match(noUrl.err, /missing <url>/);
  const badFlag = await mole(['dig', 'http://x', '--nope']); assert.equal(badFlag.code, 64); assert.match(badFlag.err, /nope/);
  const dh = await mole(['dig', '--help']); assert.equal(dh.code, 0); assert.match(dh.out, /--no-model/); assert.match(dh.out, /--watch/);
});

test('dig --json: NDJSON on stdout only, ends with run.end, process exit code equals the outcome', async () => {
  const r = await mole(['dig', fixture('sample.html'), '--no-model', '--json']);
  assert.equal(r.code, 1);
  const evts = ndjson(r.out);
  assert.equal(evts[0].type, 'run.start'); assert.equal(evts[0].triage, 'none');
  const end = evts.at(-1); assert.equal(end.type, 'run.end'); assert.equal(end.exitCode, 1); assert.equal(end.status, 'defects');
  assert.ok(end.findings > 0 && end.findings < end.findingsRaw, 'distinct vs raw');
  assert.equal(r.out.split('\n').filter(Boolean).every((l) => l.startsWith('{')), true, 'nothing but JSON on stdout');
});

test('dig on a clean page exits 0 and says SURFACED', async () => {
  const r = await mole(['dig', fixture('clean.html'), '--no-model', '--plain']);
  assert.equal(r.code, 0); assert.match(r.out, /SURFACED/); assert.match(r.out, /exit 0/);
});

test('dig on a dead URL exits 2 with NOT RUN and never claims a pass', async () => {
  const r = await mole(['dig', 'http://127.0.0.1:9/', '--plain']);
  assert.equal(r.code, 2); assert.match(r.out, /NOT RUN/); assert.doesNotMatch(r.out, /SURFACED|CLEAN/);
});

test('tunnel: exit 1 on dead clicks, 0 on a page whose controls work', async () => {
  const bad = await mole(['tunnel', fixture('sample.html'), '--plain', '--max', '4']);
  assert.equal(bad.code, 1); assert.match(bad.out, /no effect/); assert.match(bad.out, /Coverage/);
  const ok = await mole(['tunnel', fixture('clean.html'), '--plain', '--max', '4']);
  assert.equal(ok.code, 0); assert.match(ok.out, /SURFACED/);
});

test('replay plays a recorded run back with the same outcome and no browser', async () => {
  const runs = tmpDir('mole-runs-');
  const live = await mole(['dig', fixture('sample.html'), '--no-model', '--json'], { runs });
  const runDir = path.join(runs, fs.readdirSync(runs)[0]);
  assert.ok(fs.existsSync(path.join(runDir, 'trace.jsonl')));
  const rp = await mole(['replay', runDir, '--speed', '0', '--plain'], { runs });
  assert.equal(rp.code, live.code); assert.match(rp.out, /NUGGETS FOUND/); assert.match(rp.out, /contrast/);
  const latest = await mole(['replay', 'latest', '--speed', '0', '--plain'], { runs });
  assert.equal(latest.code, 1);
  const none = await mole(['replay', 'nope-not-a-run', '--plain'], { runs }); assert.equal(none.code, 2);
});

test('ci: exit 1 with defects, 0 when all clean, 2 when any page is not tested; evidence folder always written', async () => {
  const evid = tmpDir('mole-evid-');
  const defects = await mole(['ci', '--url', fixture('sample.html'), '--url', fixture('clean.html'), '--no-model', '--out', path.join(evid, 'a'), '--json']);
  assert.equal(defects.code, 1);
  const s1 = JSON.parse(fs.readFileSync(path.join(evid, 'a', 'summary.json'), 'utf8'));
  assert.equal(s1.verdict, 'defects'); assert.deepEqual([s1.totals.pages, s1.totals.clean, s1.totals.withDefects, s1.totals.notRun], [2, 1, 1, 0]);
  assert.match(s1.rule, /NOT_RUN is a failure/); assert.ok(s1.tool.rulesHash && s1.tool.designSystem);
  const runFolders = fs.readdirSync(path.join(evid, 'a')).filter((f) => fs.statSync(path.join(evid, 'a', f)).isDirectory());
  assert.ok(runFolders.length >= 2 && fs.existsSync(path.join(evid, 'a', runFolders[0], 'report.json')), 'reports and screenshots are copied into the evidence');

  const clean = await mole(['ci', '--url', fixture('clean.html'), '--no-model', '--out', path.join(evid, 'b'), '--json']);
  assert.equal(clean.code, 0); assert.equal(JSON.parse(fs.readFileSync(path.join(evid, 'b', 'summary.json'), 'utf8')).verdict, 'pass');

  const notRun = await mole(['ci', '--url', fixture('clean.html'), '--url', 'http://127.0.0.1:9/', '--no-model', '--out', path.join(evid, 'c'), '--json']);
  assert.equal(notRun.code, 2, 'one untested page fails the gate even though the other is clean');
  const s3 = JSON.parse(fs.readFileSync(path.join(evid, 'c', 'summary.json'), 'utf8'));
  assert.equal(s3.verdict, 'not_run'); assert.equal(s3.totals.notRun, 1); assert.equal(s3.totals.clean, 1);
});

test('ci reads a URL list file, skips comments and blanks, and refuses to run with no URLs', async () => {
  const dir = tmpDir('mole-list-'); const list = path.join(dir, 'urls.txt');
  fs.writeFileSync(list, `# pilot pages\n${fixture('clean.html')}   # the good one\n\n`);
  const r = await mole(['ci', '--urls', list, '--no-model', '--out', path.join(dir, 'e'), '--json']);
  assert.equal(r.code, 0); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'e', 'summary.json'), 'utf8')).totals.pages, 1);
  assert.equal((await mole(['ci'])).code, 64);
});
