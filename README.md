# Codeville (Windows app)

[![Codeville launch video](promo/preview.gif)](promo/launch.mp4)

**Built for vibe coders: your prompts, made visual.** Watch the [30-second launch video](promo/launch.mp4) or the [demo](promo/demo.mp4),
or open the [launch page](promo/index.html). [Download for Windows](https://github.com/dharaneechinnu/codeville/releases).

A desktop workspace for vibe coding. It shows what your coding agent builds: a block town (one building per feature, one
block per file), a walking shopper that runs your tests, and short messages that say what broke and what to do next.

## What is in the window

| Widget | What it does |
|---|---|
| Chat | Type a prompt and send it to Claude Code. Shows what the agent did: edits, tools, sub-agents. |
| Visualizer | **Build**: the 3D town; click a block to see the file and open it. **Test**: a shopper walks the test steps and stops at the one that fails. Rotate, zoom and reset in both. |
| Files | The project by feature or by folder, with git badges. |
| Source control | Stage, commit, commit and push, push. Failures say what broke and the next step. |

Also: **Terminal** and **Editor** popups (drag and resize them), **Extensions** (Claude Code connection, git), and
**Adjust layout** to drag widgets, resize them with the bars, or pick a preset. The layout is remembered.

First run: the welcome screen checks Git, Claude Code and Node.js, helps you connect your agent, and lets you open a
folder, start a new project from a template (Empty, Node, Python) or copy a repository.

## Parts

| Part | What it is |
|---|---|
| `src/main`, `src/renderer` | The Windows app: Electron, React and three.js. |
| `backend/` | The backend: Django and Django REST Framework, SQLite, served by waitress on `127.0.0.1`. |
| `plugin/code-visualizer` | The Claude Code plugin. It forwards hook events to the backend. |
| `scripts/prepare-python.mjs` | Builds the Python that ships inside the installer. |

The backend holds everything that is not drawing: the event stream (`/stream`), the parsers for test, lint, type and
build output, the project analyzer, the command runner, git actions, project templates and the agent tools.

## Run it

```
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd ..
npm install
npm start          # builds, then opens the window; the window starts the backend for you
```

Tests: `npm test` (68 Python tests). Type check: `npm run typecheck`.

For UI work: `npm run backend` in one terminal, `npm run dev:ui` in another, then open
`http://localhost:5180/#base=http://127.0.0.1:<port>&token=<token>` (port and token are in `~/.code-visualizer/config.json`).

## Build the installer

```
npm run dist       # release\Codeville-Setup-<version>.exe
npm run dist:dir   # unpacked app only, faster for testing: release\win-unpacked
```

The first run downloads the official Python 3.12 "embeddable" zip from python.org into `build/python` and installs the
backend packages from `backend/requirements-runtime.txt`. The installer then needs no Python on the user's computer. It
also bundles the Claude Code plugin. It is not code signed, so Windows SmartScreen will warn. The app has no custom icon yet.

## Project analysis agent

When you import a project, an analysis agent (`backend/visualizer/analysis`) runs six tools in order and reports each
step live (`analysis.step` events): `scan_files`, `read_identity`, `detect_stack`, `classify_layers`, `find_features`
and `summarize`. The report says what the project is (from its README), its frontend, backend, database and outside
services (from package files, `.env` examples and docker-compose), how many files are in each layer, and its features.
It then traces how the buildings connect (`find_connections`): imports between files, frontend calls matched to the
backend routes they hit, files that talk to the database, and files that use an outside service. The town draws these
as links with small packets moving along them (Links: main, all or off); click a building to see only its links.
It also finds the project's own test, lint, type check and build commands and the folder each runs in (`find_commands`:
for example pytest from `backend`, `npm run build` from `frontend`), and lists the test cases written in the test files
(`find_tests`). The Test view builds its play buttons from these and shows the cases before a run. When a run stops
before any test starts, the message says the real reason (no package.json, missing package, database not reachable).
A feature groups the files about the same thing across layers, for example `matters.py`, `MatterList.tsx` and
`test_matters.py`. The town gives each feature its own district with a separate building per layer, colors blocks by layer, shows the database as its own building and each outside service as a
small block. The same tools are available to agents as `analyze_project`, `detect_stack`, `find_features`, `find_connections`, `find_commands` and `find_tests`.

## Connect Claude Code

The welcome screen and **Extensions** show the exact commands. In Claude Code:

```
/plugin marketplace add <path to the plugin folder>
/plugin install code-visualizer@code-visualizer
```

The plugin reads `~/.code-visualizer/config.json` (port and token) that the app writes when it starts.

## Agent tools

Any agent can call these over HTTP with the token in the `x-cv-token` header.

| Tool | What it does |
|---|---|
| `project_map` | Features and the files in each. |
| `analyze_project` | The full analysis report: what the project is, its stack, layers and features. |
| `detect_stack` | Frameworks, database and outside services. |
| `find_features` | Features with their frontend, backend and test file counts. |
| `find_connections` | How the parts connect: calls, imports, database use, outside services, tests. |
| `recent_events` | The latest events, optionally filtered by type. |
| `current_problems` | The newest failing test, lint, type or build run: what broke, where, what is next. |
| `run_check` | Runs the project's own test, lint, type check or build and returns the same crisp result. |
| `git_status` | Branch, staged and changed files, ahead and behind. |

`GET /api/tools` lists them with their JSON schemas. `POST /api/tools/<name>` calls one.

## Backend API

| Endpoint | Use |
|---|---|
| `GET /health` | Is it running (no token). |
| `GET /stream` | Server-sent events: agent, test, build and git events plus terminal output. |
| `POST /hook/claude-code` | Where the plugin sends hook events. |
| `POST /api/analyze`, `/api/file` | Read a project into features and files; read one file. |
| `POST /api/run`, `/api/stop` | Run or stop a command. |
| `POST /api/git/changes`, `/stage`, `/commit`, `/push` | Source control. |
| `POST /api/agent/send` | Send a prompt to Claude Code. |
| `GET /api/project/templates`, `POST /api/project/new`, `/clone` | Start a project. |
| `GET /api/doctor` | First-run checks for Git, Claude Code and Node.js. |

Errors come back as `{"error": "..."}`, and for git and project actions also as a `problem`: what broke, why, the file and
line if any, and what to do next.

## Hand control (hologram)

The hand icon in the Build view's toolbar turns on the camera and switches the town to a hologram look: see-through
buildings with glowing outlines over a faint picture of the camera. Hands are tracked by Google's MediaPipe Hand
Landmarker (Apache 2.0). The runtime and the model are bundled and run on this computer, so no camera picture leaves it.

| Gesture | What it does |
|---|---|
| Open palm, moved around | Turns and tilts the town |
| Two open hands, moved apart or together | Zoom in or out |
| Fist | Hold still, nothing moves |
| Two quick pinches (thumb and finger) | Reset the view |

`npm run prepare:gestures` copies the runtime and downloads the model (about 8 MB) once; `dev:ui` and `build:ui` run it.
`npm run test:gestures` checks the gesture rules with made-up hand points. If the camera is blocked, turn it on in Windows
Settings, Privacy and security, Camera, for desktop apps. The window is now served from `app://codeville` instead of a file.

## Promo videos

`promo/` holds the launch video (30 s), the demo (93 s), the launch page and the code that makes them. Everything is
drawn on a canvas in `promo/render` (voxel town, pixel UI, kinetic text) and the soundtrack is synthesized, so there
are no outside assets apart from three Google Fonts (OFL) in `promo/render/fonts`. The demo's voiceover is spoken by
[Kokoro-82M](https://github.com/thewh1teagle/kokoro-onnx), an open-source (Apache 2.0) text-to-speech model that runs on
the CPU (`pip install kokoro-onnx soundfile`, model files from its `model-files-v1.0` release); the lines and their times
are at the top of `voice.py`, and the music ducks under the voice. To change and re-render:

```
cd promo/render
node music.mjs                 # audio/launch.wav, audio/demo.wav
python voice.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin   # audio/demo-voice.wav
node render.mjs launch         # ../launch.mp4 (Playwright Chromium + ffmpeg)
node render.mjs demo
node render.mjs demo --still 31.5   # one frame, to check a change
```

Open `promo/render/frame.html?scene=launch` (or `demo`) in a browser to preview in real time; add `&t=20` to start at 20 s.

## Not done yet

Per-feature test steps drawn as the shopper's route (login, cart, payment, admin), code signing, an app icon, and
auto-update.

## Security

The backend listens on this computer only. Every call except `/health` needs the token; the Host must be local and the
Origin must be the app or a local dev page. `run_check` only runs a command that matches the kind you ask for. Pushing
uses the git login already on the computer; the app stores no credentials.
