// Modern ad soundtrack for the pro cuts: warm pads, plucked chords, sub bass that ducks under the kick, claps,
// shakers, risers and impacts, with a small reverb. Everything is synthesized here; no samples.
//   node music_pro.mjs   -> ../audio/pro-launch.wav, ../audio/pro-social.wav, ../audio/pro-demo.wav
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const here = path.dirname(fileURLToPath(import.meta.url));
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function bus(n) { return { L: new Float32Array(n), R: new Float32Array(n) }; }
function track(dur) {
  const n = Math.ceil(dur * SR);
  return { dur, n, dry: bus(n), wet: bus(n), duck: new Float32Array(n).fill(1) };
}
// add(t, len, fn(x, i) -> [l, r] or number, gain, send)
function add(T, t, len, fn, g = 1, send = 0, pan = 0) {
  const s0 = Math.floor(t * SR), n = Math.floor(len * SR);
  for (let i = 0; i < n; i++) {
    const a = s0 + i;
    if (a < 0 || a >= T.n) continue;
    const v = fn(i / SR, i) * g;
    const l = v * (1 - pan), r = v * (1 + pan);
    T.dry.L[a] += l; T.dry.R[a] += r;
    if (send) { T.wet.L[a] += l * send; T.wet.R[a] += r * send; }
  }
}
const saw = (f, x) => 2 * ((x * f) % 1) - 1;
function lowpass(cut) { let y = 0; return (x, c = cut) => { const k = 1 - Math.exp(-2 * Math.PI * c / SR); y += k * (x - y); return y; }; }

const V = {
  pad(T, t, notes, len, g) {
    const lp = lowpass(900), lp2 = lowpass(900);
    const det = [0, 0.006, -0.005];
    add(T, t, len, (x) => {
      let s = 0;
      for (const m of notes) for (const d of det) s += saw(hz(m) * (1 + d), x + d * 3);
      const env = Math.min(1, x / 0.6, (len - x) / 0.8);
      return lp2(lp(s / (notes.length * 3), 700 + 500 * Math.sin(x * 0.7))) * env;
    }, g, 0.6);
  },
  pluck(T, t, m, g, pan = 0) {
    const lp = lowpass(3000);
    add(T, t, 0.55, (x) => lp((saw(hz(m), x) + saw(hz(m) * 1.003, x)) * 0.5, 300 + 4200 * Math.exp(-x / 0.06)) * Math.exp(-x / 0.18), g, 0.45, pan);
  },
  sub(T, t, m, len, g) {
    add(T, t, len, (x) => Math.sin(2 * Math.PI * hz(m) * x) * Math.min(1, x / 0.01, (len - x) / 0.04), g);
  },
  kick(T, t, g) {
    add(T, t, 0.35, (x) => Math.sin(2 * Math.PI * (50 * x + 110 * 0.045 * (1 - Math.exp(-x / 0.045)))) * Math.exp(-x / 0.12) + (x < 0.004 ? rnd() * 0.3 : 0), g);
    const s = Math.floor(t * SR);
    for (let i = 0; i < 0.3 * SR && s + i < T.n; i++) if (s + i >= 0) T.duck[s + i] = Math.min(T.duck[s + i], 0.25 + 0.75 * Math.min(1, i / (0.22 * SR)));
  },
  clap(T, t, g) {
    let p = 0;
    add(T, t, 0.25, (x) => { const n = rnd(), h = n - p; p = n; const burst = [0, 0.012, 0.024].some((o) => x >= o && x < o + 0.008) ? 1 : 0; return h * (burst * 0.8 + Math.exp(-(x - 0.024) / 0.07) * (x > 0.024 ? 0.6 : 0)); }, g, 0.35);
  },
  shaker(T, t, g) { let p = 0; add(T, t, 0.06, (x) => { const n = rnd(), h = n - p; p = n; return h * Math.exp(-x / 0.018); }, g, 0.1, 0.3); },
  riser(T, t, len, g) {
    const lp = lowpass(200);
    add(T, t, len, (x) => { const k = x / len; return lp(rnd(), 200 + 9000 * k * k) * k * k; }, g, 0.5);
    add(T, t, len, (x) => Math.sin(2 * Math.PI * (200 * x + 400 * x * x / len)) * (x / len) ** 2 * 0.3, g, 0.4);
  },
  impact(T, t, g) {
    add(T, t, 1.6, (x) => Math.sin(2 * Math.PI * (38 * x + 60 * 0.08 * (1 - Math.exp(-x / 0.08)))) * Math.exp(-x / 0.5), g);
    const lp = lowpass(4000);
    add(T, t, 1.6, (x) => lp(rnd(), 400 + 6000 * Math.exp(-x / 0.2)) * Math.exp(-x / 0.4) * 0.5, g, 0.8);
  },
  whoosh(T, t, g) { const lp = lowpass(300); add(T, t, 0.5, (x) => lp(rnd(), 300 + 5000 * Math.sin(Math.PI * x / 0.5)) * Math.sin(Math.PI * x / 0.5), g, 0.5); },
  tick(T, t, g) { add(T, t, 0.03, (x) => Math.sin(2 * Math.PI * 2400 * x) * Math.exp(-x / 0.006), g, 0.2); },
};

// Fmaj7 - Am7 - Dm7 - Bbmaj7
const CH = [[53, [0, 4, 7, 11]], [57, [0, 3, 7, 10]], [50, [0, 3, 7, 10]], [46, [0, 4, 7, 11]]];
const PLUCK = [0, 2, 1, 3, 2, 1, 3, 2];

function arrange(T, bpm, sec) {
  const beat = 60 / bpm, bar = beat * 4;
  for (let b = 0; b * bar < T.dur; b++) {
    const t0 = b * bar, [root, ch] = CH[b % 4];
    const s = sec(t0);
    if (s.pad) V.pad(T, t0, ch.map((n) => root + 12 + n), bar + 0.3, s.pad);
    for (let k = 0; k < 16; k++) {
      const t = t0 + k * beat / 4, q = sec(t);
      if (t >= T.dur) break;
      if (q.pluck && k % 2 === 0) V.pluck(T, t, root + 24 + ch[PLUCK[(k / 2) % 8]], q.pluck, k % 4 ? 0.25 : -0.25);
      if (q.sub && k % 2 === 0) V.sub(T, t, root - 12 + (k % 8 === 6 ? 7 : 0), beat / 2 - 0.02, q.sub);
      if (q.kick && k % 4 === 0) V.kick(T, t, q.kick);
      if (q.clap && (k === 4 || k === 12)) V.clap(T, t, q.clap);
      if (q.shaker && k % 2 === 1) V.shaker(T, t, q.shaker * (k % 4 === 3 ? 1 : 0.6));
    }
  }
}

function reverb(T) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  const aps = [225, 556].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  for (const ch of ['L', 'R']) {
    const x = T.wet[ch], off = ch === 'R' ? 23 : 0;
    combs.forEach((c) => { c.buf = new Float32Array(c.d + off); c.i = 0; });
    aps.forEach((c) => { c.buf = new Float32Array(c.d); c.i = 0; });
    for (let n = 0; n < T.n; n++) {
      let y = 0;
      for (const c of combs) { const o = c.buf[c.i]; c.buf[c.i] = x[n] + o * 0.82; c.i = (c.i + 1) % c.buf.length; y += o; }
      y /= 4;
      for (const a of aps) { const o = a.buf[a.i]; const v = -y * 0.5 + o; a.buf[a.i] = y + o * 0.5; a.i = (a.i + 1) % a.buf.length; y = v; }
      T.dry[ch][n] += y * 0.55;
    }
  }
}

function save(T, name, fade = 1.5) {
  reverb(T);
  let peak = 0;
  const out = bus(T.n);
  for (let i = 0; i < T.n; i++) {
    const f = Math.min(1, (T.n - i) / (fade * SR), i / (0.01 * SR));
    out.L[i] = Math.tanh(T.dry.L[i] * 1.1) * f; out.R[i] = Math.tanh(T.dry.R[i] * 1.1) * f;
    peak = Math.max(peak, Math.abs(out.L[i]), Math.abs(out.R[i]));
  }
  const k = 0.9 / peak, buf = Buffer.alloc(44 + T.n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + T.n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(T.n * 4, 40);
  for (let i = 0; i < T.n; i++) { buf.writeInt16LE(Math.round(out.L[i] * k * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(out.R[i] * k * 32767), 46 + i * 4); }
  const file = path.join(here, '..', 'audio', `${name}.wav`);
  writeFileSync(file, buf);
  console.log('wrote', file);
}

// Sub bass and pads duck under the kick (sidechain feel): applied to the dry bus after arranging the beat.
function pump(T, from = 0) {
  for (let i = Math.floor(from * SR); i < T.n; i++) { T.dry.L[i] *= T.duck[i] ** 0.6; T.dry.R[i] *= T.duck[i] ** 0.6; }
}

// The cut points come from pro.js (CV.PRO), so the music lands on the same beats as the picture.
const src = readFileSync(path.join(here, 'pro_timeline.js'), 'utf8');
const P = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
// The narrated launch film plans its own cues (film_plan.py).
const filmSrc = readFileSync(path.join(here, 'film_timeline.js'), 'utf8');
P.music['pro-film'] = { ...JSON.parse(filmSrc.slice(filmSrc.indexOf('{'), filmSrc.lastIndexOf('}') + 1)).music, quiet: true };

for (const [name, cfg] of Object.entries(P.music)) {
  const T = track(cfg.dur);
  const drop = cfg.drop, brk = cfg.break || [cfg.dur, cfg.dur], end = cfg.end;
  // The bed (pads, plucks, sub) goes first and is pumped by the kick; drums are added after so they stay punchy.
  arrange(T, cfg.bpm, (t) => {
    if (t < drop) return { pad: 0.10, pluck: cfg.quiet ? 0.05 : 0.07 };
    if (t >= brk[0] && t < brk[1]) return { pad: 0.12, pluck: 0.05 };
    if (t >= end) return { pad: 0.11, pluck: 0.07, sub: 0.22 };
    return { pad: 0.09, pluck: cfg.quiet ? 0.05 : 0.08, sub: cfg.quiet ? 0.16 : 0.24 };
  });
  const drums = track(cfg.dur);
  arrange(drums, cfg.bpm, (t) => {
    if (t < drop || (t >= brk[0] && t < brk[1])) return { shaker: t < drop ? 0 : 0.05 };
    if (t >= end) return { kick: cfg.quiet ? 0.45 : 0.7, clap: 0.18, shaker: 0.06 };
    return { kick: cfg.quiet ? 0.42 : 0.75, clap: cfg.quiet ? 0.1 : 0.2, shaker: cfg.quiet ? 0.04 : 0.07 };
  });
  T.duck = drums.duck;
  pump(T);
  for (const ch of ['L', 'R']) for (let i = 0; i < T.n; i++) { T.dry[ch][i] += drums.dry[ch][i]; T.wet[ch][i] += drums.wet[ch][i]; }
  for (const r of cfg.risers || []) V.riser(T, r[0], r[1] - r[0], 0.35);
  for (const t of cfg.impacts || []) V.impact(T, t, 0.55);
  for (const t of cfg.whooshes || []) V.whoosh(T, t, 0.18);
  for (const t of cfg.ticks || []) V.tick(T, t, 0.12);
  save(T, name);
}
