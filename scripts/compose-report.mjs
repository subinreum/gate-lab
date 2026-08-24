#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...flags] = process.argv.slice(2);
const checkOnly = flags.includes('--check');
if (!dir) {
  console.error('用法: compose-report.mjs <reports 目录> [--check]');
  process.exit(2);
}
function walk(d) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && /^report-.*\.json$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(dir).sort();
if (files.length === 0) {
  console.error(`在 ${dir} 下没有找到任何 report-*.json,闸门没产出报告，或者 artifact 没下载到`);
  process.exit(1);
}
const gates = [];
for (const f of files) {
  const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
  gates.push(parsed);
}
const badChecks = gates.flatMap(g => g.checks.filter(c => !c.ok).map(c => ({ gate: g.name, ...c })));
const badGates = gates.filter(g => g.result !== 'success');
const total = gates.reduce((n, g) => n + g.checks.length, 0);
const ok = badChecks.length === 0 && badGates.length === 0;
if (checkOnly) process.exit(ok ? 0 : 1);
const sha = String(process.env.GITHUB_SHA || '').slice(0, 7);
const run = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const lines = [];
lines.push(ok ? '## 验证报告 ✅' : '## 验证报告 ❌');
lines.push('');
lines.push('| 闸门 | job 结果 | 通过 |');
lines.push('| --- | --- | --- |');
for (const g of gates) {
  const pass = g.checks.filter(c => c.ok).length;
  const mark = g.result === 'success' && pass === g.checks.length ? '✅' : '❌';
  lines.push(`| ${g.name} | \`${g.result}\` | ${mark} ${pass}/${g.checks.length} |`);
}
lines.push('');
if (badChecks.length) {
  lines.push('### 失败项');
  lines.push('');
  for (const c of badChecks) lines.push(`- **${c.gate} / ${c.title}**: ${c.detail ?? ''}`);
  lines.push('');
}
lines.push(`共 ${total} 项检查，失败 ${badChecks.length}。`);
lines.push('');
lines.push(`提交 \`${sha}\` · [完整日志](${run})`);
lines.push('');
fs.writeFileSync('comment.md', lines.join('\n'), 'utf8');
process.exit(0);
