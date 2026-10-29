import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { useCv } from './state.js';

const RECENT_MS = 10 * 60 * 1000;

// When the user last disconnected. Shared, so the top-bar chip and the Extensions popup always agree.
let offAt = 0;
const listeners = new Set<() => void>();
const watchOff = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const markOff = (): void => {
  offAt = Date.now();
  listeners.forEach((fn) => fn());
};

/** none: not set up. installed: plugin is in Claude Code but nothing has arrived lately. active: events arrived in the last 10 minutes. */
export type LinkState = 'none' | 'installed' | 'active';

interface Status {
  claudeFound: boolean;
  installed: boolean;
}

export interface AgentLink {
  state: LinkState;
  claudeFound: boolean;
  connecting: boolean;
  justConnected: boolean;
  error: { what: string; next: string } | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  disconnecting: boolean;
}

/** The link to Claude Code: one call installs the plugin, and recent events prove it works. */
export function useAgentLink(): AgentLink {
  const { events, connected } = useCv();
  const [status, setStatus] = useState<Status | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const off = useSyncExternalStore(watchOff, () => offAt);
  const [error, setError] = useState<AgentLink['error']>(null);

  const load = useCallback(() => {
    api<Status>('/api/agent/status')
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!connected) return undefined;
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, [connected, load]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      setStatus(await api<Status>('/api/agent/connect', {}));
      setJustConnected(true);
    } catch (e) {
      const p = (e as { problem?: { what: string; next: string } }).problem;
      setError({ what: p?.what ?? (e instanceof Error ? e.message : 'Could not connect'), next: p?.next ?? 'Try again.' });
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    setError(null);
    try {
      setStatus(await api<Status>('/api/agent/disconnect', {}));
      setJustConnected(false);
      markOff(); // events that arrived before this click no longer count as a live connection
    } catch (e) {
      const p = (e as { problem?: { what: string; next: string } }).problem;
      setError({ what: p?.what ?? (e instanceof Error ? e.message : 'Could not disconnect'), next: p?.next ?? 'Try again.' });
    } finally {
      setDisconnecting(false);
    }
  }, []);

  const last = events.reduce((t, e) => (e.source === 'agent' && e.ts > t ? e.ts : t), 0);
  const state: LinkState = last > Math.max(Date.now() - RECENT_MS, off) ? 'active' : status?.installed ? 'installed' : 'none';
  return { state, claudeFound: status?.claudeFound ?? true, connecting, justConnected, error, connect, disconnect, disconnecting };
}
