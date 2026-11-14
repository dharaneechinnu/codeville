import { useEffect, useMemo, useRef, useState } from 'react';
import type { CvEvent } from '../shared/events.js';
import { useCv, type Note } from './state.js';
import { Ico } from './icons.js';
import { useAgentLink } from './agentlink.js';
import { openEngines, useEngines } from './engines.js';
import { TeamRunCard, TeamToggle, useTeam } from './team.js';
import { api } from './api.js';
import { buildItems, TurnView, type ChatItem, type ChatTurn } from './chat.js';

const OPEN_ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M9 2h5v5M14 2 7 9M12 9v4H3V4h4" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export function NoteCard({ note, onClose }: { note: Note; onClose?: () => void }): JSX.Element {
  return (
    <div className={`cc ${note.kind}`} role={note.kind === 'err' ? 'alert' : 'status'}>
      <b>{note.title}</b>
      {note.broke && (
        <div>
          <i>Broke</i>
          {note.broke}
        </div>
      )}
      {note.next && (
        <div>
          <i>Next</i>
          {note.next}
        </div>
      )}
      <div className="mbtn">
        {note.action && <button onClick={note.action.run}>{note.action.label}</button>}
        {onClose && <button onClick={onClose}>Close</button>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- Chat */

const MODELS: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Opus', value: 'opus' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Haiku', value: 'haiku' },
];

interface Session {
  id: string;
  cwd: string;
  start: number;
  last: number;
  first: string;
}

const norm = (p: string): string => p.split('\\').join('/').replace(/\/+$/, '').toLowerCase();

/** The Claude Code sessions that worked in this project, newest first. */
function sessionsOf(events: CvEvent[], root: string): Session[] {
  const m = new Map<string, Session>();
  for (const e of events) {
    if (!e.sessionId) continue;
    let s = m.get(e.sessionId);
    if (!s) {
      s = { id: e.sessionId, cwd: '', start: e.ts, last: e.ts, first: '' };
      m.set(e.sessionId, s);
    }
    s.last = Math.max(s.last, e.ts);
    s.start = Math.min(s.start, e.ts);
    if (e.type === 'session.start') s.cwd = e.cwd;
    if (e.type === 'prompt' && !s.first) s.first = e.text;
  }
  const r = norm(root);
  return [...m.values()].filter((s) => !r || !s.cwd || norm(s.cwd) === r || norm(s.cwd).startsWith(`${r}/`)).sort((a, b) => b.last - a.last);
}

const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const sessionName = (s: Session): string => `${clock(s.start)} · ${s.first ? s.first.slice(0, 26) : 'Claude Code session'}`;

export function ChatWidget(): JSX.Element {
  const { events, root, git, sendPrompt, agentParts, agentRunning, agentSince, pending, stopAgent, note, setNote, openEditor, analysis, askMap, mapping } = useCv();
  // What is typed stays with its project, so switching projects or restarting does not lose it.
  const draftKey = `cv.chat.draft:${root}`;
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? '');
  useEffect(() => {
    setText(localStorage.getItem(draftKey) ?? '');
    // Only when the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      // Keeping the draft is a convenience only.
    }
  }, [text, draftKey]);
  const [model, setModel] = useState('');
  const [menu, setMenu] = useState(false);
  // Which AI engine the Chat sends to. Claude Code has named models; the others use their own default.
  const { engines } = useEngines();
  const [engine, setEngine] = useState(() => localStorage.getItem('cv.chat.engine') ?? 'claude');
  const [engMenu, setEngMenu] = useState(false);
  // Team mode: the prompt goes to the Lead, who picks the specialists it needs. The team runs on Claude Code.
  const [teamOn, setTeamOn] = useState(() => localStorage.getItem('cv.chat.team') === '1');
  const setTeam = (v: boolean): void => {
    setTeamOn(v);
    try {
      localStorage.setItem('cv.chat.team', v ? '1' : '0');
    } catch {
      // Remembering the switch is a convenience only.
    }
  };
  const { run: teamRun } = useTeam();
  const myTeamRun = teamRun && root && teamRun.root.replace(/[\\/]+$/, '').toLowerCase() === root.replace(/[\\/]+$/, '').toLowerCase() ? teamRun : null;
  const teamBusy = !!myTeamRun && !['done', 'stopped', 'failed'].includes(myTeamRun.state);
  const engineLabel = engines?.find((e) => e.id === engine)?.label ?? (engine === 'claude' ? 'Claude Code' : engine);
  const pickEngine = (id: string): void => {
    setEngine(id);
    setEngMenu(false);
    localStorage.setItem('cv.chat.engine', id);
  };
  const [confirm, setConfirm] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [newSince, setNewSince] = useState(0);
  const [sesMenu, setSesMenu] = useState(false);
  const link = useAgentLink();
  // When Team is on, the Architect reads the project once, so every agent starts from the same map. It changes no code.
  useEffect(() => {
    if (!teamOn || !root || !analysis || mapping || agentRunning) return;
    if (analysis.flow?.source === 'agent' || !link.claudeFound || !link.signedIn) return;
    const key = `cv.team.read:${root}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      return;
    }
    void askMap();
  }, [teamOn, root, analysis, mapping, agentRunning, link.claudeFound, link.signedIn, askMap]);
  const sessions = useMemo(() => sessionsOf(events, root), [events, root]);
  // After "New session", follow the first session that starts afterwards.
  useEffect(() => {
    if (picked !== 'new') return;
    const fresh = sessions.find((x) => x.start > newSince);
    if (fresh) setPicked(null);
  }, [sessions, picked, newSince]);
  const shownId = picked === 'new' ? null : (picked ?? sessions[0]?.id ?? null);
  // Events with no session (git commits, pushes) belong to the project, so they show in every view.
  const mine = useMemo(() => events.filter((e) => !e.sessionId || e.sessionId === shownId), [events, shownId]);
  const items = useMemo(() => (picked === 'new' ? [] : buildItems(mine, root)), [mine, picked, root]);
  // A prompt shows the moment it is sent. The agent reports it back a few seconds later; until then it is added here.
  const { shown, liveTurn } = useMemo((): { shown: ChatItem[]; liveTurn: ChatTurn | null } => {
    const list = [...items];
    const lastTurn = (): ChatTurn | null => {
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i]!;
        if (it.kind === 'turn') return it.turn;
      }
      return null;
    };
    if (pending && !mine.some((e) => e.type === 'prompt' && e.ts >= pending.at - 1500)) {
      const end = lastTurn();
      // It ended before it could report the prompt (it could not start): the prompt still belongs above its error.
      if (end && end.prompt === undefined && end.ts >= pending.at - 1500) end.prompt = pending.text;
      else list.push({ kind: 'turn', turn: { id: `pending${pending.at}`, ts: pending.at, prompt: pending.text, steps: [], answer: '', ended: false, failed: false } });
    }
    const end = lastTurn();
    return { shown: list, liveTurn: end && pending && end.ts >= pending.at - 1500 ? end : null };
  }, [items, pending, mine]);

  // Follow the answer as it is written, unless the user has scrolled up to read something.
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const toEnd = (): void => {
    stick.current = true;
    setAway(false);
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  };
  const onScroll = (): void => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAway(!stick.current);
  };
  useEffect(() => {
    if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [shown, agentParts, agentRunning, shownId]);
  useEffect(() => {
    // The box is ready for the next message as soon as the answer is in.
    if (!agentRunning) box.current?.focus();
  }, [agentRunning]);
  const lastPrompt = useMemo(() => {
    for (let i = shown.length - 1; i >= 0; i--) {
      const it = shown[i]!;
      if (it.kind === 'turn' && it.turn.prompt) return it.turn.prompt;
    }
    return '';
  }, [shown]);

  const grow = (): void => {
    const t = box.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(150, t.scrollHeight + 2)}px`;
  };

  /** Sends one prompt to the engine and the session that are picked. */
  const send = async (prompt: string): Promise<boolean> => {
    toEnd();
    // A new session starts a fresh conversation; a picked older one is continued; otherwise the current one goes on.
    // Only Claude Code has named models and sessions; the other engines take the prompt on its own.
    return sendPrompt(prompt, engine === 'claude' ? model : '', { fresh: picked === 'new', sessionId: picked && picked !== 'new' ? picked : undefined, engine });
  };

  const go = async (): Promise<void> => {
    const prompt = text.trim();
    if (!prompt || !root || agentRunning) return;
    if (!localStorage.getItem('cv.app.agentOk')) {
      setConfirm(true);
      return;
    }
    if (teamOn) {
      try {
        await api('/api/team/start', { path: root, request: prompt });
        setText('');
        requestAnimationFrame(grow);
      } catch (err) {
        const p = (err as { problem?: { what: string; why: string[]; next: string } }).problem;
        setNote({ kind: 'err', title: p?.what ?? 'Could not start the team', broke: p?.why.join('. '), next: p?.next ?? (err instanceof Error ? err.message : undefined) });
      }
      return;
    }
    // The box empties at once, like every chat. If sending fails, the words come back.
    setText('');
    requestAnimationFrame(grow);
    if (!(await send(prompt))) {
      setText((now) => now || prompt);
      requestAnimationFrame(grow);
    }
  };

  return (
    <div className="chat">
      <div className="sesbar">
        <div className="menuwrap">
          <button className="ch" aria-haspopup="menu" aria-expanded={sesMenu} onClick={() => setSesMenu((v) => !v)} title="Switch session">
            {picked === 'new' ? 'New session' : shownId ? `${sessions[0]?.id === shownId ? 'Current · ' : ''}${sessionName(sessions.find((x) => x.id === shownId)!)}` : 'No session yet'} ▾
          </button>
          {sesMenu && (
            <div className="menu" role="menu">
              <div className="mh">Sessions in this project</div>
              {sessions.length === 0 && <div className="mut small pad">Nothing yet. Start Claude Code here, or send a prompt below.</div>}
              {sessions.slice(0, 20).map((x, i) => (
                <button
                  key={x.id}
                  role="menuitem"
                  onClick={() => {
                    setPicked(i === 0 ? null : x.id);
                    setSesMenu(false);
                  }}
                >
                  <span>{i === 0 ? 'Current · ' : ''}{sessionName(x)}</span>
                  {x.id === shownId && picked !== 'new' && <i>on</i>}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="sp" />
        <button
          className="btn sm ib"
          title="New session"
          aria-label="New session"
          onClick={() => {
            setNewSince(Date.now());
            setPicked('new');
            setSesMenu(false);
          }}
        >
          <Ico name="newChat" />
        </button>
      </div>
      <div className="msgs" ref={scroller} onScroll={onScroll} role="log" aria-label="Conversation">
        {!root && <p className="mut">Open a project to start.</p>}
        {root && shown.length === 0 && (
          <p className="mut">{teamOn ? 'Describe a feature or a fix. The Lead picks the specialists it needs and shows you its pick before anyone starts.' : engine === 'claude' ? 'Tell Claude Code what to build. It runs on this computer with your own sign-in, remembers this conversation, and everything it does shows up here and in the town.' : `Tell ${engineLabel} what to build. It runs on this computer with your own sign-in, and what it prints shows up here.`}</p>
        )}
        {root && engine === 'claude' && !link.claudeFound && (
          <div className="cc err"><b>Claude Code is not installed</b><div><i>Next</i>Install Claude Code, check that `claude` runs in a terminal, then restart Codeville.</div></div>
        )}
        {root && engine === 'claude' && link.claudeFound && !link.signedIn && (
          <div className="cc err"><b>Claude Code is not signed in</b><div><i>Next</i>Open a terminal, run `claude` and sign in. This message goes away by itself.</div></div>
        )}
        {shown.map((it, i) =>
          it.kind === 'note' ? (
            <div key={it.id} className="tool dim">
              <i />
              <span className="steptext">{it.text}</span>
            </div>
          ) : (
            <TurnView
              key={it.turn.id}
              turn={it.turn}
              root={root}
              who={it.turn === liveTurn ? engineLabel : 'Claude Code'}
              live={it.turn === liveTurn ? { parts: agentParts, since: (pending?.at ?? agentSince) + 500, running: agentRunning } : undefined}
              onOpen={openEditor}
              onRetry={i === shown.length - 1 && !agentRunning && it.turn.prompt ? () => void send(it.turn.prompt!) : undefined}
            />
          ),
        )}
        {myTeamRun && <TeamRunCard run={myTeamRun} />}
      </div>
      {away && (
        <button className="tolatest" onClick={toEnd}>
          {agentRunning ? 'Follow the answer ↓' : 'Latest ↓'}
        </button>
      )}

      <div className="composer">
        {note && <NoteCard note={note} onClose={() => setNote(null)} />}
        {confirm && (
          <div className="cc info">
            <b>Run {teamOn ? 'the team' : engineLabel} in this folder?</b>
            <div>
              <i>Note</i>
              {teamOn ? `The team runs Claude Code and can edit files in ${root}. Codeville limits what each agent may change.` : `It can read and edit files in ${root}. Your ${engineLabel} settings and sign-in apply.`}
            </div>
            <div className="mbtn">
              <button
                onClick={() => {
                  localStorage.setItem('cv.app.agentOk', '1');
                  setConfirm(false);
                  void go();
                }}
              >
                Run, and don't ask again
              </button>
              <button onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          </div>
        )}
        <div className="pbox">
          <textarea
            ref={box}
            rows={2}
            value={text}
            aria-label="Prompt"
            placeholder={!root ? 'Open a project first' : teamOn ? 'Describe a feature or a fix for the team' : 'Describe what to build or fix'}
            disabled={!root}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void go();
              } else if (e.key === 'Escape' && agentRunning) {
                e.preventDefault();
                void stopAgent();
              } else if (e.key === 'ArrowUp' && !text && lastPrompt) {
                // Up in an empty box brings back the last prompt, to change it and send it again.
                e.preventDefault();
                setText(lastPrompt);
                requestAnimationFrame(grow);
              }
            }}
          />
          <div className="pbar">
            <TeamToggle on={teamOn} onChange={setTeam} />
            {!teamOn && <div className="menuwrap">
              <button className="ch" aria-haspopup="menu" onClick={() => setEngMenu((v) => !v)} title="AI engine">
                {engineLabel}
              </button>
              {engMenu && (
                <div className="menu" role="menu">
                  <div className="mh">AI engine</div>
                  {(engines ?? []).map((e) => (
                    <button key={e.id} role="menuitem" disabled={!e.found} title={e.found ? undefined : 'Not installed. Set it up in Extensions.'} onClick={() => pickEngine(e.id)}>
                      <span>{e.label}{e.found ? '' : ' (not installed)'}</span>
                      {e.id === engine && <i>on</i>}
                    </button>
                  ))}
                  <button role="menuitem" onClick={() => { setEngMenu(false); openEngines(); }}>
                    <span>Set up engines…</span>
                  </button>
                </div>
              )}
            </div>}
            {!teamOn && engine === 'claude' && <div className="menuwrap">
              <button className="ch" aria-haspopup="menu" onClick={() => setMenu((v) => !v)} title="Model">
                {MODELS.find((m) => m.value === model)?.label ?? 'Default'}
              </button>
              {menu && (
                <div className="menu" role="menu">
                  <div className="mh">Model</div>
                  {MODELS.map((m) => (
                    <button
                      key={m.value}
                      role="menuitem"
                      onClick={() => {
                        setModel(m.value);
                        setMenu(false);
                      }}
                    >
                      <span>{m.label}</span>
                      {m.value === model && <i>on</i>}
                    </button>
                  ))}
                </div>
              )}
            </div>}
            <span className="sp" />
            {agentRunning ? (
              <button className="send stop" onClick={() => void stopAgent()} title="Stop (Esc)" aria-label="Stop">
                <Ico name="stop" />
              </button>
            ) : (
              <button className="send" onClick={() => void go()} disabled={!root || !text.trim() || (teamOn && teamBusy)} title={teamOn && teamBusy ? 'The team is working. Wait for it, or press Stop on the run.' : 'Send (Enter)'} aria-label="Send">
                <Ico name="send" />
              </button>
            )}
          </div>
        </div>
        <div className="phint" aria-live="polite">
          <span className="branch" title="Current git branch">{git?.branch ?? 'no branch'}</span>
          {agentRunning ? (text.trim() ? `${engineLabel} is still working. Stop it (Esc) to send this now, or wait.` : `${engineLabel} is working · Esc to stop`) : 'Enter to send · Shift+Enter for a new line'}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- Files */

export function FilesWidget(): JSX.Element {
  const { analysis, git, events, selected, select, openEditor } = useCv();
  const [view, setView] = useState<'feature' | 'folder'>('feature');

  const status = useMemo(() => new Map((git?.files ?? []).map((f) => [f.path, f.status])), [git]);
  const touched = useMemo(() => {
    const s = new Set<string>();
    for (const e of events.slice(-200)) if (e.type === 'file.change') s.add(e.path);
    return s;
  }, [events]);
  const broken = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e?.type === 'run.end') return e.status === 'fail' ? e.problem?.file : undefined;
    }
    return undefined;
  }, [events]);

  if (!analysis) return <p className="mut pad">Open a project to see its files.</p>;

  const row = (path: string, featureId?: string): JSX.Element => {
    const st = status.get(path);
    return (
      <div key={path} className={`tn fl${selected === path ? ' sel' : ''}`} data-feature={featureId}>
        <button className="nm" onClick={() => select(selected === path ? null : path)} title={path}>
          {path}
        </button>
        {broken && (path === broken || path.endsWith('/' + broken) || broken.endsWith('/' + path)) && <span className="bd e">!</span>}
        {st && <span className={`bd ${st}`}>{st}</span>}
        {touched.has(path) && <span className="live" title="Changed by the agent" />}
        <button className="ico" title="Open in editor" aria-label={`Open ${path} in editor`} onClick={() => openEditor(path)}>
          {OPEN_ICON}
        </button>
      </div>
    );
  };

  const folders = new Map<string, string[]>();
  if (view === 'folder') for (const f of analysis.features.flatMap((x) => x.files)) {
    const d = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
    folders.set(d, [...(folders.get(d) ?? []), f.path]);
  }

  return (
    <div className="files">
      <div className="seg">
        <button className="ib" aria-pressed={view === 'feature'} onClick={() => setView('feature')} title="By feature" aria-label="By feature"><Ico name="feature" /></button>
        <button className="ib" aria-pressed={view === 'folder'} onClick={() => setView('folder')} title="By folder" aria-label="By folder"><Ico name="folder" /></button>
      </div>
      <div className="tree">
        {view === 'feature'
          ? analysis.features.map((f) => (
              <div key={f.id}>
                <div className="tn feat">
                  <button className="nm" onClick={() => analysis.features.length && select(f.files[0]?.path ?? null)}>
                    {f.name}
                  </button>
                  <em>{f.files.length}</em>
                </div>
                {f.files.map((x) => row(x.path, f.id))}
              </div>
            ))
          : [...folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, paths]) => (
              <div key={d}>
                <div className="tn feat">
                  <span className="nm">{d}/</span>
                  <em>{paths.length}</em>
                </div>
                {paths.sort().map((p) => row(p))}
              </div>
            ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------ Source control */

export function GitWidget(): JSX.Element {
  const { git, gitError, root, gitAct, note, setNote, openEditor, refreshGit } = useCv();
  const [msg, setMsg] = useState('');
  const staged = git?.files.filter((f) => f.staged) ?? [];
  const unstaged = git?.files.filter((f) => f.unstaged) ?? [];

  if (!root) return <p className="mut pad">Open a project to see its changes.</p>;
  if (gitError && !git) {
    return (
      <div className="gp">
        <NoteCard note={{ kind: 'err', title: gitError.what, broke: gitError.why.join('. '), next: gitError.next }} />
      </div>
    );
  }

  const stageFiles = (files: string[], on: boolean): void => void gitAct('/api/git/stage', { files, stage: on });
  const commit = async (andPush: boolean): Promise<void> => {
    const ok = await gitAct('/api/git/commit', { message: msg });
    if (ok) {
      setMsg('');
      if (andPush) await gitAct('/api/git/push', {});
    }
  };

  const row = (f: { path: string; status: string; add: number; del: number }, on: boolean): JSX.Element => (
    <div key={f.path} className="gr">
      <span className={`bd ${f.status}`}>{f.status}</span>
      <button className="p" onClick={() => openEditor(f.path)} title={f.path}>
        {f.path}
      </button>
      <span className="a">+{f.add}</span>
      <span className="d">-{f.del}</span>
      <button className="gb" aria-label={`${on ? 'Unstage' : 'Stage'} ${f.path}`} onClick={() => stageFiles([f.path], !on)}>
        {on ? '-' : '+'}
      </button>
    </div>
  );

  return (
    <div className="gp">
      <div className="gtop">
        <span className="gbr">{git?.branch ?? '...'}</span>
        <span className="sp" />
        <button className="btn sm ib" onClick={() => void gitAct('/api/git/push', {})} disabled={!git || (git.ahead === 0 && git.hasUpstream)} title={git && git.ahead ? `Push ${git.ahead} commit${git.ahead === 1 ? '' : 's'}` : 'Push'} aria-label="Push">
          <Ico name="push" />
          {git && git.ahead ? <em>{git.ahead}</em> : null}
        </button>
        <button className="btn sm ib" onClick={() => void refreshGit()} title="Refresh" aria-label="Refresh">
          <Ico name="refresh" />
        </button>
      </div>
      {note && <NoteCard note={note} onClose={() => setNote(null)} />}
      <textarea className="gmsg" rows={3} value={msg} aria-label="Commit message" placeholder="Message: what changed" onChange={(e) => setMsg(e.target.value)} />
      <div className="gcm">
        <button className="big ib" onClick={() => void commit(false)} title="Commit" aria-label="Commit">
          <Ico name="check" />
        </button>
        <button className="btn sm ib" onClick={() => void commit(true)} title="Commit and push" aria-label="Commit and push">
          <Ico name="commitPush" />
        </button>
      </div>
      <div className="gsec">
        <b>Staged</b> {staged.length}
        <span className="sp" />
        {staged.length > 0 && <button className="ib" onClick={() => stageFiles(staged.map((f) => f.path), false)} title="Unstage all" aria-label="Unstage all"><Ico name="unstageAll" size={14} /></button>}
      </div>
      {staged.length === 0 && <p className="mut small">Nothing staged.</p>}
      {staged.map((f) => row(f, true))}
      <div className="gsec">
        <b>Changes</b> {unstaged.length}
        <span className="sp" />
        {unstaged.length > 0 && <button className="ib" onClick={() => stageFiles(unstaged.map((f) => f.path), true)} title="Stage all" aria-label="Stage all"><Ico name="stageAll" size={14} /></button>}
      </div>
      {unstaged.length === 0 && <p className="mut small">No changes.</p>}
      {unstaged.map((f) => row(f, false))}
    </div>
  );
}
