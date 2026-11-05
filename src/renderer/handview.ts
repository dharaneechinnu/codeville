/** Draws the tracked hands for hand control: smoothed skeletons with a glow, the palm, fingertip rings, a palm
 * reticle and a mark for each gesture. Only the hands are drawn; the camera picture is never shown. */
import type { GestureFrame, GestureMode, Hand, Pose } from './gesture.js';

interface P { x: number; y: number }

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];
const PALM = [0, 5, 9, 13, 17];
const SMOOTH = 0.5; // share of the way each point moves toward a new reading
const FADE_MS = 220;

const COLOR: Record<GestureMode, string> = { idle: '#5cf2ff', rotate: '#5cf2ff', zoom: '#8ab4ff', hold: '#fbbc05', reset: '#34d399' };
const WORD: Record<GestureMode, string> = { idle: 'TRACKING', rotate: 'TURN', zoom: 'ZOOM', hold: 'HOLD', reset: 'RESET' };

interface Tracked { pts: P[]; seen: number; alpha: number; pose: Pose }

const center = (pts: P[]): P => ({ x: PALM.reduce((s, i) => s + pts[i]!.x, 0) / PALM.length, y: PALM.reduce((s, i) => s + pts[i]!.y, 0) / PALM.length });
const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);

export class HandView {
  private hands: Tracked[] = [];
  private mode: GestureMode = 'idle';
  private pulses: { at: P; t0: number }[] = [];
  private spin = 0;
  private last = 0;

  /** Takes one tracker reading. `toScreen` maps a landmark to canvas pixels (the picture is shown mirrored). */
  update(raw: Hand[], frame: GestureFrame, now: number, toScreen: (p: { x: number; y: number }) => P): void {
    const readings = raw.filter((h) => h.length >= 21).map((h) => h.map(toScreen)).sort((a, b) => center(a).x - center(b).x);
    readings.forEach((pts, i) => {
      const h = this.hands[i];
      if (!h || now - h.seen > 400) this.hands[i] = { pts, seen: now, alpha: h?.alpha ?? 0, pose: frame.poses[i] ?? 'other' };
      else {
        h.pts = h.pts.map((q, k) => ({ x: q.x + (pts[k]!.x - q.x) * SMOOTH, y: q.y + (pts[k]!.y - q.y) * SMOOTH }));
        h.seen = now;
        h.pose = frame.poses[i] ?? 'other';
      }
    });
    this.mode = frame.mode;
    if (frame.reset) for (const h of this.hands.slice(0, readings.length)) this.pulses.push({ at: center(h.pts), t0: now });
  }

  draw(g: CanvasRenderingContext2D, dpr: number, now: number): void {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.spin += dt * (this.mode === 'rotate' ? 2.4 : this.mode === 'hold' ? 0 : 0.6);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    this.hands = this.hands.filter((h) => {
      const live = now - h.seen < 250;
      h.alpha += ((live ? 1 : 0) - h.alpha) * Math.min(1, dt * (1000 / FADE_MS));
      return live || h.alpha > 0.02;
    });
    const col = COLOR[this.mode];
    for (const h of this.hands) this.drawHand(g, h, col, dpr);
    if (this.mode === 'zoom' && this.hands.length >= 2) this.drawZoom(g, center(this.hands[0]!.pts), center(this.hands[1]!.pts), dpr);
    this.pulses = this.pulses.filter((p) => now - p.t0 < 700);
    for (const p of this.pulses) {
      const k = (now - p.t0) / 700;
      g.beginPath(); g.arc(p.at.x, p.at.y, (30 + 140 * k) * dpr, 0, Math.PI * 2);
      g.strokeStyle = `rgba(52,211,153,${1 - k})`; g.lineWidth = 3 * dpr * (1 - k) + dpr; g.stroke();
    }
  }

  private drawHand(g: CanvasRenderingContext2D, h: Tracked, col: string, dpr: number): void {
    const p = h.pts, c = center(p), size = dist(p[0]!, p[9]!);
    g.save();
    g.globalAlpha = h.alpha;
    // palm
    g.beginPath(); PALM.forEach((i, k) => (k ? g.lineTo(p[i]!.x, p[i]!.y) : g.moveTo(p[i]!.x, p[i]!.y))); g.closePath();
    g.fillStyle = 'rgba(92,242,255,0.07)'; g.fill();
    // bones: a soft glow, then a bright core
    g.beginPath();
    for (const [a, b] of BONES) { g.moveTo(p[a]!.x, p[a]!.y); g.lineTo(p[b]!.x, p[b]!.y); }
    g.strokeStyle = 'rgba(25,230,255,0.16)'; g.lineWidth = 12 * dpr; g.stroke();
    g.strokeStyle = 'rgba(25,230,255,0.35)'; g.lineWidth = 5 * dpr; g.stroke();
    g.strokeStyle = '#c8fbff'; g.lineWidth = 1.8 * dpr; g.stroke();
    // joints and fingertips
    g.fillStyle = '#e8feff';
    for (let i = 0; i < 21; i++) {
      if (TIPS.includes(i)) continue;
      g.beginPath(); g.arc(p[i]!.x, p[i]!.y, 2.6 * dpr, 0, Math.PI * 2); g.fill();
    }
    for (const i of TIPS) {
      g.beginPath(); g.arc(p[i]!.x, p[i]!.y, 7 * dpr, 0, Math.PI * 2); g.strokeStyle = col; g.lineWidth = 2 * dpr; g.stroke();
      g.beginPath(); g.arc(p[i]!.x, p[i]!.y, 2.6 * dpr, 0, Math.PI * 2); g.fill();
    }
    if (h.pose === 'pinch') {
      const m = { x: (p[4]!.x + p[8]!.x) / 2, y: (p[4]!.y + p[8]!.y) / 2 };
      g.beginPath(); g.moveTo(p[4]!.x, p[4]!.y); g.lineTo(p[8]!.x, p[8]!.y); g.strokeStyle = '#34d399'; g.lineWidth = 3 * dpr; g.stroke();
      g.beginPath(); g.arc(m.x, m.y, 14 * dpr, 0, Math.PI * 2); g.stroke();
    }
    this.drawReticle(g, c, Math.max(26 * dpr, size * 0.42), col, dpr);
    // gesture word above the hand
    const top = Math.min(...p.map((q) => q.y)) - 22 * dpr;
    g.font = `700 ${11 * dpr}px "JetBrains Mono", Consolas, monospace`;
    const word = WORD[this.mode], w = g.measureText(word).width + 18 * dpr, hh = 20 * dpr;
    g.fillStyle = 'rgba(2,12,18,0.82)'; g.strokeStyle = col; g.lineWidth = dpr;
    g.beginPath(); g.roundRect(c.x - w / 2, top - hh, w, hh, hh / 2); g.fill(); g.stroke();
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(word, c.x, top - hh / 2 + dpr);
    g.restore();
  }

  private drawReticle(g: CanvasRenderingContext2D, c: P, r: number, col: string, dpr: number): void {
    g.save();
    g.translate(c.x, c.y);
    g.strokeStyle = col; g.fillStyle = col;
    if (this.mode === 'hold') {
      g.lineWidth = 2.5 * dpr; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.fillRect(-5 * dpr, -2 * dpr, 10 * dpr, 8 * dpr);
      g.beginPath(); g.arc(0, -2 * dpr, 3.5 * dpr, Math.PI, 0); g.lineWidth = 1.6 * dpr; g.stroke();
    } else {
      g.rotate(this.spin);
      g.setLineDash([r * 0.5, r * 0.28]); g.lineWidth = 1.6 * dpr;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.beginPath(); g.moveTo(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12); g.lineTo(Math.cos(a) * r * 1.32, Math.sin(a) * r * 1.32); g.lineWidth = 2 * dpr; g.stroke();
      }
      if (this.mode === 'rotate') {
        const R = r * 1.55, a0 = 0, a1 = 1.3;
        g.beginPath(); g.arc(0, 0, R, a0, a1); g.lineWidth = 3 * dpr; g.stroke();
        const ex = Math.cos(a1) * R, ey = Math.sin(a1) * R, tx = -Math.sin(a1), ty = Math.cos(a1);
        g.beginPath(); g.moveTo(ex + tx * 9 * dpr, ey + ty * 9 * dpr); g.lineTo(ex - ty * 6 * dpr, ey + tx * 6 * dpr); g.lineTo(ex + ty * 6 * dpr, ey - tx * 6 * dpr); g.closePath(); g.fill();
      }
    }
    g.beginPath(); g.arc(0, 0, 2.5 * dpr, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  private drawZoom(g: CanvasRenderingContext2D, a: P, b: P, dpr: number): void {
    g.save();
    g.strokeStyle = COLOR.zoom; g.fillStyle = COLOR.zoom; g.lineWidth = 2 * dpr;
    g.setLineDash([8 * dpr, 7 * dpr]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const ang = Math.atan2(p.y - q.y, p.x - q.x), x = p.x - Math.cos(ang) * 34 * dpr, y = p.y - Math.sin(ang) * 34 * dpr;
      g.beginPath(); g.moveTo(x + Math.cos(ang) * 10 * dpr, y + Math.sin(ang) * 10 * dpr);
      g.lineTo(x + Math.cos(ang + 2.5) * 9 * dpr, y + Math.sin(ang + 2.5) * 9 * dpr); g.lineTo(x + Math.cos(ang - 2.5) * 9 * dpr, y + Math.sin(ang - 2.5) * 9 * dpr); g.closePath(); g.fill();
    }
    g.restore();
  }
}
