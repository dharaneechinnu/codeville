// Shared drawing for the Codeville promo videos: voxel boxes, the block town, the shopper,
// pixel UI and kinetic text. Every function draws from a time `t` in seconds, so any frame
// can be rendered on its own (render.mjs renders frames out of order in parallel).
(function (global) {
  'use strict';

  const W = 1920, H = 1080;
  const PAL = {
    blue: '#4285F4', red: '#EA4335', yellow: '#FBBC05', green: '#34A853',
    purple: '#9B6BFF', orange: '#FF8A3D', cyan: '#5CF2FF', pink: '#FF8A98',
    ink: '#0B1020', night: '#06101A', panel: '#151A33', panel2: '#1A2040', line: '#39427A',
    white: '#FFFFFF', grass: '#5DBB3F', dirt: '#8B5A2B', wood: '#6B4423', leaf: '#3E9B35', stone: '#8E96A3',
  };
  const RAINBOW = [PAL.blue, PAL.red, PAL.yellow, PAL.green];
  const LAYER = { fe: PAL.blue, be: PAL.green, test: PAL.yellow, db: PAL.purple, svc: PAL.orange };

  // ---------- math ----------
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const ease = {
    outCubic: (x) => 1 - (1 - x) ** 3,
    inCubic: (x) => x ** 3,
    inOut: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; },
    outBounce: (x) => {
      const n = 7.5625, d = 2.75;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
      if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
      return n * (x -= 2.625 / d) * x + 0.984375;
    },
  };
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // In for [a, a+fi], hold, out for [b-fo, b].
  const window_ = (t, a, b, fi = 0.3, fo = 0.3) => Math.min(prog(t, a, a + fi), 1 - prog(t, b - fo, b));

  // ---------- color ----------
  const rgbCache = {};
  function rgb(hex) {
    let c = rgbCache[hex];
    if (!c) { const n = parseInt(hex.slice(1), 16); c = rgbCache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    return c;
  }
  function shade(hex, f, a) {
    const [r, g, b] = rgb(hex);
    const c = (v) => Math.round(clamp(v * f, 0, 255));
    return a == null ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${a})`;
  }
  function mix(h1, h2, t) {
    const a = rgb(h1), b = rgb(h2);
    return '#' + a.map((v, i) => Math.round(lerp(v, b[i], t)).toString(16).padStart(2, '0')).join('');
  }

  // ---------- orthographic voxel camera ----------
  // yaw turns the world around the vertical axis, pitch tilts it toward the viewer.
  function view(o) {
    const pitch = o.pitch ?? 0.62, yaw = o.yaw ?? 0.75;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const s = o.scale, ox = o.cx ?? W / 2, oy = o.cy ?? H / 2, fx = o.fx || 0, fy = o.fy || 0;
    return {
      cp, sp, cy, sy, s,
      p(x, y, z) { x -= fx; y -= fy; return [ox + (x * cy - y * sy) * s, oy + ((x * sy + y * cy) * sp - z * cp) * s]; },
      depth(x, y, z) { x -= fx; y -= fy; return (x * sy + y * cy) * cp + z * sp; },
    };
  }

  function quad(ctx, A, B, C, D) {
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath();
  }
  const at = (A, B, D, u, v) => [A[0] + (B[0] - A[0]) * u + (D[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (D[1] - A[1]) * v];

  // One textured voxel box. Faces are A,B (top edge), C,D (bottom edge) so u runs A->B and v runs A->D.
  function box(ctx, v, x, y, z, w, d, h, col, o = {}) {
    const P = v.p;
    const faces = [[P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h), 1, 0]];
    if (v.sy > 0) faces.push([P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z), 0.72, 1]);
    if (v.sy < 0) faces.push([P(x, y + d, z + h), P(x, y, z + h), P(x, y, z), P(x, y + d, z), 0.72, 2]);
    if (v.cy > 0) faces.push([P(x + w, y + d, z + h), P(x, y + d, z + h), P(x, y + d, z), P(x + w, y + d, z), 0.86, 3]);
    if (v.cy < 0) faces.push([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y, z), P(x, y, z), 0.86, 4]);
    const alpha = o.alpha ?? 1;
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    for (const [A, B, C, D, br, id] of faces) {
      if (o.holo) {
        quad(ctx, A, B, C, D);
        ctx.fillStyle = shade(o.holoCol || PAL.cyan, 1, 0.06 + 0.05 * br); ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = shade(o.holoCol || PAL.cyan, 1, 0.16); ctx.stroke();
        ctx.lineWidth = 1.4; ctx.strokeStyle = shade(o.holoCol || PAL.cyan, 1.25, 0.9); ctx.stroke();
        continue;
      }
      const base = id === 0 && o.top ? o.top : col;
      quad(ctx, A, B, C, D); ctx.fillStyle = shade(base, br * (o.bright || 1)); ctx.fill();
      const n = o.tex === false ? 0 : o.tex || 4, seed = (o.seed || 0) * 7.13 + id * 3.1;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const r = hash(seed + i * 1.37 + j * 9.11) - 0.5;
        if (Math.abs(r) < 0.17) continue;
        ctx.fillStyle = r > 0 ? `rgba(255,255,255,${r * 0.28})` : `rgba(0,0,0,${-r * 0.32})`;
        quad(ctx, at(A, B, D, i / n, j / n), at(A, B, D, (i + 1) / n, j / n), at(A, B, D, (i + 1) / n, (j + 1) / n), at(A, B, D, i / n, (j + 1) / n));
        ctx.fill();
      }
      if (o.top && id !== 0) { // grass hanging over a dirt side
        ctx.fillStyle = shade(o.top, br);
        for (let i = 0; i < n; i++) {
          const vv = 0.18 + (hash(seed + i * 4.7) > 0.5 ? 0.12 : 0);
          quad(ctx, at(A, B, D, i / n, 0), at(A, B, D, (i + 1) / n, 0), at(A, B, D, (i + 1) / n, Math.min(vv, h ? vv / h : vv)), at(A, B, D, i / n, Math.min(vv, h ? vv / h : vv)));
          ctx.fill();
        }
      }
      if (o.edge !== false) {
        quad(ctx, A, B, C, D); ctx.lineWidth = o.lw || 1.4; ctx.strokeStyle = shade(base, br * 0.55); ctx.stroke();
      }
      if (o.glow && id === 0) {
        quad(ctx, A, B, C, D); ctx.lineWidth = 4; ctx.strokeStyle = `rgba(255,255,255,${o.glow})`; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Draw a list of {x,y,z,w,d,h,col,o} boxes (or {draw(ctx,v), x,y,z} items) back to front.
  function scene(ctx, v, items) {
    for (const it of items) it._d = v.depth(it.x + (it.w || 0) / 2, it.y + (it.d || 0) / 2, it.z + (it.h || 0) / 2);
    items.sort((a, b) => a._d - b._d);
    for (const it of items) {
      if (it.draw) it.draw(ctx, v);
      else box(ctx, v, it.x, it.y, it.z, it.w, it.d, it.h, it.col, it.o || {});
    }
  }

  // Grass ground slab with a tile grid on top.
  function ground(ctx, v, x0, y0, nx, ny, o = {}) {
    if (o.holo) {
      ctx.strokeStyle = 'rgba(92,242,255,0.18)'; ctx.lineWidth = 1;
      for (let i = 0; i <= nx; i++) { const a = v.p(x0 + i, y0, 0), b = v.p(x0 + i, y0 + ny, 0); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
      for (let j = 0; j <= ny; j++) { const a = v.p(x0, y0 + j, 0), b = v.p(x0 + nx, y0 + j, 0); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
      return;
    }
    box(ctx, v, x0, y0, -0.8, nx, ny, 0.8, PAL.dirt, { top: o.top || PAL.grass, tex: 8, seed: 3, edge: true });
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const r = hash(i * 13.7 + j * 71.3);
      quad(ctx, v.p(x0 + i, y0 + j, 0), v.p(x0 + i + 1, y0 + j, 0), v.p(x0 + i + 1, y0 + j + 1, 0), v.p(x0 + i, y0 + j + 1, 0));
      ctx.fillStyle = shade(o.top || PAL.grass, 0.9 + r * 0.18); ctx.fill();
      if (r > 0.55) {
        const u = hash(r * 99) * 0.7, w = hash(r * 77) * 0.7;
        quad(ctx, v.p(x0 + i + u, y0 + j + w, 0), v.p(x0 + i + u + 0.25, y0 + j + w, 0), v.p(x0 + i + u + 0.25, y0 + j + w + 0.25, 0), v.p(x0 + i + u, y0 + j + w + 0.25, 0));
        ctx.fillStyle = shade(o.top || PAL.grass, 1.18); ctx.fill();
      }
    }
  }

  // ---------- the block town ----------
  // features: [{name, at:[gx,gy], fe, be, test}]; each layer is a 2x2 building with one block per file.
  function makeTown(spec) {
    const town = { blocks: [], buildings: [], trees: [], links: [], labels: [] };
    function building(name, feature, layer, gx, gy, n, fw = 2, fd = 2) {
      const b = { id: town.buildings.length, name, feature, layer, x: gx, y: gy, w: fw, d: fd, n, h: Math.ceil(n / (fw * fd)) };
      town.buildings.push(b);
      for (let k = 0; k < n; k++) {
        const z = Math.floor(k / (fw * fd)), r = k % (fw * fd);
        town.blocks.push({ id: town.blocks.length, b: b.id, k, x: gx + (r % fw), y: gy + Math.floor(r / fw), z, col: LAYER[layer], born: 0, feature });
      }
      return b;
    }
    for (const f of spec.features) {
      const [gx, gy] = f.at;
      if (f.fe) building(f.name + '/ui', f.name, 'fe', gx, gy, f.fe);
      if (f.be) building(f.name + '/api', f.name, 'be', gx + 3, gy, f.be);
      if (f.test) building(f.name + '/tests', f.name, 'test', gx, gy + 3, f.test);
      town.labels.push({ text: f.name, x: gx + 2.5, y: gy + 1, feature: f.name });
    }
    if (spec.db) { building('database', 'db', 'db', spec.db.at[0], spec.db.at[1], spec.db.n, 3, 3); town.labels.push({ text: 'database', x: spec.db.at[0] + 1.5, y: spec.db.at[1] + 1.5, feature: 'db' }); }
    for (const s of spec.svc || []) { building(s.name, s.name, 'svc', s.at[0], s.at[1], 1, 1, 1); town.labels.push({ text: s.name, x: s.at[0] + 0.5, y: s.at[1] + 0.5, feature: s.name, small: true }); }
    for (const [x, y] of spec.trees || []) town.trees.push({ x, y, born: 0, seed: x * 3 + y });
    for (const [a, b] of spec.links || []) town.links.push({ a: town.buildings.find((q) => q.name === a), b: town.buildings.find((q) => q.name === b) });
    return town;
  }
  const bByName = (town, name) => town.buildings.find((b) => b.name === name);

  function treeItems(tr, a, o) {
    const s = a, items = [];
    const x = tr.x, y = tr.y, h = 1.6 * s;
    items.push({ x: x + 0.35, y: y + 0.35, z: 0, w: 0.3, d: 0.3, h, col: PAL.wood, o: { tex: 2, seed: tr.seed, holo: o.holo } });
    items.push({ x: x - 0.2 * s + 0.0, y: y - 0.2 * s, z: h - 0.2, w: 1 + 0.4 * s, d: 1 + 0.4 * s, h: 1.1 * s, col: PAL.leaf, o: { tex: 5, seed: tr.seed + 1, holo: o.holo } });
    items.push({ x: x + 0.15, y: y + 0.15, z: h + 0.9 * s, w: 0.7, d: 0.7, h: 0.5 * s, col: PAL.leaf, o: { tex: 3, seed: tr.seed + 2, holo: o.holo } });
    return items;
  }

  // o: {holo, hl (building id), fail (block id), failT, extra: items[], fade(block) -> alpha}
  function townItems(town, t, o = {}) {
    const items = [];
    for (const bl of town.blocks) {
      if (t < bl.born) continue;
      const a = prog(t, bl.born, bl.born + 0.55);
      const zOff = (1 - ease.outBounce(a)) * 7;
      const isFail = o.fail === bl.id;
      let col = bl.col, glow = 0, bright = 1;
      if (o.hl != null && o.hl === bl.b) { bright = 1.18; glow = 0.55 + 0.35 * Math.sin(t * 8); }
      if (isFail) { col = PAL.red; glow = 0.5 + 0.5 * Math.sin(t * 14); }
      if (o.hlBlock === bl.id) { col = mix(bl.col, '#ffffff', 0.35); glow = 0.9; }
      const alpha = o.dim && o.dim(bl) ? 0.25 : 1;
      items.push({ x: bl.x + 0.03, y: bl.y + 0.03, z: bl.z + zOff, w: 0.94, d: 0.94, h: 0.94, col, o: { seed: bl.id, glow, bright, holo: o.holo, alpha, holoCol: isFail ? PAL.red : undefined } });
    }
    for (const tr of town.trees) {
      if (t < tr.born) continue;
      items.push(...treeItems(tr, ease.outBack(prog(t, tr.born, tr.born + 0.5)), o));
    }
    if (o.extra) items.push(...o.extra);
    return items;
  }

  function buildingTop(town, b, t) {
    let n = 0;
    for (const bl of town.blocks) if (bl.b === b.id && t >= bl.born) n++;
    return Math.ceil(n / (b.w * b.d));
  }

  function drawLinks(ctx, v, town, t, o = {}) {
    town.links.forEach((L, i) => {
      const a = o.alpha ? o.alpha(L) : 1;
      if (a <= 0.01 || !L.a || !L.b) return;
      const ha = buildingTop(town, L.a, t), hb = buildingTop(town, L.b, t);
      if (!ha || !hb) return;
      const ca = [L.a.x + L.a.w / 2, L.a.y + L.a.d / 2, ha + 0.1], cb = [L.b.x + L.b.w / 2, L.b.y + L.b.d / 2, hb + 0.1];
      const pt = (u) => v.p(lerp(ca[0], cb[0], u), lerp(ca[1], cb[1], u), lerp(ca[2], cb[2], u) + Math.sin(Math.PI * u) * 2.2);
      const col = o.holo ? PAL.cyan : LAYER[L.a.layer];
      ctx.globalAlpha = a;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) { const p = pt(k / 24); k ? ctx.lineTo(...p) : ctx.moveTo(...p); }
      ctx.lineWidth = 7; ctx.strokeStyle = shade(col, 1, 0.18); ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = shade(col, 1.2, 0.85); ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 40; ctx.stroke(); ctx.setLineDash([]);
      for (let k = 0; k < 3; k++) {
        const u = (t * 0.45 + k / 3 + hash(i)) % 1, p = pt(u), s = 7 + 3 * Math.sin(Math.PI * u);
        ctx.fillStyle = shade(col, 1.3); ctx.fillRect(p[0] - s, p[1] - s, s * 2, s * 2);
        ctx.fillStyle = '#fff'; ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    });
  }

  function drawLabels(ctx, v, town, t, o = {}) {
    for (const L of town.labels) {
      const bs = town.buildings.filter((b) => b.feature === L.feature);
      const h = Math.max(0, ...bs.map((b) => buildingTop(town, b, t)));
      if (!h) continue;
      const a = o.alpha ? o.alpha(L) : 1;
      if (a <= 0) continue;
      const [sx, sy] = v.p(L.x, L.y, h + (L.small ? 1.4 : 2.4));
      ctx.globalAlpha = a;
      tag(ctx, L.text, sx, sy, { size: L.small ? 13 : 16, col: o.holo ? PAL.cyan : '#fff', bg: o.holo ? 'rgba(6,16,26,0.7)' : 'rgba(11,16,32,0.82)' });
      ctx.globalAlpha = 1;
    }
  }

  function drawTown(ctx, v, town, t, o = {}) {
    if (o.ground) ground(ctx, v, o.ground[0], o.ground[1], o.ground[2], o.ground[3], { holo: o.holo });
    scene(ctx, v, townItems(town, t, o));
    if (o.links !== false) drawLinks(ctx, v, town, t, { holo: o.holo, alpha: o.linkAlpha });
    if (o.labels !== false) drawLabels(ctx, v, town, t, { holo: o.holo, alpha: o.labelAlpha });
  }

  // ---------- the shopper (a little voxel person carrying a basket) ----------
  function shopper(x, y, dir, phase, o = {}) {
    const [dx, dy] = dir, px = -dy, py = dx, sw = Math.sin(phase) * (o.walking ? 1 : 0);
    const items = [];
    const add = (cx, cy, z, w, d, h, col, seed) => {
      const ww = Math.abs(dx) > 0 ? w : d, dd = Math.abs(dx) > 0 ? d : w; // footprint follows direction
      items.push({ x: cx - ww / 2, y: cy - dd / 2, z, w: ww, d: dd, h, col, o: { tex: 2, seed, lw: 1, holo: o.holo } });
    };
    const k = o.scale || 1;
    const S = (v) => v * k;
    add(x + px * S(0.09) + dx * sw * S(0.12), y + py * S(0.09) + dy * sw * S(0.12), 0, S(0.16), S(0.15), S(0.5), '#3A4170', 1);
    add(x - px * S(0.09) - dx * sw * S(0.12), y - py * S(0.09) - dy * sw * S(0.12), 0, S(0.16), S(0.15), S(0.5), '#3A4170', 2);
    add(x, y, S(0.5), S(0.2), S(0.38), S(0.6), o.shirt || PAL.cyan, 3);
    add(x + px * S(0.25) - dx * sw * S(0.1), y + py * S(0.25) - dy * sw * S(0.1), S(0.55), S(0.13), S(0.12), S(0.5), mix(o.shirt || PAL.cyan, '#000000', 0.2), 4);
    add(x - px * S(0.25) + dx * sw * S(0.1), y - py * S(0.25) + dy * sw * S(0.1), S(0.55), S(0.13), S(0.12), S(0.5), mix(o.shirt || PAL.cyan, '#000000', 0.2), 5);
    add(x, y, S(1.1), S(0.36), S(0.36), S(0.36), '#F1C27D', 6);
    add(x, y, S(1.42), S(0.38), S(0.38), S(0.08), '#4A2E1A', 7);
    add(x + dx * S(0.19), y + dy * S(0.19), S(1.24), S(0.02), S(0.26), S(0.07), '#1b1b2a', 8);
    add(x + dx * S(0.3) - px * S(0.3), y + dy * S(0.3) - py * S(0.3), S(0.6), S(0.26), S(0.26), S(0.18), '#C98B3A', 9);
    return items;
  }

  // ---------- 2D helpers ----------
  const FONTS = { pixel: '"Press Start 2P"', silk: 'Silkscreen', sans: '"Space Grotesk"', mono: '"DejaVu Sans Mono", "Liberation Mono", monospace' };
  function font(size, fam = 'sans') { return `${fam === 'pixel' ? '' : '700 '}${size}px ${FONTS[fam]}`; }

  function text(ctx, s, x, y, o = {}) {
    ctx.font = font(o.size || 32, o.fam || 'sans');
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.shadow) { ctx.fillStyle = o.shadow; const d = o.sd || Math.max(2, (o.size || 32) * 0.08); ctx.fillText(s, x + d, y + d); }
    ctx.fillStyle = o.col || '#fff'; ctx.fillText(s, x, y);
    ctx.globalAlpha = 1;
    return ctx.measureText(s).width;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Minecraft-style UI panel: chamfered corners and a bevel.
  function panel(ctx, x, y, w, h, o = {}) {
    const c = o.c ?? 8;
    const path = () => {
      ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c);
      ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath();
    };
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.drop !== false) { ctx.save(); ctx.translate(0, 10); path(); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill(); ctx.restore(); }
    path(); ctx.fillStyle = o.fill || PAL.panel; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = o.border || '#05060d'; ctx.stroke();
    const b = 4;
    ctx.fillStyle = o.hi || 'rgba(255,255,255,0.10)'; ctx.fillRect(x + c, y + b, w - 2 * c, b); ctx.fillRect(x + b, y + c, b, h - 2 * c);
    ctx.fillStyle = o.lo || 'rgba(0,0,0,0.30)'; ctx.fillRect(x + c, y + h - 2 * b, w - 2 * c, b); ctx.fillRect(x + w - 2 * b, y + c, b, h - 2 * c);
    ctx.globalAlpha = 1;
  }

  function button(ctx, label, x, y, w, h, o = {}) {
    const col = o.col || PAL.green, press = o.press || 0;
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.scale(o.scale || 1, o.scale || 1); ctx.translate(-w / 2, -h / 2 + press * 4);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    ctx.fillStyle = shade(col, 0.55); ctx.fillRect(0, 6 - press * 4, w, h);
    ctx.fillStyle = col; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, 0, w, 5);
    ctx.lineWidth = 4; ctx.strokeStyle = '#05060d'; ctx.strokeRect(0, 0, w, h + 6 - press * 4);
    text(ctx, label, w / 2, h / 2 + 2, { size: o.size || 22, fam: o.fam || 'pixel', align: 'center', base: 'middle', col: o.textCol || '#fff', shadow: 'rgba(0,0,0,0.35)', sd: 3 });
    ctx.restore();
  }

  function tag(ctx, s, x, y, o = {}) {
    ctx.font = font(o.size || 16, 'pixel');
    const w = ctx.measureText(s).width + 20, h = (o.size || 16) + 16;
    ctx.fillStyle = o.bg || 'rgba(11,16,32,0.85)'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = o.col || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y + 1);
    ctx.beginPath(); ctx.moveTo(x - 6, y + h / 2); ctx.lineTo(x + 6, y + h / 2); ctx.lineTo(x, y + h / 2 + 7); ctx.fillStyle = o.bg || 'rgba(11,16,32,0.85)'; ctx.fill();
  }

  function bitmap(ctx, rows, x, y, px, map, alpha = 1) {
    ctx.globalAlpha = alpha;
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
      const c = map[rows[j][i]];
      if (c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x + i * px), Math.round(y + j * px), Math.ceil(px), Math.ceil(px)); }
    }
    ctx.globalAlpha = 1;
  }
  const CURSOR = [
    'X..........', 'XX.........', 'XWX........', 'XWWX.......', 'XWWWX......', 'XWWWWX.....', 'XWWWWWX....', 'XWWWWWWX...',
    'XWWWWWWWX..', 'XWWWWWWWWX.', 'XWWWWWXXXXX', 'XWWXWWX....', 'XWX.XWWX...', 'XX..XWWX...', 'X....XWWX..', '.....XWWX..', '......XX...',
  ];
  function cursor(ctx, x, y, click = 0) {
    if (click > 0 && click < 1) {
      ctx.strokeStyle = `rgba(255,255,255,${1 - click})`; ctx.lineWidth = 4;
      const r = 10 + click * 40; ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    }
    bitmap(ctx, CURSOR, x, y, 3.2, { X: '#05060d', W: '#ffffff' });
  }
  const CHECK = ['.......XX', '......XXX', 'XX...XXX.', 'XXX.XXX..', '.XXXXX...', '..XXX....'];
  const CROSS = ['XX...XX', '.XX.XX.', '..XXX..', '.XX.XX.', 'XX...XX'];
  function check(ctx, x, y, s = 4, col = PAL.green) { bitmap(ctx, CHECK, x, y, s, { X: col }); }
  function cross(ctx, x, y, s = 4, col = PAL.red) { bitmap(ctx, CROSS, x, y, s, { X: col }); }
  function spinner(ctx, x, y, t, s = 6, col = PAL.cyan) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, f = ((k - Math.floor(t * 12)) % 8 + 8) % 8 / 8;
      ctx.fillStyle = shade(col, 1, 0.2 + 0.8 * (1 - f)); ctx.fillRect(x + Math.cos(a) * s * 2.2 - s / 2, y + Math.sin(a) * s * 2.2 - s / 2, s, s);
    }
  }

  // Google-ads-style kinetic headline: words pop in one by one with a bounce.
  // parts: [[word, color], ...]
  function headline(ctx, parts, t, t0, x, y, o = {}) {
    const size = o.size || 96;
    ctx.font = font(size, o.fam || 'sans');
    const gap = size * 0.28;
    const widths = parts.map(([w]) => ctx.measureText(w).width);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
    let cx = o.align === 'left' ? x : x - total / 2;
    const out = o.out != null ? prog(t, o.out, o.out + 0.35) : 0;
    parts.forEach(([w, col], i) => {
      const a = prog(t, t0 + i * (o.stagger ?? 0.09), t0 + i * (o.stagger ?? 0.09) + 0.4);
      if (a > 0 && out < 1) {
        const s = ease.outBack(a) * (1 - ease.inCubic(out));
        ctx.save(); ctx.translate(cx + widths[i] / 2, y - size * 0.35 + (1 - ease.outCubic(a)) * 40 - out * 60); ctx.scale(s, s);
        ctx.globalAlpha = Math.min(1, a * 2) * (1 - out);
        text(ctx, w, 0, size * 0.35, { size, fam: o.fam || 'sans', align: 'center', col: col || '#fff', shadow: o.shadow ?? 'rgba(5,6,13,0.55)', sd: size * 0.06 });
        ctx.restore();
      }
      cx += widths[i] + gap;
    });
    ctx.globalAlpha = 1;
  }

  function typed(s, t, t0, cps = 18) { return s.slice(0, Math.max(0, Math.floor((t - t0) * cps))); }

  // Colorful pixel wipe: squares grow in diagonally, then shrink away.
  function wipe(ctx, t, t0, dur) {
    if (t < t0 || t > t0 + dur) return;
    const cols = 16, rows = 9, cw = W / cols, ch = H / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const d = (i + j) / (cols + rows - 2) * 0.35 * dur;
      const s = ease.outCubic(prog(t, t0 + d, t0 + d + 0.15 * dur)) * (1 - ease.inCubic(prog(t, t0 + 0.5 * dur + d, t0 + 0.5 * dur + d + 0.15 * dur)));
      if (s <= 0) continue;
      ctx.fillStyle = RAINBOW[(i * 3 + j * 5) % 4];
      ctx.fillRect(i * cw + cw * (1 - s) / 2, j * ch + ch * (1 - s) / 2, cw * s + 1, ch * s + 1);
    }
  }

  function sky(ctx, t, o = {}) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, o.top || '#6EC1FF'); g.addColorStop(1, o.bottom || '#D6F0FF');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // blocky clouds
    for (let k = 0; k < 6; k++) {
      const s = 26, cw = 6 + Math.floor(hash(k) * 6), x = ((hash(k + 10) * (W + 600) + t * (20 + k * 6)) % (W + 600)) - 300, y = 60 + hash(k + 20) * 380;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < cw; i++) for (let j = 0; j < 2; j++) if (hash(k * 40 + i * 3 + j) > 0.25 || j === 0) ctx.fillRect(x + i * s * 2, y + j * s, s * 2, s);
    }
  }

  function darkBg(ctx, t, o = {}) {
    ctx.fillStyle = o.col || PAL.night; ctx.fillRect(0, 0, W, H);
    const s = 48;
    for (let i = 0; i < W / s; i++) for (let j = 0; j < H / s; j++) {
      const r = hash(i * 17 + j * 131);
      if (r > 0.9) { ctx.fillStyle = `rgba(92,242,255,${0.03 + 0.04 * Math.sin(t * 2 + r * 20)})`; ctx.fillRect(i * s, j * s, s - 4, s - 4); }
    }
  }

  // The Codeville logo: a little voxel house and the extruded rainbow word.
  function logo(ctx, cx, cy, size, t, t0 = 0) {
    const word = 'CODEVILLE';
    ctx.font = font(size, 'pixel');
    const cw = ctx.measureText('C').width, total = cw * word.length + size * 1.6;
    let x = cx - total / 2;
    // icon: three blocks
    const a0 = prog(t, t0, t0 + 0.4);
    if (a0 > 0) {
      const v = view({ scale: size * 0.55, cx: x + size * 0.6, cy: cy - size * 0.1, yaw: 0.78, pitch: 0.62 });
      const s = ease.outBack(a0);
      scene(ctx, v, [
        { x: -0.5, y: -0.5, z: 0, w: s, d: s, h: s, col: PAL.blue, o: { seed: 1 } },
        { x: 0.55, y: -0.5, z: 0, w: s * 0.9, d: s * 0.9, h: s * 0.9, col: PAL.green, o: { seed: 2 } },
        { x: -0.5, y: 0.55, z: 0, w: s * 0.9, d: s * 0.9, h: s * 0.9, col: PAL.yellow, o: { seed: 3 } },
        { x: -0.45, y: -0.45, z: s, w: s * 0.9, d: s * 0.9, h: s * 0.9, col: PAL.red, o: { seed: 4 } },
      ]);
    }
    x += size * 1.6;
    for (let i = 0; i < word.length; i++) {
      const a = prog(t, t0 + 0.15 + i * 0.05, t0 + 0.55 + i * 0.05);
      if (a <= 0) { x += cw; continue; }
      const s = ease.outBack(a), col = RAINBOW[i % 4], bob = Math.sin(t * 3 + i * 0.6) * size * 0.03;
      ctx.save(); ctx.translate(x + cw / 2, cy + bob); ctx.scale(s, s);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(size, 'pixel');
      const depth = Math.round(size * 0.12);
      for (let d = depth; d > 0; d -= 2) { ctx.fillStyle = shade(col, 0.45); ctx.fillText(word[i], d, d); }
      ctx.fillStyle = '#05060d'; ctx.fillText(word[i], depth + 2, depth + 2);
      ctx.fillStyle = shade(col, 0.45); ctx.fillText(word[i], depth, depth);
      ctx.fillStyle = col; ctx.fillText(word[i], 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-cw / 2, -size / 2, cw, size * 0.12);
      ctx.restore();
      x += cw;
    }
  }

  // Pixel-art open hand for the hologram scenes.
  const HAND = [
    '....XX.........', '....XX.XX......', '.XX.XX.XX......', '.XX.XX.XX.XX...', '.XX.XX.XX.XX...', '.XX.XX.XX.XX...',
    '.XX.XX.XX.XX...', '.XXXXXXXXXXX.XX', '.XXXXXXXXXXXXXX', '.XXXXXXXXXXXXX.', '.XXXXXXXXXXXX..', '..XXXXXXXXXXX..',
    '..XXXXXXXXXX...', '...XXXXXXXXX...', '...XXXXXXXXX...', '...XXXXXXXXX...',
  ];
  const FIST = [
    '...............', '...............', '...............', '...............', '...............', '..XXXXXXXXX....',
    '.XXXXXXXXXXX...', '.XXXXXXXXXXX.XX', '.XXXXXXXXXXXXXX', '.XXXXXXXXXXXXX.', '.XXXXXXXXXXXX..', '..XXXXXXXXXXX..',
    '..XXXXXXXXXX...', '...XXXXXXXXX...', '...XXXXXXXXX...', '...XXXXXXXXX...',
  ];
  function hand(ctx, x, y, px, o = {}) {
    const rows = o.fist ? FIST : HAND;
    ctx.save();
    if (o.flip) { ctx.translate(x, 0); ctx.scale(-1, 1); x = 0; }
    for (const [ox, oy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) bitmap(ctx, rows, x - 7.5 * px + ox, y - 8 * px + oy, px, { X: 'rgba(92,242,255,0.35)' });
    bitmap(ctx, rows, x - 7.5 * px, y - 8 * px, px, { X: 'rgba(5,6,13,0.85)' });
    bitmap(ctx, rows, x - 7.5 * px + 3, y - 8 * px + 3, px - 6 / 15, { X: 'rgba(140,248,255,0.8)' }, o.alpha ?? 1);
    // landmark dots on the knuckles and finger tips
    ctx.fillStyle = '#ffffff';
    for (const [i, j] of o.fist ? [[2, 6], [5, 6], [8, 6], [10, 7]] : [[4, 0], [7, 1], [1, 2], [10, 3], [13, 7], [6, 12]]) ctx.fillRect(x - 7.5 * px + i * px + px * 0.25, y - 8 * px + j * px + px * 0.25, px * 0.6, px * 0.6);
    ctx.restore();
  }

  global.CV = {
    W, H, PAL, RAINBOW, LAYER, clamp, lerp, prog, ease, hash, win: window_, shade, mix, view, box, scene, ground,
    makeTown, bByName, townItems, drawTown, drawLinks, drawLabels, buildingTop, shopper, font, text, rr, panel, button, tag,
    bitmap, cursor, check, cross, spinner, headline, typed, wipe, sky, darkBg, logo, hand,
  };
})(window);
