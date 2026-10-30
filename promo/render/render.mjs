// Renders a promo scene to MP4 (or one still frame to PNG) with headless Chromium and ffmpeg.
//   node render.mjs launch                -> ../launch.mp4 (needs ../audio/launch.wav from music.mjs)
//   node render.mjs demo --still 31.5     -> still-demo-31.5.jpg in the current folder
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const name = args[0] || 'launch';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const fps = +opt('--fps', 30), workers = +opt('--workers', 4);
const out = opt('--out', path.join(here, '..', `${name}.mp4`));
const url = pathToFileURL(path.join(here, 'frame.html')).href + `?scene=${name}&render=1`;

const browser = await chromium.launch();
async function page() {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', (e) => { console.error('page error:', e.message); process.exit(1); });
  await p.goto(url);
  await p.evaluate(() => window.ready);
  return p;
}
const frame = async (p, t) => Buffer.from((await p.evaluate((t) => CV.frame(t), t)).split(',')[1], 'base64');

if (opt('--still')) {
  const p = await page();
  for (const s of opt('--still').split(',')) {
    const file = opt('--dir', '.') + `/still-${name}-${s}.jpg`;
    writeFileSync(file, await frame(p, +s));
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

const duration = await (await page()).evaluate((n) => CV.scenes[n].duration, name);
const total = Math.round(duration * fps);
const audio = path.join(here, '..', 'audio', `${name}.wav`);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  ...(existsSync(audio) ? ['-i', audio, '-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('--crf', '24'), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });

const done = new Map();
let next = 0;
const flush = async () => {
  while (done.has(next)) {
    const buf = done.get(next); done.delete(next); next++;
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (next % (fps * 5) === 0) console.log(`${name}: ${next / fps}s / ${duration}s`);
  }
};
await Promise.all(Array.from({ length: workers }, async (_, k) => {
  const p = await page();
  for (let i = k; i < total; i += workers) {
    while (i - next > workers * 8) await new Promise((r) => setTimeout(r, 5));
    done.set(i, await frame(p, i / fps));
    await flush();
  }
}));
await flush();
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log('wrote', out);
