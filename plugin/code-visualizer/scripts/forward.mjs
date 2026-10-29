// Forwards one Claude Code hook call to the Codeville app on this computer.
// It must never slow down or break Claude Code: it prints nothing, gives up fast, and always exits 0.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX = 900 * 1024;

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function trimResponse(payload) {
  const r = payload.tool_response;
  if (r === undefined) return;
  // Only shell output is read by the app (test, lint and build results). Everything else is dropped.
  if (payload.tool_name !== 'Bash') {
    delete payload.tool_response;
    return;
  }
  const cut = (s) => (typeof s === 'string' && s.length > 200 * 1024 ? s.slice(-200 * 1024) : s);
  if (typeof r === 'string') payload.tool_response = cut(r);
  else if (r && typeof r === 'object') {
    for (const k of ['stdout', 'stderr', 'output']) if (k in r) r[k] = cut(r[k]);
  }
}

async function main() {
  const raw = readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  let cfg;
  try {
    const dir = process.env.CV_HOME || join(homedir(), '.code-visualizer');
    cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  } catch {
    return; // The app has never run on this computer, so there is nobody to tell.
  }
  trimResponse(payload);
  const body = JSON.stringify(payload);
  if (body.length > MAX) return;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    await fetch(`http://127.0.0.1:${cfg.port}/hook/claude-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cv-token': cfg.token },
      body,
      signal: ctl.signal,
    });
  } catch {
    // The app is not running. That is fine.
  } finally {
    clearTimeout(timer);
  }
}

main().finally(() => process.exit(0));
