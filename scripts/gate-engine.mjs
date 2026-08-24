#!/usr/bin/env node
// 快闸门：只测纯引擎，不碰页面。
//
// 这条闸门绿 **不代表页面能用**。引擎对、页面上什么都没渲染，在报告上两边都是绿的,
// 这就是覆盖缺口的经典形状。页面那一层由 scripts/gate-browser.mjs 单独一个 job 守。

import fs from 'node:fs';
import path from 'node:path';
import { diffLines, summarize, reconstruct } from '../src/diff.mjs';

const OUT = process.argv[2] || 'out';
const NL = '\n';
const checks = [];
function check(title, ok, detail) {
  checks.push({ title, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title} | ${detail}`);
}

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
const failed = checks.filter(c => !c.ok);
console.log(`${NL}共执行 ${checks.length} 条检查，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report-engine.json'), JSON.stringify({ name: '引擎闸门', result: failed.length ? 'failure' : 'success', checks }, null, 2) + NL);
process.exit(failed.length ? 1 : 0);
