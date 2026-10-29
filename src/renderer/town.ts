import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Analysis, Connection, Feature, Layer, LinkKind } from '../shared/types.js';
import type { CvEvent } from '../shared/events.js';

/** Every block is colored by the layer its file belongs to, so one building shows how a feature is built. */
export const LAYER_COLOR: Record<Layer, string> = { frontend: '#19c6e6', backend: '#ff9f43', database: '#8a5cff', tests: '#5be37a' };
const SERVICE_COLOR = '#ffd23f';

/** How each kind of link is drawn. */
export const LINK_COLOR: Record<LinkKind, string> = { calls: '#19e6ff', imports: '#8f9ad8', stores: '#b78bff', uses: '#ffd23f', tests: '#5be37a' };
export type LinkMode = 'main' | 'all' | 'off';

interface Link {
  edge: Connection;
  from: Building;
  to: Building;
  curve: THREE.QuadraticBezierCurve3;
  line: THREE.Mesh;
  packet: THREE.Mesh;
  phase: number;
  visible: boolean;
}
const DISTRICT_X = 12.5;
const DISTRICT_Z = 9;
const BUILDING_STEP = 3.5;
const SERVICE_GAP = 4.5;

function layerGuess(path: string): Layer {
  const p = path.toLowerCase();
  if (/(^|\/)(tests?|__tests__|e2e|specs?)\//.test(p) || /(\.test\.|\.spec\.|(^|\/)test_)/.test(p)) return 'tests';
  if (/\.(sql|prisma)$/.test(p) || /(^|\/)(alembic|migrations?|models)\//.test(p)) return 'database';
  if (/\.(tsx|jsx|vue|svelte)$/.test(p)) return 'frontend';
  return 'backend';
}
const MAX_FLOORS = 24;

interface Floor {
  mesh: THREE.Mesh;
  path: string;
  isNew: boolean;
}

/** One feature, laid out as a small district: a pad with its own label and one separate building per layer. */
interface District {
  id: string;
  name: string;
  x: number;
  z: number;
  group: THREE.Group;
  label: HTMLDivElement;
  buildings: Building[];
}

interface Building {
  feature: Feature;
  layer: Layer;
  district: District;
  group: THREE.Group;
  floors: Floor[];
  color: THREE.Color;
  width: number;
  /** Height of one block. Buildings with many files get thinner blocks so no tower hides the rest. */
  fh: number;
  service: boolean;
  fire: THREE.Group;
  failed: boolean;
  activeUntil: number;
}

export interface Pick {
  /** The building that was clicked: `<feature id>:<layer>`. */
  buildingId: string;
  featureId: string;
  featureName: string;
  path: string;
}

/** A town of districts: one per feature, each with separate frontend, backend and test buildings, one block per file. Drag to rotate, wheel to zoom. */
export class Town {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  private controls: OrbitControls;
  private buildings = new Map<string, Building>();
  private districts: District[] = [];
  private links: Link[] = [];
  private linkMode: LinkMode = 'main';
  private focusB: Building | null = null;
  private linkGroup = new THREE.Group();
  private pulses: { floor: Floor; start: number }[] = [];
  private raf = 0;
  private ro: ResizeObserver;
  private labels: HTMLDivElement;
  private down = { x: 0, y: 0 };
  private onPick: (p: Pick | null) => void = () => undefined;
  private selected: Floor | null = null;
  private center = new THREE.Vector3();
  private extent = 16;
  private holo = false;
  private fog: THREE.Fog | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor('#0a0c16');
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.labels = document.createElement('div');
    this.labels.className = 'cv-labels';
    host.appendChild(this.labels);

    this.fog = new THREE.Fog('#0a0c16', 60, 160);
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight('#bcd0ff', '#1b1330', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(18, 30, 12);
    this.scene.add(sun);
    this.scene.add(this.linkGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) this.pick(e);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.setProject(null);
    this.loop();
  }

  setOnPick(fn: (p: Pick | null) => void): void {
    this.onPick = fn;
  }

  /** Builds the town from an analyzed project. Passing null shows an empty ground. */
  setProject(a: Analysis | null): void {
    for (const d of this.districts) {
      this.scene.remove(d.group);
      d.label.remove();
    }
    this.clearLinks();
    this.districts = [];
    this.buildings.clear();
    this.pulses = [];
    this.selected = null;
    for (const child of [...this.scene.children]) if (child.userData.ground) this.scene.remove(child);

    const all = a?.features ?? [];
    const app = all.filter((f) => f.kind !== 'database');
    const db = all.find((f) => f.kind === 'database');
    const services = (a?.stack.services ?? []).slice(0, 8);
    const cols = Math.max(1, Math.ceil(Math.sqrt(app.length * 1.3 || 1)));
    const rows = Math.ceil(app.length / cols) || 1;
    const xC = ((cols - 1) * DISTRICT_X) / 2;
    const zMin = db ? -DISTRICT_Z : 0;
    const zMax = (rows - 1 + (services.length ? 1 : 0)) * DISTRICT_Z;
    const w = Math.max(cols * DISTRICT_X, services.length * SERVICE_GAP) + 4;
    const d = zMax - zMin + DISTRICT_Z + 1;
    this.extent = Math.max(w, d) + 8;

    const ground = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), new THREE.MeshStandardMaterial({ color: '#1a1b45', roughness: 1 }));
    ground.position.set(xC, -0.5, (zMin + zMax) / 2);
    ground.userData.ground = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(Math.max(w, d), Math.round(Math.max(w, d) / 2.2), '#2d3361', '#222750');
    grid.position.set(ground.position.x, 0.01, ground.position.z);
    grid.userData.ground = true;
    this.scene.add(grid);

    /** Makes one district and puts a separate building in it for each of the given layers. */
    const makeDistrict = (f: Feature, x: number, z: number, layers: Layer[], width: number, extra = '', service = false): void => {
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      const dist: District = { id: f.id, name: f.name, x, z, group, label: this.makeLabel(f.name, extra), buildings: [] };
      const step = service ? 0 : Math.max(BUILDING_STEP, width + 0.9);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(service ? 3 : layers.length * step + 0.6, 0.18, service ? 3 : width + 1.8),
        new THREE.MeshStandardMaterial({ color: '#262c5e', roughness: 1 }),
      );
      pad.position.y = 0.09;
      group.add(pad);
      layers.forEach((layer, k) => {
        const files = f.files.filter((file) => file.layer === layer);
        const bf: Feature = { ...f, id: `${f.id}:${layer}`, files };
        const bg = new THREE.Group();
        bg.position.set((k - (layers.length - 1) / 2) * step, 0.18, 0);
        const b: Building = {
          feature: bf, layer, district: dist, group: bg, floors: [], color: new THREE.Color(service ? SERVICE_COLOR : LAYER_COLOR[layer]), width, service,
          fh: service ? 0.9 : Math.min(0.92, Math.max(0.3, 8 / Math.max(1, Math.min(files.length, MAX_FLOORS)))),
          fire: this.makeFire(), failed: false, activeUntil: 0,
        };
        b.fire.visible = false;
        bg.add(b.fire);
        if (service) for (let n = 0; n < 2; n++) this.addFloor(b, '', false, layer, SERVICE_COLOR);
        else files.slice(0, MAX_FLOORS).forEach((file) => this.addFloor(b, file.path, false, layer));
        group.add(bg);
        dist.buildings.push(b);
        this.buildings.set(bf.id, b);
      });
      this.scene.add(group);
      this.districts.push(dist);
    };

    const LAYERS: Layer[] = ['frontend', 'backend', 'tests'];
    app.forEach((f, i) => {
      const present = LAYERS.filter((l) => f.files.some((file) => file.layer === l));
      makeDistrict(f, (i % cols) * DISTRICT_X, Math.floor(i / cols) * DISTRICT_Z, present.length ? present : ['backend'], 2.6);
    });
    if (db) makeDistrict(db, xC, -DISTRICT_Z, ['database'], 5.2, 'db');
    services.forEach((name, i) => {
      const fake: Feature = { id: `svc-${name}`, name, kind: 'feature', path: '', files: [], layers: { frontend: 0, backend: 0, database: 0, tests: 0 } };
      makeDistrict(fake, xC + (i - (services.length - 1) / 2) * SERVICE_GAP, zMax, ['backend'], 1.8, 'svc', true);
    });

    this.center.set(xC, 3, (zMin + zMax) / 2);
    this.buildLinks(a?.connections ?? []);
    this.overview();
    this.applyHologram();
  }

  /** Hologram look: the town turns see-through with glowing outlines, so a camera picture can show behind it. */
  setHologram(on: boolean): void {
    this.holo = on;
    this.applyHologram();
  }

  private applyHologram(): void {
    const on = this.holo;
    this.renderer.setClearColor('#0a0c16', on ? 0 : 1);
    this.scene.fog = on ? null : this.fog;
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.userData.ground) o.visible = !on || !(o.geometry instanceof THREE.BoxGeometry);
      if (!o.userData.floor) return;
      const mat = o.material as THREE.MeshStandardMaterial;
      mat.transparent = on;
      mat.opacity = on ? 0.42 : 1;
      mat.depthWrite = !on;
      let edges = o.getObjectByName('holo-edges') as THREE.LineSegments | undefined;
      if (on && !edges) {
        edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), new THREE.LineBasicMaterial({ color: '#5cf2ff', transparent: true, opacity: 0.95 }));
        edges.name = 'holo-edges';
        o.add(edges);
      }
      if (edges) edges.visible = on;
    });
    this.scene.traverse((o) => {
      if (o instanceof THREE.GridHelper) (o.material as THREE.LineBasicMaterial).color.set(on ? '#2fd6ee' : '#2d3361');
    });
  }

  // ------------------------------------------------------------------------------------------ links

  private clearLinks(): void {
    for (const l of this.links) {
      this.linkGroup.remove(l.line, l.packet);
      l.line.geometry.dispose();
      (l.line.material as THREE.Material).dispose();
      l.packet.geometry.dispose();
      (l.packet.material as THREE.Material).dispose();
    }
    this.links = [];
    this.focusB = null;
  }

  private anchor(b: Building): THREE.Vector3 {
    return new THREE.Vector3(b.district.x + b.group.position.x, 0.18 + b.floors.length * b.fh + 0.25, b.district.z + b.group.position.z);
  }

  /** One curved pipe between two buildings, with a small packet that travels along it. */
  private buildLinks(edges: Connection[]): void {
    for (const e of edges) {
      const from = this.buildings.get(e.from);
      const to = this.buildings.get(e.to);
      if (!from || !to || from === to) continue;
      const a = this.anchor(from);
      const c = this.anchor(to);
      const mid = a.clone().add(c).multiplyScalar(0.5);
      mid.y = Math.max(a.y, c.y) + 1.5 + a.distanceTo(c) * 0.2;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
      const color = LINK_COLOR[e.kind];
      const radius = 0.05 + Math.min(0.09, e.weight * 0.004);
      const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 5, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
      const packet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      line.visible = false;
      packet.visible = false;
      this.linkGroup.add(line, packet);
      this.links.push({ edge: e, from, to, curve, line, packet, phase: Math.random(), visible: false });
    }
    this.applyLinks();
  }

  private applyLinks(): void {
    const focus = this.focusB;
    for (const l of this.links) {
      const main = l.edge.kind === 'calls' || l.edge.kind === 'stores' || l.edge.kind === 'uses';
      l.visible = focus ? l.from === focus || l.to === focus : this.linkMode === 'all' || (this.linkMode === 'main' && main);
      l.line.visible = l.visible;
      l.packet.visible = l.visible;
      (l.line.material as THREE.MeshBasicMaterial).opacity = focus ? 0.95 : 0.5;
    }
  }

  setLinkMode(mode: LinkMode): void {
    this.linkMode = mode;
    this.applyLinks();
  }

  /** Shows only the links of one building, or all of them again when null. */
  focusBuilding(id: string | null): void {
    this.focusB = id ? (this.buildings.get(id) ?? null) : null;
    this.applyLinks();
  }

  private makeLabel(name: string, extra = ''): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `cv-label ${extra}`.trim();
    el.textContent = name;
    this.labels.appendChild(el);
    return el;
  }

  private makeFire(): THREE.Group {
    const g = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff4d1f' : '#ffb02e' }));
      m.position.set((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 2.4);
      m.userData.phase = Math.random() * 6;
      g.add(m);
    }
    return g;
  }

  private addFloor(b: Building, path: string, isNew: boolean, layer: Layer = 'backend', color?: string): Floor {
    const i = b.floors.length;
    const base = new THREE.Color(color ?? LAYER_COLOR[layer]).offsetHSL(0, 0, i % 2 ? 0.04 : -0.04);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.width, b.fh * 0.96, b.width),
      new THREE.MeshStandardMaterial({ color: base, roughness: 0.85, emissive: '#000000' }),
    );
    mesh.position.y = i * b.fh + b.fh / 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }));
    mesh.add(edges);
    const floor: Floor = { mesh, path, isNew };
    mesh.userData.floor = floor;
    mesh.userData.building = b;
    b.group.add(mesh);
    b.floors.push(floor);
    return floor;
  }

  /** Reacts to one event: edited files pulse (new files add a block), failures set a building on fire. */
  handleEvent(e: CvEvent): void {
    const now = performance.now();
    if (e.type === 'file.change') {
      const hit = this.findFloor(e.path);
      if (hit) {
        hit.b.activeUntil = now + 4000;
        this.pulse(hit.floor);
      } else {
        const b = this.buildingFor(e.path);
        if (b && b.floors.length < MAX_FLOORS) {
          const floor = this.addFloor(b, e.path, true, layerGuess(e.path));
          b.activeUntil = now + 4000;
          this.pulse(floor);
        }
      }
    } else if (e.type === 'step.fail' || (e.type === 'run.end' && e.status === 'fail' && e.problem)) {
      const file = e.type === 'step.fail' ? (e.problem.file ?? e.path) : e.problem?.file;
      const hit = file ? this.findFloor(file) : undefined;
      const b = hit?.b ?? (file ? this.buildingFor(file) : undefined);
      if (b) this.setFailed(b, true, hit?.floor);
    } else if (e.type === 'run.end' && e.status === 'pass') {
      for (const b of this.buildings.values()) this.setFailed(b, false);
    }
  }

  private setFailed(b: Building, failed: boolean, floor?: Floor): void {
    b.failed = failed;
    b.fire.visible = failed;
    b.district.label.classList.toggle('bad', b.district.buildings.some((x) => x.failed));
    for (const f of b.floors) (f.mesh.material as THREE.MeshStandardMaterial).emissive.set(failed && (!floor || f === floor) ? '#7a0f1a' : '#000000');
    if (failed) b.fire.position.y = b.floors.length * b.fh + 0.6;
  }

  private findFloor(path: string): { b: Building; floor: Floor } | undefined {
    const p = path.replace(/\\/g, '/');
    for (const b of this.buildings.values()) {
      const floor = b.floors.find((f) => f.path === p || p.endsWith('/' + f.path) || f.path.endsWith('/' + p));
      if (floor) return { b, floor };
    }
    return undefined;
  }

  /** The building a new file belongs to: of the same layer when there is one, and the one whose files share the most of its folder. */
  private buildingFor(path: string): Building | undefined {
    const dir = path.split('/').slice(0, -1);
    const layer = layerGuess(path);
    const all = [...this.buildings.values()].filter((b) => !b.service);
    const pool = all.some((b) => b.layer === layer) ? all.filter((b) => b.layer === layer) : all;
    let best: Building | undefined;
    let score = -1;
    for (const b of pool) {
      for (const f of b.feature.files) {
        const parts = f.path.split('/').slice(0, -1);
        let n = 0;
        while (n < parts.length && n < dir.length && parts[n] === dir[n]) n++;
        if (n > score) {
          score = n;
          best = b;
        }
      }
    }
    return best ?? pool[0];
  }

  private pulse(floor: Floor): void {
    this.pulses.push({ floor, start: performance.now() });
  }

  focusFeature(id: string): void {
    const d = this.districts.find((x) => x.id === id);
    if (!d) return;
    const t = new THREE.Vector3(d.x, Math.max(1.5, Math.max(...d.buildings.map((b) => b.floors.length * b.fh)) / 2), d.z);
    this.controls.target.copy(t);
    this.camera.position.set(t.x + 9, t.y + 8, t.z + 9);
  }

  select(path: string | null): void {
    if (this.selected) this.selected.mesh.scale.set(1, 1, 1);
    this.selected = null;
    if (!path) {
      this.focusBuilding(null);
      return;
    }
    const hit = this.findFloor(path);
    if (hit) {
      this.selected = hit.floor;
      hit.floor.mesh.scale.set(1.12, 1, 1.12);
      this.focusBuilding(hit.b.feature.id);
    }
  }

  private pick(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const meshes = [...this.buildings.values()].flatMap((b) => b.floors.map((f) => f.mesh));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) {
      this.select(null);
      this.onPick(null);
      return;
    }
    const floor = hit.object.userData.floor as Floor;
    const b = hit.object.userData.building as Building;
    if (!floor.path) {
      // An outside service has no file to open, but it has links to show.
      this.select(null);
      this.focusBuilding(b.feature.id);
      this.onPick({ buildingId: b.feature.id, featureId: b.district.id, featureName: b.district.name, path: '' });
      return;
    }
    this.select(floor.path);
    this.onPick({ buildingId: b.feature.id, featureId: b.district.id, featureName: b.district.name, path: floor.path });
  }

  // View controls: the same moves a person makes with the mouse, as buttons.
  rotate(angle: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.controls.target).add(off);
  }
  tilt(delta: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const r = off.length();
    const polar = Math.min(Math.PI / 2 - 0.05, Math.max(0.15, Math.acos(off.y / r) + delta));
    const az = Math.atan2(off.x, off.z);
    this.camera.position.set(this.controls.target.x + r * Math.sin(polar) * Math.sin(az), this.controls.target.y + r * Math.cos(polar), this.controls.target.z + r * Math.sin(polar) * Math.cos(az));
  }
  zoom(factor: number): void {
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(off);
  }
  overview(): void {
    this.controls.target.copy(this.center);
    this.camera.position.set(this.center.x + this.extent * 0.42, this.center.y + this.extent * 0.4, this.center.z + this.extent * 0.55);
  }
  wholeProject(): void {
    this.controls.target.copy(this.center);
    this.camera.position.set(this.center.x + 0.01, this.center.y + this.extent * 1.5, this.center.z + 0.01);
  }

  private resize(): void {
    const w = Math.max(10, this.host.clientWidth);
    const h = Math.max(10, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    this.pulses = this.pulses.filter((p) => {
      const t = (now - p.start) / 900;
      const mat = p.floor.mesh.material as THREE.MeshStandardMaterial;
      if (t >= 1) {
        mat.emissive.set(p.floor.mesh.userData.building?.failed ? '#7a0f1a' : '#000000');
        return false;
      }
      mat.emissive.set('#ffffff').multiplyScalar(0.55 * (1 - t));
      return true;
    });
    for (const b of this.buildings.values()) {
      if (b.fire.visible) b.fire.children.forEach((c) => {
        const ph = (c.userData.phase as number) + now / 180;
        c.position.y = Math.abs(Math.sin(ph)) * 1.4;
        c.scale.setScalar(0.6 + Math.abs(Math.cos(ph)) * 0.8);
      });
    }
    for (const l of this.links) if (l.visible) l.packet.position.copy(l.curve.getPoint((now / 1700 + l.phase) % 1));
    const rect = this.host.getBoundingClientRect();
    for (const d of this.districts) {
      const top = Math.max(0.5, ...d.buildings.map((b) => b.floors.length * b.fh));
      const v = new THREE.Vector3(d.x, top + 1.4, d.z).project(this.camera);
      d.label.style.display = v.z > 1 ? 'none' : 'block';
      d.label.style.transform = `translate(${((v.x + 1) / 2) * rect.width}px, ${((1 - v.y) / 2) * rect.height}px) translate(-50%, -100%)`;
      d.label.classList.toggle('active', d.buildings.some((b) => now < b.activeUntil));
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.remove();
  }
}

