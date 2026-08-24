// 页面闸门的**独立判据**。
//
// 为什么需要这个文件：页面闸门之前把 DOM 跟 `diffLines()` 在 Node 里跑出的结果比，
// 也就是拿引擎当自己的 oracle。引擎语义坏掉的时候，两边以完全相同的方式错，于是
// 它完美一致、依旧 18/18 全绿。PR #5 真的跑出了这个结果。
//
// 所以这里的期望是**手写死的**：第几行是 add、第几行是 equal、文本是什么、计数多少。
// **这个文件不得 import src/ 里的任何东西**，引擎闸门有一条断言盯着。
//
// 夹具自己也得能守住东西：每一个都必须能拓住「逐行对齐」那个变异体。我第一版的 CJK
// 夹具就不行：它是同一下标位置的替换，而逐行对齐和 LCS 在这种形状上结果一模一样，
// 换到中间插一行才能区分。引擎闸门现在会用那个变异体逐个验夹具。

const NL = String.fromCharCode(10);

export const DOM_FIXTURES = [
  {
    name: 'insert at top',
    left: 'a' + NL + 'b',
    right: 'x' + NL + 'a' + NL + 'b',
    expectedRows: [
      { type: 'add', text: 'x' },
      { type: 'equal', text: 'a' },
      { type: 'equal', text: 'b' }
    ],
    expectedEqual: '2',
    expectedAdd: '1',
    expectedDel: '0',
    expectedSimilarity: '0.6667',
    hasCjk: false
  },
  {
    name: 'delete in middle',
    left: 'a' + NL + 'b' + NL + 'c',
    right: 'a' + NL + 'c',
    expectedRows: [
      { type: 'equal', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'equal', text: 'c' }
    ],
    expectedEqual: '2',
    expectedAdd: '0',
    expectedDel: '1',
    expectedSimilarity: '0.6667',
    hasCjk: false
  },
  {
    // 含 CJK。runner 默认不一定带那批字体，而方块字只有真渲染才看得见，
    // 所以页面闸门除了比文本，还会问浏览器这串字到底有没有字形可用。
    name: 'cjk insert in middle',
    left: '你好' + NL + '世界',
    right: '你好' + NL + '中间' + NL + '世界',
    expectedRows: [
      { type: 'equal', text: '你好' },
      { type: 'add', text: '中间' },
      { type: 'equal', text: '世界' }
    ],
    expectedEqual: '2',
    expectedAdd: '1',
    expectedDel: '0',
    expectedSimilarity: '0.6667',
    hasCjk: true
  }
];

// 逐行对齐的变异体，只用来验夹具自己有没有区分能力。不得被产品代码引用。
export function naiveAlignmentMutant(leftText, rightText) {
  const a = String(leftText).split(NL);
  const b = String(rightText).split(NL);
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (i < a.length && i < b.length) {
      if (a[i] === b[i]) {
        out.push({ type: 'equal', text: a[i] });
      } else {
        out.push({ type: 'del', text: a[i] });
        out.push({ type: 'add', text: b[i] });
      }
    } else if (i < a.length) {
      out.push({ type: 'del', text: a[i] });
    } else {
      out.push({ type: 'add', text: b[i] });
    }
  }
  return out;
}
