import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, bridge } from './api.js';
import { ALL, PRESETS, TITLES, type Layout } from './layout.js';
import { useAgentLink } from './agentlink.js';
import { Ico } from './icons.js';
import { useCv } from './state.js';

interface PopupProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  initial?: { right?: number; bottom?: number; top?: number; left?: number };
}

/** A window that floats above the layout. Drag its header to move it; pull the corner to resize it. */
export function Popup({ title, onClose, children, className = '', initial }: PopupProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      if (!drag.current || !ref.current) return;
      const el = ref.current;
      el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.current.dx))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.dy))}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };
    const up = (): void => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`tpop ${className}`}
      role="dialog"
      aria-label={title}
      style={{ right: initial?.right ?? 18, bottom: initial?.bottom, top: initial?.top, left: initial?.left }}
      onPointerDown={() => {
        document.querySelectorAll<HTMLElement>('.tpop').forEach((p) => (p.style.zIndex = '70'));
        if (ref.current) ref.current.style.zIndex = '71';
      }}
    >
      <div
        className="tph"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const r = ref.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
          e.preventDefault();
        }}
      >
        <span className="grip" aria-hidden="true">::</span>
        <b>{title}</b>
        <span className="sp" />
        <button className="ib" onClick={onClose} aria-label={`Close ${title}`} title="Close"><Ico name="close" size={14} /></button>
      </div>
      <div className="tpb">{children}</div>
    </div>
  );
}

export function TerminalPopup(): JSX.Element | null {
  const { terminalOpen, setTerminalOpen, run, root, output } = useCv();
  const [cmd, setCmd] = useState('');
  const hist = useRef<string[]>([]);
  const idx = useRef(0);
  const out = useRef<HTMLDivElement>(null);

  useEffect(() => {
    out.current?.scrollTo({ top: out.current.scrollHeight });
  }, [output.length, terminalOpen]);

  if (!terminalOpen) return null;
  const submit = (c: string): void => {
    if (!c.trim()) return;
    hist.current.push(c);
    idx.current = hist.current.length;
    void run(c);
    setCmd('');
  };

  return (
    <Popup title="Terminal" onClose={() => setTerminalOpen(false)} className="term" initial={{ right: 18, bottom: 18 }}>
      <div className="tq">
        {['npm test', 'npm run lint', 'npm run build', 'git status'].map((c) => (
          <button key={c} onClick={() => submit(c)} disabled={!root}>
            {c}
          </button>
        ))}
      </div>
      <div className="termout" ref={out} role="log" aria-label="Terminal output">
        {output.length === 0 && <div className="dim">Run a command. Test, lint and build results also show in the Test view.</div>}
        {output.slice(-250).map((o, i) => (
          <div key={i} className={o.stream === 'err' ? 'tbad' : ''}>
            {o.line}
          </div>
        ))}
      </div>
      <form
        className="tin"
        onSubmit={(e) => {
          e.preventDefault();
          submit(cmd);
        }}
      >
        <span>$</span>
        <input
          value={cmd}
          autoFocus
          spellCheck={false}
          aria-label="Terminal command"
          placeholder={root ? 'npm test' : 'Open a project first'}
          disabled={!root}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && hist.current.length) {
              idx.current = Math.max(0, idx.current - 1);
              setCmd(hist.current[idx.current] ?? '');
            }
            if (e.key === 'ArrowDown') {
              idx.current = Math.min(hist.current.length, idx.current + 1);
              setCmd(hist.current[idx.current] ?? '');
            }
          }}
        />
      </form>
    </Popup>
  );
}

interface FileBody {
  file: string;
  text: string;
  lines: number;
  truncated: boolean;
}

export function EditorPopup(): JSX.Element | null {
  const { editorOpen, setEditorOpen, editorFile, root } = useCv();
  const [body, setBody] = useState<FileBody | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!editorOpen || !editorFile || !root) return;
    let live = true;
    setErr('');
    api<FileBody>('/api/file', { path: root, file: editorFile })
      .then((b) => live && setBody(b))
      .catch((e: unknown) => {
        if (!live) return;
        setBody(null);
        setErr(e instanceof Error ? e.message : 'Could not open that file');
      });
    return () => {
      live = false;
    };
  }, [editorOpen, editorFile, root]);

  if (!editorOpen) return null;
  const lines = body ? body.text.split(/\r?\n/) : [];
  return (
    <Popup title={editorFile ?? 'Editor'} onClose={() => setEditorOpen(false)} className="editor" initial={{ top: 90, right: 40 }}>
      {!editorFile && <p className="mut pad">Pick a file in Files, Source control or the town to see it here.</p>}
      {err && (
        <div className="cc err pad">
          <b>Could not open that file</b>
          <div>
            <i>Broke</i>
            {err}
          </div>
        </div>
      )}
      {body && (
        <div className="code" aria-label={`Contents of ${body.file}`}>
          {lines.map((l, i) => (
            <div key={i} className="ln">
              <i>{i + 1}</i>
              <s>{l || ' '}</s>
            </div>
          ))}
          {body.truncated && <div className="mline">Only the first part of this file is shown.</div>}
        </div>
      )}
    </Popup>
  );
}

interface Template {
  id: string;
  title: string;
  about: string;
}

/** Start a project: a new folder from a template, or a copy of a repository. */
export function NewProjectPopup({ onClose }: { onClose: () => void }): JSX.Element {
  const { openProject } = useCv();
  const b = bridge();
  const [mode, setMode] = useState<'new' | 'clone'>('new');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [template, setTemplate] = useState('node');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ what: string; next: string } | null>(null);

  useEffect(() => {
    api<{ templates: Template[] }>('/api/project/templates')
      .then((d) => setTemplates(d.templates))
      .catch(() => setTemplates([]));
  }, []);

  const pick = async (): Promise<void> => {
    const p = await b.pickFolder?.();
    if (p) setParent(p);
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const res =
        mode === 'new'
          ? await api<{ root: string }>('/api/project/new', { parent, name, template })
          : await api<{ root: string }>('/api/project/clone', { parent, url });
      await openProject(res.root);
      onClose();
    } catch (e) {
      const p = (e as { problem?: { what: string; why: string[]; next: string } }).problem;
      setErr({ what: p ? p.what : e instanceof Error ? e.message : 'Could not start the project', next: p?.next ?? 'Check the fields and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const ready = !!parent && (mode === 'new' ? !!name : !!url);
  return (
    <Popup title="Start a project" onClose={onClose} className="newp" initial={{ top: 90, left: 140 }}>
      <form
        className="newform"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void submit();
        }}
      >
        <div className="seg" role="tablist" aria-label="How to start">
          <button type="button" role="tab" aria-selected={mode === 'new'} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>New</button>
          <button type="button" role="tab" aria-selected={mode === 'clone'} aria-pressed={mode === 'clone'} onClick={() => setMode('clone')}>Copy a repository</button>
        </div>

        {mode === 'new' && (
          <>
            <label className="fl" htmlFor="np-name">Name</label>
            <input id="np-name" type="text" value={name} placeholder="my-shop" onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="fl">Template</div>
            <div className="tpls">
              {templates.map((t) => (
                <button type="button" key={t.id} className={`tpl ${template === t.id ? 'on' : ''}`} aria-pressed={template === t.id} onClick={() => setTemplate(t.id)}>
                  <b>{t.title}</b>
                  <span>{t.about}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {mode === 'clone' && (
          <>
            <label className="fl" htmlFor="np-url">Repository link</label>
            <input id="np-url" type="text" value={url} placeholder="https://github.com/you/project.git" onChange={(e) => setUrl(e.target.value)} autoFocus />
          </>
        )}

        <label className="fl" htmlFor="np-parent">Put it in</label>
        <div className="pathform">
          <input id="np-parent" type="text" value={parent} placeholder="C:\Users\you\projects" onChange={(e) => setParent(e.target.value)} />
          {b.pickFolder && (
            <button type="button" className="btn" onClick={() => void pick()}>
              Browse
            </button>
          )}
        </div>

        {err && (
          <div className="cc err" role="alert">
            <b>{err.what}</b>
            <div>
              <i>Next</i>
              {err.next}
            </div>
          </div>
        )}
        <button className="big" type="submit" disabled={!ready || busy}>
          {busy ? (mode === 'new' ? 'Creating…' : 'Copying…') : mode === 'new' ? 'Create project' : 'Copy and open'}
        </button>
      </form>
    </Popup>
  );
}

/** The one place that connects Claude Code: a single button, then proof that events arrive. */
export function ConnectAgent(): JSX.Element {
  const link = useAgentLink();
  const [copied, setCopied] = useState(false);
  const plugin = bridge().pluginPath ?? '<path to the plugin folder>';
  const commands = `/plugin marketplace add ${plugin}\n/plugin install code-visualizer@code-visualizer`;
  const copy = (): void => {
    const done = (): void => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    navigator.clipboard.writeText(commands).then(done, done);
  };

  const off = (
    <>
      {link.error && (
        <div className="cc err" role="alert">
          <b>{link.error.what}</b>
          <div>
            <i>Next</i>
            {link.error.next}
          </div>
        </div>
      )}
      <button className="btn sm ib" disabled={link.disconnecting} onClick={() => void link.disconnect()} title="Remove the Codeville plugin from Claude Code" aria-label="Disconnect Claude Code">
        <Ico name="unlink" />
        {link.disconnecting ? 'Disconnecting…' : 'Disconnect'}
      </button>
    </>
  );

  if (link.state === 'active') {
    return (
      <>
        <p className="cs ok">Connected. Claude Code activity is arriving.</p>
        {off}
      </>
    );
  }
  if (link.state === 'installed' || link.justConnected) {
    return (
      <div className="cc info">
        <b>Plugin installed</b>
        <div>
          <i>Next</i>
          Start a new Claude Code session (or restart the open one), then ask it anything. This turns green when the first event arrives.
        </div>
        {off}
      </div>
    );
  }
  return (
    <>
      <button className="big" disabled={link.connecting || !link.claudeFound} onClick={() => void link.connect()}>
        {link.connecting ? 'Connecting…' : 'Connect Claude Code'}
      </button>
      {!link.claudeFound && (
        <div className="cc err">
          <b>Claude Code was not found</b>
          <div>
            <i>Next</i>
            Install Claude Code, then restart Codeville.
          </div>
        </div>
      )}
      {link.error && (
        <div className="cc err" role="alert">
          <b>{link.error.what}</b>
          <div>
            <i>Next</i>
            {link.error.next}
          </div>
        </div>
      )}
      <details className="manual">
        <summary>Connect by hand instead</summary>
        <p className="mut small">Run these inside Claude Code:</p>
        <pre className="cmd">{commands}</pre>
        <button className="btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy commands'}</button>
      </details>
    </>
  );
}

/** What can connect to the app. Claude Code works today; the others are listed so people can see what is coming. */
export function ExtensionsPopup({ onClose }: { onClose: () => void }): JSX.Element {
  const { git, root } = useCv();
  const link = useAgentLink();

  return (
    <Popup title="Extensions" onClose={onClose} className="ext" initial={{ top: 90, right: 60 }}>
      <div className="extlist">
        <section className="extcard">
          <div className="exth">
            <b>Claude Code</b>
            <span className={`chip ${link.state === 'active' ? 'ok' : ''}`}>{link.state === 'active' ? 'Connected' : link.state === 'installed' ? 'Installed' : 'Not connected'}</span>
          </div>
          <p className="mut small">Shows what the agent edits and runs, and lets you send prompts from the Chat.</p>
          <ConnectAgent />
        </section>

        <section className="extcard">
          <div className="exth">
            <b>Git and GitHub</b>
            <span className={`chip ${git ? 'ok' : ''}`}>{git ? `On ${git.branch}` : root ? 'No git repository' : 'No project'}</span>
          </div>
          <p className="mut small">Stage, commit and push from Source control. Pushing uses the git login already on this computer, so nothing is stored here.</p>
        </section>

        {['Codex', 'Cursor', 'Gemini CLI'].map((n) => (
          <section key={n} className="extcard soon">
            <div className="exth">
              <b>{n}</b>
              <span className="chip">Coming later</span>
            </div>
          </section>
        ))}
      </div>
    </Popup>
  );
}

export function CustomizePanel({ layout, setLayout, onClose }: { layout: Layout; setLayout: (fn: (l: Layout) => Layout) => void; onClose: () => void }): JSX.Element {
  return (
    <div className="cust" role="dialog" aria-label="Customize">
      <div className="fl">Layout</div>
      <div className="row2">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} className="btn sm" onClick={() => setLayout(() => structuredClone(p.layout))}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="fl">Widgets</div>
      {ALL.map((id) => (
        <label key={id}>
          <input type="checkbox" checked={layout.vis[id]} onChange={(e) => setLayout((l) => ({ ...l, vis: { ...l.vis, [id]: e.target.checked } }))} />
          {TITLES[id]}
        </label>
      ))}
      <p className="mut small">Drag a widget header to move it. Drag the thin bars between widgets to resize.</p>
      <button className="btn sm" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
