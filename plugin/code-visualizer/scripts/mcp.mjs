// The Codeville tool server for Claude Code (MCP over standard input and output, no packages needed).
// It lets Claude Code ask the Codeville app on this computer about the project: its map, its problems, its git state,
// and lets it save the project map it wrote after reading the code. Every call is passed to the app's own
// /api/tools; nothing leaves this computer. When the app is not running the tools say so and Claude Code carries on.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const OFF = 'Codeville is not running on this computer. Open the Codeville app, then try again.';

function config() {
  try {
    const dir = process.env.CV_HOME || join(homedir(), '.code-visualizer');
    const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    return typeof cfg.port === 'number' && typeof cfg.token === 'string' ? cfg : null;
  } catch {
    return null;
  }
}

async function app(path, body) {
  const cfg = config();
  if (!cfg) throw new Error(OFF);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 600_000);
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-cv-token': cfg.token },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Codeville answered with ${res.status}`);
    return data;
  } catch (e) {
    if (e instanceof TypeError || e?.name === 'AbortError') throw new Error(OFF);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // a notification: nothing to answer
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codeville', version: '0.1.0' },
        instructions: 'Tools from the Codeville app: what the open project looks like, what is broken, git state, and saving a project map after you have read the code.',
      } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') {
      let tools = [];
      try {
        tools = (await app('/api/tools')).tools ?? [];
      } catch {
        // The app is closed: offer no tools rather than fail Claude Code's start.
      }
      return send({ jsonrpc: '2.0', id, result: { tools } });
    }
    if (method === 'tools/call') {
      try {
        const out = await app(`/api/tools/${encodeURIComponent(params?.name ?? '')}`, params?.arguments ?? {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] } });
      }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
  }
}

const pending = new Set();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That was not JSON.' } });
  }
  const p = handle(msg).finally(() => pending.delete(p));
  pending.add(p);
}).on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
