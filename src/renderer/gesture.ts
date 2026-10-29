/** Hand gestures: the camera tracker (MediaPipe Hand Landmarker, run locally) and the rules that turn hand poses into view moves. */

export interface Pt {
  x: number;
  y: number;
  z: number;
}
/** The 21 landmarks of one hand, as the camera sees it (x from the left of the image, y from the top, both 0 to 1). */
export type Hand = Pt[];
export type Pose = 'open' | 'fist' | 'pinch' | 'other';
export type GestureMode = 'idle' | 'rotate' | 'zoom' | 'hold' | 'reset';

/** What the view should do this frame. yaw and tilt are in radians, zoom is a distance factor (below 1 zooms in). */
export interface GestureFrame {
  mode: GestureMode;
  yaw: number;
  tilt: number;
  zoom: number;
  reset: boolean;
  poses: Pose[];
}

const WRIST = 0;
const PALM = [0, 5, 9, 13, 17];
const FINGERS: [number, number][] = [[8, 6], [12, 10], [16, 14], [20, 18]]; // fingertip, middle joint

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Size of the hand in the image, so a gesture means the same near the camera and far from it. */
export function handSize(h: Hand): number {
  return dist(h[WRIST]!, h[9]!) || 1e-6;
}

export function palmCenter(h: Hand): Pt {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += h[i]!.x;
    y += h[i]!.y;
  }
  return { x: x / PALM.length, y: y / PALM.length, z: 0 };
}

/** Which fingers are stretched out: a fingertip farther from the wrist than the joint below it. */
export function extended(h: Hand): number {
  const w = h[WRIST]!;
  return FINGERS.filter(([tip, pip]) => dist(h[tip]!, w) > dist(h[pip]!, w) * 1.12).length;
}

export function poseOf(h: Hand): Pose {
  if (h.length < 21) return 'other';
  const size = handSize(h);
  const n = extended(h);
  if (dist(h[4]!, h[8]!) < size * 0.32) return 'pinch';
  if (n >= 4) return 'open';
  if (n === 0) return 'fist';
  return 'other';
}

/** A small low-lag smoothing filter (One Euro): steady when the hand is still, quick when it moves. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCutoff = 1.4, private beta = 6, private dCutoff = 1) {}
  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset(): void {
    this.x = null;
  }
  filter(v: number, t: number): number {
    if (this.x === null) {
      this.x = v;
      this.t = t;
      this.dx = 0;
      return v;
    }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const rate = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (rate - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

const YAW_PER_WIDTH = 3.4; // a hand sweep across the whole image turns the town about half a turn
const TILT_PER_HEIGHT = 1.7;
const DEADZONE = 0.0025;
const STABLE_FRAMES = 3;
const DOUBLE_PINCH_MS = 750;
const RESET_COOLDOWN_MS = 1500;
const LOST_FRAMES = 6;

/** Turns hands into view moves. Open palm moves the town, two open hands zoom, a fist holds still, a double pinch resets. */
export class GestureInterpreter {
  private fx = new OneEuro();
  private fy = new OneEuro();
  private gx = new OneEuro();
  private gy = new OneEuro();
  private prev: Pt | null = null;
  private prevGap: number | null = null;
  private mode: GestureMode = 'idle';
  private stable: Pose[] = [];
  private pending: Pose[] = [];
  private pendingCount: number[] = [];
  private pinching = false;
  private pinchStarts: number[] = [];
  private lastReset = -1e9;
  private lost = 0;

  /** Keeps a pose only after it has been seen for a few frames in a row, so one bad frame does nothing. */
  private steady(raw: Pose[]): Pose[] {
    raw.forEach((p, i) => {
      if (this.pending[i] === p) this.pendingCount[i] = (this.pendingCount[i] ?? 0) + 1;
      else {
        this.pending[i] = p;
        this.pendingCount[i] = 1;
      }
      if ((this.pendingCount[i] ?? 0) >= STABLE_FRAMES || this.stable[i] === undefined) this.stable[i] = p;
    });
    this.stable.length = raw.length;
    this.pending.length = raw.length;
    this.pendingCount.length = raw.length;
    return [...this.stable];
  }

  private enter(mode: GestureMode): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.prev = null;
      this.prevGap = null;
      this.fx.reset();
      this.fy.reset();
      this.gx.reset();
      this.gy.reset();
    }
  }

  update(raw: Hand[], now: number): GestureFrame {
    const frame: GestureFrame = { mode: 'idle', yaw: 0, tilt: 0, zoom: 1, reset: false, poses: [] };
    const hands = raw
      .filter((h) => h.length >= 21)
      // The image is shown mirrored, so the left-most hand on screen comes first.
      .map((h) => h.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })))
      .sort((a, b) => palmCenter(a).x - palmCenter(b).x);

    if (hands.length === 0) {
      this.lost += 1;
      if (this.lost >= LOST_FRAMES) {
        this.enter('idle');
        this.stable = [];
        this.pending = [];
        this.pendingCount = [];
        this.pinching = false;
      }
      frame.mode = this.mode === 'idle' ? 'idle' : this.mode;
      return frame;
    }
    this.lost = 0;

    const poses = this.steady(hands.map(poseOf));
    frame.poses = poses;

    // Double pinch: the thumb and finger meet twice within a short time.
    const pinchNow = poses.includes('pinch');
    if (pinchNow && !this.pinching) {
      this.pinchStarts = this.pinchStarts.filter((t) => now - t < DOUBLE_PINCH_MS);
      this.pinchStarts.push(now);
      if (this.pinchStarts.length >= 2 && now - this.lastReset > RESET_COOLDOWN_MS) {
        this.lastReset = now;
        this.pinchStarts = [];
        frame.reset = true;
      }
    }
    this.pinching = pinchNow;
    if (frame.reset || now - this.lastReset < 600) {
      this.enter('reset');
      frame.mode = 'reset';
      return frame;
    }

    if (poses.includes('fist') && !poses.includes('open')) {
      this.enter('hold');
      frame.mode = 'hold';
      return frame;
    }

    if (hands.length >= 2 && poses[0] === 'open' && poses[1] === 'open') {
      this.enter('zoom');
      frame.mode = 'zoom';
      const a = palmCenter(hands[0]!);
      const b = palmCenter(hands[1]!);
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.prevGap !== null && gap > 1e-4) {
        const ratio = this.prevGap / gap;
        if (Math.abs(ratio - 1) > 0.004) frame.zoom = Math.min(1.08, Math.max(0.92, ratio));
      }
      this.prevGap = gap;
      return frame;
    }

    const openIdx = poses.indexOf('open');
    if (openIdx >= 0) {
      this.enter('rotate');
      frame.mode = 'rotate';
      const c = palmCenter(hands[openIdx]!);
      const sx = this.fx.filter(c.x, now);
      const sy = this.fy.filter(c.y, now);
      if (this.prev) {
        const dx = sx - this.prev.x;
        const dy = sy - this.prev.y;
        if (Math.abs(dx) > DEADZONE) frame.yaw = -dx * YAW_PER_WIDTH;
        if (Math.abs(dy) > DEADZONE) frame.tilt = -dy * TILT_PER_HEIGHT;
      }
      this.prev = { x: sx, y: sy, z: 0 };
      return frame;
    }

    this.enter('idle');
    return frame;
  }
}

export interface TrackerHandlers {
  onHands: (hands: Hand[], now: number) => void;
  onError: (message: string) => void;
}

/** Opens the camera and runs the hand landmark model on every new video frame. Nothing leaves the computer. */
export class HandTracker {
  readonly video = document.createElement('video');
  private stream: MediaStream | null = null;
  private landmarker: { detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks: Hand[] }; close: () => void } | null = null;
  private raf = 0;
  private lastTime = -1;
  private alive = false;

  constructor(private handlers: TrackerHandlers) {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  async start(): Promise<void> {
    this.alive = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      this.stop();
      throw new Error(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera access is off. Turn it on in Windows Settings, Privacy and security, Camera, for desktop apps.'
          : name === 'NotFoundError'
            ? 'No camera was found. Check that it is plugged in, not used by another app, and allowed in Windows Settings, Privacy and security, Camera.'
            : 'The camera could not be opened. Another app may be using it.',
      );
    }
    if (!this.alive) return this.stop();
    this.video.srcObject = this.stream;
    await this.video.play();

    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const base = new URL('./mediapipe', location.href).href;
    const fileset = await FilesetResolver.forVisionTasks(base);
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      this.landmarker = await make('GPU');
    } catch {
      this.landmarker = await make('CPU');
    }
    if (!this.alive) return this.stop();
    this.loop();
  }

  private loop = (): void => {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.loop);
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastTime) return;
    this.lastTime = v.currentTime;
    try {
      const now = performance.now();
      this.handlers.onHands(this.landmarker.detectForVideo(v, now).landmarks, now);
    } catch (e) {
      this.handlers.onError(e instanceof Error ? e.message : 'Hand tracking stopped.');
      this.stop();
    }
  };

  stop(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    try {
      this.landmarker?.close();
    } catch {
      /* already closed */
    }
    this.landmarker = null;
  }
}
