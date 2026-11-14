import { useEffect, useState } from 'react';
import type { CvEvent } from '../shared/events.js';
import type { LivePart } from './api.js';
import { Md } from './md.js';

/**
 * The conversation, as turns: what you asked, what the agent did, what it answered. The same shape for every AI engine.
 * A finished turn is read from the saved events, so it is still there after a restart. The turn that is running is
 * shown from the live stream, word by word.
 */

export interface Step {
  id: string;
  text: string;
  /** A project file this step touched; it opens in the editor. */
  path?: string;
  bad?: boolean;
}

export interface ChatTurn {
  id: string;
  ts: number;
  /** Missing when the turn started somewhere the app did not see, such as a terminal. */
  prompt?: string;
  steps: Step[];
  answer: string;
  ended: boolean;
  failed: boolean;
}

export type ChatItem = { kind: 'turn'; turn: ChatTurn } | { kind: 'note'; id: string; text: string };

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FILE_OPS: Record<string, string> = { edit: 'Edited', write: 'Wrote', create: 'Created', delete: 'Deleted' };

/** A path inside the project is shown from the project folder; anything else as it is. */
function tidy(target: string, root: string): string {
  const t = target.split('\\').join('/');
  const r = root.split('\\').join('/').replace(/\/+$/, '');
  return r && t.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? t.slice(r.length + 1) : t;
}

/** What a tool did, in plain words. */
export function toolLabel(tool: string, target: string, root: string): string {
  const t = tidy(target, root);
  const mcp = /^(?:mcp__)?(?:plugin_[\w-]+_)?codeville(?:__|: )(\w+)/.exec(tool);
  if (mcp) return `Asked Codeville: ${mcp[1]!.replace(/_/g, ' ')}`;
  switch (tool) {
    case 'Read': return `Read ${t}`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Edited ${t}`;
    case 'Write': return `Wrote ${t}`;
    case 'Bash': return `Ran ${t}`;
    case 'Grep': return `Searched the code for ${t}`;
    case 'Glob': return `Looked for files ${t}`;
    case 'WebFetch': return `Opened ${t}`;
    case 'WebSearch': return `Searched the web for ${t}`;
    case 'Task': case 'Agent': return `Asked a sub-agent${t ? `: ${t}` : ''}`;
    case 'TodoWrite': return 'Updated its to-do list';
    default: return `${tool.replace(/^mcp__/, '').replace(/__/g, ': ')} ${t}`.trim();
  }
}

/** A live tool line looks like "→ Read src/a.ts". */
export function liveToolLabel(line: string, root: string): string {
  const m = /^→ (\S+: \S+|\S+)\s?(.*)$/.exec(line);
  return m ? toolLabel(m[1]!, m[2] ?? '', root) : line;
}

export function buildItems(events: CvEvent[], root: string): ChatItem[] {
  const items: ChatItem[] = [];
  let cur: ChatTurn | null = null;
  const turn = (e: CvEvent, prompt?: string): ChatTurn => {
    cur = { id: e.id, ts: e.ts, prompt, steps: [], answer: '', ended: false, failed: false };
    items.push({ kind: 'turn', turn: cur });
    return cur;
  };
  for (const e of events.slice(-400)) {
    if (e.team) continue; // the team's work is shown on its own card
    if (e.type === 'prompt') turn(e, e.text);
    else if (e.type === 'tool') {
      if (e.phase === 'end' || (e.phase === 'start' && FILE_TOOLS.has(e.tool))) continue; // a file change says it better
      const label = toolLabel(e.tool, e.target ?? '', root);
      const t: ChatTurn = cur ?? turn(e);
      // Something that was tried and did not happen (it needed approval, or it failed) is one step, marked, not two.
      const tried = e.phase === 'fail' ? t.steps.find((s) => s.text === label && !s.bad) : undefined;
      if (tried) tried.bad = true;
      else t.steps.push({ id: e.id, text: label, bad: e.phase === 'fail' });
    } else if (e.type === 'file.change') (cur ?? turn(e)).steps.push({ id: e.id, text: FILE_OPS[e.op] ?? 'Changed', path: e.path });
    else if (e.type === 'agent.start') (cur ?? turn(e)).steps.push({ id: e.id, text: `Started a sub-agent${e.agentType ? ` (${e.agentType})` : ''}` });
    else if (e.type === 'turn.end') {
      const t: ChatTurn = cur ?? turn(e);
      // With the plugin, the same ending arrives twice (from its hook and from the app). The fuller one is the answer.
      if (e.message && e.message.length >= t.answer.length) t.answer = e.message;
      t.ended = true;
      t.failed = t.failed || !!e.failed;
    } else if (e.type === 'git.commit') items.push({ kind: 'note', id: e.id, text: `Committed ${e.files} files on ${e.branch}` });
    else if (e.type === 'git.push') items.push({ kind: 'note', id: e.id, text: `Pushed ${e.branch}` });
  }
  return items.slice(-60);
}

function Elapsed({ since }: { since: number }): JSX.Element {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return <span className="elapsed">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}

function Copy({ text }: { text: string }): JSX.Element {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function StepRow({ s, onOpen }: { s: Step; onOpen: (path: string) => void }): JSX.Element {
  return (
    <div className={`tool ${s.bad ? 'bad' : ''}`}>
      <i />
      <span className="steptext">
        {s.bad && <b>Not done · </b>}
        {s.text}
        {s.path && <> <button className="lnk" onClick={() => onOpen(s.path!)}>{s.path}</button></>}
      </span>
    </div>
  );
}

/** What the agent did in a finished turn. Closed by default: the answer is what people came for. */
function Steps({ steps, onOpen }: { steps: Step[]; onOpen: (path: string) => void }): JSX.Element {
  const files = steps.filter((s) => s.path).length;
  const bad = steps.filter((s) => s.bad).length;
  return (
    <details className="steps" open={bad > 0}>
      <summary>
        {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        {files > 0 && ` · ${files} file ${files === 1 ? 'change' : 'changes'}`}
        {bad > 0 && <b className="badtxt"> · {bad} not done</b>}
      </summary>
      {steps.map((s) => <StepRow key={s.id} s={s} onOpen={onOpen} />)}
    </details>
  );
}

function Prompt({ text, waiting }: { text: string; waiting?: boolean }): JSX.Element {
  const [all, setAll] = useState(false);
  const long = text.length > 700;
  return (
    <div className={`m user ${waiting ? 'waiting' : ''}`}>
      <span className="who">You</span>
      {long && !all ? `${text.slice(0, 600)}…` : text}
      {long && <button className="lnk more" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : 'Show all'}</button>}
    </div>
  );
}

export interface TurnProps {
  turn: ChatTurn;
  root: string;
  /** Who answers, as the user knows it: "Claude Code", "Codex", ... */
  who: string;
  /** Set while this turn is being worked on: the live stream, and when the prompt was sent. */
  live?: { parts: LivePart[]; since: number; running: boolean };
  onOpen: (path: string) => void;
  /** Sends this turn's prompt again. */
  onRetry?: () => void;
}

export function TurnView({ turn, root, who, live, onOpen, onRetry }: TurnProps): JSX.Element {
  const running = !!live?.running;
  const parts = live?.parts ?? [];
  // While it works, and when it ended without a final message, the live stream is the best account of the turn.
  const stopped = turn.ended && !turn.failed && turn.answer === 'Stopped.';
  // What it had written before it was stopped stays on the screen.
  const showLive = parts.length > 0 && (running || !turn.answer || stopped);
  const lastPart = parts[parts.length - 1];
  const status = !lastPart ? `Starting ${who}` : lastPart.kind === 'tool' ? liveToolLabel(lastPart.text, root) : lastPart.kind === 'text' ? 'Writing' : 'Working';
  return (
    <div className="turn">
      {turn.prompt !== undefined && <Prompt text={turn.prompt} waiting={running && parts.length === 0} />}
      {showLive ? (
        <div className="m ai" aria-live="polite" aria-busy={running}>
          <span className="who">{who}</span>
          {parts.map((p, i) =>
            p.kind === 'text' ? <Md key={i} text={p.text} /> : p.kind === 'tool' ? (
              <div key={i} className="tool"><i /><span className="steptext">{liveToolLabel(p.text, root)}</span></div>
            ) : (
              <div key={i} className="tool bad"><i /><span className="steptext">{p.text}</span></div>
            ),
          )}
        </div>
      ) : (
        <>
          {turn.steps.length > 0 && <Steps steps={turn.steps} onOpen={onOpen} />}
          {turn.answer && !stopped && (
            <div className={`m ai ${turn.failed ? 'failed' : ''}`}>
              <span className="who">{who}{turn.failed ? ' · did not finish' : ''}</span>
              <Md text={turn.answer} />
              <div className="mact">
                <Copy text={turn.answer} />
                {turn.failed && onRetry && <button onClick={onRetry}>Try again</button>}
              </div>
            </div>
          )}
          {turn.ended && !turn.answer && <div className="tool dim"><i /><span className="steptext">Finished without a message.</span></div>}
        </>
      )}
      {stopped && !running && (
        <div className="tool dim">
          <i />
          <span className="steptext">You stopped this. {onRetry && <button className="lnk" onClick={onRetry}>Send it again</button>}</span>
        </div>
      )}
      {running && (
        <div className="working" role="status">
          <span className="aispin" aria-hidden="true" />
          <span className="worktext">{status}…</span>
          <Elapsed since={live!.since} />
        </div>
      )}
    </div>
  );
}
