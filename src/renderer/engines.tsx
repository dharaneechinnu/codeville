/** AI engines: the coding agents people already have as command-line tools (Claude Code, Copilot, Codex, Gemini, OpenCode,
 * Qwen, Amp), each signed in with the user's own account. This file is the AI engines page and its building blocks.
 * Codeville starts the tool; the tool holds the account. No key or token is typed or stored here. */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useAISettings } from './ai.js';
import { Ico } from './icons.js';

export interface Engine {
  id: string;
  label: string;
  by: string;
  provider: string;
  accountKind: string;
  found: boolean;
  version: string;
  account: { state: 'signedIn' | 'signedOut' | 'unknown'; name: string };
  install: string;
  url: string;
  loginCommand: string;
  models: string[];
}

interface Problem {
  what: string;
  next: string;
}

const problemOf = (e: unknown): Problem => {
  const p = (e as { problem?: Problem }).problem;
  return p ?? { what: e instanceof Error ? e.message : 'That did not work', next: 'Try again.' };
};

/** The engines on this computer. Asked again when the window gets focus back, because signing in happens in a terminal. */
export function useEngines(): { engines: Engine[] | null; reload: (refresh?: boolean) => Promise<void> } {
  const [engines, setEngines] = useState<Engine[] | null>(null);
  const reload = useCallback(async (refresh = false) => {
    const r = await api<{ engines: Engine[] }>(`/api/engines${refresh ? '?refresh=1' : ''}`);
    setEngines(r.engines);
  }, []);
  useEffect(() => {
    void reload().catch(() => undefined);
    // Not forced: the backend remembers the answer for a short while and forgets it after a sign-in or a test.
    const on = (): void => void reload().catch(() => undefined);
    window.addEventListener('focus', on);
    window.addEventListener('cv:engines', on);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('cv:engines', on);
    };
  }, [reload]);
  return { engines, reload };
}

/** Opens the AI engines page (App listens for this). */
export function openEngines(): void {
  window.dispatchEvent(new CustomEvent('cv:open-engines'));
}

const signedIn = (e: Engine): boolean => e.found && e.account.state === 'signedIn';

/** The short card in Extensions: what is ready, and the way to the full page. */
export function EnginesSummary(): JSX.Element {
  const { engines } = useEngines();
  const { settings } = useAISettings();
  if (!engines) return <p className="mut small">Looking for AI engines on this computer…</p>;
  const found = engines.filter((e) => e.found);
  const active = engines.find((e) => e.provider === settings?.active);
  return (
    <>
      <p className="mut small">
        {found.length
          ? <>On this computer: <b>{found.map((e) => e.label).join(', ')}</b>.</>
          : 'No AI engine is installed on this computer yet.'}
        {active ? <> The editor uses <b>{active.label}</b>.</> : ''}
      </p>
      <button className="big" onClick={openEngines}>Open AI engines</button>
    </>
  );
}

/** The AI engines page: every supported engine, with install, sign in, test, and use for the editor. */
export function EnginesPage({ onBack }: { onBack: () => void }): JSX.Element {
  const { engines, reload } = useEngines();
  const { settings, save } = useAISettings();
  const [checking, setChecking] = useState(false);
  const here = (engines ?? []).filter((e) => e.found);
  const missing = (engines ?? []).filter((e) => !e.found);
  const row = (e: Engine): JSX.Element => (
    <EngineRow
      key={e.id}
      e={e}
      model={settings?.providers.find((p) => p.id === e.provider)?.model ?? 'default'}
      active={settings?.active === e.provider}
      save={save}
      reload={reload}
    />
  );
  return (
    <div className="page" role="dialog" aria-modal="true" aria-label="AI engines">
      <header className="pagehead">
        <button className="btn" onClick={onBack} aria-label="Back to the project">← Back</button>
        <h1>AI engines</h1>
        {engines && <span className="chip">{here.length} of {engines.length} installed · {engines.filter(signedIn).length} signed in</span>}
        <span className="sp" />
        <button
          className="btn"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void reload(true).catch(() => undefined).finally(() => setChecking(false));
          }}
        >
          <Ico name="refresh" size={13} /> {checking ? 'Checking…' : 'Check again'}
        </button>
      </header>
      <div className="pagebody">
        <p className="pagelead">
          Use the coding agents you already pay for. Each one runs on this computer with its own sign-in, so Codeville never sees a
          key or a password. Sign in, press <b>Test</b>, then pick the engine in the Chat or use it for the editor's AI prompt.
        </p>
        {!engines && <p className="mut">Looking for AI engines on this computer…</p>}
        {engines && (
          <>
            <h2>On this computer</h2>
            {here.length ? <div className="enggrid">{here.map(row)}</div> : <p className="mut">None yet. Install one from the list below, then press Check again.</p>}
            {missing.length > 0 && (
              <>
                <h2>Not installed</h2>
                <div className="enggrid">{missing.map(row)}</div>
              </>
            )}
            <h2>How Codeville runs them</h2>
            <ul className="pagenotes">
              <li>Your prompt is passed on standard input, the same as typing it into the tool.</li>
              <li>A test or an AI edit only asks a question. It runs in an empty folder, in the engine's read-only mode where it has one (Amp has none).</li>
              <li>In the Chat an engine may edit files in the open project. No engine is ever started with an allow-everything flag.</li>
              <li>The town lights up live for Claude Code. For other engines the Chat shows their output and the town follows the changed files.</li>
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function EngineRow({ e, model: saved, active, save, reload }: { e: Engine; model: string; active: boolean; save: (b: Record<string, unknown>) => Promise<unknown>; reload: (refresh?: boolean) => Promise<void> }): JSX.Element {
  const [model, setModel] = useState(saved);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [works, setWorks] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setModel(saved), [saved]);

  const act = async (name: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(name);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (err) {
      const p = problemOf(err);
      setMsg({ ok: false, text: `${p.what}. ${p.next}` });
    } finally {
      setBusy('');
    }
  };

  const isIn = works || e.account.state === 'signedIn';
  const chip = !e.found ? (
    <span className="chip mut">Not installed</span>
  ) : isIn ? (
    <span className="chip ok">{e.account.name ? `Signed in: ${e.account.name}` : 'Signed in'}</span>
  ) : e.account.state === 'signedOut' ? (
    <span className="chip bad">Not signed in</span>
  ) : (
    <span className="chip">Installed</span>
  );

  return (
    <section className={`aiprov ${active ? 'on' : ''}`} aria-label={e.label}>
      <div className="aiprovh static">
        <b>{e.label} <em className="engby">{e.by}</em></b>
        {active && <span className="chip ok">In use</span>}
        {chip}
      </div>
      {!e.found ? (
        <div className="aiprovb">
          <p className="mut small">
            Install it, then press Check again. <a href={e.url} target="_blank" rel="noreferrer">About {e.label}</a>
          </p>
          <pre className="cmd">{e.install}</pre>
          <div className="aiprovacts">
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                void navigator.clipboard.writeText(e.install).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy command'}
            </button>
            <button type="button" className="btn sm" disabled={!!busy} onClick={() => void act('check', async () => { await reload(true); return 'Checked.'; })}>
              {busy === 'check' ? 'Checking…' : 'Check again'}
            </button>
          </div>
          {msg && <p className={`small ${msg.ok ? 'okmsg' : 'badmsg'}`} role="status">{msg.text}</p>}
        </div>
      ) : (
        <form
          className="aiprovb"
          onSubmit={(ev) => {
            ev.preventDefault();
            void act('use', async () => {
              await save({ provider: e.provider, model, makeActive: true });
              return `Saved. The editor's AI prompt now uses ${e.label}.`;
            });
          }}
        >
          <p className="mut small">
            {e.version || 'Installed'}.{' '}
            {isIn
              ? `It answers with your ${e.accountKind} account.`
              : e.account.state === 'signedOut'
                ? `Sign in with your ${e.accountKind} account to use it.`
                : `Press Test to check that it is signed in with your ${e.accountKind} account.`}
          </p>
          {e.models.length > 0 && <label>
            <span>Model</span>
            <input id={`eng-model-${e.id}`} type="text" list={`eng-models-${e.id}`} spellCheck={false} value={model} onChange={(ev) => setModel(ev.target.value)} placeholder="default" />
            <datalist id={`eng-models-${e.id}`}>{e.models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>}
          <div className="aiprovacts">
            <button
              type="button"
              className={isIn ? 'btn sm' : 'big'}
              disabled={!!busy}
              onClick={() =>
                void act('login', async () => {
                  const r = await api<{ opened: boolean; command: string }>('/api/engines/login', { engine: e.id });
                  setWorks(false);
                  return r.opened
                    ? `A terminal opened with ${r.command}. Finish signing in there, then press Test.`
                    : `Run ${r.command} in a terminal and sign in, then press Test.`;
                })
              }
            >
              {isIn ? 'Switch account' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={!!busy}
              onClick={() =>
                void act('test', async () => {
                  setWorks(false);
                  await save({ provider: e.provider, model });
                  try {
                    const r = await api<{ ms: number }>('/api/ai/test', { provider: e.provider });
                    setWorks(true);
                    return `It works: ${e.label} answered in ${(r.ms / 1000).toFixed(1)}s.`;
                  } finally {
                    void reload(true).catch(() => undefined);
                  }
                })
              }
            >
              {busy === 'test' ? 'Testing…' : 'Test'}
            </button>
            <button type="submit" className="btn sm" disabled={!!busy || active}>{active ? 'Used by the editor' : 'Use for the editor'}</button>
          </div>
          {msg && <p className={`small ${msg.ok ? 'okmsg' : 'badmsg'}`} role="status">{msg.text}</p>}
        </form>
      )}
    </section>
  );
}
