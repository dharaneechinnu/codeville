import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// The packaged UI is served from app:// instead of file://, so the hand tracking runtime and model can be fetched.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const MIME: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.task': 'application/octet-stream' };

let win: BrowserWindow | null = null;
let backend: ChildProcess | null = null;

interface Config {
  port: number;
  token: string;
}

function configFile(): string {
  return join(process.env.CV_HOME ?? join(homedir(), '.code-visualizer'), 'config.json');
}

function readConfig(): Config | null {
  try {
    const c = JSON.parse(readFileSync(configFile(), 'utf8')) as Config;
    return typeof c.port === 'number' && typeof c.token === 'string' ? c : null;
  } catch {
    return null;
  }
}

/** The Django backend: a folder next to the app when installed, the project's own folder in development. */
function backendLaunch(): { python: string; script: string; cwd: string } {
  const packaged = app.isPackaged;
  const root = packaged ? join(process.resourcesPath, 'backend') : resolve(__dirname, '../../backend');
  const venv = join(root, '.venv', 'Scripts', 'python.exe');
  const bundled = join(root, 'python', 'python.exe');
  const python = process.env.CV_PYTHON ?? (existsSync(bundled) ? bundled : existsSync(venv) ? venv : 'python');
  return { python, script: join(root, 'serve.py'), cwd: root };
}

/** The Claude Code plugin folder: next to the app when installed, the project's own folder in development. */
function pluginDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'plugin') : resolve(__dirname, '../../plugin');
}

async function healthy(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Starts the backend, and waits until it answers. Returns the port it ended up on. */
async function startBackend(): Promise<Config> {
  const { python, script, cwd } = backendLaunch();
  const existing = readConfig();
  // A backend from an earlier run may still be there. Use it instead of starting a second one.
  if (existing && (await healthy(existing.port))) return existing;

  let output = '';
  backend = spawn(python, [script], { cwd, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  backend.stdout?.on('data', (d: Buffer) => (output += d.toString()));
  backend.stderr?.on('data', (d: Buffer) => (output += d.toString()));
  const failed = new Promise<never>((_, reject) => {
    backend?.on('error', (e) => reject(new Error(`Could not start Python (${python}): ${e.message}`)));
    backend?.on('exit', (code) => reject(new Error(`The backend stopped with code ${code}.\n${output.slice(-600)}`)));
  });
  const ready = (async (): Promise<Config> => {
    for (let i = 0; i < 80; i++) {
      const cfg = readConfig();
      if (cfg && (await healthy(cfg.port))) return cfg;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`The backend did not answer in 20 seconds.\n${output.slice(-600)}`);
  })();
  return Promise.race([ready, failed]);
}

/** Serves the built UI folder. Anything outside it is refused. */
function serveUi(): void {
  const ui = resolve(__dirname, '../renderer');
  protocol.handle('app', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const full = resolve(ui, '.' + rel);
    if (full !== ui && !full.startsWith(ui + sep)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(full).toString());
    const type = MIME[extname(full)];
    return type ? new Response(res.body, { status: res.status, headers: { 'content-type': type } }) : res;
  });
}

/** The only permission the window may ask for is the camera (video, never the microphone), for hand gestures. */
function limitPermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    callback(wc === win?.webContents && permission === 'media' && types.length > 0 && types.every((t) => t === 'video'));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => {
    // Chromium also asks this while a stream is open, sometimes with no window and no kind of media, so only the
    // microphone and other pages are refused here.
    const type = (details as { mediaType?: string }).mediaType;
    return permission === 'media' && type !== 'audio' && /^(app:\/\/codeville|http:\/\/(localhost|127\.0\.0\.1):5180)/.test(origin);
  });
}

async function start(): Promise<void> {
  const cfg = await startBackend();
  limitPermissions();
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0c16',
    title: 'Codeville',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--cv-base=http://127.0.0.1:${cfg.port}`, `--cv-token=${cfg.token}`, `--cv-plugin=${pluginDir()}`],
    },
  });
  // The window may only show the app itself. Links go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.CV_DEV) await win.loadURL(process.env.CV_DEV_URL ?? 'http://localhost:5180');
  else {
    serveUi();
    await win.loadURL('app://codeville/index.html');
  }
  win.on('closed', () => {
    win = null;
  });
}

ipcMain.handle('pick-folder', async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open a project folder' });
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

/** Opens a file of the project in the default editor. Refuses paths outside the project folder. */
ipcMain.handle('open-file', async (_e, root: unknown, rel: unknown) => {
  if (typeof root !== 'string' || typeof rel !== 'string') return false;
  const base = resolve(root);
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep)) return false;
  return (await shell.openPath(full)) === '';
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      dialog.showErrorBox('Codeville could not start', err instanceof Error ? err.message : String(err));
      backend?.kill();
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => backend?.kill());
}
