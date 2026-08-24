// 行级 diff。
//
// !!! 变异体分支 test/break-insert-at-top，不合入。
//
// 这里故意把 LCS 走法换成了「逐行对齐」，也就是原注释里那个被点名批过的便宜写法。
// 它不报错、不崩、而且 round-trip 依旧正确（把 diff 应用回去仍然得到两侧原文），
// 它只是对「什么变了」的判断是错的：顶部插一行，它报 equal=0 add=4 del=3，
// 而正确答案是 1 add + 3 equal。
//
// 为什么故意选这个而不是语法错：语法错只能证明 runner 能跑，证不了那条断言是承重的。
// 这个形状才是真正危险的那种：看起来有输出，实际是垃圾。

export function lcsMatrix(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

export function diffLines(leftText, rightText) {
  const a = String(leftText).split('\n');
  const b = String(rightText).split('\n');
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (i < a.length && i < b.length) {
      if (a[i] === b[i]) {
        out.push({ type: 'equal', line: a[i], aIndex: i, bIndex: i });
      } else {
        out.push({ type: 'del', line: a[i], aIndex: i, bIndex: null });
        out.push({ type: 'add', line: b[i], aIndex: null, bIndex: i });
      }
    } else if (i < a.length) {
      out.push({ type: 'del', line: a[i], aIndex: i, bIndex: null });
    } else {
      out.push({ type: 'add', line: b[i], aIndex: null, bIndex: i });
    }
  }
  return out;
}

export function summarize(ops) {
  return {
    equal: ops.filter(o => o.type === 'equal').length,
    added: ops.filter(o => o.type === 'add').length,
    deleted: ops.filter(o => o.type === 'del').length
  };
}

export function similarity(ops) {
  const s = summarize(ops);
  const total = s.equal + s.added + s.deleted;
  if (total === 0) return 1;
  return s.equal / total;
}

export function reconstruct(ops) {
  const left = ops.filter(o => o.type !== 'add').map(o => o.line).join('\n');
  const right = ops.filter(o => o.type !== 'del').map(o => o.line).join('\n');
  return { left, right };
}
