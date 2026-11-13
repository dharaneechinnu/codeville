import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Analysis } from '../shared/types.js';
import type { CvEvent, Problem } from '../shared/events.js';
import { api, bridge, useEventStream, type OutputLine } from './api.js';
import type { Town } from './town.js';

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D';
  staged: boolean;
  unstaged: boolean;
  add: number;
  del: number;
}

export interface GitChanges {
  branch: string;
  ahead: number;
  hasUpstream: boolean;
  files: ChangedFile[];
}

export interface Note {
  kind: 'ok' | 'err' | 'info';
  title: string;
  broke?: string;
  next?: string;
  action?: { label: string; run: () => void };
}

export type Popup = 'terminal' | 'editor' | null;

interface Ctx {
  root: string;
  analysis: Analysis | null;
  events: CvEvent[];
  output: OutputLine[];
  connected: boolean;
  busy: boolean;
  error: string;
  git: GitChanges | null;
  gitError: Problem | null;
  note: Note | null;
  setNote: (n: Note | null) => void;
  selected: string | null;
  select: (path: string | null) => void;
  editorFile: string | null;
  /** Opens a file in the editor; with { ai: true } the AI prompt is focused, ready to type. { dock: true } opens it
   * fixed to the right of the town instead of as a floating window; without `dock` the editor stays where it is. */
  openEditor: (path: string, opts?: { ai?: boolean; dock?: boolean }) => void;
  /** The editor is fixed to the right of the town (hand control) instead of floating. */
  editorDocked: boolean;
  setEditorDocked: (v: boolean) => void;
  /** Goes up each time the editor is opened for an AI edit. */
  editorAsk: number;
  terminalOpen: boolean;
  editorOpen: boolean;
  setTerminalOpen: (v: boolean) => void;
  setEditorOpen: (v: boolean) => void;
  townRef: React.MutableRefObject<Town | null>;
  openProject: (path: string) => Promise<void>;
  chooseFolder: () => Promise<void>;
  recent: string[];
  refreshGit: () => Promise<void>;
  gitAct: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  run: (command: string, cwd?: string) => Promise<void>;
  /** Sends a prompt to an AI engine. Claude Code continues the project's conversation unless `fresh` starts a new one or `sessionId` names another. */
  sendPrompt: (prompt: string, model: string, opts?: { fresh?: boolean; sessionId?: string; engine?: string }) => Promise<boolean>;
  agentLines: string[];
  agentRunning: boolean;
  /** Asks the connected agent to read the code and write the project map; the town rebuilds when it has. */
  askMap: () => Promise<void>;
  /** Forgets the agent's map and goes back to what the file names say. */
  clearMap: () => Promise<void>;
  /** The agent is reading the code for the map right now. */
  mapping: boolean;
  stopAgent: () => Promise<void>;
}

const CvContext = createContext<Ctx | null>(null);

export function useCv(): Ctx {
  const c = useContext(CvContext);
  if (!c) throw new Error('useCv must be used inside CvProvider');
  return c;
}

const LAST = 'cv.app.lastRoot';
const RECENT = 'cv.app.recent';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function problemOf(err: unknown): Problem | null {
  const p = (err as { problem?: Problem } | null)?.problem;
  return p ?? null;
}

export function CvProvider({ children }: { children: ReactNode }): JSX.Element {
  const townRef = useRef<Town | null>(null);
  const [root, setRoot] = useState(() => localStorage.getItem(LAST) ?? '');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [git, setGit] = useState<GitChanges | null>(null);
  const [gitError, setGitError] = useState<Problem | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editorFile, setEditorFile] = useState<string | null>(null);
  const [editorAsk, setEditorAsk] = useState(0);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDocked, setEditorDocked] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [agentRun, setAgentRun] = useState<string | null>(null);
  const [agentSince, setAgentSince] = useState(0);

  const { events, output, connected } = useEventStream(useCallback((e: CvEvent) => townRef.current?.handleEvent(e), []));

  const openProject = useCallback(async (path: string) => {
    setError('');
    setBusy(true);
    try {
      const a = await api<Analysis>('/api/analyze', { path });
      setAnalysis(a);
      setRoot(a.root);
      setSelected(null);
      setEditorFile(null);
      localStorage.setItem(LAST, a.root);
      const next = [a.root, ...readRecent().filter((r) => r !== a.root)].slice(0, 6);
      localStorage.setItem(RECENT, JSON.stringify(next));
      setRecent(next);
      townRef.current?.setProject(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that folder');
    } finally {
      setBusy(false);
    }
  }, []);

  const chooseFolder = useCallback(async () => {
    const picked = await bridge().pickFolder?.();
    if (picked) await openProject(picked);
  }, [openProject]);

  useEffect(() => {
    if (root) void openProject(root);
    // Open the last project once, when the window starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshGit = useCallback(async () => {
    if (!root) return;
    try {
      setGit(await api<GitChanges>('/api/git/changes', { path: root }));
      setGitError(null);
    } catch (err) {
      setGit(null);
      setGitError(problemOf(err) ?? { what: 'Git is not available', why: [err instanceof Error ? err.message : ''], next: 'Open a project that uses git.' });
    }
  }, [root]);

  // Keep the changes list fresh: when something happens, and now and then.
  const last = events[events.length - 1];
  useEffect(() => {
    if (!last) return;
    if (last.type === 'file.change' || last.type === 'git.commit' || last.type === 'git.push' || last.type === 'run.end' || last.type === 'turn.end') {
      const t = window.setTimeout(() => void refreshGit(), 600);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [last, refreshGit]);
  useEffect(() => {
    void refreshGit();
    const t = window.setInterval(() => void refreshGit(), 6000);
    return () => window.clearInterval(t);
  }, [refreshGit]);

  const gitAct = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await api<unknown>(path, { path: root, ...body });
        if (path === '/api/git/commit') {
          const r = res as { files: number; branch: string };
          setNote({ kind: 'ok', title: `Committed ${r.files} files on ${r.branch}`, next: 'Push to origin.' });
        } else if (path === '/api/git/push') {
          const r = res as { branch: string };
          setNote({ kind: 'ok', title: `Pushed to origin/${r.branch}`, next: 'Open a pull request on your git host.' });
        }
        await refreshGit();
        return true;
      } catch (err) {
        const p = problemOf(err);
        const setUp = p?.what === 'This branch is not on the server yet';
        setNote({
          kind: 'err',
          title: p?.what ?? 'That did not work',
          broke: p?.why.join('. ') ?? (err instanceof Error ? err.message : ''),
          next: p?.next,
          action: setUp ? { label: 'Push and set upstream', run: () => void gitAct('/api/git/push', { setUpstream: true }) } : undefined,
        });
        return false;
      }
    },
    [root, refreshGit],
  );

  const run = useCallback(
    async (command: string, cwd = '') => {
      if (!root || !command.trim()) return;
      setTerminalOpen(true);
      try {
        // The command runs in its own folder (for example backend), and messages stay relative to the project folder.
        await api('/api/run', { command, cwd: cwd ? `${root.replace(/[\\/]+$/, '')}/${cwd}` : root, root });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not run that command');
      }
    },
    [root],
  );

  const sendPrompt = useCallback(
    async (prompt: string, model: string, opts?: { fresh?: boolean; sessionId?: string; engine?: string }): Promise<boolean> => {
      if (!root) return false;
      try {
        const sentAt = Date.now() - 500;
        const r = await api<{ runId: string }>('/api/agent/send', { path: root, prompt, model, fresh: opts?.fresh ?? false, sessionId: opts?.sessionId ?? '', engine: opts?.engine ?? 'claude' });
        setAgentSince(sentAt);
        setAgentRun(r.runId);
        return true;
      } catch (err) {
        const p = problemOf(err);
        setNote({ kind: 'err', title: p?.what ?? 'Could not send that', broke: p?.why.join('. '), next: p?.next ?? (err instanceof Error ? err.message : undefined) });
        return false;
      }
    },
    [root],
  );

  const [mapping, setMapping] = useState(false);
  const askMap = useCallback(async () => {
    if (!root) return;
    try {
      const { prompt } = await api<{ prompt: string }>('/api/map/prompt', { path: root });
      if (await sendPrompt(prompt, '')) setMapping(true);
    } catch (err) {
      setNote({ kind: 'err', title: 'Could not ask Claude', broke: err instanceof Error ? err.message : '', next: 'Check that Claude Code is connected in Extensions.' });
    }
  }, [root, sendPrompt]);
  const clearMap = useCallback(async () => {
    if (!root) return;
    await api('/api/map/clear', { path: root }).catch(() => undefined);
    await openProject(root);
  }, [root, openProject]);

  // The town follows the map: rebuild when the agent finishes reading, or whenever the map file is written.
  useEffect(() => {
    if (!last || !root) return;
    const wrote = last.type === 'file.change' && last.path.replace(/\\/g, '/').endsWith('.codeville/map.json');
    const finished = mapping && last.type === 'turn.end';
    if (!wrote && !finished) return;
    if (finished) setMapping(false);
    const t = window.setTimeout(() => void openProject(root), 400);
    return () => window.clearTimeout(t);
    // Runs once per new event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);

  const stopAgent = useCallback(async () => {
    if (agentRun) await api('/api/stop', { runId: agentRun }).catch(() => undefined);
  }, [agentRun]);

  const agentLines = useMemo(() => (agentRun ? output.filter((o) => o.runId === agentRun).map((o) => o.line) : []), [output, agentRun]);
  const agentRunning = useMemo(() => {
    if (!agentRun) return false;
    // Only an ending that came after this prompt was sent counts; earlier turns ended too.
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e && e.ts < agentSince) break;
      if (e?.type === 'turn.end' && e.source === 'app') return false;
    }
    return true;
  }, [events, agentRun, agentSince]);

  const select = useCallback((path: string | null) => {
    setSelected(path);
    townRef.current?.select(path);
  }, []);

  const openEditor = useCallback((path: string, opts?: { ai?: boolean; dock?: boolean }) => {
    setEditorFile(path);
    setEditorOpen(true);
    if (opts?.dock !== undefined) setEditorDocked(opts.dock);
    if (opts?.ai) setEditorAsk((n) => n + 1);
  }, []);

  const value: Ctx = {
    root, analysis, events, output, connected, busy, error, git, gitError, note, setNote, selected, select, editorFile, openEditor, editorAsk, editorDocked, setEditorDocked,
    terminalOpen, editorOpen, setTerminalOpen, setEditorOpen, townRef, openProject, chooseFolder, recent, refreshGit, gitAct, run,
    sendPrompt, agentLines, agentRunning, stopAgent, askMap, clearMap, mapping,
  };
  return <CvContext.Provider value={value}>{children}</CvContext.Provider>;
}
