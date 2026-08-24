#!/usr/bin/env node
// 快闸门：只测纯引擎和仓内约束，不碰页面。
//
// 这条闸门绿 **不代表页面能用**。页面那一层由 scripts/gate-browser.mjs 单独一个 job 守，
// 而且它现在有自己的手写判据（scripts/dom-fixtures.mjs），不再拿引擎当 oracle。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { diffLines, summarize, similarity, reconstruct } from '../src/diff.mjs';
import { DOM_FIXTURES, naiveAlignmentMutant } from './dom-fixtures.mjs';

const OUT = process.argv[2] || 'out';
const NL = String.fromCharCode(10);
const WF_DIR = '.github/workflows';
const SCRIPTS_DIR = 'scripts';
const checks = [];
function check(title, ok, detail) {
  checks.push({ title, ok: Boolean(ok), detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + title + ' | ' + detail);
}
const eqSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sha12 = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

// ---- 引擎语义：应用回去必须字节级相等，不是“有输出” ----------------------
const roundTrip = [
  ['identical', 'a' + NL + 'b' + NL + 'c', 'a' + NL + 'b' + NL + 'c'],
  ['insert at top', 'a' + NL + 'b', 'x' + NL + 'a' + NL + 'b'],
  ['delete in middle', 'a' + NL + 'b' + NL + 'c', 'a' + NL + 'c'],
  ['replace one line', 'a' + NL + 'b' + NL + 'c', 'a' + NL + 'B' + NL + 'c'],
  ['empty left', '', 'a' + NL + 'b'],
  ['empty both', '', ''],
  ['reorder', 'a' + NL + 'b' + NL + 'c', 'c' + NL + 'b' + NL + 'a'],
  ['trailing newline', 'a' + NL, 'a'],
  ['cjk lines', '你好' + NL + '世界', '你好' + NL + '中国']
];
for (const [name, L, R] of roundTrip) {
  const rt = reconstruct(diffLines(L, R));
  check('round-trip: ' + name, rt.left === L && rt.right === R, 'apply-back must be byte-exact on both sides');
}
{
  const s = summarize(diffLines('a' + NL + 'b' + NL + 'c', 'x' + NL + 'a' + NL + 'b' + NL + 'c'));
  check(
    'insert one line at top is 1 add + 3 equal',
    s.added === 1 && s.deleted === 0 && s.equal === 3,
    'got add=' + s.added + ' del=' + s.deleted + ' equal=' + s.equal + '; naive line-by-line would report 4 changes'
  );
}

const simCases = [
  ['identical is exactly 1', 'a' + NL + 'b', 'a' + NL + 'b', 1],
  ['all different is exactly 0', 'a' + NL + 'b', 'x' + NL + 'y', 0],
  ['empty vs empty is 1, not 0/0', '', '', 1]
];
for (const [name, L, R, want] of simCases) {
  const got = similarity(diffLines(L, R));
  check('similarity: ' + name, Math.abs(got - want) < 1e-9, 'got ' + got.toFixed(4) + ', want ' + want);
}
{
  const got = similarity(diffLines('a' + NL + 'b' + NL + 'c', 'a' + NL + 'B' + NL + 'c'));
  check('similarity: one replaced line is strictly between 0 and 1', got > 0 && got < 1, 'got ' + got.toFixed(4));
}
{
  const pairs = [
    ['a' + NL + 'b', 'x' + NL + 'a' + NL + 'b'],
    ['a' + NL + 'b' + NL + 'c', 'a' + NL + 'c'],
    ['你好' + NL + '世界', '你好' + NL + '中国']
  ];
  const bad = pairs.filter(([L, R]) => {
    const ops = diffLines(L, R);
    const s = summarize(ops);
    const total = s.equal + s.added + s.deleted;
    return Math.abs(similarity(ops) - (total === 0 ? 1 : s.equal / total)) > 1e-9;
  });
  check('similarity always agrees with the counts beside it', bad.length === 0, bad.length ? bad.length + ' pairs disagree' : pairs.length + ' pairs consistent');
}

// ---- 夹具自己得诚实 -------------------------------------------------------
// 页面闸门拿手写夹具当 oracle，那么夹具写错就是一个错的 oracle，比没有更坏。
// 三条约束：不得引入引擎、必须能拓住逐行对齐变异体、必须跟真引擎一致。
const fixturesSrc = fs.readFileSync(path.join(SCRIPTS_DIR, 'dom-fixtures.mjs'), 'utf8');
check(
  'the DOM fixtures import nothing from src/',
  !/from\s+['"][^'"]*src\//.test(fixturesSrc) && !/require\([^)]*src\//.test(fixturesSrc),
  'a fixture that imports the engine inherits the engine opinion and stops being independent'
);
check(
  'at least one DOM fixture contains CJK',
  DOM_FIXTURES.some(f => f.hasCjk && /[\u3000-\u9fff]/.test(f.expectedRows.map(r => r.text).join(''))),
  'the runner does not necessarily ship those fonts, and tofu is only visible in a real render'
);
check(
  'there are at least three DOM fixtures',
  DOM_FIXTURES.length >= 3,
  DOM_FIXTURES.length + ' fixtures'
);

const nonDiscriminating = DOM_FIXTURES.filter(f => {
  const mutant = naiveAlignmentMutant(f.left, f.right).map(r => ({ type: r.type, text: r.text }));
  return JSON.stringify(mutant) === JSON.stringify(f.expectedRows);
});
check(
  'every DOM fixture disagrees with the naive-alignment mutant',
  nonDiscriminating.length === 0,
  nonDiscriminating.length
    ? 'these cannot catch it, so they are decoration: ' + nonDiscriminating.map(f => f.name).join(', ')
    : 'all ' + DOM_FIXTURES.length + ' would go red if the engine reverted to index alignment'
);

const fixtureDisagreement = DOM_FIXTURES.filter(f => {
  const ops = diffLines(f.left, f.right);
  const got = ops.map(o => ({ type: o.type, text: o.line }));
  const s = summarize(ops);
  return JSON.stringify(got) !== JSON.stringify(f.expectedRows)
    || String(s.equal) !== f.expectedEqual
    || String(s.added) !== f.expectedAdd
    || String(s.deleted) !== f.expectedDel
    || similarity(ops).toFixed(4) !== f.expectedSimilarity;
});
check(
  'every DOM fixture agrees with the real engine',
  fixtureDisagreement.length === 0,
  fixtureDisagreement.length
    ? 'disagreement means either the engine or the hand-written expectation is wrong: ' + fixtureDisagreement.map(f => f.name).join(', ')
    : DOM_FIXTURES.length + ' fixtures agree'
);

// ---- 仓内约束：磁盘集合 == 登记集合 ------------------------------------
const wfFiles = fs.readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f)).sort();
const scriptFiles = fs.readdirSync(SCRIPTS_DIR).filter(f => /\.(mjs|cjs|js)$/.test(f)).sort();
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8')); } catch (e) { manifest = null; }
if (!manifest) {
  check('manifest.json loads', false, 'parse failed');
} else {
  const regScripts = [...(manifest.scripts || [])].sort();
  const extra = scriptFiles.filter(f => !regScripts.includes(f));
  const missing = regScripts.filter(f => !scriptFiles.includes(f));
  const parts = [];
  if (extra.length) parts.push('on disk but unregistered: ' + extra.join(', '));
  if (missing.length) parts.push('registered but absent: ' + missing.join(', '));
  check('scripts/ on disk equals scripts registered in manifest', eqSet(scriptFiles, regScripts), parts.length ? parts.join(' | ') : scriptFiles.length + ' files match exactly');
  const regWf = [...(manifest.workflows || [])].sort();
  const wfExtra = wfFiles.filter(f => !regWf.includes(f));
  const wfMissing = regWf.filter(f => !wfFiles.includes(f));
  const wparts = [];
  if (wfExtra.length) wparts.push('on disk but unregistered: ' + wfExtra.join(', '));
  if (wfMissing.length) wparts.push('registered but absent: ' + wfMissing.join(', '));
  check('workflows/ on disk equals workflows registered in manifest', eqSet(wfFiles, regWf), wparts.length ? wparts.join(' | ') : wfFiles.length + ' files match exactly');
}

const ci = fs.readFileSync(path.join(WF_DIR, 'ci.yml'), 'utf8');

const expectedMarkers = (manifest && manifest.expected_markers) || null;
if (!expectedMarkers || !expectedMarkers.report) {
  check('manifest registers the expected marker hash', false, 'manifest.expected_markers.report is required');
} else {
  const usedMarkers = [...ci.matchAll(/^\s*marker:\s*'([^']*)'/gm)].map(m => m[1]);
  const mismatched = usedMarkers.filter(m => sha12(m) !== expectedMarkers.report);
  check(
    'every marker passed to the shared workflows matches the registered hash',
    usedMarkers.length >= 2 && mismatched.length === 0,
    usedMarkers.length < 2
      ? 'expected the marker at both the report and attest call sites, found ' + usedMarkers.length
      : (mismatched.length
          ? mismatched.map(m => 'length ' + m.length + ' hashes to ' + sha12(m) + ', registered is ' + expectedMarkers.report).join('; ')
          : usedMarkers.length + ' call sites, all hash to ' + expectedMarkers.report)
  );
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pin = (pkg.devDependencies || {}).playwright;
check('playwright pin is an exact version', typeof pin === 'string' && /^\d+\.\d+\.\d+$/.test(pin), 'package.json devDependencies.playwright = ' + JSON.stringify(pin));
check('workflow never installs playwright unpinned', !/npm install[^\n]*--no-save[^\n]*playwright(?![@\w.-])/.test(ci), 'a bare npm install playwright is latest-at-run-time');
check('workflow installs the pin read from package.json', /playwright@\$\{?PIN\}?/.test(ci) || /playwright@"?\$PIN/.test(ci), 'the workflow must read the pin, not carry its own copy');
check('the version literal lives in exactly one file', typeof pin === 'string' && !ci.includes(pin), pin && ci.includes(pin) ? pin + ' is hardcoded in ci.yml too' : 'only package.json carries the number');

check('attest is delegated to the shared reusable workflow', /uses:\s*subinreum\/ci-workflows\/\.github\/workflows\/attest\.yml@/.test(ci), 'the hand-written copy here is what let the freshness assertion go missing');
check('this repo does not re-inline freshness logic', !/checkFreshness/.test(ci) && !fs.readdirSync(SCRIPTS_DIR).some(f => /freshness/i.test(f)), 'second copies grow apart');

const BSLASH = String.fromCharCode(92);
const ESCAPE_SOURCE = BSLASH + BSLASH + 'u[0-9a-fA-F]{4}';
const escapeOffenders = [];
for (const f of wfFiles) {
  const hits = fs.readFileSync(path.join(WF_DIR, f), 'utf8').match(new RegExp(ESCAPE_SOURCE, 'g'));
  if (hits) escapeOffenders.push(WF_DIR + '/' + f + ': ' + hits.length + ' hits');
}
for (const f of scriptFiles) {
  const hits = fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8').match(new RegExp(ESCAPE_SOURCE, 'g'));
  if (hits) escapeOffenders.push(SCRIPTS_DIR + '/' + f + ': ' + hits.length + ' hits');
}
check('no load-bearing literal uses a unicode escape', escapeOffenders.length === 0, escapeOffenders.length ? escapeOffenders.join('; ') : 'runtime-equivalent but ungreppable is the whole failure class');

const failed = checks.filter(c => !c.ok);
console.log(NL + '共执行 ' + checks.length + ' 条检查，通过 ' + (checks.length - failed.length) + '，失败 ' + failed.length);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report-engine.json'), JSON.stringify({ name: '引擎闸门', result: failed.length ? 'failure' : 'success', checks }, null, 2) + NL);
process.exit(failed.length ? 1 : 0);
