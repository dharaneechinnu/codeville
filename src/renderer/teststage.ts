import * as THREE from 'three';

export interface StageStep {
  name: string;
  status: 'pass' | 'fail' | 'run' | 'wait';
}

const GAP = 6;
const ok = '#5be37a';
const bad = '#ff4d5e';
const idle = '#39427a';

interface Station {
  group: THREE.Group;
  pad: THREE.Mesh;
  block: THREE.Mesh;
  fire: THREE.Group;
  label: HTMLDivElement;
  status: StageStep['status'] | 'wait';
}

/** The test scene: a shopper walks a path, one station per test step. The camera follows from behind. */
export class TestStage {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  private labels = document.createElement('div');
  private stations: Station[] = [];
  private shopper = new THREE.Group();
  private limbs: THREE.Mesh[] = [];
  private zNow = 0;
  private zTarget = 0;
  private stopped: 'none' | 'fail' = 'none';
  private raf = 0;
  private ro: ResizeObserver;
  private yaw = 0;
  private dist = 9;
  private t0 = performance.now();

  constructor(private host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor('#0a0c16');
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.labels.className = 'cv-labels';
    host.appendChild(this.labels);

    this.scene.fog = new THREE.Fog('#0a0c16', 25, 70);
    this.scene.add(new THREE.HemisphereLight('#bcd0ff', '#1b1330', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.5);
    sun.position.set(10, 20, 10);
    this.scene.add(sun);

    const path = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 400), new THREE.MeshStandardMaterial({ color: '#242a5a' }));
    path.position.set(0, -0.2, -190);
    this.scene.add(path);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(200, 0.4, 400), new THREE.MeshStandardMaterial({ color: '#141538' }));
    ground.position.set(0, -0.45, -190);
    this.scene.add(ground);

    this.buildShopper();
    this.scene.add(this.shopper);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loop();
  }

  private box(w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.position.set(x, y, z);
    return m;
  }

  /** A blocky shopper with a cart-bag on the back, so the back view reads clearly. */
  private buildShopper(): void {
    const legL = this.box(0.45, 1, 0.45, '#2b3a8f', -0.28, 0.5, 0);
    const legR = this.box(0.45, 1, 0.45, '#2b3a8f', 0.28, 0.5, 0);
    const armL = this.box(0.35, 1, 0.35, '#19e6ff', -0.75, 1.8, 0);
    const armR = this.box(0.35, 1, 0.35, '#19e6ff', 0.75, 1.8, 0);
    for (const l of [legL, legR, armL, armR]) l.geometry.translate(0, -0.5, 0);
    legL.position.y = 1;
    legR.position.y = 1;
    armL.position.y = 2.3;
    armR.position.y = 2.3;
    this.limbs = [legL, legR, armL, armR];
    this.shopper.add(
      legL,
      legR,
      armL,
      armR,
      this.box(1.1, 1.3, 0.6, '#19e6ff', 0, 1.65, 0),
      this.box(0.8, 0.8, 0.8, '#f2c9a0', 0, 2.7, 0),
      this.box(0.86, 0.3, 0.86, '#3a2a1a', 0, 3.0, 0.03),
      this.box(0.8, 0.9, 0.35, '#ffb02e', 0, 1.7, 0.5),
    );
  }

  private makeStation(i: number, name: string): Station {
    const group = new THREE.Group();
    group.position.set(0, 0, -(i + 1) * GAP);
    const pad = this.box(3.4, 0.2, 3.4, idle, 0, 0.1, 0);
    const block = this.box(1.6, 1.6, 1.6, idle, 0, 1.1, 0);
    const fire = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const f = this.box(0.35, 0.5 + k * 0.1, 0.35, k % 2 ? '#ffb02e' : '#ff5a3c', (k - 1.5) * 0.4, 2.2, 0);
      fire.add(f);
    }
    fire.visible = false;
    group.add(pad, block, fire);
    this.scene.add(group);
    const label = document.createElement('div');
    label.className = 'cv-label';
    label.textContent = name;
    this.labels.appendChild(label);
    return { group, pad, block, fire, label, status: 'wait' };
  }

  /** Brings the scene in line with the steps of the latest run. */
  setSteps(steps: StageStep[], running: boolean): void {
    while (this.stations.length > steps.length) {
      const s = this.stations.pop()!;
      this.scene.remove(s.group);
      s.label.remove();
    }
    steps.forEach((st, i) => {
      const s = this.stations[i] ?? (this.stations[i] = this.makeStation(i, st.name));
      s.label.textContent = st.name;
      s.status = st.status;
      const c = st.status === 'pass' ? ok : st.status === 'fail' ? bad : idle;
      (s.pad.material as THREE.MeshStandardMaterial).color.set(c);
      (s.block.material as THREE.MeshStandardMaterial).color.set(c);
      s.fire.visible = st.status === 'fail';
      s.label.className = `cv-label ${st.status === 'fail' ? 'bad' : st.status === 'run' ? 'active' : ''}`;
    });
    const failAt = steps.findIndex((s) => s.status === 'fail');
    this.stopped = failAt >= 0 ? 'fail' : 'none';
    if (failAt >= 0) this.zTarget = -(failAt + 1) * GAP + 2.6;
    else if (steps.length) this.zTarget = -(steps.length + (running ? 1 : 0)) * GAP + (running ? 0 : 2.6);
    else this.zTarget = 0;
    if (steps.length === 0) this.zNow = 0;
  }

  rotate(a: number): void {
    this.yaw += a;
  }
  zoom(f: number): void {
    this.dist = Math.max(4, Math.min(30, this.dist * f));
  }
  reset(): void {
    this.yaw = 0;
    this.dist = 9;
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const t = (performance.now() - this.t0) / 1000;
    const dz = this.zTarget - this.zNow;
    const moving = Math.abs(dz) > 0.05;
    if (moving) this.zNow += Math.sign(dz) * Math.min(Math.abs(dz), 0.07);
    this.shopper.position.set(0, 0, this.zNow);
    this.shopper.rotation.y = 0;
    const swing = moving ? Math.sin(t * 9) * 0.7 : 0;
    this.limbs[0]!.rotation.x = swing;
    this.limbs[1]!.rotation.x = -swing;
    this.limbs[2]!.rotation.x = -swing;
    this.limbs[3]!.rotation.x = this.stopped === 'fail' && !moving ? -2.6 + Math.sin(t * 10) * 0.3 : swing;
    this.shopper.position.x = this.stopped === 'fail' && !moving ? Math.sin(t * 30) * 0.05 : 0;

    for (const s of this.stations) {
      if (s.status === 'run') s.block.rotation.y = t * 2;
      if (s.fire.visible) s.fire.children.forEach((f, k) => (f.position.y = 2.2 + Math.abs(Math.sin(t * 6 + k)) * 0.4));
    }

    // Back view: the camera stays behind the shopper and looks down the path.
    const cx = Math.sin(this.yaw) * this.dist;
    const cz = Math.cos(this.yaw) * this.dist;
    this.camera.position.set(cx, 3.8 + this.dist * 0.15, this.zNow + cz);
    this.camera.lookAt(0, 2, this.zNow - 4);
    this.renderer.render(this.scene, this.camera);

    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (const s of this.stations) {
      const p = new THREE.Vector3(0, 3.4, s.group.position.z).project(this.camera);
      const vis = p.z < 1 && p.z > -1;
      s.label.style.display = vis ? 'block' : 'none';
      s.label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.remove();
  }
}
