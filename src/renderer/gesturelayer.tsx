import { useEffect, useRef, useState } from 'react';
import { GestureInterpreter, HandTracker, type GestureMode, type Hand } from './gesture.js';
import { HandView } from './handview.js';
import type { Town } from './town.js';

const STEPS: [GestureMode, string, string][] = [
  ['rotate', 'Open hand', 'turn'],
  ['zoom', 'Two hands', 'zoom'],
  ['hold', 'Fist', 'hold'],
  ['reset', 'Double pinch', 'reset'],
];

/**
 * Hand control with a hologram look: the town turns see-through and the tracked hands are drawn over it. The camera
 * only feeds the hand tracker; its picture is never shown. Open hand turns the town, two open hands zoom, a fist
 * holds, a double pinch resets.
 */
export function GestureLayer({ getTown, onClose }: { getTown: () => Town | null; onClose: () => void }): JSX.Element {
  const overlay = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'starting' | 'on' | 'error'>('starting');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<GestureMode>('idle');

  useEffect(() => {
    const town = getTown();
    town?.setHologram(true);
    const interp = new GestureInterpreter();
    let shown: GestureMode = 'idle';
    const view = new HandView();
    const tracker = new HandTracker({
      onError: (m) => {
        setError(m);
        setState('error');
      },
      onHands: (hands: Hand[], now) => {
        const f = interp.update(hands, now);
        const t = getTown();
        if (t) {
          if (f.yaw) t.rotate(f.yaw);
          if (f.tilt) t.tilt(f.tilt);
          if (f.zoom !== 1) t.zoom(f.zoom);
          if (f.reset) t.overview();
        }
        if (f.mode !== shown) {
          shown = f.mode;
          setMode(f.mode);
        }
        view.update(hands, f, now, toScreen);
      },
    });
    // The camera element stays in the page so the browser keeps decoding it, but it is invisible: it only feeds the tracker.
    const video = tracker.video;
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(video);

    // Landmarks are in camera-image space; the stage shows that space mirrored and cropped to fill it.
    function toScreen(p: { x: number; y: number }): { x: number; y: number } {
      const c = overlay.current, dpr = window.devicePixelRatio || 1;
      const w = (c?.clientWidth ?? 0) * dpr, h = (c?.clientHeight ?? 0) * dpr;
      const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
      const k = Math.max(w / vw, h / vh);
      return { x: (w - vw * k) / 2 + (1 - p.x) * vw * k, y: (h - vh * k) / 2 + p.y * vh * k };
    }

    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const c = overlay.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      view.draw(g, dpr, performance.now());
    };
    frame();

    tracker
      .start()
      .then(() => setState('on'))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Hand control could not start.');
        setState('error');
      });

    return () => {
      tracker.stop();
      cancelAnimationFrame(raf);
      video.remove();
      getTown()?.setHologram(false);
    };
    // The camera starts once when hand control is switched on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="holo-front">
      <div className="holo-scan" />
      <canvas className="holo-hands" ref={overlay} />
      <div className="holo-hud" role="status">
        {state === 'starting' && <span>Starting hand tracking...</span>}
        {state === 'error' && (
          <span className="bad">
            {error} <button onClick={onClose}>Close</button>
          </span>
        )}
        {state === 'on' && (
          <>
            <b>HAND CONTROL{mode === 'idle' ? ' · show your hand' : ''}</b>
            <ul>
              {STEPS.map(([m, hand, does]) => (
                <li key={m} className={mode === m ? 'on' : ''}>{hand} <em>{does}</em></li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
