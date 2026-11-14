import { useEffect, useRef, useState } from 'react';
import type { CvEvent } from '../shared/events.js';

export interface CvBridge {
  baseUrl: string;
  token: string;
  pluginPath?: string;
  pickFolder?: () => Promise<string | null>;
  openFile?: (root: string, rel: string) => Promise<boolean>;
}

declare global {
  interface Window {
    cv?: CvBridge;
  }
}

/** Inside the Windows app the bridge comes from the preload script. In a browser (development) it comes from the page address. */
export function bridge(): CvBridge {
  if (window.cv && window.cv.baseUrl) return window.cv;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return { baseUrl: hash.get('base') ?? 'http://127.0.0.1:4317', token: hash.get('token') ?? '' };
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const b = bridge();
  const res = await fetch(b.baseUrl + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-cv-token': b.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(data.error ?? `The app answered with ${res.status}`) as Error & { problem?: unknown };
    err.problem = (data as { problem?: unknown }).problem;
    throw err;
  }
  return data;
}

export interface OutputLine {
  runId: string;
  line: string;
  /** out and err are whole lines. delta is a piece of an answer as it is written; tool is one thing an agent did. */
  stream: 'out' | 'err' | 'delta' | 'tool';
}

/** One piece of an answer that is being written: words, something the agent did, or an error it printed. */
export interface LivePart {
  kind: 'text' | 'tool' | 'err';
  text: string;
}

/** Follows the live event stream and the terminal output. Reconnects by itself. */
export function useEventStream(onEvent: (e: CvEvent) => void): { events: CvEvent[]; output: OutputLine[]; live: Record<string, LivePart[]>; connected: boolean } {
  const [events, setEvents] = useState<CvEvent[]>([]);
  const [output, setOutput] = useState<OutputLine[]>([]);
  // What each run has said so far, for the chat. Words arrive many times a second, so the screen follows in small steps.
  const [live, setLive] = useState<Record<string, LivePart[]>>({});
  const runs = useRef(new Map<string, { parts: LivePart[]; streamed: boolean }>());
  const paint = useRef(0);
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const b = bridge();
    const es = new EventSource(`${b.baseUrl}/stream?token=${encodeURIComponent(b.token)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m: MessageEvent<string>) => {
      try {
        const e = JSON.parse(m.data) as CvEvent;
        setEvents((prev) => [...prev.slice(-499), e]);
        handler.current(e);
      } catch {
        // Ignore a broken message and keep listening.
      }
    };
    es.addEventListener('output', (m) => {
      try {
        const o = JSON.parse((m as MessageEvent<string>).data) as OutputLine;
        let run = runs.current.get(o.runId);
        if (!run) {
          run = { parts: [], streamed: false };
          runs.current.set(o.runId, run);
          if (runs.current.size > 6) runs.current.delete(runs.current.keys().next().value as string);
        }
        const say = (text: string): void => {
          const end = run!.parts[run!.parts.length - 1];
          if (end?.kind === 'text') end.text += text;
          else run!.parts.push({ kind: 'text', text });
        };
        if (o.stream === 'delta') {
          run.streamed = true;
          say(o.line);
        } else if (o.stream === 'tool') run.parts.push({ kind: 'tool', text: o.line });
        else if (o.stream === 'err') run.parts.push({ kind: 'err', text: o.line });
        else if (!run.streamed) say(`${o.line}\n`); // an engine that prints whole lines
        if (run.parts.length > 400) run.parts.splice(0, run.parts.length - 400);
        if (!paint.current) {
          paint.current = window.setTimeout(() => {
            paint.current = 0;
            setLive(Object.fromEntries([...runs.current].map(([id, r]) => [id, r.parts.map((p) => ({ ...p }))])));
          }, 50);
        }
        if (o.stream !== 'delta') setOutput((prev) => [...prev.slice(-299), o]);
      } catch {
        // Ignore.
      }
    });
    return () => es.close();
  }, []);

  return { events, output, live, connected };
}
