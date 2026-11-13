/** The development team: a Lead that is always on, and six specialists it calls only when a request needs them.
 * This file holds the Team page (who is on the team and what each may do) and the run card the Chat shows. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TeamRun, TeamStage } from '../shared/types.js';
import { api } from './api.js';
import { useAgentLink } from './agentlink.js';
import { Ico } from './icons.js';
import { useCv } from './state.js';

export interface TeamRole {
  id: string;
  label: string;
  color: string;
  job: string;
  may: string;
  instructions: string;
  enabled: boolean;
  model: string;
  extra: string;
}

interface TeamInfo {
  roles: TeamRole[];
  approveDesign: boolean;
  engine: string;
  run: TeamRun | null;
}

interface Problem {
  what: string;
  next: string;
}

const problemOf = (e: unknown): Problem => {
  const p = (e as { problem?: Problem }).problem;
  return p ?? { what: e instanceof Error ? e.message : 'That did not work', next: 'Try again.' };
};

export const SPECIALISTS = ['architect', 'ux', 'developer', 'tester', 'security', 'deployment'];

/** Opens the Team page (App listens for this). */
export function openTeam(): void {
  window.dispatchEvent(new CustomEvent('cv:open-team'));
}

/** The team's roles and settings, and the latest run: from the backend once, then from the live event stream. */
export function useTeam(): { info: TeamInfo | null; run: TeamRun | null; reload: () => Promise<void>; save: (b: Record<string, unknown>) => Promise<void> } {
  const { events } = useCv();
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const reload = useCallback(async () => {
    setInfo(await api<TeamInfo>('/api/team'));
  }, []);
  const save = useCallback(async (body: Record<string, unknown>) => {
    const r = await api<TeamInfo>('/api/team/settings', body);
    setInfo((old) => ({ ...r, run: old?.run ?? null }));
  }, []);
  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);
  const live = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === 'team.run') return e.run;
    }
    return null;
  }, [events]);
  const run = live && (!info?.run || live.started >= info.run.started) ? live : (info?.run ?? null);
  return { info, run, reload, save };
}

const same = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

const STATE_LABEL: Record<TeamRun['state'], string> = {
  picking: 'The Lead is reading your request',
  pick: 'Waiting for you: agree the team',
  running: 'Working',
  design: 'Waiting for you: approve the design',
  security: 'Waiting for you: a serious security finding',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Stopped with a problem',
};

const STATUS_MARK: Record<TeamStage['status'], string> = { waiting: '·', working: '…', done: '✓', failed: '✕', stopped: '■' };

/** One team run in the Chat: the Lead's pick, the stage bar, the gates, the live output, and the result. */
export function TeamRunCard({ run }: { run: TeamRun }): JSX.Element {
  const { output, openEditor, root } = useCv();
  const { info } = useTeam();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Problem | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  useEffect(() => setChosen(null), [run.id, run.state]);

  const roleOf = (id: string): TeamRole | undefined => info?.roles.find((r) => r.id === id);
  const answer = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/team/answer', { runId: run.id, ...body });
    } catch (e) {
      setErr(problemOf(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = async (): Promise<void> => {
    await api('/api/team/stop', { runId: run.id }).catch(() => undefined);
  };

  const working = run.state === 'picking' ? run.lead : run.stages.find((s) => s.status === 'working');
  const lines = useMemo(() => (working?.outputId ? output.filter((o) => o.runId === working.outputId).map((o) => o.line).slice(-8) : []), [output, working?.outputId]);
  const pickedRoles = chosen ?? run.pick.map((p) => p.role);
  const locked = new Set(run.pick.filter((p) => p.locked).map((p) => p.role));
  const toggle = (id: string): void => {
    if (locked.has(id)) return;
    setChosen(pickedRoles.includes(id) ? pickedRoles.filter((r) => r !== id) : [...pickedRoles, id]);
  };
  const lastNote = (role: string): TeamStage | undefined => [...run.stages].reverse().find((s) => s.role === role && s.status === 'done');
  const open = (rel: string): void => {
    if (root && same(root, run.root)) openEditor(rel);
  };
  const ended = run.state === 'done' || run.state === 'stopped' || run.state === 'failed';

  return (
    <section className={`teamrun s-${run.state}`} aria-label="Team run">
      <header className="trh">
        <b>Team</b>
        <span className="trreq">{run.request}</span>
        <span className={`chip ${run.state === 'done' ? 'ok' : run.state === 'failed' ? 'bad' : ''}`}>{STATE_LABEL[run.state]}</span>
        {!ended && (
          <button className="btn sm" onClick={() => void stop()} title="Stop the team">
            Stop
          </button>
        )}
      </header>

      {run.plan && <p className="trplan">{run.plan}</p>}

      {run.stages.length > 0 && (
        <ol className="trbar" aria-label="Who works, in order">
          {run.stages.map((s, i) => (
            <li key={i} className={`st-${s.status}`} style={{ ['--c' as string]: s.color }} title={s.added || s.why}>
              <i aria-hidden="true">{STATUS_MARK[s.status]}</i>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {run.state === 'pick' && (
        <div className="trgate">
          <p>
            <b>The Lead picked {run.pick.length === 1 ? 'one specialist' : `${run.pick.length} specialists`}.</b> Add or remove one, then start.
          </p>
          <ul className="trpick">
            {SPECIALISTS.map((id) => {
              const p = run.pick.find((x) => x.role === id);
              const on = pickedRoles.includes(id);
              const r = roleOf(id);
              return (
                <li key={id} style={{ ['--c' as string]: r?.color ?? '#888' }}>
                  <label className={`trchoice ${on ? 'on' : ''} ${locked.has(id) ? 'locked' : ''}`}>
                    <input id={`team-pick-${id}`} type="checkbox" checked={on} disabled={locked.has(id)} onChange={() => toggle(id)} />
                    <b>{r?.label ?? id}</b>
                    <span>{locked.has(id) ? `Always runs here. ${p?.why ?? ''}` : on ? (p?.why || 'Added by you') : r?.job}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mbtn">
            <button className="big" disabled={busy || pickedRoles.length === 0} onClick={() => void answer({ gate: 'pick', roles: pickedRoles })}>
              Start with {pickedRoles.length} {pickedRoles.length === 1 ? 'agent' : 'agents'}
            </button>
            <button className="btn sm" disabled={busy} onClick={() => void stop()}>Cancel</button>
          </div>
        </div>
      )}

      {run.state === 'design' && (
        <div className="trgate">
          <p><b>The Architect's design.</b> Nothing has been changed yet. Approve it to let the team build it.</p>
          <pre className="trnote">{lastNote('architect')?.note}</pre>
          <div className="mbtn">
            <button className="big" disabled={busy} onClick={() => void answer({ gate: 'design', approve: true })}>Approve and build</button>
            <button className="btn sm" disabled={busy} onClick={() => void answer({ gate: 'design', approve: false })}>Stop</button>
          </div>
        </div>
      )}

      {run.state === 'security' && (
        <div className="trgate bad">
          <p><b>The Security reviewer found a serious problem.</b> Read it before the team carries on.</p>
          <pre className="trnote">{lastNote('security')?.note}</pre>
          <div className="mbtn">
            <button className="btn sm" disabled={busy} onClick={() => void answer({ gate: 'security', proceed: true })}>Carry on anyway</button>
            <button className="big" disabled={busy} onClick={() => void answer({ gate: 'security', proceed: false })}>Stop here</button>
          </div>
        </div>
      )}

      {working && !ended && run.state !== 'pick' && (
        <div className="trlive">
          <span className="who" style={{ color: working.color }}>{working.label} · working</span>
          {lines.length ? lines.join('\n') : 'Starting…'}
        </div>
      )}

      {err && (
        <div className="cc err" role="alert">
          <b>{err.what}</b>
          <div><i>Next</i>{err.next}</div>
        </div>
      )}

      {ended && (
        <div className="trend">
          {run.problem && (
            <div className="cc err" role="alert">
              <b>{run.problem.what}</b>
              <div><i>Next</i>{run.problem.next}</div>
            </div>
          )}
          {[...new Set(run.stages.flatMap((s) => s.result.didNotRun ?? []))].length > 0 && (
            <div className="cc warn" role="status">
              <b>Some checks could not run</b>
              <div>{[...new Set(run.stages.flatMap((s) => s.result.didNotRun ?? []))].join('. ')}</div>
              <div><i>Next</i>Install the project's packages, then ask the team to test again. The team cannot install packages.</div>
            </div>
          )}
          {run.stages.filter((s) => s.putBack.length).map((s, i) => (
            <p key={i} className="small badmsg">Codeville put back {s.putBack.join(', ')}: the {s.label} may not change them.</p>
          ))}
          {run.changed.length > 0 && (
            <>
              <span className="trlabel">Files changed</span>
              <ul className="trfiles">
                {run.changed.map((p) => (
                  <li key={p}><button className="lnk" onClick={() => open(p)}>{p}</button></li>
                ))}
              </ul>
            </>
          )}
          {run.commit?.hash && <p className="small okmsg">Committed as {run.commit.hash} on {run.commit.branch}. Push it from Source control when you are ready.</p>}
          {run.commit?.error && <p className="small badmsg">Not committed: {run.commit.error}. {run.commit.next}</p>}
          <button className="lnk" onClick={() => open(`${run.notes}/summary.md`)}>Open the team's notes</button>
        </div>
      )}
    </section>
  );
}

/** The Team page: who is on the team, what each may do, and this computer's settings for them. */
export function TeamPage({ onBack }: { onBack: () => void }): JSX.Element {
  const { info, run, save } = useTeam();
  const link = useAgentLink();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, text: string): Promise<void> => {
    try {
      await save(body);
      setMsg({ ok: true, text });
    } catch (e) {
      const p = problemOf(e);
      setMsg({ ok: false, text: `${p.what}. ${p.next}` });
    }
  };
  const ready = link.claudeFound && link.signedIn;
  return (
    <div className="page" role="dialog" aria-modal="true" aria-label="Team">
      <header className="pagehead">
        <button className="btn" onClick={onBack} aria-label="Back to the project">← Back</button>
        <h1>Team</h1>
        <span className={`chip ${ready ? 'ok' : 'bad'}`}>{ready ? 'Ready on Claude Code' : !link.claudeFound ? 'Claude Code is not installed' : 'Claude Code is not signed in'}</span>
        <span className="sp" />
        {msg && <span className={`small ${msg.ok ? 'okmsg' : 'badmsg'}`} role="status">{msg.text}</span>}
      </header>
      <div className="pagebody">
        <p className="pagelead">
          The <b>Lead</b> is always on. For each request it picks the smallest team that can do the job and shows you its pick before anyone
          starts. A typo fix uses one agent; a new sign-in feature may use five. Turn on <b>Team</b> in the Chat to use it.
        </p>
        {!info && <p className="mut">Loading the team…</p>}
        {info && (
          <>
            <label className="teamopt">
              <input id="team-approve-design" type="checkbox" checked={info.approveDesign} onChange={(e) => void act({ approveDesign: e.target.checked }, e.target.checked ? 'You will approve each design before code is written.' : 'The team will build without waiting for design approval.')} />
              <span><b>Approve the design before code is written.</b> When the Architect is called, the team waits for you before anyone changes a file.</span>
            </label>
            <h2>The team</h2>
            <div className="teamgrid">
              {info.roles.map((r) => (
                <RoleCard key={r.id} r={r} onSave={act} />
              ))}
            </div>
            <h2>Rules Codeville enforces</h2>
            <ul className="pagenotes">
              <li>Each agent is started with its own tool list. The Lead, Architect, UI and UX designer and Security reviewer cannot change files at all.</li>
              <li>Before each agent works, Codeville takes a picture of the project. Afterwards it puts back any file that agent may not change: the Tester only test files, Deployment only build and CI files, nobody .env files.</li>
              <li>No agent can run a shell. The Tester and Deployment can only run the project's own test and build commands.</li>
              <li>Security always reviews changes that touch sign-in, payments, user input, uploaded files, secrets or packages, even when it is switched off here.</li>
              <li>Failed tests send the Developer back at most twice. Deployment commits the team's files; you push.</li>
            </ul>
            {run && (
              <>
                <h2>Last run</h2>
                <p className="mut">{run.request} · {STATE_LABEL[run.state]}</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RoleCard({ r, onSave }: { r: TeamRole; onSave: (b: Record<string, unknown>, text: string) => Promise<void> }): JSX.Element {
  const [model, setModel] = useState(r.model);
  const [extra, setExtra] = useState(r.extra);
  useEffect(() => {
    setModel(r.model);
    setExtra(r.extra);
  }, [r.model, r.extra]);
  const lead = r.id === 'lead';
  return (
    <section className={`teamrole ${r.enabled ? '' : 'off'}`} style={{ ['--c' as string]: r.color }} aria-label={r.label}>
      <div className="trrh">
        <i aria-hidden="true" />
        <b>{r.label}</b>
        {lead ? (
          <span className="chip ok">Always on</span>
        ) : (
          <label className="switch">
            <input id={`team-on-${r.id}`} type="checkbox" checked={r.enabled} onChange={(e) => void onSave({ roles: { [r.id]: { enabled: e.target.checked } } }, `${r.label} ${e.target.checked ? 'can be called' : 'is switched off'}.`)} />
            <span>{r.enabled ? 'On' : 'Off'}</span>
          </label>
        )}
      </div>
      <p>{r.job}</p>
      <p className="mut small"><b>May:</b> {r.may}</p>
      <details>
        <summary>Instructions and model</summary>
        <pre className="trnote">{r.instructions}</pre>
        <form
          className="aiprovb"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ roles: { [r.id]: { model, extra } } }, `Saved the ${r.label}'s settings.`);
          }}
        >
          <label>
            <span>Model</span>
            <input id={`team-model-${r.id}`} type="text" list="team-models" value={model} placeholder="default" spellCheck={false} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label>
            <span>Extra instructions</span>
            <textarea id={`team-extra-${r.id}`} rows={3} value={extra} placeholder="For example: use our design system in src/ui." onChange={(e) => setExtra(e.target.value)} />
          </label>
          <div className="aiprovacts">
            <button type="submit" className="btn sm">Save</button>
          </div>
        </form>
      </details>
    </section>
  );
}

/** Small helpers the Chat uses. */
export function TeamToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button className="ch team" aria-pressed={on} onClick={() => onChange(!on)} title={on ? 'Team is on: the Lead picks who works on your request' : 'Send to the team instead of one agent'}>
      <Ico name="team" size={13} /> Team
    </button>
  );
}

export const teamModels = (
  <datalist id="team-models">
    {['default', 'sonnet', 'opus', 'haiku'].map((m) => <option key={m} value={m} />)}
  </datalist>
);
