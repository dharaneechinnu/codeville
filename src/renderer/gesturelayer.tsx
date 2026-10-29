import { useEffect, useRef, useState } from 'react';
import { GestureInterpreter, HandTracker, type GestureMode, type Hand } from './gesture.js';
import type { Town } from './town.js';

/** Finger bones of one hand, as pairs of landmark numbers. */
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const LABEL: Record<GestureMode, string> = {
  idle: 'show your hand',
  rotate: 'moving the town',
  zoom: 'zooming',
  hold: 'holding still',
  reset: 'view reset',
};

/**
 * Hand control with a hologram look: the camera picture shows faintly behind the see-through town, and the hand
 * skeleton is drawn on top. Open palm moves the town, two open hands zoom, a fist holds, a double pinch resets.
 */
export function GestureLayer({ getTown, onClose }: { getTown: () => Town | null; onClose: () => void }): JSX.Element {
  const back = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'starting' | 'on' | 'error'>('starting');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<GestureMode>('idle');

  useEffect(() => {
    const town = getTown();
    town?.setHologram(true);
    const interp = new GestureInterpreter();
    let shown: GestureMode = 'idle';
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
        draw(hands);
      },
    });
    const video = tracker.video;
    video.className = 'holo-video';
    back.current?.appendChild(video);

    function draw(hands: Hand[]): void {
      const c = overlay.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, w, h);
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const k = Math.max(w / vw, h / vh); // the picture fills the stage, so the points follow the same crop
      const ox = (w - vw * k) / 2;
      const oy = (h - vh * k) / 2;
      const at = (p: { x: number; y: number }): [number, number] => [ox + (1 - p.x) * vw * k, oy + p.y * vh * k];
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(92,242,255,.95)';
      g.fillStyle = '#d8fcff';
      g.shadowColor = '#19e6ff';
      g.shadowBlur = 10;
      for (const hand of hands) {
        g.beginPath();
        for (const [a, b] of BONES) {
          const [x1, y1] = at(hand[a!]!);
          const [x2, y2] = at(hand[b!]!);
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
        }
        g.stroke();
        for (const p of hand) {
          const [x, y] = at(p);
          g.beginPath();
          g.arc(x, y, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    tracker
      .start()
      .then(() => setState('on'))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Hand control could not start.');
        setState('error');
      });

    return () => {
      tracker.stop();
      video.remove();
      getTown()?.setHologram(false);
    };
    // The camera starts once when hand control is switched on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="holo-back" ref={back} />
      <div className="holo-front">
        <div className="holo-scan" />
        <canvas className="holo-hands" ref={overlay} />
        <div className="holo-hud" role="status">
          {state === 'starting' && <span>Starting the camera and hand tracking...</span>}
          {state === 'error' && (
            <span className="bad">
              {error} <button onClick={onClose}>Close</button>
            </span>
          )}
          {state === 'on' && (
            <>
              <b>HAND CONTROL</b> <em className={mode}>{LABEL[mode]}</em>
              <small>open hand: move the town · two open hands: zoom · fist: hold · double pinch: reset</small>
            </>
          )}
        </div>
      </div>
    </>
  );
}
