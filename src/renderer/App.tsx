import { useCallback, useEffect, useState } from 'react';
import { api, bridge } from './api.js';
import { Workspace, loadLayout, saveLayout, PRESETS, type Layout, type WId } from './layout.js';
import { useAgentLink } from './agentlink.js';
import { Ico } from './icons.js';
import { ConnectAgent, CustomizePanel, EditorPopup, ExtensionsPopup, NewProjectPopup, TerminalPopup } from './popups.js';
import { EnginesPage, openEngines } from './engines.js';
import { TeamPage, teamModels } from './team.js';
import { CvProvider, useCv } from './state.js';
import { AnalysisProgress, VizWidget } from './viz.js';
import { ChatWidget, FilesWidget, GitWidget } from './widgets.js';

export default function App(): JSX.Element {
  return (
    <CvProvider>
      <Shell />
    </CvProvider>
  );
}

function Shell(): JSX.Element {
  const cv = useCv();
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const [adjust, setAdjust] = useState(false);
  const [custom, setCustom] = useState(false);
  const [menu, setMenu] = useState(false);
  const [ext, setExt] = useState(false);
  useEffect(() => {
    // The editor's AI prompt opens Extensions at the AI models section.
    const open = (): void => {
      setExt(true);
      window.setTimeout(() => document.getElementById('ext-ai')?.scrollIntoView({ block: 'start' }), 50);
    };
    window.addEventListener('cv:open-ai-setup', open);
    return () => window.removeEventListener('cv:open-ai-setup', open);
  }, []);
  const [newp, setNewp] = useState(false);
  // The AI engines page covers the whole window, on top of the project or the welcome screen.
  const [engines, setEngines] = useState(false);
  const [team, setTeam] = useState(false);
  useEffect(() => {
    const open = (): void => {
      setTeam(false);
      setEngines(true);
    };
    const openT = (): void => {
      setEngines(false);
      setTeam(true);
    };
    window.addEventListener('cv:open-engines', open);
    window.addEventListener('cv:open-team', openT);
    return () => {
      window.removeEventListener('cv:open-engines', open);
      window.removeEventListener('cv:open-team', openT);
    };
  }, []);

  const setLayout = useCallback((fn: (l: Layout) => Layout) => {
    setLayoutState((l) => {
      const next = fn(l);
      saveLayout(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        cv.setTerminalOpen(!cv.terminalOpen);
      }
      if (e.key === 'Escape') {
        setMenu(false);
        setCustom(false);
        setAdjust(false);
        setEngines(false);
        setTeam(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cv]);

  // Hooks must run on every render, so this one stays above the early return below.
  const link = useAgentLink();

  const enginesPage = (
    <>
      {teamModels}
      {engines ? <EnginesPage onBack={() => setEngines(false)} /> : null}
      {team ? <TeamPage onBack={() => setTeam(false)} /> : null}
    </>
  );
  if (!cv.analysis) return <>{<Welcome />}{enginesPage}</>;

  const render = (id: WId): JSX.Element => (id === 'chat' ? <ChatWidget /> : id === 'viz' ? <VizWidget /> : id === 'files' ? <FilesWidget /> : <GitWidget />);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <i aria-hidden="true" />
          Codeville
        </div>
        <div className="menuwrap">
          <button className="btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            {cv.analysis.name} ▾
          </button>
          {menu && (
            <div className="menu pmenu" role="menu">
              <div className="mh">Project</div>
              <button role="menuitem" onClick={() => { setMenu(false); void cv.chooseFolder(); }}>
                <span>Open a folder…</span>
              </button>
              <button role="menuitem" onClick={() => { setMenu(false); setNewp(true); }}>
                <span>New or copy a project…</span>
              </button>
              {cv.recent.filter((r) => r !== cv.root).map((r) => (
                <button key={r} role="menuitem" onClick={() => { setMenu(false); void cv.openProject(r); }} title={r}>
                  <span>{r.split(/[\\/]/).pop()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="chip">
          {cv.analysis.kind} · {cv.analysis.totalFiles} files
        </span>
        <span className="sp" />
        <button className={`chip chipbtn ${link.state === 'active' ? 'ok' : ''}`} onClick={() => setExt(true)} title="Open Extensions">{link.state === 'active' ? 'Claude Code connected' : link.state === 'installed' ? 'Claude Code: waiting for a session' : 'Connect Claude Code'}</button>
        <span className={`chip ${cv.connected ? 'ok' : 'bad'}`}>{cv.connected ? 'App ready' : 'Reconnecting'}</span>
        <button className="btn ib" aria-pressed={cv.terminalOpen} onClick={() => cv.setTerminalOpen(!cv.terminalOpen)} title="Terminal (Ctrl+`)" aria-label="Terminal">
          <Ico name="terminal" />
        </button>
        <button className="btn ib" aria-pressed={cv.editorOpen} onClick={() => cv.setEditorOpen(!cv.editorOpen)} title="Editor" aria-label="Editor">
          <Ico name="editor" />
        </button>
        <button className="btn ib" aria-pressed={team} onClick={() => { setEngines(false); setTeam(!team); }} title="Team" aria-label="Team">
          <Ico name="team" />
        </button>
        <button className="btn ib" aria-pressed={engines} onClick={() => { setTeam(false); setEngines(!engines); }} title="AI engines" aria-label="AI engines">
          <Ico name="engine" />
        </button>
        <button className="btn ib" aria-pressed={ext} onClick={() => setExt(!ext)} title="Extensions" aria-label="Extensions">
          <Ico name="extensions" />
        </button>
        <button className="btn ib" aria-pressed={adjust} onClick={() => setAdjust(!adjust)} title="Adjust layout" aria-label="Adjust layout">
          <Ico name="layout" />
        </button>
        <button className="btn ib" aria-expanded={custom} onClick={() => setCustom(!custom)} title="Customize" aria-label="Customize">
          <Ico name="sliders" />
        </button>
        {custom && <CustomizePanel layout={layout} setLayout={setLayout} onClose={() => setCustom(false)} />}
      </header>

      {enginesPage}
      {cv.error && (
        <div className="notice bad" role="alert">
          <b>Broke</b> {cv.error}
        </div>
      )}
      {adjust && (
        <div className="adjbar">
          <b>Adjust layout</b>
          <span>Drag a widget to move it. Drag the bright bars to resize. Double-click a bar to reset it.</span>
          <span className="sp" />
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} className="btn sm" onClick={() => setLayout(() => structuredClone(p.layout))}>
              {p.name}
            </button>
          ))}
          <button className="big" onClick={() => setAdjust(false)}>
            Done
          </button>
        </div>
      )}

      <Workspace layout={layout} setLayout={setLayout} adjust={adjust} render={render} />
      <TerminalPopup />
      <EditorPopup />
      {ext && <ExtensionsPopup onClose={() => setExt(false)} />}
      {newp && <NewProjectPopup onClose={() => setNewp(false)} />}
    </div>
  );
}

interface Check {
  id: string;
  title: string;
  about: string;
  required: boolean;
  ok: boolean;
  version: string;
  next: string;
}

function Welcome(): JSX.Element {
  const cv = useCv();
  const b = bridge();
  const [typed, setTyped] = useState(cv.root);
  const [copied, setCopied] = useState(false);
  const [newp, setNewp] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const link = useAgentLink();
  const plugin = b.pluginPath ?? '<path to the plugin folder>';
  const commands = `/plugin marketplace add ${plugin}\n/plugin install code-visualizer@code-visualizer`;

  const runChecks = useCallback(() => {
    api<{ checks: Check[] }>('/api/doctor')
      .then((d) => setChecks(d.checks))
      .catch(() => setChecks(null));
  }, []);
  useEffect(() => {
    if (cv.connected) runChecks();
  }, [cv.connected, runChecks]);

  const gitMissing = checks?.some((c) => c.required && !c.ok) ?? false;
  const copy = (): void => {
    const done = (): void => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    navigator.clipboard.writeText(commands).then(done, done);
  };

  return (
    <div className="welcome">
      <div className="wcard">
        <div className="brand big">
          <i aria-hidden="true" />
          Codeville
        </div>
        <h1>See what your coding agent builds</h1>

        <section>
          <h2>
            <span className={`stepno ${cv.connected && !gitMissing ? 'done' : ''}`}>{cv.connected && !gitMissing ? '✓' : '1'}</span> Check this computer
          </h2>
          {!cv.connected && <p className="cs">The app backend is not answering yet. It starts by itself, so wait a few seconds.</p>}
          {checks && (
            <ul className="checks">
              {checks.map((c) => (
                <li key={c.id} className={c.ok ? 'ok' : c.required ? 'bad' : 'warn'}>
                  <b>{c.ok ? '✓' : c.required ? '✕' : '!'}</b>
                  <span>
                    {c.title}
                    <em>{c.ok ? c.version : `${c.about} ${c.next}`}</em>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {checks && checks.some((c) => !c.ok) && (
            <button className="btn sm" onClick={runChecks}>
              Check again
            </button>
          )}
        </section>

        <section>
          <h2>
            <span className={`stepno ${link.state !== 'none' ? 'done' : ''}`}>{link.state !== 'none' ? '✓' : '2'}</span> Connect your agent <span className="opt">optional</span>
          </h2>
          <p className="mut">One click adds the Codeville plugin to Claude Code. You can also do this later from Extensions.</p>
          <ConnectAgent />
          <p className="mut small">Using Copilot, Codex, Gemini or another agent? <button className="lnk" onClick={openEngines}>Set up AI engines</button></p>
        </section>

        <section>
          <h2>
            <span className="stepno">3</span> Open a project
          </h2>
          <p className="mut">The app reads it once to build its town.</p>
          {cv.error && (
            <div className="cc err" role="alert">
              <b>Could not open that folder</b>
              <div>
                <i>Broke</i>
                {cv.error}
              </div>
              <div>
                <i>Next</i>
                Check the path, or choose the folder with the button.
              </div>
            </div>
          )}
          {b.pickFolder ? (
            <button className="big" disabled={cv.busy} onClick={() => void cv.chooseFolder()}>
              {cv.busy ? 'Reading the project…' : 'Open a folder'}
            </button>
          ) : (
            <form
              className="pathform"
              onSubmit={(e) => {
                e.preventDefault();
                void cv.openProject(typed);
              }}
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="C:\path\to\project" aria-label="Project folder" />
              <button className="big" type="submit" disabled={cv.busy}>
                {cv.busy ? 'Reading…' : 'Open'}
              </button>
            </form>
          )}
          <AnalysisProgress />
          <button className="btn" onClick={() => setNewp(true)}>
            Start a new project or copy one
          </button>
          {cv.recent.length > 0 && (
            <div className="recent">
              <span className="fl">Recent</span>
              {cv.recent.map((r) => (
                <button key={r} className="lnk" onClick={() => void cv.openProject(r)} title={r}>
                  {r.split(/[\\/]/).pop()}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      {newp && <NewProjectPopup onClose={() => setNewp(false)} />}
    </div>
  );
}
