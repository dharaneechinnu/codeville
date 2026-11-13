/**
 * The event contract. Every part of the app (the Claude Code plugin, the terminal runner,
 * the parsers, the visualizers and any agent built on top) speaks only this.
 * One event is one small JSON object with a `type`.
 */

import type { TeamRun } from './types.js';

export type EventSource = 'agent' | 'terminal' | 'git' | 'app';

/** What broke, why, and what to do next. Every failure carries one, so messages stay crisp. */
export interface Problem {
  what: string;
  why: string[];
  file?: string;
  line?: number;
  next: string;
}

export type RunKind = 'test' | 'lint' | 'typecheck' | 'build' | 'command';

interface Base {
  id: string;
  ts: number;
  source: EventSource;
  sessionId?: string;
  /** The team agent that caused this, when the team is working. */
  team?: string;
}

export type CvEvent = Base &
  (
    | { type: 'session.start'; cwd: string; agent: string; model?: string }
    | { type: 'session.end' }
    | { type: 'prompt'; text: string }
    | { type: 'turn.end'; message?: string }
    | { type: 'agent.start'; agentId: string; agentType?: string }
    | { type: 'agent.stop'; agentId: string; agentType?: string }
    | { type: 'tool'; tool: string; phase: 'start' | 'end' | 'fail'; target?: string; agentId?: string }
    | { type: 'file.change'; path: string; op: 'edit' | 'write' | 'create' | 'delete'; agentId?: string }
    | { type: 'run.start'; runId: string; kind: RunKind; command: string }
    | { type: 'step.start'; runId: string; stepId: string; name: string; path?: string }
    | { type: 'step.pass'; runId: string; stepId: string; name: string; path?: string; ms?: number }
    | { type: 'step.fail'; runId: string; stepId: string; name: string; path?: string; ms?: number; problem: Problem }
    | {
        type: 'run.end';
        runId: string;
        kind: RunKind;
        status: 'pass' | 'fail';
        passed: number;
        failed: number;
        skipped: number;
        ms: number;
        problem?: Problem;
      }
    | { type: 'git.status'; branch: string; staged: number; changed: number; ahead: number; behind: number }
    | { type: 'git.commit'; branch: string; hash: string; message: string; files: number }
    | { type: 'git.push'; branch: string; commits: number }
    | { type: 'analysis.step'; step: string; label: string; status: 'running' | 'done'; detail?: string }
    | { type: 'team.run'; run: TeamRun }
  );

export type CvEventType = CvEvent['type'];

/** An event before the hub stamps it with an id and a time. */
export type NewEvent = DistributiveOmit<CvEvent, 'id' | 'ts'> & { id?: string; ts?: number };
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

let counter = 0;

export function newId(prefix = 'e'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function stamp(e: NewEvent): CvEvent {
  return { ...e, id: e.id ?? newId(), ts: e.ts ?? Date.now() } as CvEvent;
}

const TYPES: ReadonlySet<string> = new Set<CvEventType>([
  'session.start', 'session.end', 'prompt', 'turn.end', 'agent.start', 'agent.stop', 'tool', 'file.change',
  'run.start', 'step.start', 'step.pass', 'step.fail', 'run.end', 'git.status', 'git.commit', 'git.push', 'analysis.step',
]);
const SOURCES: ReadonlySet<string> = new Set<EventSource>(['agent', 'terminal', 'git', 'app']);

/** Checks the shape of something that came in over the wire. Does not trust it. */
export function parseNewEvent(value: unknown): NewEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || !TYPES.has(v.type)) return null;
  if (typeof v.source !== 'string' || !SOURCES.has(v.source)) return null;
  if (v.ts !== undefined && typeof v.ts !== 'number') return null;
  if (v.id !== undefined && typeof v.id !== 'string') return null;
  return v as unknown as NewEvent;
}

/** Turns a problem into the two lines users read: what broke, and what is next. */
export function crisp(p: Problem): { title: string; broke: string; next: string; where?: string } {
  const where = p.file ? (p.line ? `${p.file}:${p.line}` : p.file) : undefined;
  return { title: p.what, broke: p.why.join('. ') + (p.why.length ? '.' : ''), next: p.next, where };
}
