// Puts the hand tracking files where the UI serves them from: the MediaPipe runtime (copied from node_modules)
// and the hand landmark model (downloaded once). Everything is then loaded from the app itself, so no camera frame
// or network request is needed at run time.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'renderer', 'public', 'mediapipe');
mkdirSync(out, { recursive: true });

const wasmDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  copyFileSync(join(wasmDir, f), join(out, f));
}

const model = join(out, 'hand_landmarker.task');
const URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
if (!existsSync(model) || statSync(model).size < 1_000_000) {
  console.log('Downloading the hand landmark model (about 8 MB, Apache 2.0)...');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Could not download the hand model: ${res.status}`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log('Hand tracking files are ready.');
