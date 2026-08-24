#!/usr/bin/env node
// 页面闸门：驱真实浏览器跑真实页面，断言 DOM 上真的出现了 diff 结果。
//
// **为什么不能只靠引擎闸门。** 引擎全绿只证了纯核心。引擎对、页面上什么都没
// 渲染出来，两边在报告上都是全绿, 这就是覆盖缺口的经典形状。
//
// **两类检查要分得很清楚。**
//
// 一、FIXTURE：拿 `scripts/dom-fixtures.mjs` 里**手写死的**期望比。这是真正的独立判据，
// 引擎坏掉它也会红。
//
// 二、CONSISTENCY：拿引擎输出比。这一类**结构上看不见引擎 bug**：它把 DOM 跟
// diffLines() 对，引擎错了两边一起错、完美一致。PR #5 真的跑出了 18/18 全绿。
// 留着是因为它能覆盖夹具盖不到的输入组合，但不能当成独立证据。
//
// **CJK 夹具额外问一下字形可用性。** textContent 相等只证明字符串对，完全不证明它不是
// 一排方块。runner 默认不一定带那批字体，所以这里用 document.fonts.check 问浏览器。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { diffLines, summarize, similarity } from '../src/diff.mjs';
import { DOM_FIXTURES } from './dom-fixtures.mjs';

const require = createRequire(import.meta.url);
const OUT = process.argv[2] || 'out';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const checks = [];
function check(title, ok, detail) {
  checks.push({ title, ok: Boolean(ok), detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + title + ' | ' + detail);
}

const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies.playwright;
let installed = null;
try { installed = require('playwright/package.json').version; } catch (e) { installed = 'unreadable: ' + e.message; }
check('installed playwright equals the pinned version', installed === pin, 'pinned ' + pin + ', installed ' + installed);

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      const ext = path.extname(file);
      const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.mjs' || ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type }).end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const CONSISTENCY_CASES = [
  ['insert at top', 'a' + NL + 'b', 'x' + NL + 'a' + NL + 'b'],
  ['delete in middle', 'a' + NL + 'b' + NL + 'c', 'a' + NL + 'c'],
  ['replace one line', 'a' + NL + 'b' + NL + 'c', 'a' + NL + 'B' + NL + 'c'],
  ['reorder', 'a' + NL + 'b' + NL + 'c', 'c' + NL + 'b' + NL + 'a'],
  ['identical', 'a' + NL + 'b', 'a' + NL + 'b']
];

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch();
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  const ready = await page.evaluate(() => window.__diffReady === true).catch(() => false);
  check('page module actually executed', ready, 'window.__diffReady set by src/app.mjs');

  async function runPair(L, R) {
    await page.fill('#left', L);
    await page.fill('#right', R);
    await page.click('#run');
    const rows = await page.$$eval('#result tr', trs => trs.map(tr => ({
      type: tr.dataset.type,
      text: tr.querySelector('td.text') ? tr.querySelector('td.text').textContent : null
    })));
    const sum = await page.$eval('#summary', el => ({
      equal: el.dataset.equal, add: el.dataset.add, del: el.dataset.del, similarity: el.dataset.similarity
    }));
    return { rows, sum };
  }

  // ---- FIXTURE：跟手写期望比，不跟引擎比 ----------------------------------
  for (const f of DOM_FIXTURES) {
    const { rows, sum } = await runPair(f.left, f.right);
    const want = f.expectedRows;
    const sameLen = rows.length === want.length;
    const firstBad = want.findIndex((w, i) => !rows[i] || rows[i].type !== w.type || rows[i].text !== w.text);
    check(
      'FIXTURE rows match the hand-written expectation: ' + f.name,
      sameLen && firstBad === -1,
      sameLen
        ? (firstBad === -1
            ? rows.length + ' rows match the hand-written order and text'
            : 'row ' + firstBad + ' differs: DOM ' + JSON.stringify(rows[firstBad]) + ' vs hand-written ' + JSON.stringify(want[firstBad]))
        : 'DOM rendered ' + rows.length + ' rows, hand-written expects ' + want.length
    );
    check(
      'FIXTURE counts match the hand-written expectation: ' + f.name,
      sum.equal === f.expectedEqual && sum.add === f.expectedAdd && sum.del === f.expectedDel,
      'DOM equal/add/del = ' + sum.equal + '/' + sum.add + '/' + sum.del + ', hand-written = ' + f.expectedEqual + '/' + f.expectedAdd + '/' + f.expectedDel
    );
    check(
      'FIXTURE similarity matches the hand-written expectation: ' + f.name,
      sum.similarity === f.expectedSimilarity,
      'DOM ' + sum.similarity + ', hand-written ' + f.expectedSimilarity
    );

    if (f.hasCjk) {
      const cjkText = f.expectedRows.map(r => r.text).join('');
      const glyphs = await page.evaluate(t => {
        const el = document.getElementById('summary');
        const font = getComputedStyle(el).font || '14px sans-serif';
        return { ok: document.fonts.check(font, t), font };
      }, cjkText);
      check(
        'CJK glyphs are actually available in the runner: ' + f.name,
        glyphs.ok,
        glyphs.ok
          ? 'document.fonts.check says the computed font can render it (' + glyphs.font + ')'
          : 'no glyph available for ' + JSON.stringify(cjkText) + ' with ' + glyphs.font + ', it would render as tofu boxes and textContent equality would not notice'
      );
      const box = await page.$eval('#result tr:last-child td.text', el => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      check(
        'the CJK row actually laid out with non-zero area: ' + f.name,
        box.w > 0 && box.h > 0,
        box.w + 'x' + box.h + ' px; this catches a collapsed row but cannot tell a glyph from a tofu box'
      );
    }
  }

  // ---- CONSISTENCY：跟引擎比。结构上看不见引擎 bug，不得当独立证据。 -----
  for (const [name, L, R] of CONSISTENCY_CASES) {
    const { rows, sum } = await runPair(L, R);
    const ops = diffLines(L, R);
    const want = ops.map(o => ({ type: o.type, text: o.line }));
    const ws = summarize(ops);
    const wsim = similarity(ops).toFixed(4);
    const sameLen = rows.length === want.length;
    const firstBad = want.findIndex((w, i) => !rows[i] || rows[i].type !== w.type || rows[i].text !== w.text);
    check(
      'CONSISTENCY DOM matches engine output: ' + name,
      sameLen && firstBad === -1,
      sameLen
        ? (firstBad === -1 ? rows.length + ' rows agree with the engine' : 'row ' + firstBad + ' differs: DOM ' + JSON.stringify(rows[firstBad]) + ' vs engine ' + JSON.stringify(want[firstBad]))
        : 'DOM rendered ' + rows.length + ' rows, engine produced ' + want.length
    );
    check(
      'CONSISTENCY DOM summary agrees with engine: ' + name,
      sum.equal === String(ws.equal) && sum.add === String(ws.added) && sum.del === String(ws.deleted) && sum.similarity === wsim,
      'DOM ' + sum.equal + '/' + sum.add + '/' + sum.del + ' sim ' + sum.similarity + ', engine ' + ws.equal + '/' + ws.added + '/' + ws.deleted + ' sim ' + wsim
    );
  }

  check('no page errors during the whole run', pageErrors.length === 0, pageErrors.length ? pageErrors.join(' | ') : 'zero pageerror and zero console.error');
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter(c => !c.ok);
console.log(NL + '共执行 ' + checks.length + ' 条检查，通过 ' + (checks.length - failed.length) + '，失败 ' + failed.length);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report-browser.json'), JSON.stringify({ name: '页面闸门', result: failed.length ? 'failure' : 'success', checks }, null, 2) + NL);
process.exit(failed.length ? 1 : 0);
