/** AI edits with the user's own key: provider settings and the edit request. Keys go to the backend and never come back. */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export interface AIProvider {
  id: string;
  label: string;
  tier: 'free' | 'local' | 'paid' | 'any';
  keyUrl: string;
  models: string[];
  needsKey: boolean;
  model: string;
  baseUrl: string;
  editableUrl: boolean;
  hasKey: boolean;
  keyHint: string;
  ready: boolean;
}

export interface AISettings {
  active: string | null;
  providers: AIProvider[];
}

export interface AIEdit {
  file: string;
  original: string;
  updated: string;
  summary: string;
  provider: string;
  model: string;
  ms: number;
  changed: boolean;
}

export const TIER: Record<AIProvider['tier'], string> = { free: 'Free tier', local: 'Free, local', paid: 'Paid', any: 'Any' };

/** Opens Extensions at the AI models section (App listens for this). */
export function openAISetup(): void {
  window.dispatchEvent(new CustomEvent('cv:open-ai-setup'));
}

export function useAISettings(): { settings: AISettings | null; reload: () => Promise<void>; save: (body: Record<string, unknown>) => Promise<AISettings> } {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const reload = useCallback(async () => {
    setSettings(await api<AISettings>('/api/ai/settings'));
  }, []);
  const save = useCallback(async (body: Record<string, unknown>) => {
    const s = await api<AISettings>('/api/ai/settings', body);
    setSettings(s);
    window.dispatchEvent(new CustomEvent('cv:ai-settings'));
    return s;
  }, []);
  useEffect(() => {
    void reload().catch(() => setSettings(null));
    const on = (): void => void reload().catch(() => undefined);
    window.addEventListener('cv:ai-settings', on);
    return () => window.removeEventListener('cv:ai-settings', on);
  }, [reload]);
  return { settings, reload, save };
}
