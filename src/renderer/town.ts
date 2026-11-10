import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Analysis, Connection, Feature, FileLink, Layer, LinkKind } from '../shared/types.js';
import type { CvEvent } from '../shared/events.js';
import { dress, floorMaterials, styleFor, type BuildingStyle } from './buildings.js';

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
  /** A failed test or check points at this file. */
  bad?: boolean;
  /** How this block is linked to the selected block, when it is. */
  rel?: LinkKind;
}

/** A wire between two blocks: drawn only for the selected block, with a packet moving the way the link points. */
interface Wire {
  curve: THREE.QuadraticBezierCurve3;
  line: THREE.Mesh;
  packet: THREE.Mesh;
  phase: number;
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
  /** The parts on top of the last floor (roof, sign, chimney). Moves up when a floor is added. */
  roof: THREE.Group | null;
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
  private hovered: Floor | null = null;
  private fileLinks: FileLink[] = [];
  private floorByPath = new Map<string, { b: Building; floor: Floor }>();
  private meshes: THREE.Mesh[] = [];
  private wires: Wire[] = [];
  private wireGroup = new THREE.Group();
  private tip: HTMLDivElement;
  private flowDots: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; phase: number }[] = [];
  private center = new THREE.Vector3();
  private extent = 16;
  private wide = false;
  private style: BuildingStyle = 'workshop';
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
    this.scene.add(this.wireGroup);
    this.tip = document.createElement('div');
    this.tip.className = 'cv-tip';
    this.tip.style.display = 'none';
    this.labels.appendChild(this.tip);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) this.pickAt(e.clientX, e.clientY);
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.buttons === 0) this.hoverAt(e.clientX, e.clientY);
    });
    dom.addEventListener('pointerleave', () => this.clearHover());

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
    this.clearWires();
    this.districts = [];
    this.buildings.clear();
    this.floorByPath.clear();
    this.meshes = [];
    this.fileLinks = a?.fileLinks ?? [];
    this.pulses = [];
    this.selected = null;
    this.hovered = null;
    this.tip.style.display = 'none';
    for (const child of [...this.scene.children]) if (child.userData.ground) this.scene.remove(child);

    this.style = styleFor(a?.flow?.template.id);
    const all = a?.features ?? [];
    // When the project matches a known kind of app, the districts stand in the order of its user flow and carry the step number.
    const stepOf = new Map<string, number>();
    if (a?.flow && a.flow.template.id !== 'general') {
      a.flow.steps.forEach((s, i) => {
        const main = s.features[0];
        if (s.found && main && !stepOf.has(main)) stepOf.set(main, i + 1);
      });
    }
    const app = all.filter((f) => f.kind !== 'database').sort((x, y) => (stepOf.get(x.id) ?? 99) - (stepOf.get(y.id) ?? 99));
    this.flowDots = [];
    const db = all.find((f) => f.kind === 'database');
    const services = (a?.stack.services ?? []).slice(0, 8);
    // The steps of the flow stand side by side on one street, in order; everything else sits in the rows behind it.
    const onStreet = app.filter((f) => stepOf.has(f.id)).length;
    const cols = onStreet >= 2 ? onStreet : Math.max(1, Math.ceil(Math.sqrt(app.length * 1.3 || 1)));
    const rows = Math.ceil(app.length / cols) || 1;
    const xC = ((cols - 1) * DISTRICT_X) / 2;
    const zMin = db ? -DISTRICT_Z : 0;
    const zMax = (rows - 1 + (services.length ? 1 : 0)) * DISTRICT_Z;
    const w = Math.max(cols * DISTRICT_X, services.length * SERVICE_GAP) + 4;
    const d = zMax - zMin + DISTRICT_Z + 1;
    this.extent = Math.max(w, d) + 8;
    this.wide = w > d * 1.6;

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
      const n = stepOf.get(f.id);
      const dist: District = { id: f.id, name: f.name, x, z, group, label: this.makeLabel(n ? `${n} · ${f.name}` : f.name, n ? `${extra} step` : extra), buildings: [] };
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
          roof: null, fire: this.makeFire(), failed: false, activeUntil: 0,
        };
        b.fire.visible = false;
        bg.add(b.fire);
        if (!service) {
          // Street-level parts and the roof of this town's building style; the floors between them are the files.
          const parts = dress(this.style, width, layer, b.color);
          for (const part of [parts.base, parts.roof]) part.traverse((o) => (o.userData.trim = true));
          b.roof = parts.roof;
          bg.add(parts.base, parts.roof);
        }
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

    // The flow road: a lit strip on the ground from each step's district to the next, with a dot moving along it.
    const stops = this.districts.filter((d) => stepOf.has(d.id)).sort((x, y) => stepOf.get(x.id)! - stepOf.get(y.id)!);
    for (let i = 0; i + 1 < stops.length; i++) {
      const from = new THREE.Vector3(stops[i]!.x, 0.04, stops[i]!.z + 2.6);
      const to = new THREE.Vector3(stops[i + 1]!.x, 0.04, stops[i + 1]!.z + 2.6);
      const len = from.distanceTo(to);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.28), new THREE.MeshBasicMaterial({ color: '#19e6ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = -Math.atan2(to.z - from.z, to.x - from.x);
      road.position.copy(from).add(to).multiplyScalar(0.5);
      road.userData.ground = true;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      dot.userData.ground = true;
      this.scene.add(road, dot);
      this.flowDots.push({ mesh: dot, from, to, phase: i * 0.17 });
    }

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
      if (o.userData.trim) {
        // Doors, roofs and chimneys turn to faint glass too, so the floors (the files) stay the thing you aim at.
        for (const m of this.mats(o)) {
          m.transparent = on;
          m.opacity = on ? 0.3 : 1;
          m.depthWrite = !on;
        }
        return;
      }
      if (!o.userData.floor) return;
      for (const mat of this.mats(o)) {
        mat.transparent = on;
        mat.opacity = on ? 0.42 : 1;
        mat.depthWrite = !on;
      }
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
    return new THREE.Vector3(b.district.x + b.group.position.x, 0.18 + b.floors.length * b.fh + (b.roof ? 1.1 : 0.25), b.district.z + b.group.position.z);
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

  /** The building style this town is drawn in, chosen from the kind of app. */
  getStyle(): BuildingStyle {
    return this.style;
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
      b.service ? new THREE.MeshStandardMaterial({ color: base, roughness: 0.85, emissive: '#000000' }) : floorMaterials(this.style, base, b.width),
    );
    mesh.position.y = i * b.fh + b.fh / 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }));
    mesh.add(edges);
    const floor: Floor = { mesh, path, isNew };
    mesh.userData.floor = floor;
    mesh.userData.building = b;
    b.group.add(mesh);
    b.floors.push(floor);
    this.meshes.push(mesh);
    if (b.roof) b.roof.position.y = b.floors.length * b.fh;
    if (path) this.floorByPath.set(path, { b, floor });
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
    for (const f of b.floors) {
      f.bad = failed && (!floor || f === floor);
      this.paint(f);
    }
    if (failed) b.fire.position.y = b.floors.length * b.fh + (b.roof ? 1.2 : 0.6);
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
    const old = this.selected;
    if (old) old.mesh.scale.set(1, 1, 1);
    this.selected = null;
    this.clearWires();
    if (old) this.paint(old);
    if (!path) {
      this.focusBuilding(null);
      return;
    }
    const hit = this.findFloor(path);
    if (hit) {
      this.selected = hit.floor;
      hit.floor.mesh.scale.set(1.12, 1, 1.12);
      this.paint(hit.floor);
      this.focusBuilding(hit.b.feature.id);
      this.buildWires(hit.floor);
    }
  }

  // ------------------------------------------------------------------------------------------ block wires

  private clearWires(): void {
    for (const w of this.wires) {
      this.wireGroup.remove(w.line, w.packet);
      w.line.geometry.dispose();
      (w.line.material as THREE.Material).dispose();
      w.packet.geometry.dispose();
      (w.packet.material as THREE.Material).dispose();
    }
    this.wires = [];
    for (const { floor } of this.floorByPath.values()) {
      if (floor.rel) {
        floor.rel = undefined;
        this.paint(floor);
      }
    }
  }

  /** Draws a wire from the selected block to every block its file is linked to, and lights those blocks. */
  private buildWires(sel: Floor): void {
    this.scene.updateMatrixWorld();
    const at = (f: Floor): THREE.Vector3 => f.mesh.getWorldPosition(new THREE.Vector3());
    for (const l of this.fileLinks) {
      if (l.from !== sel.path && l.to !== sel.path) continue;
      const from = this.floorByPath.get(l.from);
      const to = this.floorByPath.get(l.to);
      if (!from || !to) continue;
      const a = at(from.floor);
      const c = at(to.floor);
      const mid = a.clone().add(c).multiplyScalar(0.5);
      const flat = Math.hypot(a.x - c.x, a.z - c.z);
      // Two blocks of the same tower: bow the wire out of the front. Otherwise arc it over the roofs.
      if (flat < 0.5) mid.z += from.b.width / 2 + 1.1 + Math.abs(a.y - c.y) * 0.25;
      else mid.y = Math.max(a.y, c.y) + 1.4 + flat * 0.28;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
      const color = LINK_COLOR[l.kind];
      const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.04, 5, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      const packet = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      this.wireGroup.add(line, packet);
      this.wires.push({ curve, line, packet, phase: Math.random() });
      const other = l.from === sel.path ? to.floor : from.floor;
      other.rel = l.kind;
      this.paint(other);
    }
  }

  /** A floor has one material, or six when it carries a building style (four walls and two slabs). */
  private mats(mesh: THREE.Mesh): THREE.MeshStandardMaterial[] {
    return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
  }

  private glow(f: Floor, color: THREE.ColorRepresentation, scale = 1): void {
    for (const m of this.mats(f.mesh)) m.emissive.set(color).multiplyScalar(scale);
  }

  /** One place decides a block's glow, so hover, selection, links and failures never fight over it. */
  private paint(f: Floor): void {
    if (f === this.hovered) this.glow(f, '#1f7f92');
    else if (f.bad) this.glow(f, '#7a0f1a');
    else if (f === this.selected) this.glow(f, '#3b4170');
    else if (f.rel) this.glow(f, LINK_COLOR[f.rel], 0.4);
    else this.glow(f, '#000000');
  }

  // ------------------------------------------------------------------------------------------ pointing

  /** The block under a point of the window. `fat` (pixels) also tries a ring around the point, for a hand that cannot aim to the pixel. */
  private floorAt(clientX: number, clientY: number, fat = 0): THREE.Mesh | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const ray = new THREE.Raycaster();
    const spots: [number, number][] = [[0, 0]];
    for (let k = 0; fat > 0 && k < 8; k++) spots.push([Math.cos((k * Math.PI) / 4) * fat, Math.sin((k * Math.PI) / 4) * fat]);
    for (const [dx, dy] of spots) {
      const ndc = new THREE.Vector2(((clientX + dx - rect.left) / rect.width) * 2 - 1, -((clientY + dy - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.meshes, false)[0];
      if (hit) return hit.object as THREE.Mesh;
    }
    return null;
  }

  private pickOf(mesh: THREE.Mesh): Pick {
    const floor = mesh.userData.floor as Floor;
    const b = mesh.userData.building as Building;
    return { buildingId: b.feature.id, featureId: b.district.id, featureName: b.district.name, path: floor.path };
  }

  /** Lights the block under a point and shows its file name. Used by the mouse and by the pointing hand. */
  hoverAt(clientX: number, clientY: number, fat = 0): Pick | null {
    const mesh = this.floorAt(clientX, clientY, fat);
    const floor = (mesh?.userData.floor as Floor | undefined) ?? null;
    if (floor !== this.hovered) {
      const old = this.hovered;
      this.hovered = floor;
      if (old) this.paint(old);
      if (floor) this.paint(floor);
      const b = mesh?.userData.building as Building | undefined;
      const name = floor?.path ? floor.path.split('/').pop()! : (b?.district.name ?? '');
      this.tip.textContent = name;
      this.tip.style.display = floor ? 'block' : 'none';
    }
    return mesh ? this.pickOf(mesh) : null;
  }

  clearHover(): void {
    const old = this.hovered;
    this.hovered = null;
    if (old) this.paint(old);
    this.tip.style.display = 'none';
  }

  /** Selects the block under a point, the same as a mouse click there. */
  pickAt(clientX: number, clientY: number, fat = 0): Pick | null {
    const mesh = this.floorAt(clientX, clientY, fat);
    if (!mesh) {
      this.select(null);
      this.onPick(null);
      return null;
    }
    const p = this.pickOf(mesh);
    // An outside service has no file to open, but it has links to show.
    this.select(p.path || null);
    if (!p.path) this.focusBuilding(p.buildingId);
    this.onPick(p);
    return p;
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
    // A long street is seen from the front so all of it fits; a square town from its corner.
    if (this.wide) this.camera.position.set(this.center.x + this.extent * 0.1, this.center.y + this.extent * 0.48, this.center.z + this.extent * 0.85);
    else this.camera.position.set(this.center.x + this.extent * 0.42, this.center.y + this.extent * 0.4, this.center.z + this.extent * 0.55);
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
      if (t >= 1) {
        this.paint(p.floor);
        return false;
      }
      this.glow(p.floor, '#ffffff', 0.55 * (1 - t));
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
    for (const d of this.flowDots) d.mesh.position.lerpVectors(d.from, d.to, (now / 1900 + d.phase) % 1).setY(0.25);
    for (const w of this.wires) w.packet.position.copy(w.curve.getPoint((now / 1300 + w.phase) % 1));
    const rect = this.host.getBoundingClientRect();
    if (this.hovered) {
      const v = this.hovered.mesh.getWorldPosition(new THREE.Vector3()).project(this.camera);
      this.tip.style.transform = `translate(${((v.x + 1) / 2) * rect.width}px, ${((1 - v.y) / 2) * rect.height}px) translate(14px, -130%)`;
    }
    for (const d of this.districts) {
      const top = Math.max(0.5, ...d.buildings.map((b) => b.floors.length * b.fh));
      const v = new THREE.Vector3(d.x, top + 2.4, d.z).project(this.camera);
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

