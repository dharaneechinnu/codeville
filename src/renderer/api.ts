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
  stream: 'out' | 'err';
}

/** Follows the live event stream and the terminal output. Reconnects by itself. */
export function useEventStream(onEvent: (e: CvEvent) => void): { events: CvEvent[]; output: OutputLine[]; connected: boolean } {
  const [events, setEvents] = useState<CvEvent[]>([]);
  const [output, setOutput] = useState<OutputLine[]>([]);
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
        setOutput((prev) => [...prev.slice(-299), o]);
      } catch {
        // Ignore.
      }
    });
    return () => es.close();
  }, []);

  return { events, output, connected };
}
