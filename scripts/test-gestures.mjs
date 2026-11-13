// Checks the hand gesture rules with made-up hand landmarks (no camera needed): npm run test:gestures
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'cv-gesture-')), 'gesture.mjs');
await build({ entryPoints: ['src/renderer/gesture.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { GestureInterpreter, poseOf } = await import(pathToFileURL(out).href);
const P = (x, y) => ({ x, y, z: 0 });
function hand(cx, cy, pose) {
  const h = Array.from({ length: 21 }, () => P(cx, cy));
  h[0] = P(cx, cy + 0.15);
  [[5, -.06], [9, -.02], [13, .02], [17, .06]].forEach(([i, dx]) => (h[i] = P(cx + dx, cy)));
  const fing = [[6, 8, 5], [10, 12, 9], [14, 16, 13], [18, 20, 17]];
  fing.forEach(([pip, tip, base]) => {
    const bx = h[base].x;
    h[pip] = P(bx, cy - 0.05);
    h[tip] = pose === 'fist' ? P(bx, cy + 0.06) : P(bx, cy - 0.12);
  });
  // Pointing: only the index finger stays out.
  if (pose === 'point') fing.slice(1).forEach(([, tip, base]) => (h[tip] = P(h[base].x, cy + 0.06)));
  h[4] = pose === 'pinch' ? P(cx - 0.055, cy - 0.12) : P(cx + 0.12, cy + 0.03);
  if (pose === 'pinch') h[8] = P(cx - 0.055, cy - 0.12);
  return h;
}
let ok = true;
const check = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) ok = false; };
check('open pose', poseOf(hand(.5, .5, 'open')) === 'open');
check('fist pose', poseOf(hand(.5, .5, 'fist')) === 'fist');
check('pinch pose', poseOf(hand(.5, .5, 'pinch')) === 'pinch');

// Rotate: a hand moving right (raw x decreasing, since the camera is not mirrored) gives negative yaw
let g = new GestureInterpreter(), t = 0, yaw = 0, tilt = 0, mode = '';
for (let i = 0; i < 20; i++) { const f = g.update([hand(.6 - i * .01, .5, 'open')], (t += 33)); yaw += f.yaw; mode = f.mode; }
check('rotate mode', mode === 'rotate'); check('moving right turns yaw negative', yaw < -0.3);
g = new GestureInterpreter(); t = 0; tilt = 0;
for (let i = 0; i < 20; i++) { const f = g.update([hand(.5, .6 - i * .01, 'open')], (t += 33)); tilt += f.tilt; }
check('moving up tilts positive', tilt > 0.1);
// Still hand: no motion
g = new GestureInterpreter(); t = 0; let mv = 0;
for (let i = 0; i < 30; i++) { const f = g.update([hand(.5, .5, 'open')], (t += 33)); mv += Math.abs(f.yaw) + Math.abs(f.tilt); }
check('still hand does not move the town', mv < 0.01);
// Zoom: hands apart => zoom factor < 1; together => > 1
g = new GestureInterpreter(); t = 0; let z = 1;
for (let i = 0; i < 20; i++) { const f = g.update([hand(.35 - i * .006, .5, 'open'), hand(.65 + i * .006, .5, 'open')], (t += 33)); z *= f.zoom; }
check('hands apart zoom in (<1)', z < 0.8);
g = new GestureInterpreter(); t = 0; z = 1;
for (let i = 0; i < 20; i++) { const f = g.update([hand(.2 + i * .01, .5, 'open'), hand(.8 - i * .01, .5, 'open')], (t += 33)); z *= f.zoom; }
check('hands together zoom out (>1)', z > 1.25);
// Fist holds
g = new GestureInterpreter(); t = 0; mode = '';
for (let i = 0; i < 10; i++) { const f = g.update([hand(.5 - i * .02, .5, 'fist')], (t += 33)); mode = f.mode; }
check('fist holds', mode === 'hold');
// Double pinch resets once
g = new GestureInterpreter(); t = 0; let resets = 0;
const seq = ['open','open','open','pinch','pinch','pinch','pinch','open','open','open','open','pinch','pinch','pinch','pinch','open','open','open'];
for (const p of seq) { const f = g.update([hand(.5, .5, p)], (t += 40)); if (f.reset) resets++; }
check('double pinch resets once', resets === 1);
// Single pinch does not
g = new GestureInterpreter(); t = 0; resets = 0;
for (const p of ['open','open','open','pinch','pinch','pinch','pinch','open','open','open','open']) { const f = g.update([hand(.5, .5, p)], (t += 40)); if (f.reset) resets++; }
check('single pinch does not reset', resets === 0);
// Hand lost then returns without a jump
g = new GestureInterpreter(); t = 0;
for (let i = 0; i < 5; i++) g.update([hand(.3, .5, 'open')], (t += 33));
for (let i = 0; i < 10; i++) g.update([], (t += 33));
const back = g.update([hand(.8, .5, 'open')], (t += 33));
check('no jump when the hand returns', back.yaw === 0 && back.tilt === 0);
// Pointing: one finger out aims a cursor at the fingertip and does not move the town
check('point pose', poseOf(hand(.5, .5, 'point')) === 'point');
g = new GestureInterpreter(); t = 0; mv = 0; let f;
for (let i = 0; i < 12; i++) { f = g.update([hand(.5 - i * .01, .5, 'point')], (t += 33)); mv += Math.abs(f.yaw) + Math.abs(f.tilt) + Math.abs(f.zoom - 1); }
check('pointing aims and does not move the town', f.mode === 'point' && mv === 0 && !!f.cursor);
// index tip of the last hand: x = cx - 0.06, y = cy - 0.12, reported in camera space like the landmarks
check('the cursor follows the fingertip', Math.abs(f.cursor.x - (.39 - .06)) < 0.02 && Math.abs(f.cursor.y - .38) < 0.02);
// Point, then pinch: one click where the finger was aiming, and no reset
g = new GestureInterpreter(); t = 0; let clicks = 0; resets = 0; let at = null;
for (const p of ['point','point','point','point','point','point','point','point','pinch','pinch','pinch','pinch','pinch','point','point','point']) {
  f = g.update([hand(.5, .5, p)], (t += 33)); if (f.click) { clicks++; at = f.cursor; } if (f.reset) resets++;
}
check('point then pinch clicks once', clicks === 1 && resets === 0);
check('the click lands where the finger aimed', !!at && Math.abs(at.x - .44) < 0.02 && Math.abs(at.y - .38) < 0.02);
// A slow camera (8 frames a second): the click still lands on the aim, not where the finger went while pinching
g = new GestureInterpreter(); t = 0; at = null;
for (let i = 0; i < 10; i++) g.update([hand(.5, .5, 'point')], (t += 125));
for (let i = 0; i < 5; i++) { f = g.update([hand(.5, .58, 'pinch')], (t += 125)); if (f.click) at = f.cursor; }
check('a slow camera still clicks on the aim', !!at && Math.abs(at.y - .38) < 0.02);
// Two clicks in a row open two things; they are not a double-pinch reset
g = new GestureInterpreter(); t = 0; clicks = 0; resets = 0;
for (const p of ['point','point','point','point','pinch','pinch','pinch','pinch','point','point','point','point','pinch','pinch','pinch','pinch','point','point','point']) {
  f = g.update([hand(.5, .5, p)], (t += 40)); if (f.click) clicks++; if (f.reset) resets++;
}
check('two aimed pinches are two clicks, not a reset', clicks === 2 && resets === 0);
// A pinch with no pointing first never clicks
g = new GestureInterpreter(); t = 0; clicks = 0;
for (const p of ['open','open','open','pinch','pinch','pinch','pinch','open','open']) { f = g.update([hand(.5, .5, p)], (t += 40)); if (f.click) clicks++; }
check('a pinch without pointing does not click', clicks === 0);
// A closed fist is a fist even when the thumb rests on the index finger
const tight = hand(.5, .5, 'fist'); tight[4] = P(tight[8].x + 0.01, tight[8].y);
check('a fist with the thumb on the index finger is still a fist', poseOf(tight) === 'fist');
process.exit(ok ? 0 : 1);
