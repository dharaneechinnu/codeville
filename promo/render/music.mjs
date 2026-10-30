// Original 8-bit soundtrack and sound effects for the promo videos, synthesized from scratch (no samples).
//   node music.mjs   -> ../audio/launch.wav and ../audio/demo.wav
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const here = path.dirname(fileURLToPath(import.meta.url));
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function track(dur) {
  const L = new Float32Array(Math.ceil(dur * SR)), R = new Float32Array(L.length);
  // add(t, len, fn(localTime, i) -> sample, gain, pan, delay)
  const add = (t, len, fn, g = 1, pan = 0, delay = 0) => {
    const s0 = Math.floor(t * SR), n = Math.floor(len * SR);
    for (let i = 0; i < n; i++) {
      const v = fn(i / SR, i) * g, a = s0 + i;
      if (a >= 0 && a < L.length) L[a] += v * (1 - pan);
      const b = a + Math.floor(delay * SR);
      if (b >= 0 && b < R.length) R[b] += v * (1 + pan);
    }
  };
  return { L, R, add, dur };
}

const sq = (f, duty = 0.5) => (t) => ((t * f) % 1 < duty ? 1 : -1);
const tri = (f) => (t) => 4 * Math.abs(((t * f) % 1) - 0.5) - 1;
const env = (a, d) => (t) => (t < a ? t / a : Math.exp(-(t - a) / d));

const inst = {
  arp: (T, t, m, g) => T.add(t, 0.22, (x) => sq(hz(m), 0.25)(x) * env(0.003, 0.07)(x), g, -0.25, 0.011),
  bass: (T, t, m, g, len = 0.25) => T.add(t, len, (x) => tri(hz(m))(x) * env(0.004, len * 0.6)(x), g),
  lead: (T, t, m, g, len = 0.3) => T.add(t, len, (x) => sq(hz(m) * (1 + 0.004 * Math.sin(x * 30)), 0.5)(x) * env(0.01, len * 0.7)(x), g, 0.2, 0.006),
  pad: (T, t, ms, g, len) => T.add(t, len, (x) => ms.reduce((s, m) => s + tri(hz(m))(x) + tri(hz(m) * 1.004)(x), 0) / (ms.length * 2) * Math.min(1, x / 0.3, (len - x) / 0.3), g),
  kick: (T, t, g) => T.add(t, 0.2, (x) => Math.sin(2 * Math.PI * (45 * x + 95 * (1 - Math.exp(-x / 0.03)) * 0.03)) * Math.exp(-x / 0.08), g),
  snare: (T, t, g) => T.add(t, 0.18, (x) => ((rnd() * 2 - 1) * 0.8 + Math.sin(2 * Math.PI * 190 * x) * 0.4) * Math.exp(-x / 0.05), g),
  hat: (T, t, g) => { let p = 0; T.add(t, 0.05, (x) => { const n = rnd() * 2 - 1, v = n - p; p = n; return v * Math.exp(-x / 0.012); }, g, 0.3); },
  // sound effects
  whoosh: (T, t, g = 0.35) => { let lp = 0; T.add(t, 0.5, (x) => { const k = 0.05 + 0.6 * (x / 0.5); lp += (rnd() * 2 - 1 - lp) * k; return lp * Math.sin(Math.PI * x / 0.5); }, g); },
  pop: (T, t, g = 0.18, f = 660) => T.add(t, 0.09, (x) => sq(f * (1 + x * 6), 0.5)(x) * Math.exp(-x / 0.03), g),
  click: (T, t, g = 0.25) => T.add(t, 0.04, (x) => sq(1800, 0.5)(x) * Math.exp(-x / 0.008), g),
  ding: (T, t, g = 0.16) => { inst.lead(T, t, 84, g, 0.12); inst.lead(T, t + 0.08, 91, g, 0.25); },
  fail: (T, t, g = 0.2) => T.add(t, 0.6, (x) => sq(hz(64) * (1 - x * 0.6), 0.5)(x) * Math.exp(-x / 0.3), g),
  hit: (T, t, g = 0.5) => { inst.kick(T, t, g); let p = 0; T.add(t, 1.0, (x) => { const n = rnd() * 2 - 1, v = n - p; p = n; return v * Math.exp(-x / 0.35); }, g * 0.3); },
};

// I - V - vi - IV in C
const PROG = [[48, [0, 4, 7]], [43, [0, 4, 7]], [45, [0, 3, 7]], [41, [0, 4, 7]]];
const ARP = [0, 1, 2, 3, 2, 1, 0, 2];
const MELODY = [12, null, 16, 19, null, 16, 14, null, 12, 14, 16, null, 19, 21, 19, null];

function music(T, bpm, parts) {
  const beat = 60 / bpm, bar = beat * 4;
  for (let b = 0; b * bar < T.dur; b++) {
    const [root, tri3] = PROG[b % 4], t0 = b * bar;
    const p = parts(t0);
    if (p.pad) inst.pad(T, t0, tri3.map((n) => root + 24 + n), p.pad, bar);
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * beat / 4, q = parts(t);
      if (t >= T.dur) break;
      if (q.arp) { const n = [...tri3, 12][ARP[s % 8]]; inst.arp(T, t, root + 24 + n, q.arp); }
      if (q.bass && s % 2 === 0) inst.bass(T, t, root + (s % 4 === 2 ? 12 : 0), q.bass);
      if (q.kick && s % 4 === 0) inst.kick(T, t, q.kick);
      if (q.snare && (s === 4 || s === 12)) inst.snare(T, t, q.snare);
      if (q.hat && s % 2 === 1) inst.hat(T, t, q.hat);
      if (q.lead && s % 2 === 0) { const m = MELODY[(s / 2 + (b % 2) * 8) % 16]; if (m != null) inst.lead(T, t, 60 + m, q.lead, beat * 0.9); }
    }
  }
}

function save(T, name, fadeOut = 1.2) {
  const n = T.L.length;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, (n - i) / (fadeOut * SR), i / (0.02 * SR));
    T.L[i] = Math.tanh(T.L[i] * 1.2) * f; T.R[i] = Math.tanh(T.R[i] * 1.2) * f;
    peak = Math.max(peak, Math.abs(T.L[i]), Math.abs(T.R[i]));
  }
  const k = 0.9 / peak, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(T.L[i] * k * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(T.R[i] * k * 32767), 46 + i * 4); }
  const out = path.join(here, '..', 'audio', `${name}.wav`);
  writeFileSync(out, buf);
  console.log('wrote', out);
}

// ---------- launch: 30 s at 128 bpm, synced to launch.js ----------
{
  const T = track(30);
  music(T, 128, (t) => {
    if (t < 2.7) return { arp: 0.07, hat: 0.04, kick: 0.35 };
    if (t < 6) return { arp: 0.09, bass: 0.22, hat: 0.06, kick: t > 4.5 ? 0.45 : 0 };
    if (t < 22) return { arp: 0.09, bass: 0.25, hat: 0.07, kick: 0.55, snare: 0.22, lead: t > 8.9 ? 0.07 : 0 };
    if (t < 26) return { pad: 0.12, arp: 0.06, hat: 0.05 };
    return { arp: 0.09, bass: 0.25, hat: 0.07, kick: 0.55, snare: 0.22, lead: 0.08 };
  });
  for (const w of [5.55, 11.55, 16.55, 25.55]) inst.whoosh(T, w);
  for (let i = 0; i < 18; i++) inst.pop(T, 6.3 + i * 0.18 + rnd() * 0.05, 0.12, 520 + rnd() * 400);
  for (const [s, n] of [[13.9, 7], [14.6, 6], [15.7, 3]]) for (let k = 0; k < n; k++) inst.pop(T, s + k * 0.11 + 0.15, 0.13, 700 + k * 40);
  inst.hit(T, 8.9, 0.5); inst.click(T, 13.45); inst.ding(T, 16.35);
  inst.fail(T, 17.9 + 10 / 5); inst.hit(T, 26.0, 0.6); inst.ding(T, 27.3, 0.14);
  save(T, 'launch');
}

// ---------- demo: 3.5 s title + 90 s at 100 bpm, quieter bed under the walkthrough ----------
{
  const OFF = 3.5, T0 = track(97 + OFF), T = { ...T0, add: (t, ...a) => T0.add(t + OFF, ...a), dur: 97 };
  music({ ...T0, dur: OFF }, 100, () => ({ arp: 0.08, hat: 0.05, kick: 0.4 }));
  inst.pop(T0, 0.15, 0.15, 520); inst.pop(T0, 0.4, 0.15, 780); inst.whoosh(T0, OFF - 0.45, 0.25);
  for (let i = 0; i < 25; i++) inst.click(T0, 0.95 + i / 26, 0.08);
  music(T, 100, (t) => {
    if (t >= 93) return { arp: 0.08, bass: 0.22, hat: 0.06, kick: 0.45, snare: 0.18, lead: 0.07 };
    if (t >= 80) return { pad: 0.11, arp: 0.05, hat: 0.04, kick: t > 81.6 ? 0.25 : 0 };
    return { arp: 0.06, bass: 0.18, hat: 0.045, kick: t > 10 ? 0.3 : 0, snare: t > 25 ? 0.1 : 0 };
  });
  for (const w of [9.7, 24.7, 39.7, 54.7, 69.7, 79.7, 92.55]) inst.whoosh(T, w, 0.22);
  inst.whoosh(T, 80.3, 0.3); inst.ding(T, 81.7, 0.12); for (let i = 0; i < 12; i++) inst.click(T, 80.4 + i * 0.11, 0.05);
  for (const d of [1.3, 2.1, 2.9]) inst.ding(T, d, 0.1);
  for (let i = 0; i < 9; i++) inst.pop(T, 11.2 + i * 1.25, 0.1, 800);
  for (const c of [6.0, 7.4, 31.4, 35.8, 42.9, 56.2, 66.9, 75.9]) inst.click(T, c, 0.2);
  for (let i = 0; i < 20; i++) inst.pop(T, 25.3 + i * 0.11, 0.08, 500 + rnd() * 400);
  for (const [s, n] of [[45.8, 5], [46.9, 4], [49.1, 2]]) for (let k = 0; k < n; k++) inst.pop(T, s + k * 0.13 + 0.15, 0.1, 700 + k * 40);
  inst.ding(T, 51.2, 0.1); inst.fail(T, 56.9 + 12 / 1.95, 0.16); inst.ding(T, 77.5, 0.12); inst.hit(T, 93.0, 0.45);
  save(T0, 'demo', 2);
}

// ---------- real-UI demo: follows the timeline compose.py wrote ----------
{
  const src = readFileSync(path.join(here, 'real_timeline.js'), 'utf8');
  const R = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  const holo = R.scenes.find((s) => s.key === 'holo');
  const T = track(R.total);
  music(T, 100, (t) => {
    if (t < R.intro) return { arp: 0.08, hat: 0.05, kick: 0.4 };
    if (t >= R.uiEnd) return { arp: 0.08, bass: 0.22, hat: 0.06, kick: 0.45, snare: 0.18, lead: 0.07 };
    if (t >= holo.start) return { pad: 0.11, arp: 0.05, hat: 0.04, kick: 0.22 };
    return { arp: 0.055, bass: 0.17, hat: 0.045, kick: t > R.scenes[1].start ? 0.28 : 0, snare: t > R.scenes[2].start ? 0.1 : 0 };
  });
  inst.pop(T, 0.15, 0.15, 520); inst.pop(T, 0.4, 0.15, 780);
  for (let i = 0; i < 25; i++) inst.click(T, 0.95 + i / 26, 0.08);
  for (const s of R.scenes) inst.whoosh(T, s.start - 0.3, 0.16);
  inst.whoosh(T, holo.start + 0.2, 0.25);
  inst.whoosh(T, R.uiEnd - 0.45, 0.22); inst.hit(T, R.uiEnd, 0.45);
  save(T, 'real', 2);
}
