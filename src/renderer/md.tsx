import { memo, useState, type ReactNode } from 'react';

/**
 * Shows an AI answer the way it was meant to be read: headings, lists, tables, code blocks with a Copy button, links.
 * It is written for answers that are still arriving, so a half-written answer (an open code block, half a table)
 * shows cleanly instead of breaking. It builds React elements only, never HTML from the text.
 */

const FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const INLINE = /(`+)([^`]|[^`].*?[^`])\1(?!`)|\*\*(?=\S)(.+?)(?<=\S)\*\*|\*(?=[^\s*])(.+?)(?<=[^\s*])\*|~~(?=\S)(.+?)(?<=\S)~~|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g;

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}${n++}`;
    if (m[1]) out.push(<code key={k}>{m[2]}</code>);
    else if (m[3] !== undefined) out.push(<strong key={k}>{inline(m[3], `${k}b`)}</strong>);
    else if (m[4] !== undefined) out.push(<em key={k}>{inline(m[4], `${k}e`)}</em>);
    else if (m[5] !== undefined) out.push(<del key={k}>{inline(m[5], `${k}d`)}</del>);
    else if (m[6] !== undefined) out.push(<a key={k} href={m[7]} target="_blank" rel="noreferrer">{inline(m[6], `${k}l`)}</a>);
    else if (m[8]) out.push(<a key={k} href={m[8]} target="_blank" rel="noreferrer">{m[8]}</a>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ lang, code }: { lang: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="mdcode">
      <div className="mdcodebar">
        <span>{lang || 'code'}</span>
        <button onClick={copy} aria-label="Copy this code">{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

interface Item { indent: number; ordered: boolean; start: number; lines: string[] }

function list(items: Item[], key: string): JSX.Element {
  const base = items[0]!;
  const rows: { item: Item; kids: Item[] }[] = [];
  for (const it of items) {
    if (it.indent > base.indent + 1 && rows.length) rows[rows.length - 1]!.kids.push(it);
    else rows.push({ item: it, kids: [] });
  }
  const body = rows.map((r, i) => (
    <li key={i}>
      {inline(r.item.lines.join('\n'), `${key}${i}`)}
      {r.kids.length > 0 && list(r.kids, `${key}${i}k`)}
    </li>
  ));
  return base.ordered ? <ol key={key} start={base.start}>{body}</ol> : <ul key={key}>{body}</ul>;
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const startsBlock = (l: string, next?: string): boolean =>
    FENCE.test(l) || HEADING.test(l) || RULE.test(l) || ITEM.test(l) || QUOTE.test(l) || (l.includes('|') && !!next && TABLE_RULE.test(next));

  while (i < lines.length) {
    const line = lines[i]!;
    const k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const code: string[] = [];
      i++;
      // A block that is still being written has no closing line yet: everything so far is its code.
      while (i < lines.length && !(lines[i]!.trim().startsWith(mark[0]!.repeat(mark.length)) && FENCE.test(lines[i]!) && !FENCE.exec(lines[i]!)![2])) code.push(lines[i++]!);
      i++;
      out.push(<CodeBlock key={k} lang={fence[2] ?? ''} code={code.join('\n')} />);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const level = Math.min(6, h[1]!.length);
      out.push(<div key={k} className={`mdh mdh${level}`} role="heading" aria-level={level}>{inline(h[2]!, k)}</div>);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push(<hr key={k} />);
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      out.push(
        <div key={k} className="mdtable">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, a) => <tr key={a}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? '', `${k}r${a}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!);
      out.push(<blockquote key={k}>{blocks(inner.join('\n'))}</blockquote>);
      continue;
    }
    if (ITEM.test(line)) {
      const items: Item[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const m = ITEM.exec(l);
        if (m) {
          items.push({ indent: m[1]!.length, ordered: /\d/.test(m[2]!), start: parseInt(m[2]!, 10) || 1, lines: [m[3]!] });
        } else if (!l.trim()) {
          // A blank line ends the list unless the list goes on after it.
          const next = lines[i + 1];
          if (!next || !(ITEM.test(next) || /^\s{2,}\S/.test(next))) break;
        } else if (/^\s{2,}\S/.test(l) && !FENCE.test(l)) {
          items[items.length - 1]!.lines.push(l.trim());
        } else break;
        i++;
      }
      out.push(list(items, k));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !(para.length && startsBlock(lines[i]!, lines[i + 1]))) para.push(lines[i++]!);
    out.push(<p key={k}>{inline(para.join('\n'), k)}</p>);
  }
  return out;
}

export const Md = memo(function Md({ text }: { text: string }): JSX.Element {
  return <div className="md">{blocks(text)}</div>;
});
