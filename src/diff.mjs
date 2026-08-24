// 行级 diff：Myers 的简化版（LCS 动态规划）。
//
// 为什么不用“逐行对齐”这种便宜写法：它在插入/删除面前会把后续所有行都报成
// 改动，看起来“有输出”但结果是垃圾。
//
// 这不是空话，PR #5 真的把它换成了逐行对齐跑了一次：顶部插一行，它报
// equal=0 add=4 del=3，而正确答案是 1 add + 3 equal。不报错、不崩、round-trip
// 依旧正确, 只是对“什么变了”的判断全错。闸门里那条用例就是盯这个的。
//
// 而且那一跑顺带暴露了：页面闸门**拓不住这个**。它把 DOM 跟同一个引擎对比，
// 引擎错了两边一起错，于是它依旧 18/18 全绿。见 docs/BLIND-SPOTS.md。

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
  const dp = lcsMatrix(a, b);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'equal', line: a[i], aIndex: i, bIndex: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', line: a[i], aIndex: i, bIndex: null });
      i += 1;
    } else {
      out.push({ type: 'add', line: b[j], aIndex: null, bIndex: j });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ type: 'del', line: a[i], aIndex: i, bIndex: null });
    i += 1;
  }
  while (j < b.length) {
    out.push({ type: 'add', line: b[j], aIndex: null, bIndex: j });
    j += 1;
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

// 相似度：相同行 ÷ 总操作数。两侧都空算完全相同（不是 0/0）。
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
