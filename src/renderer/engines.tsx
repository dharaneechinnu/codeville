/** AI engines: command-line tools signed in with the user's own account (Claude Code, GitHub Copilot CLI).
 * Codeville starts the tool; the tool holds the account. No key or token is typed or stored here. */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useAISettings } from './ai.js';

export interface Engine {
  id: string;
  label: string;
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
    const on = (): void => void reload(true).catch(() => undefined);
    window.addEventListener('focus', on);
    window.addEventListener('cv:engines', on);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('cv:engines', on);
    };
  }, [reload]);
  return { engines, reload };
}

/** Engine setup in Extensions: install, sign in, test, and use for the editor's AI prompt. */
export function AIEngines(): JSX.Element {
  const { engines, reload } = useEngines();
  const { settings, save } = useAISettings();
  if (!engines) return <p className="mut small">Looking for AI engines on this computer…</p>;
  return (
    <div className="aimodels">
      <p className="mut small">
        Use the AI tools you already pay for. Each one runs on this computer with its own sign-in, so Codeville never sees a key.
        Pick one in the Chat, or use one for the editor's AI prompt.
      </p>
      {engines.map((e) => (
        <EngineRow
          key={e.id}
          e={e}
          model={settings?.providers.find((p) => p.id === e.provider)?.model ?? 'default'}
          active={settings?.active === e.provider}
          save={save}
          reload={reload}
        />
      ))}
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

  const signedIn = works || e.account.state === 'signedIn';
  const chip = !e.found ? (
    <span className="chip mut">Not installed</span>
  ) : signedIn ? (
    <span className="chip ok">{e.account.name ? `Signed in: ${e.account.name}` : 'Signed in'}</span>
  ) : e.account.state === 'signedOut' ? (
    <span className="chip bad">Not signed in</span>
  ) : (
    <span className="chip">Installed</span>
  );

  return (
    <section className={`aiprov ${active ? 'on' : ''}`} aria-label={e.label}>
      <div className="aiprovh static">
        <b>{e.label}</b>
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
            {signedIn
              ? `It answers with your ${e.accountKind} account.`
              : e.account.state === 'signedOut'
                ? `Sign in with your ${e.accountKind} account to use it.`
                : `Press Test to check that it is signed in with your ${e.accountKind} account.`}
          </p>
          <label>
            <span>Model</span>
            <input id={`eng-model-${e.id}`} type="text" list={`eng-models-${e.id}`} spellCheck={false} value={model} onChange={(ev) => setModel(ev.target.value)} placeholder="default" />
            <datalist id={`eng-models-${e.id}`}>{e.models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <div className="aiprovacts">
            <button
              type="button"
              className={signedIn ? 'btn sm' : 'big'}
              disabled={!!busy}
              onClick={() =>
                void act('login', async () => {
                  const r = await api<{ opened: boolean; command: string }>('/api/engines/login', { engine: e.id });
                  setWorks(false);
                  return r.opened
                    ? 'A terminal opened. Finish signing in there, then press Test.'
                    : `Run ${r.command} in a terminal, then press Test.`;
                })
              }
            >
              {signedIn ? 'Switch account' : 'Sign in'}
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
