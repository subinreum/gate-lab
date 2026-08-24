import { diffLines, summarize, similarity } from './diff.mjs';

const MARK = { equal: '\u00a0', add: '+', del: '-' };

export function render(ops, root, summaryEl) {
  root.textContent = '';
  for (const op of ops) {
    const tr = document.createElement('tr');
    tr.dataset.type = op.type;
    const mark = document.createElement('td');
    mark.className = 'mark';
    mark.textContent = MARK[op.type];
    const text = document.createElement('td');
    text.className = 'text';
    text.textContent = op.line;
    tr.append(mark, text);
    root.append(tr);
  }
  const s = summarize(ops);
  const ratio = similarity(ops);
  summaryEl.dataset.equal = String(s.equal);
  summaryEl.dataset.add = String(s.added);
  summaryEl.dataset.del = String(s.deleted);
  summaryEl.dataset.similarity = ratio.toFixed(4);
  summaryEl.textContent = `相同 ${s.equal} 行，新增 ${s.added} 行，删除 ${s.deleted} 行，相似度 ${(ratio * 100).toFixed(1)}%`;
}

function wire() {
  const left = document.getElementById('left');
  const right = document.getElementById('right');
  const root = document.getElementById('result');
  const summaryEl = document.getElementById('summary');
  document.getElementById('run').addEventListener('click', () => {
    render(diffLines(left.value, right.value), root, summaryEl);
  });
  window.__diffReady = true;
}

if (typeof document !== 'undefined') wire();
