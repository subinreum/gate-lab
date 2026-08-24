#!/usr/bin/env node
// 快闸门：只测纯引擎和仓内约束，不碰页面。
//
// 这条闸门绿 **不代表页面能用**。引擎对、页面上什么都没渲染，在报告上两边都是绿的,
// 这就是覆盖缺口的经典形状。页面那一层由 scripts/gate-browser.mjs 单独一个 job 守。

import fs from 'node:fs';
import path from 'node:path';
import { diffLines, summarize, reconstruct } from '../src/diff.mjs';

const OUT = process.argv[2] || 'out';
const NL = '\n';
const WF_DIR = '.github/workflows';
const SCRIPTS_DIR = 'scripts';
const checks = [];
function check(title, ok, detail) {
  checks.push({ title, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title} | ${detail}`);
}
const eqSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

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
  check(`round-trip: ${name}`, rt.left === L && rt.right === R, 'apply-back must be byte-exact on both sides');
}
{
  const s = summarize(diffLines('a' + NL + 'b' + NL + 'c', 'x' + NL + 'a' + NL + 'b' + NL + 'c'));
  check(
    'insert one line at top is 1 add + 3 equal',
    s.added === 1 && s.deleted === 0 && s.equal === 3,
    `got add=${s.added} del=${s.deleted} equal=${s.equal}; naive line-by-line would report 4 changes`
  );
}

// ---- 仓内约束：磁盘集合 == 登记集合 ------------------------------------
const wfFiles = fs.readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f)).sort();
const scriptFiles = fs.readdirSync(SCRIPTS_DIR).filter(f => /\.(mjs|cjs|js)$/.test(f)).sort();
let manifest = null;
let manifestErr = '';
try { manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8')); } catch (e) { manifestErr = e.message; }
if (!manifest) {
  check('manifest.json loads', false, manifestErr);
} else {
  const regScripts = [...(manifest.scripts || [])].sort();
  const extra = scriptFiles.filter(f => !regScripts.includes(f));
  const missing = regScripts.filter(f => !scriptFiles.includes(f));
  const parts = [];
  if (extra.length) parts.push(`on disk but unregistered: ${extra.join(', ')}`);
  if (missing.length) parts.push(`registered but absent: ${missing.join(', ')}`);
  check('scripts/ on disk equals scripts registered in manifest', eqSet(scriptFiles, regScripts), parts.length ? parts.join(' | ') : `${scriptFiles.length} files match exactly: ${scriptFiles.join(', ')}`);
  const regWf = [...(manifest.workflows || [])].sort();
  const wfExtra = wfFiles.filter(f => !regWf.includes(f));
  const wfMissing = regWf.filter(f => !wfFiles.includes(f));
  const wparts = [];
  if (wfExtra.length) wparts.push(`on disk but unregistered: ${wfExtra.join(', ')}`);
  if (wfMissing.length) wparts.push(`registered but absent: ${wfMissing.join(', ')}`);
  check('workflows/ on disk equals workflows registered in manifest', eqSet(wfFiles, regWf), wparts.length ? wparts.join(' | ') : `${wfFiles.length} files match exactly: ${wfFiles.join(', ')}`);
}

// ---- Playwright 钉版本：这是时间驱动的漂移，不推代码也会变 ----------------
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pin = (pkg.devDependencies || {}).playwright;
check(
  'playwright pin is an exact version',
  typeof pin === 'string' && /^\d+\.\d+\.\d+$/.test(pin),
  `package.json devDependencies.playwright = ${JSON.stringify(pin)}; a range would drift without any commit`
);
const ci = fs.readFileSync(path.join(WF_DIR, 'ci.yml'), 'utf8');
check(
  'workflow never installs playwright unpinned',
  !/npm install[^\n]*--no-save[^\n]*playwright(?![@\w.-])/.test(ci),
  'a bare `npm install playwright` is latest-at-run-time, which is exactly the drift we are guarding'
);
check(
  'workflow installs the pin read from package.json',
  /playwright@\$\{?PIN\}?/.test(ci) || /playwright@"?\$PIN/.test(ci),
  'the workflow must read the pin, not carry its own copy of the number'
);
check(
  'the version literal lives in exactly one file',
  typeof pin === 'string' && !ci.includes(pin),
  pin && ci.includes(pin) ? `${pin} is hardcoded in ci.yml as well as package.json, so the two can fork` : 'only package.json carries the number'
);

// ---- 送达核对必须走共享那一份 -------------------------------------------
check(
  'attest is delegated to the shared reusable workflow',
  /uses:\s*subinreum\/ci-workflows\/\.github\/workflows\/attest\.yml@/.test(ci),
  'the hand-written copy here is what let the freshness assertion go missing'
);
check(
  'this repo does not re-inline freshness logic',
  !/checkFreshness/.test(ci) && !fs.readdirSync(SCRIPTS_DIR).some(f => /freshness/i.test(f)),
  'second copies grow apart; only the upstream one is watched'
);

const failed = checks.filter(c => !c.ok);
console.log(`${NL}共执行 ${checks.length} 条检查，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report-engine.json'), JSON.stringify({ name: '引擎闸门', result: failed.length ? 'failure' : 'success', checks }, null, 2) + NL);
process.exit(failed.length ? 1 : 0);
