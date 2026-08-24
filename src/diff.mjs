// 行级 diff：Myers 的简化版（LCS 动态规划）。
//
// 为什么不用“逐行对齐”这种便宜写法：它在插入/删除面前会把后续所有行都报成
// 改动，看起来“有输出”但结果是垃圾。闸门里专门有一条用例盯这个。

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

export function reconstruct(ops) {
  const left = ops.filter(o => o.type !== 'add').map(o => o.line).join('\n');
  const right = ops.filter(o => o.type !== 'del').map(o => o.line).join('\n');
  return { left, right };
}
