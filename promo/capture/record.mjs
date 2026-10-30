// Records the real Codeville UI for the demo: it drives the app in Chromium (typing, clicks, the agent, tests, git,
// hand control) and saves every painted frame with its time, plus marks where each scene starts.
//   node record.mjs <out dir> <project path>
// Needs: the backend running with bin/ (the scripted `claude`) on its PATH, the UI on http://localhost:5180,
// and <out dir>/camera.y4m (the picture the fake camera shows in hand control).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const [out, project] = process.argv.slice(2);
const cvHome = process.env.CV_HOME;
const cfg = JSON.parse(readFileSync(path.join(cvHome, 'config.json'), 'utf8'));
mkdirSync(path.join(out, 'frames'), { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(out, 'camera.y4m')}`],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['camera'] });
await ctx.addInitScript({ path: path.join(here, 'cursor.js') });
await ctx.addInitScript({ path: path.join(here, 'hands.js') });
// MediaPipe is replaced by a stub that returns the scripted hands; everything after it is the app's own code.
await ctx.route(/@mediapipe_tasks-vision\.js/, (r) => r.fulfill({
  contentType: 'application/javascript',
  body: `export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = { createFromOptions: async () => ({ detectForVideo: () => ({ landmarks: window.__cvHands() }), close() {} }) };`,
}));
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('page error:', e.message));

const frames = [], marks = [];
const cdp = await ctx.newCDPSession(p);
let n = 0;
cdp.on('Page.screencastFrame', async (f) => {
  const file = `frames/${String(n++).padStart(6, '0')}.jpg`;
  writeFileSync(path.join(out, file), Buffer.from(f.data, 'base64'));
  frames.push({ file, t: f.metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
const mark = (name) => { marks.push({ name, t: Date.now() / 1000 }); console.log('mark', name); };
const wait = (s) => p.waitForTimeout(s * 1000);
let cur = { x: 1500, y: 900 };
async function moveTo(target, dur = 0.8) {
  const box = typeof target === 'string' || target.boundingBox ? await (typeof target === 'string' ? p.locator(target).first() : target).boundingBox() : null;
  const to = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : target;
  const steps = Math.max(8, Math.round(dur * 40));
  for (let i = 1; i <= steps; i++) {
    const e = i / steps, k = e < 0.5 ? 4 * e ** 3 : 1 - (-2 * e + 2) ** 3 / 2;
    await p.mouse.move(cur.x + (to.x - cur.x) * k, cur.y + (to.y - cur.y) * k);
    await p.waitForTimeout((dur * 1000) / steps);
  }
  cur = to;
}
async function click(target, dur) { await moveTo(target, dur); await p.mouse.down(); await wait(0.08); await p.mouse.up(); }
const byTitle = (t) => p.locator(`button[title^="${t}"]`).first();
const gesture = (mode) => p.evaluate((m) => { window.__cvGesture = m ? { mode: m, t0: performance.now() } : null; }, mode);

await p.goto(`http://localhost:5180/#base=http://127.0.0.1:${cfg.port}&token=${cfg.token}`);
await wait(1.5);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
await p.mouse.move(cur.x, cur.y);

mark('welcome');
await wait(2.5);
await click('input[placeholder*="path"]', 1.0);
await p.keyboard.type(project, { delay: 28 });
await wait(0.4);
await click(p.getByRole('button', { name: 'Open', exact: true }), 0.6);
await wait(3.5);

mark('analysis');
await click(p.getByText('How this was analyzed'), 0.9);
await wait(1.5);
await moveTo({ x: 520, y: 960 }, 0.5);
for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 60); await wait(0.18); }
await wait(2.5);

mark('town');
await click('button.abh', 0.8);
await wait(1.0);
for (let i = 0; i < 3; i++) { await click(byTitle('Rotate right'), i ? 0.3 : 0.8); await wait(0.7); }
await click(byTitle('Zoom in'), 0.4); await wait(0.8);
await click(p.getByRole('button', { name: 'frontend/src/features/cart/Cart.tsx', exact: true }), 1.0); await wait(2.2);
const openBtn = p.getByRole('button', { name: 'frontend/src/features/cart/Cart.tsx', exact: true }).locator('xpath=following-sibling::button[1]');
await click(openBtn, 0.5); await wait(3.2);
await click(p.locator('.editor button[title="Close"]').first(), 0.7); await wait(0.6);
await click(byTitle('Links:'), 1.0); await wait(1.8);
await click(byTitle('Links:'), 0.3); await wait(1.8);
await click(byTitle('Links:'), 0.3); await wait(1.0);

mark('chat');
await click(byTitle('Reset the view'), 0.8);
await wait(1.2);
await click('textarea[placeholder*="Describe"]', 1.0);
await p.keyboard.type('add a wishlist feature with tests', { delay: 45 });
await wait(0.4);
await p.keyboard.press('Enter');
await wait(0.7);
await click(p.getByText(/don.t ask again/i), 0.6);
await p.getByText('Both tests pass').first().waitFor({ timeout: 40000 });
await wait(2.5);

mark('test');
await click(p.locator('button', { hasText: /^Test$/ }).first(), 0.9);
await wait(1.0);
await click(p.locator('button', { hasText: /^backend$/ }).first(), 0.7);
await wait(9);

mark('fix');
await click('textarea[placeholder*="Describe"]', 1.0);
await p.keyboard.type('fix the cart total', { delay: 45 });
await p.keyboard.press('Enter');
await p.getByText('All 8 backend tests pass').first().waitFor({ timeout: 40000 });
await wait(3.5);

await click(p.locator('.term button[title="Close"]').first(), 0.8).catch(() => {});
await wait(0.5);

mark('git');
await click('textarea[placeholder*="what changed"]', 1.0);
await p.keyboard.type('Add wishlist, fix cart total', { delay: 40 });
await wait(0.4);
await click(byTitle('Stage all'), 0.7);
await wait(1.2);
await click(byTitle('Commit and push'), 0.7);
await wait(4.5);

mark('holo');
await click(p.locator('button', { hasText: /^Build$/ }).first(), 0.9);
await wait(0.6);
await click(p.locator('button[aria-label="Hand control"]').first(), 1.0);
await moveTo({ x: 1900, y: 600 }, 0.6);
await wait(3.0);
await gesture('rotate'); await wait(6.0);
await gesture(null); await wait(0.6);
await gesture('zoom'); await wait(3.2);
await gesture('hold'); await wait(2.0);
await gesture('reset'); await wait(2.2);
await gesture('rotate'); await wait(2.5);
mark('end');
await wait(0.5);

await cdp.send('Page.stopScreencast');
writeFileSync(path.join(out, 'frames.json'), JSON.stringify({ frames, marks }, null, 1));
await browser.close();
console.log(`${frames.length} frames`);
