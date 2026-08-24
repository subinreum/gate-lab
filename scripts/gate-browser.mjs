#!/usr/bin/env node
// 页面闸门：驱真实浏览器跑真实页面，断言 DOM 上真的出现了 diff 结果。
//
// **为什么不能只靠引擎闸门。** 引擎 10/10 只证了纯核心。引擎对、页面上什么都没
// 渲染出来，两边在报告上都是全绿, 这就是覆盖缺口的经典形状。
//
// **断言不是“有元素”，是逐行数对得上。** 行数、每行类型、每行文本、汇总计数，
// 全部跟引擎在 Node 里算出的结果逐一比对。
//
// **版本对得上也是一条断言。** 钉了版本不等于装上的就是那个版本；安装命令写错、
// 缓存命中旧的、lockfile 漂了，都能让两边分开。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { diffLines, summarize } from '../src/diff.mjs';

const require = createRequire(import.meta.url);
const OUT = process.argv[2] || 'out';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NL = '\n';
const checks = [];
function check(title, ok, detail) {
  checks.push({ title, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title} | ${detail}`);
}

// 钉的版本 vs 实际装上的版本
const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies.playwright;
let installed = null;
try { installed = require('playwright/package.json').version; } catch (e) { installed = `读不到：${e.message}`; }
check(
  'installed playwright equals the pinned version',
  installed === pin,
  `pinned ${pin}, installed ${installed}`
);

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
const CASES = [
  ['insert at top', 'a' + NL + 'b', 'x' + NL + 'a' + NL + 'b'],
  ['delete in middle', 'a' + NL + 'b' + NL + 'c', 'a' + NL + 'c'],
  ['replace one line', 'a' + NL + 'b' + NL + 'c', 'a' + NL + 'B' + NL + 'c'],
  ['cjk lines', '你好' + NL + '世界', '你好' + NL + '中国'],
  ['identical', 'a' + NL + 'b', 'a' + NL + 'b']
];
const server = await serve();
const port = server.address().port;
const browser = await chromium.launch();
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const ready = await page.evaluate(() => window.__diffReady === true).catch(() => false);
  check('page module actually executed', ready, 'window.__diffReady set by src/app.mjs');
  for (const [name, L, R] of CASES) {
    await page.fill('#left', L);
    await page.fill('#right', R);
    await page.click('#run');
    const rows = await page.$$eval('#result tr', trs => trs.map(tr => ({ type: tr.dataset.type, text: tr.querySelector('td.text') ? tr.querySelector('td.text').textContent : null })));
    const sum = await page.$eval('#summary', el => ({ equal: el.dataset.equal, add: el.dataset.add, del: el.dataset.del }));
    const want = diffLines(L, R).map(o => ({ type: o.type, text: o.line }));
    const ws = summarize(diffLines(L, R));
    const sameLen = rows.length === want.length;
    const firstBad = want.findIndex((w, i) => !rows[i] || rows[i].type !== w.type || rows[i].text !== w.text);
    check(`DOM rows match engine line-by-line: ${name}`, sameLen && firstBad === -1, sameLen ? (firstBad === -1 ? `${rows.length} rows all match` : `row ${firstBad} differs: DOM ${JSON.stringify(rows[firstBad])} vs engine ${JSON.stringify(want[firstBad])}`) : `DOM rendered ${rows.length} rows, engine produced ${want.length}`);
    check(`DOM summary counts match engine: ${name}`, sum.equal === String(ws.equal) && sum.add === String(ws.added) && sum.del === String(ws.deleted), `DOM equal/add/del = ${sum.equal}/${sum.add}/${sum.del}, engine = ${ws.equal}/${ws.added}/${ws.deleted}`);
  }
  check('no page errors during the whole run', pageErrors.length === 0, pageErrors.length ? pageErrors.join(' | ') : 'zero pageerror and zero console.error');
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter(c => !c.ok);
console.log(`${NL}共执行 ${checks.length} 条检查，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report-browser.json'), JSON.stringify({ name: '页面闸门', result: failed.length ? 'failure' : 'success', checks }, null, 2) + NL);
process.exit(failed.length ? 1 : 0);
