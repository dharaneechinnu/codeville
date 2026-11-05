/** Editing a file with AI: the prompt bar under the editor, the review of the proposed change, and provider setup. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { TIER, openAISetup, useAISettings, type AIEdit, type AIProvider } from './ai.js';
import { lineDiff } from './diff.js';

interface Problem {
  what: string;
  why: string[];
  next: string;
}

const problemOf = (e: unknown): Problem => {
  const p = (e as { problem?: Problem }).problem;
  return p ?? { what: e instanceof Error ? e.message : 'That did not work', why: [], next: 'Try again.' };
};

const SUGGESTIONS = ['Add input validation', 'Add error handling', 'Explain with comments', 'Write tests for this', 'Make it faster'];

/** The prompt bar: type an instruction, Enter sends it to the model in use. */
export function AIBar({ root, file, focusKey, onProposal }: { root: string; file: string; focusKey: number; onProposal: (e: AIEdit) => void }): JSX.Element {
  const { settings } = useAISettings();
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<Problem | null>(null);
  const run = useRef(0);

  const active = settings?.providers.find((p) => p.id === settings.active) ?? null;

  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const t = window.setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [busy]);

  // Grow the box with its text, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = async (instruction: string): Promise<void> => {
    if (!instruction.trim() || busy) return;
    const id = ++run.current;
    setBusy(true);
    setSecs(0);
    setErr(null);
    try {
      const res = await api<AIEdit>('/api/ai/edit', { path: root, file, instruction });
      if (id !== run.current) return;
      if (!res.changed) setErr({ what: 'The model made no changes', why: [res.summary || 'The file came back the same'], next: 'Try a more specific instruction.' });
      else onProposal(res);
    } catch (e) {
      if (id === run.current) setErr(problemOf(e));
    } finally {
      if (id === run.current) setBusy(false);
    }
  };

  return (
    <div className="aibar">
      {err && (
        <div className="cc err aierr" role="alert">
          <b>{err.what}</b>
          {err.why[0] && <div><i>Broke</i>{err.why[0]}</div>}
          <div><i>Next</i>{err.next}</div>
          {/set up|API key|Extensions/i.test(err.what + err.next) && <button className="lnk" onClick={openAISetup}>Open AI models</button>}
        </div>
      )}
      {!text && !busy && (
        <div className="aisugg" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => { setText(s); input.current?.focus(); }}>{s}</button>
          ))}
        </div>
      )}
      <form
        className="aiform"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <button type="button" className={`aimodel ${active ? '' : 'none'}`} onClick={openAISetup} title="Choose the AI model">
          <i aria-hidden="true" />
          {active ? `${active.label.split(' (')[0]} · ${active.model}` : 'Set up a model'}
        </button>
        <textarea
          ref={input}
          id="ai-instruction"
          rows={1}
          value={text}
          disabled={busy}
          spellCheck
          aria-label={`Tell the AI how to change ${file}`}
          placeholder={`Tell the AI how to change ${file.split('/').pop()}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
            if (e.key === 'Escape' && busy) {
              run.current++;
              setBusy(false);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn sm" onClick={() => { run.current++; setBusy(false); }}>Stop · {secs}s</button>
        ) : (
          <button type="submit" className="big aigo" disabled={!text.trim()}>Generate</button>
        )}
      </form>
      {busy && <div className="aibusy" role="status"><span className="aispin" aria-hidden="true" />Writing the change with {active?.model ?? 'the model'}…</div>}
    </div>
  );
}

/** Shows the proposed change as a diff: Accept saves it, Reject drops it. */
export function AIReview({ root, edit, onDone, onRetry }: { root: string; edit: AIEdit; onDone: (saved: boolean) => void; onRetry: () => void }): JSX.Element {
  const diff = useMemo(() => lineDiff(edit.original, edit.updated), [edit]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<Problem | null>(null);
  const accept = async (): Promise<void> => {
    setSaving(true);
    setErr(null);
    try {
      await api('/api/file/write', { path: root, file: edit.file, content: edit.updated, base: edit.original });
      onDone(true);
    } catch (e) {
      setErr(problemOf(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="aireview">
      <div className="aihead">
        <div>
          <b>{edit.summary || 'Proposed change'}</b>
          <span className="mut small">{edit.model} · {(edit.ms / 1000).toFixed(1)}s · <em className="plus">+{diff.added}</em> <em className="minus">−{diff.removed}</em></span>
        </div>
        <div className="aiacts">
          <button className="btn sm" onClick={onRetry}>Try again</button>
          <button className="btn sm" onClick={() => onDone(false)}>Reject</button>
          <button className="big" onClick={() => void accept()} disabled={saving}>{saving ? 'Saving…' : 'Accept'}</button>
        </div>
      </div>
      {err && (
        <div className="cc err aierr" role="alert">
          <b>{err.what}</b>
          <div><i>Next</i>{err.next}</div>
        </div>
      )}
      <div className="code diff" aria-label={`Proposed changes to ${edit.file}`}>
        {diff.rows.map((r, i) =>
          r.kind === 'gap' ? (
            <div key={i} className="dgap">{r.hidden} unchanged {r.hidden === 1 ? 'line' : 'lines'}</div>
          ) : (
            <div key={i} className={`ln d-${r.kind}`}>
              <i>{r.a ?? ''}</i>
              <i>{r.b ?? ''}</i>
              <u aria-hidden="true">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}</u>
              <s>{r.text || ' '}</s>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** Provider setup in Extensions: free, local and paid models, each with its own key. */
export function AIModels(): JSX.Element {
  const { settings, save } = useAISettings();
  const [open, setOpen] = useState<string | null>(null);
  if (!settings) return <p className="mut small">Loading the AI providers…</p>;
  const active = settings.providers.find((p) => p.id === settings.active);
  return (
    <div className="aimodels">
      <p className="mut small">
        Bring your own key. Pick a provider for the editor's AI prompt; keys stay on this computer and are never shown again.
        {active ? <> In use: <b>{active.label} · {active.model}</b>.</> : ' No model is in use yet.'}
      </p>
      {settings.providers.map((p) => (
        <ProviderRow key={p.id} p={p} active={p.id === settings.active} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} save={save} />
      ))}
    </div>
  );
}

function ProviderRow({ p, active, open, onToggle, save }: { p: AIProvider; active: boolean; open: boolean; onToggle: () => void; save: (b: Record<string, unknown>) => Promise<unknown> }): JSX.Element {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(p.model);
  const [url, setUrl] = useState(p.baseUrl);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setModel(p.model);
    setUrl(p.baseUrl);
  }, [p.model, p.baseUrl]);

  const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    provider: p.id, model, ...(key ? { apiKey: key } : {}), ...(p.editableUrl ? { baseUrl: url } : {}), ...extra,
  });
  const act = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      setKey('');
    } catch (e) {
      const pr = problemOf(e);
      setMsg({ ok: false, text: `${pr.what}. ${pr.next}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`aiprov ${active ? 'on' : ''}`}>
      <button className="aiprovh" aria-expanded={open} onClick={onToggle}>
        <b>{p.label}</b>
        <span className={`chip t-${p.tier}`}>{TIER[p.tier]}</span>
        {active ? <span className="chip ok">In use</span> : p.ready ? <span className="chip">Ready</span> : <span className="chip mut">{p.needsKey ? 'Key needed' : 'Set up'}</span>}
      </button>
      {open && (
        <form
          className="aiprovb"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await save(body({ makeActive: true }));
              return `Saved. The editor now uses ${p.label}.`;
            });
          }}
        >
          {p.id !== 'ollama' && (
            <label>
              <span>API key {p.keyUrl && <a href={p.keyUrl} target="_blank" rel="noreferrer">Get a key</a>}</span>
              <input
                id={`ai-key-${p.id}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                placeholder={p.hasKey ? `Saved (${p.keyHint}). Paste a new key to replace it.` : p.needsKey ? 'Paste your API key' : 'Optional'}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
          )}
          {p.id === 'ollama' && (
            <p className="mut small">Runs on this computer, free. Install Ollama, then run <code>ollama pull {p.models[0]}</code>. <a href={p.keyUrl} target="_blank" rel="noreferrer">Get Ollama</a></p>
          )}
          <label>
            <span>Model</span>
            <input id={`ai-model-${p.id}`} type="text" list={`ai-models-${p.id}`} spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" />
            <datalist id={`ai-models-${p.id}`}>{p.models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          {p.editableUrl && (
            <label>
              <span>Address</span>
              <input id={`ai-url-${p.id}`} type="text" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-provider/v1" />
            </label>
          )}
          <div className="aiprovacts">
            <button type="submit" className="big" disabled={busy}>{active ? 'Save' : 'Use this one'}</button>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await save(body());
                  const r = await api<{ model: string; ms: number }>('/api/ai/test', { provider: p.id });
                  return `It works: ${r.model} answered in ${(r.ms / 1000).toFixed(1)}s.`;
                })
              }
            >
              Test
            </button>
            {p.hasKey && (
              <button type="button" className="btn sm" disabled={busy} onClick={() => void act(async () => { await save({ provider: p.id, clearKey: true }); return 'Key removed.'; })}>
                Remove key
              </button>
            )}
          </div>
          {msg && <p className={`small ${msg.ok ? 'okmsg' : 'badmsg'}`} role="status">{msg.text}</p>}
        </form>
      )}
    </section>
  );
}
