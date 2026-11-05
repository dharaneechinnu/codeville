/** A line diff for reviewing AI edits: common start and end are trimmed, the middle is matched by longest common subsequence. */

export interface DiffRow {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
  a?: number; // line number in the old file
  b?: number; // line number in the new file
  hidden?: number; // for 'gap': how many unchanged lines are folded
}

const MAX_CELLS = 4_000_000;
const CONTEXT = 3;

export function lineDiff(before: string, after: string): { rows: DiffRow[]; added: number; removed: number } {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const mid: DiffRow[] = [];
  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) mid.push({ kind: 'del', text: a[i]!, a: i + 1 });
    for (let j = start; j < endB; j++) mid.push({ kind: 'add', text: b[j]!, b: j + 1 });
  } else {
    // lcs[i][j] = length of the LCS of a[start+i..endA) and b[start+j..endB)
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = a[start + i] === b[start + j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        mid.push({ kind: 'same', text: a[start + i]!, a: start + i + 1, b: start + j + 1 });
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i * w + j + 1]! > lcs[(i + 1) * w + j]!)) {
        mid.push({ kind: 'add', text: b[start + j]!, b: start + j + 1 });
        j++;
      } else {
        mid.push({ kind: 'del', text: a[start + i]!, a: start + i + 1 });
        i++;
      }
    }
  }
  const all: DiffRow[] = [
    ...a.slice(0, start).map((t, k) => ({ kind: 'same' as const, text: t, a: k + 1, b: k + 1 })),
    ...mid,
    ...a.slice(endA).map((t, k) => ({ kind: 'same' as const, text: t, a: endA + k + 1, b: endB + k + 1 })),
  ];
  const added = all.filter((r) => r.kind === 'add').length;
  const removed = all.filter((r) => r.kind === 'del').length;
  return { rows: fold(all), added, removed };
}

/** Keeps a few unchanged lines around each change and folds the rest. */
function fold(rows: DiffRow[]): DiffRow[] {
  const near = new Uint8Array(rows.length);
  rows.forEach((r, i) => {
    if (r.kind === 'same') return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) near[k] = 1;
  });
  const out: DiffRow[] = [];
  let hidden = 0;
  rows.forEach((r, i) => {
    if (r.kind === 'same' && !near[i]) {
      hidden++;
      return;
    }
    if (hidden) out.push({ kind: 'gap', text: '', hidden });
    hidden = 0;
    out.push(r);
  });
  if (hidden) out.push({ kind: 'gap', text: '', hidden });
  return out;
}
