// Builds build/python: a private copy of Python that ships inside the installer, so people need no Python of their own.
// Source: the official "embeddable" zip from python.org. The backend's pure-Python dependencies go into its site-packages.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '3.12.0';
const out = join(app, 'build', 'python');
const zip = join(app, 'build', `python-${VERSION}-embed-amd64.zip`);
const venvPython = join(app, 'backend', '.venv', 'Scripts', 'python.exe');

if (existsSync(join(out, 'python.exe')) && existsSync(join(out, 'Lib', 'site-packages', 'django'))) {
  console.log('build/python is ready');
  process.exit(0);
}
if (!existsSync(venvPython)) throw new Error('Create backend/.venv first: it is used to install the backend packages.');

mkdirSync(out, { recursive: true });
if (!existsSync(join(out, 'python.exe'))) {
  const url = `https://www.python.org/ftp/python/${VERSION}/python-${VERSION}-embed-amd64.zip`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download Python: ${res.status}`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync(join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', out], { stdio: 'inherit' });
}

// The embeddable build ignores site-packages until its ._pth file lists it.
const pth = readdirSync(out).find((f) => f.endsWith('._pth'));
if (!pth) throw new Error('The Python download has no ._pth file');
const stdlib = readdirSync(out).find((f) => /^python\d+\.zip$/.test(f));
writeFileSync(join(out, pth), `${stdlib}\n.\nLib\\site-packages\nimport site\n`);

const reqs = readFileSync(join(app, 'backend', 'requirements-runtime.txt'), 'utf8');
console.log('Installing backend packages');
execFileSync(venvPython, ['-m', 'pip', 'install', '--no-compile', '--target', join(out, 'Lib', 'site-packages'), '-r', join(app, 'backend', 'requirements-runtime.txt')], { stdio: 'inherit' });
console.log(`Ready: ${out} (${reqs.trim().split(/\r?\n/).length} packages requested)`);
