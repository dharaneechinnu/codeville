import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export type WId = 'chat' | 'viz' | 'files' | 'git';
export type ColId = 'L' | 'C' | 'R';

export interface Layout {
  order: WId[];
  col: Record<WId, ColId>;
  vis: Record<WId, boolean>;
  /** Fixed heights in pixels. A widget without one shares the leftover space. */
  h: Partial<Record<WId, number>>;
  wl: number;
  wr: number;
}

export const TITLES: Record<WId, string> = { chat: 'Chat', viz: 'Visualizer', files: 'Files', git: 'Source control' };
export const ALL: WId[] = ['chat', 'viz', 'files', 'git'];
const FLEX: Record<WId, number> = { chat: 1, viz: 4, files: 1.3, git: 1 };
const KEY = 'cv.app.layout1';

const all = (v: boolean): Record<WId, boolean> => ({ chat: v, viz: v, files: v, git: v });

export const PRESETS: Record<string, { name: string; layout: Layout }> = {
  vibe: {
    name: 'Vibe',
    layout: { order: ['chat', 'viz', 'files', 'git'], col: { chat: 'L', viz: 'C', files: 'R', git: 'R' }, vis: all(true), h: {}, wl: 340, wr: 320 },
  },
  review: {
    name: 'Review',
    layout: { order: ['chat', 'files', 'git', 'viz'], col: { chat: 'L', files: 'C', git: 'C', viz: 'R' }, vis: all(true), h: {}, wl: 320, wr: 440 },
  },
  viz: {
    name: 'Visualizer only',
    layout: { order: ['chat', 'viz', 'files', 'git'], col: { chat: 'L', viz: 'C', files: 'R', git: 'R' }, vis: { chat: true, viz: true, files: false, git: false }, h: {}, wl: 340, wr: 320 },
  },
};

export function loadLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Layout | null;
    if (raw && ALL.every((id) => raw.order?.includes(id) && raw.col?.[id] && typeof raw.vis?.[id] === 'boolean')) return raw;
  } catch {
    // Use the default below.
  }
  return structuredClone(PRESETS.vibe!.layout);
}

export function saveLayout(l: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // Not saving is fine.
  }
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

function moveTo(l: Layout, id: WId, col: ColId, before: WId | null): Layout {
  const order = l.order.filter((x) => x !== id);
  if (before && order.includes(before)) order.splice(order.indexOf(before), 0, id);
  else {
    const last = [...order].reverse().find((x) => l.col[x] === col);
    if (last) order.splice(order.indexOf(last) + 1, 0, id);
    else order.push(id);
  }
  return { ...l, order, col: { ...l.col, [id]: col }, vis: { ...l.vis, [id]: true } };
}

interface Props {
  layout: Layout;
  setLayout: (fn: (l: Layout) => Layout) => void;
  adjust: boolean;
  render: (id: WId) => ReactNode;
  headerExtra?: (id: WId) => ReactNode;
}

/** Three columns of widgets. Drag a header to move a widget, drag the bars to resize, use the corner grip for height. */
export function Workspace({ layout, setLayout, adjust, render, headerExtra }: Props): JSX.Element {
  const [dragId, setDragId] = useState<WId | null>(null);
  const [drop, setDrop] = useState<{ col: ColId; before: WId | null } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string } | null>(null);
  const pending = useRef<{ id: WId; x: number; y: number; on: boolean } | null>(null);
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const resize = useRef<
    | { kind: 'col'; side: 'wl' | 'wr'; x: number; w0: number }
    | { kind: 'v'; prev: WId; next: WId; y: number; ph: number; nh: number }
    | { kind: 'grip'; id: WId; x: number; y: number; h0: number; wl: number; wr: number }
    | null
  >(null);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const r = resize.current;
      if (r?.kind === 'col') {
        const d = e.clientX - r.x;
        setLayout((l) => ({ ...l, [r.side]: clamp(r.side === 'wl' ? r.w0 + d : r.w0 - d, 220, 640) }));
        return;
      }
      if (r?.kind === 'v') {
        const p = clamp(r.ph + (e.clientY - r.y), 90, r.ph + r.nh - 90);
        setLayout((l) => ({ ...l, h: { ...l.h, [r.prev]: Math.round(p), [r.next]: Math.round(r.ph + r.nh - p) } }));
        return;
      }
      if (r?.kind === 'grip') {
        const h = clamp(r.h0 + (e.clientY - r.y), 90, 1600);
        setLayout((l) => {
          const col = l.col[r.id];
          const next = { ...l, h: { ...l.h, [r.id]: Math.round(h) } };
          if (col === 'L') next.wl = clamp(r.wl + (e.clientX - r.x), 220, 640);
          if (col === 'R') next.wr = clamp(r.wr - (e.clientX - r.x), 220, 640);
          return next;
        });
        return;
      }
      const p = pending.current;
      if (!p) return;
      if (!p.on) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
        p.on = true;
        setDragId(p.id);
      }
      setGhost({ x: e.clientX + 12, y: e.clientY + 12, text: TITLES[p.id] });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const colEl = el?.closest<HTMLElement>('[data-col]');
      if (!colEl) return setDrop(null);
      const col = colEl.dataset.col as ColId;
      const widgets = Array.from(colEl.querySelectorAll<HTMLElement>('[data-w]')).filter((w) => w.dataset.w !== p.id);
      const before = widgets.find((w) => e.clientY < w.getBoundingClientRect().top + w.getBoundingClientRect().height / 2);
      setDrop({ col, before: (before?.dataset.w as WId | undefined) ?? null });
    };
    const onUp = (): void => {
      const p = pending.current;
      pending.current = null;
      resize.current = null;
      if (p?.on) {
        const d = dropRef.current;
        if (d) setLayout((l) => moveTo(l, p.id, d.col, d.before));
        setDragId(null);
        setDrop(null);
        setGhost(null);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        pending.current = null;
        setDragId(null);
        setDrop(null);
        setGhost(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [setLayout]);

  const startDrag = useCallback((id: WId, e: React.PointerEvent): void => {
    const t = e.target as HTMLElement;
    if (t.closest('button,input,select,textarea')) return;
    pending.current = { id, x: e.clientX, y: e.clientY, on: false };
  }, []);

  const widgetsIn = (c: ColId): WId[] => layout.order.filter((id) => layout.col[id] === c && layout.vis[id]);
  const columns = (['L', 'C', 'R'] as ColId[]).filter((c) => widgetsIn(c).length > 0 || dragId !== null);
  const style = { '--wl': `${layout.wl}px`, '--wr': `${layout.wr}px` } as CSSProperties;

  const gutterDown = (a: ColId, b: ColId) => (e: React.PointerEvent): void => {
    e.preventDefault();
    const side = a === 'L' ? 'wl' : 'wr';
    const colEl = document.querySelector<HTMLElement>(`[data-col="${side === 'wl' ? a : b}"]`);
    resize.current = { kind: 'col', side, x: e.clientX, w0: colEl?.offsetWidth ?? (side === 'wl' ? layout.wl : layout.wr) };
  };

  return (
    <div className={`cols${adjust ? ' adjust' : ''}${dragId ? ' dragging' : ''}`} style={style}>
      {columns.map((c, ci) => {
        const ws = widgetsIn(c);
        const prevCol = columns[ci - 1];
        return (
          <div key={c} style={{ display: 'contents' }}>
            {prevCol && (
              <div className="gut" role="separator" aria-orientation="vertical" aria-label="Resize columns" onPointerDown={gutterDown(prevCol, c)} />
            )}
            <div
              className={`col col-${c}${drop?.col === c ? ' over' : ''}${drop?.col === c && !drop.before ? ' de' : ''}${ws.length === 0 ? ' empty' : ''}`}
              data-col={c}
              style={c === 'L' ? { width: 'var(--wl)' } : c === 'R' ? { width: 'var(--wr)' } : undefined}
            >
              {ws.map((id, i) => (
                <div key={id} style={{ display: 'contents' }}>
                  {i > 0 && (
                    <div
                      className="vg"
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize widgets"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        const prev = ws[i - 1]!;
                        const ph = document.querySelector<HTMLElement>(`[data-w="${prev}"]`)?.offsetHeight ?? 200;
                        const nh = document.querySelector<HTMLElement>(`[data-w="${id}"]`)?.offsetHeight ?? 200;
                        resize.current = { kind: 'v', prev, next: id, y: e.clientY, ph, nh };
                      }}
                      onDoubleClick={() => setLayout((l) => ({ ...l, h: { ...l.h, [ws[i - 1]!]: undefined, [id]: undefined } }))}
                    />
                  )}
                  <section
                    className={`w${dragId === id ? ' dragsrc' : ''}${drop?.before === id && drop.col === c ? ' db' : ''}`}
                    data-w={id}
                    style={{ flex: layout.h[id] ? `0 0 ${layout.h[id]}px` : `${FLEX[id]} 1 0` }}
                  >
                    <header className="wh" onPointerDown={(e) => startDrag(id, e)}>
                      <span className="grip" aria-hidden="true">::</span>
                      <b>{TITLES[id]}</b>
                      <span className="hx">{headerExtra?.(id)}</span>
                    </header>
                    <div className="wb">{render(id)}</div>
                    {adjust && <div className="szbadge" aria-hidden="true">{TITLES[id]}</div>}
                    <div
                      className="rg"
                      role="separator"
                      aria-label="Resize widget"
                      title="Drag to resize. Double-click to reset."
                      onPointerDown={(e) => {
                        e.preventDefault();
                        const el = document.querySelector<HTMLElement>(`[data-w="${id}"]`);
                        resize.current = { kind: 'grip', id, x: e.clientX, y: e.clientY, h0: el?.offsetHeight ?? 200, wl: layout.wl, wr: layout.wr };
                      }}
                      onDoubleClick={() => setLayout((l) => ({ ...l, h: { ...l.h, [id]: undefined } }))}
                    />
                  </section>
                </div>
              ))}
              {ws.length === 0 && <div className="dropzone">Drop a widget here</div>}
            </div>
          </div>
        );
      })}
      {ghost && (
        <div className="ghost" style={{ left: ghost.x, top: ghost.y }}>
          {ghost.text}
        </div>
      )}
    </div>
  );
}
