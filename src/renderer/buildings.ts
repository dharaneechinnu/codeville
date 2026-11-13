/** Building styles for the town. Each file is still one floor you can point at and open; a style decides what those
 * floors look like (walls and windows) and what stands around them (door, awning, columns, roof, chimney).
 *
 * The styles are designed by hand, one per kind of app, so a store looks like a market street and a dashboard app
 * looks like glass offices. To add a style: add its name, its windows in `drawBay`, and its parts in `dress`. */
import * as THREE from 'three';
import type { Layer } from '../shared/types.js';

export type BuildingStyle = 'shop' | 'apartment' | 'library' | 'office' | 'workshop';

/** Which style a kind of app (its flow template) gets, and the name people see for it. */
export const STYLE_OF: Record<string, BuildingStyle> = { commerce: 'shop', social: 'apartment', content: 'library', saas: 'office', general: 'workshop' };
export const STYLE_NAME: Record<BuildingStyle, string> = {
  shop: 'Market street', apartment: 'Apartment blocks', library: 'Library row', office: 'Glass offices', workshop: 'Workshops',
};

/** The style of a town: the one the agent chose after reading the code, else the one that goes with the kind of app. */
export function styleFor(flow: { template: { id: string }; style?: string | null } | undefined): BuildingStyle {
  if (flow?.style && flow.style in STYLE_NAME) return flow.style as BuildingStyle;
  return STYLE_OF[flow?.template.id ?? 'general'] ?? 'workshop';
}

const GLASS = '#16223f';
const LIT = '#ffe2a0';
const BAYS = 4; // window bays drawn in one texture, so lit and dark windows do not repeat too evenly

function shade(color: THREE.Color, by: number): string {
  return `#${color.clone().offsetHSL(0, 0, by).getHexString()}`;
}

/** Draws one window bay of one floor, in a w by h box at x. The wall colour is already painted. */
function drawBay(g: CanvasRenderingContext2D, style: BuildingStyle, x: number, w: number, h: number, wall: THREE.Color, lit: boolean): void {
  const glass = lit ? LIT : GLASS;
  g.fillStyle = glass;
  if (style === 'shop') {
    // one wide shop window with a frame and a sill
    g.fillRect(x + w * 0.12, h * 0.2, w * 0.76, h * 0.56);
    g.fillStyle = shade(wall, -0.18);
    g.fillRect(x + w * 0.06, h * 0.78, w * 0.88, h * 0.08);
    g.fillRect(x + w * 0.49, h * 0.2, w * 0.03, h * 0.56);
  } else if (style === 'apartment') {
    // a window beside a balcony door, with a balcony slab under both
    g.fillRect(x + w * 0.1, h * 0.22, w * 0.3, h * 0.4);
    g.fillRect(x + w * 0.52, h * 0.16, w * 0.3, h * 0.62);
    g.fillStyle = shade(wall, 0.2);
    g.fillRect(x + w * 0.44, h * 0.8, w * 0.48, h * 0.09);
    g.fillStyle = shade(wall, -0.22);
    for (let k = 0; k < 4; k++) g.fillRect(x + w * (0.46 + k * 0.14), h * 0.6, w * 0.025, h * 0.2);
  } else if (style === 'library') {
    // a tall arched window between stone bands
    g.beginPath();
    g.moveTo(x + w * 0.3, h * 0.84);
    g.lineTo(x + w * 0.3, h * 0.4);
    g.arc(x + w * 0.5, h * 0.4, w * 0.2, Math.PI, 0);
    g.lineTo(x + w * 0.7, h * 0.84);
    g.closePath();
    g.fill();
    g.fillStyle = shade(wall, 0.16);
    g.fillRect(x, 0, w, h * 0.07);
    g.fillRect(x + w * 0.02, h * 0.07, w * 0.1, h * 0.93);
  } else if (style === 'office') {
    // glass from edge to edge, cut by thin mullions and a floor band
    g.fillStyle = lit ? '#bfe9ff' : '#1d3f66';
    g.fillRect(x, h * 0.12, w, h * 0.76);
    g.fillStyle = shade(wall, 0.05);
    g.fillRect(x, h * 0.12, w * 0.06, h * 0.76);
    g.fillRect(x + w * 0.5, h * 0.12, w * 0.03, h * 0.76);
  } else {
    // brick courses and a small high window
    g.fillStyle = shade(wall, -0.12);
    for (let r = 0; r < 4; r++) g.fillRect(x, h * (0.02 + r * 0.25), w, h * 0.03);
    g.fillStyle = glass;
    g.fillRect(x + w * 0.28, h * 0.2, w * 0.44, h * 0.3);
    g.fillStyle = shade(wall, -0.25);
    g.fillRect(x + w * 0.49, h * 0.2, w * 0.03, h * 0.3);
    g.fillRect(x + w * 0.28, h * 0.34, w * 0.44, h * 0.03);
  }
}

/** A wall with no windows painted on it: only the style's own surface (brick courses, stone bands, panels). */
function drawWall(g: CanvasRenderingContext2D, style: BuildingStyle, x: number, w: number, h: number, wall: THREE.Color): void {
  if (style === 'workshop') {
    g.fillStyle = shade(wall, -0.12);
    for (let r = 0; r < 4; r++) g.fillRect(x, h * (0.02 + r * 0.25), w, h * 0.03);
    g.fillRect(x + w * 0.5, h * 0.05, w * 0.03, h * 0.22);
    g.fillRect(x, h * 0.55, w * 0.03, h * 0.22);
  } else if (style === 'library') {
    g.fillStyle = shade(wall, 0.16);
    g.fillRect(x, 0, w, h * 0.08);
    g.fillRect(x + w * 0.02, h * 0.08, w * 0.1, h * 0.92);
  } else if (style === 'office') {
    g.fillStyle = shade(wall, 0.12);
    g.fillRect(x, h * 0.9, w, h * 0.1);
    g.fillStyle = shade(wall, -0.1);
    g.fillRect(x, 0, w * 0.04, h);
  } else if (style === 'apartment') {
    g.fillStyle = shade(wall, 0.14);
    g.fillRect(x, h * 0.88, w, h * 0.12);
  } else {
    g.fillStyle = shade(wall, -0.16);
    g.fillRect(x, h * 0.9, w, h * 0.1);
  }
}

const walls = new Map<string, THREE.CanvasTexture>();

/** The wall of one floor: the layer's colour with this style's windows, some of them lit. */
function wallTexture(style: BuildingStyle, color: THREE.Color, bays: number, plain = false): THREE.CanvasTexture {
  const key = `${style}:${color.getHexString()}:${bays}:${plain}`;
  let tex = walls.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = 64 * BAYS;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${color.getHexString()}`;
  g.fillRect(0, 0, c.width, c.height);
  let seed = [...key].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
  for (let i = 0; i < BAYS; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    if (plain) drawWall(g, style, i * 64, 64, 64, color);
    else drawBay(g, style, i * 64, 64, 64, color, seed % 100 < 38);
  }
  tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(bays / BAYS, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  walls.set(key, tex);
  return tex;
}

/** The six materials of one floor: windowed walls on the four sides, a plain slab above and below. */
export function floorMaterials(style: BuildingStyle, color: THREE.Color, width: number, plain = false): THREE.MeshStandardMaterial[] {
  const bays = Math.max(2, Math.round(width / 0.85));
  const side = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map: wallTexture(style, color, bays, plain), roughness: style === 'office' ? 0.35 : 0.85, metalness: style === 'office' ? 0.25 : 0, emissive: '#000000' });
  const slab = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: shade(color, -0.2), roughness: 0.9, emissive: '#000000' });
  return [side(), side(), slab(), slab(), side(), side()];
}

const solid = (color: string, rough = 0.9): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough });
const box = (w: number, h: number, d: number, color: string): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), solid(color));

function stripes(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect(i * 8, 0, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A roof with two slopes and a ridge along x, as wide as w and as deep as d. */
function gable(w: number, d: number, rise: number, color: string): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(0, rise);
  shape.lineTo(d / 2, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, solid(color));
}

/** One tooth of a factory roof: a steep glass face and a long sloped back. */
function tooth(w: number, d: number, rise: number): THREE.Group {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, rise);
  shape.lineTo(d, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(-d / 2, 0, -w / 2);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, solid('#59607a')));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, rise * 0.7), new THREE.MeshStandardMaterial({ color: '#9fdcff', emissive: '#2a5b78', roughness: 0.3, side: THREE.DoubleSide }));
  pane.rotation.y = -Math.PI / 2;
  pane.position.set(-d / 2 - 0.01, rise * 0.5, 0);
  g.add(pane);
  g.rotation.y = Math.PI / 2;
  return g;
}

export interface Dressing {
  /** Parts that stand on the ground: door, awning, columns, steps. */
  base: THREE.Group;
  /** Parts that sit on the top floor. The town moves this group up when a floor is added. */
  roof: THREE.Group;
}

/** Everything around the floors that makes a building of this style: what is at street level and what is on the roof.
 * The front of a building faces +z. The layer changes small things, so the three buildings of a feature are siblings, not copies. */
export function dress(style: BuildingStyle, width: number, layer: Layer, wall: THREE.Color, withDoor = true): Dressing {
  const base = new THREE.Group();
  const roof = new THREE.Group();
  const w = width;
  const front = w / 2;
  const trim = shade(wall, -0.3);
  const front1 = layer === 'frontend' || layer === 'database';

  const door = (dw: number, dh: number, color = '#1b1410'): void => {
    if (!withDoor) return;
    const d = box(dw, dh, 0.06, color);
    d.position.set(0, dh / 2, front + 0.02);
    base.add(d);
  };

  if (style === 'shop') {
    door(0.5, 0.62);
    // striped awning over the shop front, and a sign board on the roof edge
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.05, 0.7), new THREE.MeshStandardMaterial({ map: stripes('#ffffff', front1 ? '#e84a5f' : '#2f6fd6'), roughness: 0.8 }));
    awning.position.set(0, 0.86, front + 0.3);
    awning.rotation.x = 0.32;
    base.add(awning);
    const parapet = box(w + 0.16, 0.16, w + 0.16, trim);
    parapet.position.y = 0.08;
    roof.add(parapet);
    const sign = box(w * 0.72, 0.42, 0.08, front1 ? '#ffd23f' : '#f2f4ff');
    sign.position.set(0, 0.42, front - 0.02);
    roof.add(sign);
    if (layer === 'backend') {
      // stock room: an air unit on the roof
      const unit = box(0.6, 0.3, 0.5, '#aab2c8');
      unit.position.set(-w * 0.2, 0.31, -w * 0.15);
      roof.add(unit);
    }
  } else if (style === 'apartment') {
    door(0.46, 0.66, '#3b2a1c');
    const canopy = box(0.9, 0.06, 0.42, trim);
    canopy.position.set(0, 0.74, front + 0.2);
    base.add(canopy);
    const slab = box(w + 0.1, 0.1, w + 0.1, trim);
    slab.position.y = 0.05;
    roof.add(slab);
    // roof life: a water tank on legs and the stair house
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 14), solid('#7d8aa8', 0.6));
    tank.position.set(w * 0.22, 0.62, -w * 0.2);
    roof.add(tank);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const leg = box(0.05, 0.3, 0.05, '#4d566e');
      leg.position.set(w * 0.22 + x * 0.22, 0.25, -w * 0.2 + z * 0.22);
      roof.add(leg);
    }
    const stair = box(0.7, 0.5, 0.7, shade(wall, -0.1));
    stair.position.set(-w * 0.22, 0.35, w * 0.12);
    roof.add(stair);
    if (layer === 'tests') {
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), solid('#dfe5f5', 0.5));
      dish.rotation.x = Math.PI * 0.8;
      dish.position.set(-w * 0.22, 0.82, w * 0.12);
      roof.add(dish);
    }
  } else if (style === 'library') {
    // stone steps and a row of columns carrying a porch, under a pitched roof
    const steps = box(w * 0.9, 0.12, 0.7, '#cfd3e2');
    steps.position.set(0, 0.06, front + 0.35);
    base.add(steps);
    const n = front1 ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.86, 10), solid('#eef0f8', 0.7));
      col.position.set((k / (n - 1) - 0.5) * w * 0.74, 0.55, front + 0.5);
      base.add(col);
    }
    const porch = box(w * 0.92, 0.1, 0.72, '#dfe2ee');
    porch.position.set(0, 1.03, front + 0.34);
    base.add(porch);
    door(0.44, 0.72, '#4a2f1a');
    const eave = box(w + 0.3, 0.1, w + 0.3, '#dfe2ee');
    eave.position.y = 0.05;
    roof.add(eave);
    const top = gable(w + 0.3, w + 0.3, w * 0.42, '#7a3b34');
    top.position.y = 0.1;
    roof.add(top);
    if (layer === 'backend') {
      const chimney = box(0.3, 0.9, 0.3, '#8a4a40');
      chimney.position.set(w * 0.28, 0.55, -w * 0.2);
      roof.add(chimney);
    }
  } else if (style === 'office') {
    // a glass lobby, corner fins the full height are added by the town; a set-back crown and a mast on top
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.6, 0.1), new THREE.MeshStandardMaterial({ color: '#bfe9ff', emissive: '#24506e', roughness: 0.2, metalness: 0.4 }));
    lobby.position.set(0, 0.3, front + 0.03);
    base.add(lobby);
    const canopy = box(w * 0.8, 0.05, 0.5, '#e7ecf7');
    canopy.position.set(0, 0.66, front + 0.25);
    base.add(canopy);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.66, 0.55, w * 0.66), new THREE.MeshStandardMaterial({ color: '#27496f', roughness: 0.3, metalness: 0.4 }));
    crown.position.y = 0.275;
    roof.add(crown);
    const cap = box(w * 0.74, 0.06, w * 0.74, '#e7ecf7');
    cap.position.y = 0.58;
    roof.add(cap);
    if (layer !== 'tests') {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.2, 6), solid('#dfe5f5', 0.5));
      mast.position.set(layer === 'backend' ? w * 0.18 : 0, 1.2, 0);
      roof.add(mast);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
      lamp.position.set(mast.position.x, 1.82, 0);
      roof.add(lamp);
    } else {
      // helipad
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.26, w * 0.26, 0.03, 20), solid('#3d4763'));
      pad.position.y = 0.63;
      roof.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.2, 0.025, 6, 24), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.66;
      roof.add(ring);
    }
  } else {
    // a roller door, a saw-tooth roof with glass faces, and a chimney
    if (withDoor) {
      const roller = box(w * 0.46, 0.7, 0.06, '#3a4157');
      roller.position.set(0, 0.35, front + 0.02);
      base.add(roller);
      for (let k = 1; k < 5; k++) {
        const rib = box(w * 0.46, 0.02, 0.07, '#5a637d');
        rib.position.set(0, k * 0.14, front + 0.03);
        base.add(rib);
      }
    } else {
      const lamp = box(0.9, 0.06, 0.3, '#5a637d');
      lamp.position.set(0, 0.84, front + 0.15);
      base.add(lamp);
    }
    const teeth = 3;
    for (let k = 0; k < teeth; k++) {
      const t = tooth(w, w / teeth, 0.5);
      t.position.set(0, 0, (k - (teeth - 1) / 2) * (w / teeth));
      roof.add(t);
    }
    if (layer !== 'frontend') {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 1.5, 10), solid(layer === 'tests' ? '#cfd3e2' : '#8a4a40'));
      stack.position.set(w * 0.3, 0.75, -w * 0.3);
      roof.add(stack);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), solid('#2a2f40'));
      rim.position.set(w * 0.3, 1.5, -w * 0.3);
      roof.add(rim);
    }
  }
  return { base, roof };
}

/** One piece of roof for a house, covering a strip `depth` deep. The shape follows the style: a pitched slice,
 * a factory tooth, or a flat slab. Each test file is one piece. */
export function roofPiece(style: BuildingStyle, width: number, depth: number, color: string): THREE.Mesh {
  const mat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: '#000000' });
  if (style === 'library') {
    // a slice of a pitched roof: the triangle faces the street, the slice runs back
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2 - 0.15, 0);
    shape.lineTo(0, width * 0.36);
    shape.lineTo(width / 2 + 0.15, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: depth * 0.94, bevelEnabled: false });
    geo.translate(0, 0, -depth * 0.47);
    return new THREE.Mesh(geo, mat());
  }
  if (style === 'workshop') {
    const shape = new THREE.Shape();
    shape.moveTo(-depth * 0.47, 0);
    shape.lineTo(-depth * 0.47, 0.55);
    shape.lineTo(depth * 0.47, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(-Math.PI / 2);
    return new THREE.Mesh(geo, mat());
  }
  const lift = style === 'office' ? 0.34 : style === 'apartment' ? 0.2 : 0.26;
  const geo = new THREE.BoxGeometry(width + 0.2, lift, depth * 0.94);
  geo.translate(0, lift / 2, 0);
  return new THREE.Mesh(geo, mat());
}

/** Street-level trim for a house, kept clear of the door and windows because those are files a person must be able to
 * see and pick. It sits above the ground storey (which is `fh` tall) or at the corners. Plain structure, not files. */
export function houseTrim(style: BuildingStyle, w: number, d: number, fh: number): THREE.Group {
  const g = new THREE.Group();
  const front = d / 2;
  if (style === 'shop') {
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.05, 0.5), new THREE.MeshStandardMaterial({ map: stripes('#ffffff', '#e84a5f'), roughness: 0.8 }));
    awning.position.set(0, fh + 0.06, front + 0.24);
    awning.rotation.x = 0.2;
    g.add(awning);
  } else if (style === 'library') {
    for (const x of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, fh, 10), solid('#eef0f8', 0.7));
      col.position.set(x * (w / 2 - 0.12), fh / 2, front + 0.4);
      g.add(col);
    }
    const porch = box(w + 0.1, 0.1, 0.6, '#dfe2ee');
    porch.position.set(0, fh + 0.05, front + 0.3);
    g.add(porch);
  } else if (style === 'office') {
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: '#bfe9ff', roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.75 }));
    canopy.position.set(0, fh + 0.03, front + 0.3);
    g.add(canopy);
    for (const x of [-1, 1]) {
      const fin = box(0.08, fh * 2, 0.08, '#e7ecf7');
      fin.position.set(x * (w / 2 + 0.04), fh, front + 0.04);
      g.add(fin);
    }
  } else if (style === 'apartment') {
    const balcony = box(w * 0.9, 0.08, 0.36, '#dfe2ee');
    balcony.position.set(0, fh + 0.04, front + 0.18);
    g.add(balcony);
    const rail = box(w * 0.9, 0.22, 0.03, '#aab2c8');
    rail.position.set(0, fh + 0.19, front + 0.35);
    g.add(rail);
  } else {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, fh * 1.6, 10), solid('#8a4a40'));
    stack.position.set(w / 2 + 0.3, fh * 0.8, -d * 0.2);
    g.add(stack);
  }
  // the path from the street to the door: this is the way in
  const path = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.25), new THREE.MeshStandardMaterial({ color: '#cfd3e2', roughness: 1 }));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.012, front + 0.66);
  g.add(path);
  return g;
}
