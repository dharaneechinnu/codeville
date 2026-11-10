import { useEffect, useMemo, useRef, useState } from 'react';
import { crisp, type CvEvent } from '../shared/events.js';
import { useCv } from './state.js';
import { TestStage, type StageStep } from './teststage.js';
import { Ico } from './icons.js';
import type { Analysis, FlowStep, LinkKind } from '../shared/types.js';
import { GestureLayer } from './gesturelayer.js';
import { EditorDock } from './popups.js';
import { LAYER_COLOR, LINK_COLOR, Town, type LinkMode, type Pick } from './town.js';

const OPEN_ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M9 2h5v5M14 2 7 9M12 9v4H3V4h4" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

type Tab = 'build' | 'flow' | 'test';

const LAYER_NAMES: [keyof typeof LAYER_COLOR, string][] = [
  ['frontend', 'Frontend'], ['backend', 'Backend'], ['database', 'Database'], ['tests', 'Tests'],
];

const LINK_NAMES: [LinkKind, string][] = [['calls', 'Calls'], ['stores', 'Stores'], ['uses', 'Uses'], ['imports', 'Imports'], ['tests', 'Tests']];
const NEXT_MODE: Record<LinkMode, LinkMode> = { main: 'all', all: 'off', off: 'main' };
const MODE_NAME: Record<LinkMode, string> = { main: 'Links: main', all: 'Links: all', off: 'Links: off' };

/** A readable name for a building id like `matter:backend`, `database:database` or `svc-Stripe:backend`. */
function nameOf(a: Analysis, id: string): string {
  if (id === 'database:database') return 'Database';
  if (id.startsWith('svc-')) return id.slice(4).replace(/:backend$/, '');
  const [fid = '', layer = ''] = id.split(':');
  return `${a.features.find((f) => f.id === fid)?.name ?? fid} ${layer}`;
}

/** The building a file belongs to. */
function buildingOfPath(a: Analysis, path: string): string | null {
  for (const f of a.features) {
    const hit = f.files.find((x) => x.path === path);
    if (hit) return `${f.id}:${hit.layer}`;
  }
  return null;
}

/** How one file (one block) is wired to other files. Each name is a button that jumps to that block. */
function FileLinks({ a, path, onGo }: { a: Analysis; path: string; onGo: (path: string) => void }): JSX.Element {
  const links = a.fileLinks ?? [];
  const out = (k: LinkKind): string[] => links.filter((e) => e.from === path && e.kind === k).map((e) => e.to);
  const into = (k: LinkKind): string[] => links.filter((e) => e.to === path && e.kind === k).map((e) => e.from);
  const rows: [string, LinkKind, string[]][] = [
    ['Imports', 'imports', out('imports')], ['Imported by', 'imports', into('imports')],
    ['Calls', 'calls', out('calls')], ['Called by', 'calls', into('calls')],
    ['Stores in', 'stores', out('stores')], ['Stored here by', 'stores', into('stores')],
    ['Covers', 'tests', out('tests')], ['Tested by', 'tests', into('tests')],
  ];
  const shown = rows.filter(([, , v]) => v.length);
  return (
    <>
      <b>{path.split('/').pop()}</b>
      {shown.length === 0 && <p className="mut small">No links found from this file to other files.</p>}
      {shown.map(([label, kind, files]) => (
        <div key={label} className="crow2">
          <span style={{ color: LINK_COLOR[kind] }}>{label}</span>
          <span className="tags">
            {files.slice(0, 8).map((f) => <button key={f} className="tag go" title={`Go to ${f}`} onClick={() => onGo(f)}>{f.split('/').pop()}</button>)}
            {files.length > 8 && <span className="tag">+{files.length - 8}</span>}
          </span>
        </div>
      ))}
    </>
  );
}

/** How one building is wired to the rest: who it calls, what it stores, which services it uses, what it imports.
 * When a file is selected, its own file-to-file links come first. */
function Connections({ a, id, path, onGo }: { a: Analysis; id: string; path: string | null; onGo: (path: string) => void }): JSX.Element | null {
  const out = (k: LinkKind): string[] => a.connections.filter((e) => e.from === id && e.kind === k).map((e) => nameOf(a, e.to));
  const into = (k: LinkKind): string[] => a.connections.filter((e) => e.to === id && e.kind === k).map((e) => nameOf(a, e.from));
  const rows: [string, LinkKind, string[]][] = [
    ['Calls', 'calls', out('calls')], ['Called by', 'calls', into('calls')],
    ['Stores in', 'stores', out('stores')], ['Stored here by', 'stores', into('stores')],
    ['Uses', 'uses', out('uses')], ['Used by', 'uses', into('uses')],
    ['Imports', 'imports', out('imports')], ['Imported by', 'imports', into('imports')],
    ['Covers', 'tests', out('tests')], ['Tested by', 'tests', into('tests')],
  ];
  const shown = rows.filter(([, , v]) => v.length);
  return (
    <div className="conn" role="region" aria-label="Connections">
      {path && <FileLinks a={a} path={path} onGo={onGo} />}
      {path && <hr />}
      <b>{path ? <span className="mut">Building · </span> : null}{nameOf(a, id)}</b>
      {shown.length === 0 && <p className="mut small">Nothing detected linking to this building.</p>}
      {shown.map(([label, kind, names]) => (
        <div key={label} className="crow2">
          <span style={{ color: LINK_COLOR[kind] }}>{label}</span>
          <span className="tags">
            {names.slice(0, 7).map((n, i) => <span key={`${n}${i}`} className="tag">{n}</span>)}
            {names.length > 7 && <span className="tag">+{names.length - 7}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** What the analysis agent found: what the project is, what it is built with, and how each layer is colored in the town. */
function About(): JSX.Element | null {
  const { analysis: a } = useCv();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('cv.app.about') !== '0';
    } catch {
      return true;
    }
  });
  if (!a) return null;
  const toggle = (): void => {
    setOpen(!open);
    try {
      localStorage.setItem('cv.app.about', open ? '0' : '1');
    } catch {
      /* the choice is only a convenience */
    }
  };
  const rows: [string, string[]][] = [['Frontend', a.stack.frontend], ['Backend', a.stack.backend], ['Database', a.stack.database], ['Services', a.stack.services]];
  return (
    <aside className={`about ${open ? '' : 'shut'}`} aria-label="About this project">
      <button className="abh" aria-expanded={open} onClick={toggle}>
        <b>{a.title}</b>
        <span className="chip">{a.kind}</span>
        <i aria-hidden="true">{open ? '–' : '+'}</i>
      </button>
      {open && (
        <div className="abb">
          {a.summary && <p className="sum">{a.summary}</p>}
          <dl>
            {rows.filter(([, v]) => v.length).map(([k, v]) => (
              <div key={k} className="abrow">
                <dt>{k}</dt>
                <dd>{v.map((x) => <span key={x} className="tag">{x}</span>)}</dd>
              </div>
            ))}
          </dl>
          <div className="legend" aria-label="Block colors">
            {LAYER_NAMES.map(([k, name]) => (
              <span key={k}><i style={{ background: LAYER_COLOR[k] }} />{name} {a.layers[k]}</span>
            ))}
            {a.stack.services.length > 0 && <span><i style={{ background: '#ffd23f' }} />Services {a.stack.services.length}</span>}
          </div>
          <div className="legend" aria-label="Link colors">
            {LINK_NAMES.map(([k, name]) => (
              <span key={k}><i className="bar" style={{ background: LINK_COLOR[k] }} />{name}</span>
            ))}
          </div>
          <details className="how">
            <summary>How this was analyzed</summary>
            <ol>
              {a.steps.map((st) => (
                <li key={st.step}><b>{st.label}</b><span>{st.detail}</span></li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </aside>
  );
}

/** The analysis agent working, step by step, while a project is being imported. */
export function AnalysisProgress(): JSX.Element | null {
  const { events, busy } = useCv();
  const steps = useMemo(() => {
    let from = -1;
    events.forEach((e, i) => {
      if (e.type === 'analysis.step' && e.step === 'scan_files' && e.status === 'running') from = i;
    });
    const out = new Map<string, { label: string; status: string; detail?: string }>();
    for (const e of from >= 0 ? events.slice(from) : []) if (e.type === 'analysis.step') out.set(e.step, { label: e.label, status: e.status, detail: e.detail });
    return [...out.values()];
  }, [events]);
  if (!busy || steps.length === 0) return null;
  return (
    <ul className="progress" aria-live="polite" aria-label="Analyzing the project">
      {steps.map((st) => (
        <li key={st.label} className={st.status}>
          <b>{st.status === 'done' ? '✓' : '…'}</b>
          <span>{st.label}{st.detail ? <em> {st.detail}</em> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export function VizWidget(): JSX.Element {
  const { events } = useCv();
  const [tab, setTab] = useState<Tab>('build');
  const [auto, setAuto] = useState(true);
  const [dot, setDot] = useState<'ok' | 'bad' | null>(null);

  // Follow the work: a test run switches to Test, an edit switches back to Build. Turn this off with Auto.
  const last = events[events.length - 1];
  useEffect(() => {
    if (!last) return;
    if (auto && (last.type === 'run.start' || last.type === 'step.start')) setTab('test');
    else if (auto && last.type === 'file.change') setTab('build');
    else if (tab !== 'test' && (last.type === 'run.end' || last.type === 'step.fail')) setDot(last.type === 'step.fail' || (last.type === 'run.end' && last.status === 'fail') ? 'bad' : 'ok');
  }, [last]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="viz">
      <div className="vtabs" role="tablist" aria-label="Visualizer view">
        <button role="tab" aria-selected={tab === 'build'} onClick={() => setTab('build')}>
          Build
        </button>
        <button role="tab" aria-selected={tab === 'flow'} onClick={() => setTab('flow')} title="How a user moves through this app, step by step, and the files behind each step">
          Flow
        </button>
        <button
          role="tab"
          aria-selected={tab === 'test'}
          onClick={() => {
            setTab('test');
            setDot(null);
          }}
        >
          Test{dot && <i className={`vdot ${dot}`} />}
        </button>
        <label className="auto" title="Switch view by itself when a test starts or a file changes">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
        </label>
      </div>
      {tab === 'build' ? <BuildView /> : tab === 'flow' ? <FlowView onShowInTown={() => setTab('build')} /> : <TestView />}
    </div>
  );
}

/** The user flow: the kind of app this is, the steps a user walks through, and the files of this project behind each step. */
function FlowView({ onShowInTown }: { onShowInTown: () => void }): JSX.Element {
  const { analysis, openEditor, select } = useCv();
  const flow = analysis?.flow;
  const [openId, setOpenId] = useState<string | null>(null);
  if (!analysis || !flow) return <p className="mut pad">Open a project to see its flow.</p>;
  const general = flow.template.id === 'general';
  const current: FlowStep | undefined = flow.steps.find((s) => s.id === openId && s.found) ?? flow.steps.find((s) => s.found);
  const missing = flow.steps.filter((s) => !s.found);
  return (
    <div className="flowview">
      <header className="flhead">
        <div>
          <span className="mut small">{general ? 'No known kind of app matched' : 'This project looks like'}</span>
          <b>{flow.template.name}</b>
          {flow.template.examples.length > 0 && <span className="mut small">the same shape as {flow.template.examples.join(', ')}</span>}
        </div>
        <p>{flow.template.about}</p>
        <span className={`chip ${flow.found === flow.total ? 'ok' : ''}`}>{flow.found} of {flow.total} steps found</span>
      </header>

      <ol className="flsteps" aria-label="User flow">
        {flow.steps.map((s, i) => (
          <li key={s.id}>
            <button className={`flstep ${s.found ? '' : 'missing'} ${current?.id === s.id ? 'on' : ''}`} disabled={!s.found} aria-pressed={current?.id === s.id} onClick={() => setOpenId(s.id)}>
              <i>{i + 1}</i>
              <b>{s.name}</b>
              <span>{s.about}</span>
              {s.found ? (
                <em>
                  {LAYER_NAMES.filter(([k]) => s.layers[k] > 0).map(([k, name]) => (
                    <u key={k} title={`${s.layers[k]} ${name.toLowerCase()} files`}><i style={{ background: LAYER_COLOR[k] }} />{s.layers[k]}</u>
                  ))}
                </em>
              ) : (
                <em className="none">Not in this project yet</em>
              )}
            </button>
          </li>
        ))}
      </ol>

      {current && (
        <section className="fldetail" aria-label={`Files for ${current.name}`}>
          <div className="fldh">
            <b>{current.name}</b>
            <span className="mut small">{current.files.length} {current.files.length === 1 ? 'file' : 'files'} do this step. Click one to open it.</span>
            <span className="sp" />
            <button
              className="btn sm"
              onClick={() => {
                select(current.files[0]?.path ?? null);
                onShowInTown();
              }}
            >
              Show in the town
            </button>
          </div>
          <div className="flcols">
            {LAYER_NAMES.filter(([k]) => current.layers[k] > 0).map(([k, name]) => (
              <div key={k} className="flcol">
                <h4><i style={{ background: LAYER_COLOR[k] }} />{name}</h4>
                {current.files.filter((f) => f.layer === k).map((f) => (
                  <button key={f.path} className="flfile" title={f.path} onClick={() => openEditor(f.path)}>
                    <b>{f.path.split('/').pop()}</b>
                    <span>{f.path.split('/').slice(0, -1).join('/')}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {missing.length > 0 && !general && (
        <p className="flnote">
          <b>Missing:</b> {missing.map((s) => s.name).join(', ')}. A typical {flow.template.name.toLowerCase()} has {missing.length === 1 ? 'this step' : 'these steps'}; no file in this project does {missing.length === 1 ? 'it' : 'them'} yet.
        </p>
      )}
      {flow.others.length > 0 && (
        <p className="flnote mut">
          <b>Not part of the flow:</b> {flow.others.map((o) => `${o.name} (${o.files})`).join(', ')}. Shared code that the steps above use.
        </p>
      )}
    </div>
  );
}

function BuildView(): JSX.Element {
  const { analysis, townRef, select, openEditor, selected, editorOpen, editorDocked, setEditorDocked } = useCv();
  const host = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(true);
  const [pick, setPick] = useState<Pick | null>(null);
  const [mode, setMode] = useState<LinkMode>('main');
  const [hands, setHands] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    try {
      const t = new Town(host.current);
      t.setOnPick((p) => {
        setPick(p);
        select(p?.path ?? null);
      });
      townRef.current = t;
      if (analysis) t.setProject(analysis);
      if (selected) t.select(selected);
      return () => {
        t.dispose();
        townRef.current = null;
      };
    } catch {
      setWebgl(false);
      return undefined;
    }
    // The town is built once per visit to this tab; the project and selection are applied above and by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (analysis) townRef.current?.setProject(analysis);
    townRef.current?.setLinkMode(mode);
  }, [analysis, townRef]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    townRef.current?.setLinkMode(mode);
  }, [mode, townRef]);

  // The docked editor belongs to hand control: leaving it (or this tab) turns the editor back into a floating window.
  useEffect(() => {
    if (!hands) setEditorDocked(false);
  }, [hands, setEditorDocked]);
  useEffect(() => () => setEditorDocked(false), [setEditorDocked]);

  const t = (): Town | null => townRef.current;
  const shown = selected ?? pick?.path ?? null;
  const docked = hands && editorOpen && editorDocked;

  return (
    <div className={`stage${hands ? ' holo' : ''}${docked ? ' split' : ''}`}>
      <div className="viewport" ref={host} />
      {hands && <GestureLayer getTown={() => townRef.current} onClose={() => setHands(false)} onOpen={(path) => openEditor(path, { dock: true })} />}
      {docked && <EditorDock />}
      {!webgl && <div className="nogl">This computer cannot draw the 3D town. The Test view and the lists still work.</div>}
      <div className="tools" role="toolbar" aria-label="View controls">
        <button onClick={() => t()?.rotate(-Math.PI / 4)} title="Rotate left" aria-label="Rotate left"><Ico name="rotateLeft" /></button>
        <button onClick={() => t()?.rotate(Math.PI / 4)} title="Rotate right" aria-label="Rotate right"><Ico name="rotateRight" /></button>
        <button onClick={() => t()?.tilt(-0.15)} title="Tilt up" aria-label="Tilt up"><Ico name="up" /></button>
        <button onClick={() => t()?.tilt(0.15)} title="Tilt down" aria-label="Tilt down"><Ico name="down" /></button>
        <button onClick={() => t()?.zoom(0.8)} title="Zoom in" aria-label="Zoom in"><Ico name="plus" /></button>
        <button onClick={() => t()?.zoom(1.25)} title="Zoom out" aria-label="Zoom out"><Ico name="minus" /></button>
        <button onClick={() => t()?.overview()} title="Reset the view" aria-label="Reset the view"><Ico name="home" /></button>
        <button onClick={() => t()?.wholeProject()} title="See the whole project from above" aria-label="Whole project"><Ico name="whole" /></button>
        <button className={hands ? 'on' : ''} onClick={() => setHands(!hands)} title={hands ? 'Leave hand control (Esc)' : 'Hand control: turn the town, point at a block and pinch to open its file, with your hand in front of the camera'} aria-label="Hand control" aria-pressed={hands}><Ico name="hand" />{hands && <em>exit</em>}</button>
        <button className="modebtn" onClick={() => setMode(NEXT_MODE[mode])} title={`${MODE_NAME[mode]}. Click to change: main links, all links, or none.`} aria-label={MODE_NAME[mode]}><Ico name="links" /><em>{mode}</em></button>
      </div>
      {shown && (
        <div className="filecard">
          <span>{shown}</span>
          <button className="ico" title="Open in editor" aria-label="Open in editor" onClick={() => openEditor(shown)}>
            {OPEN_ICON}
          </button>
          <button className="aibtn" title="Change this file with AI" onClick={() => openEditor(shown, { ai: true })}>
            <span aria-hidden="true">✦</span> Edit with AI
          </button>
        </div>
      )}
      {!analysis && <div className="nogl">Open a project to build its town.</div>}
      {analysis && (pick?.buildingId || shown) && (
        <div className="connwrap" style={{ top: shown ? 60 : 8 }}>
          <Connections
            a={analysis}
            id={(shown ? buildingOfPath(analysis, shown) : null) ?? pick?.buildingId ?? ''}
            path={shown}
            onGo={(p) => {
              setPick(null);
              select(p);
            }}
          />
        </div>
      )}
      <About />
    </div>
  );
}

interface RunView {
  id: string;
  command: string;
  kind: string;
  steps: CvEvent[];
  end?: Extract<CvEvent, { type: 'run.end' }>;
}

function latestRun(events: CvEvent[]): RunView | null {
  let start: Extract<CvEvent, { type: 'run.start' }> | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type === 'run.start') {
      start = e;
      break;
    }
  }
  if (!start) return null;
  const mine = events.filter((e) => 'runId' in e && e.runId === start!.runId);
  return {
    id: start.runId,
    command: start.command,
    kind: start.kind,
    steps: mine.filter((e) => e.type === 'step.pass' || e.type === 'step.fail'),
    end: mine.find((e): e is Extract<CvEvent, { type: 'run.end' }> => e.type === 'run.end'),
  };
}

/** The shopper walking the test steps, seen from behind. A failed step stops the shopper and sets the block on fire. */
function TestScene({ steps, running, planned }: { steps: CvEvent[]; running: boolean; planned: string[] }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<TestStage | null>(null);
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    if (!host.current) return;
    try {
      stage.current = new TestStage(host.current);
    } catch {
      setWebgl(false);
      return undefined;
    }
    return () => {
      stage.current?.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    const list: StageStep[] = steps.map((s) => ({ name: 'name' in s ? s.name : '', status: s.type === 'step.fail' ? 'fail' : 'pass' }));
    if (running) list.push({ name: 'next step', status: 'run' });
    // Before the first run the path shows the test cases found in the code, waiting their turn.
    if (list.length === 0) planned.slice(0, 8).forEach((name) => list.push({ name, status: 'wait' }));
    stage.current?.setSteps(list, running);
  }, [steps, running, planned]);

  if (!webgl) return <p className="mut pad">This computer cannot draw the 3D test view. The steps below still work.</p>;
  return (
    <div className="stage tstage">
      <div className="viewport" ref={host} />
      <div className="tools" role="toolbar" aria-label="Test view controls">
        <button onClick={() => stage.current?.rotate(-0.4)} aria-label="Rotate left" title="Rotate left"><Ico name="rotateLeft" /></button>
        <button onClick={() => stage.current?.rotate(0.4)} aria-label="Rotate right" title="Rotate right"><Ico name="rotateRight" /></button>
        <button onClick={() => stage.current?.zoom(0.8)} aria-label="Zoom in" title="Zoom in"><Ico name="plus" /></button>
        <button onClick={() => stage.current?.zoom(1.25)} aria-label="Zoom out" title="Zoom out"><Ico name="minus" /></button>
        <button onClick={() => stage.current?.reset()} title="Back view" aria-label="Back view"><Ico name="eye" /></button>
      </div>
    </div>
  );
}

function TestView(): JSX.Element {
  const { events, root, run, openEditor, analysis } = useCv();
  const r = useMemo(() => latestRun(events), [events]);
  const commands = analysis?.commands ?? [];
  const cases = analysis?.tests ?? [];
  const planned = useMemo(() => cases.map((t) => t.name), [cases]);
  const caseFiles = useMemo(() => {
    const by = new Map<string, typeof cases>();
    for (const t of cases) by.set(t.file, [...(by.get(t.file) ?? []), t]);
    return [...by.entries()];
  }, [cases]);
  const running = r && !r.end;
  const problem = r?.end?.problem;
  const c = problem ? crisp(problem) : null;

  return (
    <div className="testview">
      <div className="tvbar">
        <span className={`fst ${r ? (running ? 'running' : r.end?.status ?? '') : ''}`}>{!r ? 'ready' : running ? 'running' : r.end?.status === 'pass' ? 'passed' : 'failed'}</span>
        <code>{r?.command ?? commands.find((c) => c.kind === 'test')?.command ?? 'no test command found'}</code>
        <span className="sp" />
        {commands.map((c) => (
          <button
            key={c.id}
            className="btn sm ib"
            disabled={!root}
            onClick={() => void run(c.command, c.cwd)}
            title={`${c.kind === 'test' ? 'Run tests' : c.kind === 'lint' ? 'Run lint' : c.kind === 'typecheck' ? 'Run type check' : 'Run build'}: ${c.command} (in ${c.cwd || 'the project folder'})`}
            aria-label={`${c.kind} ${c.label}`}
          >
            <Ico name={c.kind === 'test' ? 'play' : c.kind === 'build' ? 'build' : 'lint'} />
            <em>{c.cwd || 'root'}{commands.filter((x) => x.kind === c.kind && x.cwd === c.cwd).length > 1 ? ` ${c.label.split(' · ')[1] ?? ''}` : ''}</em>
          </button>
        ))}
        {commands.length === 0 && <span className="mut small">No test, lint or build command found. Run one from the terminal.</span>}
      </div>
      <TestScene steps={r?.steps ?? []} running={!!running} planned={planned} />
      {!r && (
        <p className="mut pad">
          {cases.length > 0
            ? `${cases.length} test cases found in ${caseFiles.length} files. Press a play button to run them.`
            : commands.some((c) => c.kind === 'test')
              ? 'No test cases found in the code yet. Press a play button to run the tests.'
              : 'No tests found in this project.'}
        </p>
      )}
      {r && (
        <div className="fgraph">
          {r.steps.map((s, i) => {
            const bad = s.type === 'step.fail';
            const path = (s.type === 'step.pass' || s.type === 'step.fail') && s.path ? s.path : undefined;
            return (
              <div key={s.id} className="fgrp">
                {i > 0 && <span className={`far ${bad ? '' : 'pass'}`} />}
                <button className={`fn ${bad ? 'fail' : 'pass'}`} onClick={() => path && openEditor(path)} title={path}>
                  <span className="fb" />
                  <b>{'name' in s ? s.name : ''}</b>
                  <small>{path ?? ''}</small>
                  <em>{bad ? 'broke' : `${'ms' in s && s.ms ? Math.round(s.ms) : 0}ms`}</em>
                </button>
              </div>
            );
          })}
          {running && <div className="fgrp"><span className="far flow" /><div className="fn run"><span className="fb" /><b>running</b></div></div>}
        </div>
      )}
      {r?.end && (
        <p className="mut pad">
          {r.end.passed} passed{r.end.failed ? `, ${r.end.failed} failed` : ''}
          {r.end.skipped ? `, ${r.end.skipped} skipped` : ''} · {(r.end.ms / 1000).toFixed(1)}s
        </p>
      )}
      {c && (
        <div className="cc err" role="alert">
          <b>{c.title}</b>
          {c.broke && (
            <div>
              <i>Broke</i>
              {c.broke}
            </div>
          )}
          {c.where && problem?.file && (
            <div>
              <i>Where</i>
              <button className="lnk" onClick={() => openEditor(problem.file!)}>{c.where}</button>
            </div>
          )}
          <div>
            <i>Next</i>
            {c.next}
          </div>
        </div>
      )}
      {cases.length > 0 && (
        <details className="cases" open={!r}>
          <summary>Test cases in the code ({cases.length})</summary>
          {caseFiles.map(([file, list]) => (
            <div key={file} className="casefile">
              <button className="lnk" onClick={() => openEditor(file)} title="Open this file">{file}</button>
              <ul>
                {list.map((t) => (
                  <li key={`${t.name}${t.line}`}><span className="mut">{t.line}</span> {t.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
      {r?.end?.status === 'pass' && (
        <div className="cc ok">
          <b>{r.kind === 'test' ? 'Tests pass' : `${r.kind} passed`}</b>
          <div>
            <i>Next</i>
            Review and commit in Source control.
          </div>
        </div>
      )}
    </div>
  );
}
