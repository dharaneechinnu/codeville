// Codeville app widgets drawn for the promo videos: chat, problem card, the test path and the end card.
(function () {
  'use strict';
  const { W, H, PAL, RAINBOW, prog, ease, lerp, hash, view, scene, ground, panel, button, text, tag, check, cross, spinner,
    headline, typed, logo, drawTown, shopper, bitmap, shade, rr } = CV;

  const VERB = { READ: '#8E96A3', TASK: PAL.purple, WRITE: PAL.blue, EDIT: PAL.green, BASH: PAL.orange, TEST: PAL.yellow };

  // cfg: {prompt, typeAt, sendAt, rows: [[time, verb, path, layerColor?]], doneAt, doneText}
  function chat(ctx, x, y, w, h, t, cfg) {
    panel(ctx, x, y, w, h, { fill: '#11162B' });
    ctx.fillStyle = PAL.panel2; ctx.fillRect(x + 8, y + 8, w - 16, 56);
    text(ctx, 'CHAT', x + 28, y + 46, { size: 18, fam: 'pixel', col: '#fff' });
    text(ctx, 'Claude Code', x + 130, y + 45, { size: 22, col: '#9AA3D6' });
    ctx.fillStyle = PAL.green; ctx.fillRect(x + w - 150, y + 30, 12, 12);
    text(ctx, 'connected', x + w - 130, y + 43, { size: 16, fam: 'silk', col: '#8dffa8' });

    let yy = y + 92;
    if (t >= cfg.sendAt) {
      const a = ease.outBack(prog(t, cfg.sendAt, cfg.sendAt + 0.35));
      ctx.font = CV.font(24); const bw = ctx.measureText(cfg.prompt).width + 40;
      ctx.save(); ctx.translate(x + w - 24 - bw, yy); ctx.scale(a, a);
      ctx.fillStyle = shade(PAL.blue, 0.5); ctx.fillRect(0, 6, bw, 56); ctx.fillStyle = PAL.blue; ctx.fillRect(0, 0, bw, 56);
      text(ctx, cfg.prompt, 20, 37, { size: 24, col: '#fff' });
      ctx.restore();
      yy += 84;
    }
    for (const [rt, verb, path, col] of cfg.rows) {
      if (t < rt) break;
      const a = prog(t, rt, rt + 0.3), dx = (1 - ease.outCubic(a)) * -40;
      ctx.globalAlpha = a;
      const vc = VERB[verb] || '#8E96A3';
      ctx.fillStyle = shade(vc, 0.5); ctx.fillRect(x + 24 + dx, yy + 4, 92, 36);
      ctx.fillStyle = vc; ctx.fillRect(x + 24 + dx, yy, 92, 36);
      text(ctx, verb, x + 70 + dx, yy + 19, { size: 12, fam: 'pixel', col: '#0B1020', align: 'center', base: 'middle' });
      if (col) { ctx.fillStyle = col; ctx.fillRect(x + 132 + dx, yy + 10, 16, 16); }
      text(ctx, path, x + (col ? 160 : 132) + dx, yy + 27, { size: 21, fam: 'mono', col: '#D4DAFF', alpha: a });
      ctx.globalAlpha = 1;
      yy += 50;
    }
    if (cfg.doneAt != null && t >= cfg.doneAt) {
      const a = ease.outBack(prog(t, cfg.doneAt, cfg.doneAt + 0.4));
      ctx.save(); ctx.translate(x + 24, yy + 8); ctx.scale(a, a);
      ctx.fillStyle = 'rgba(52,168,83,0.18)'; ctx.fillRect(0, 0, w - 48, 48);
      check(ctx, 14, 14, 3.4);
      text(ctx, cfg.doneText, 58, 32, { size: 22, col: '#8dffa8' });
      ctx.restore();
    }
    // input
    const iy = y + h - 92;
    ctx.fillStyle = '#0B1020'; ctx.fillRect(x + 20, iy, w - 40, 66);
    ctx.lineWidth = 3; ctx.strokeStyle = t >= cfg.typeAt && t < cfg.sendAt ? PAL.cyan : PAL.line; ctx.strokeRect(x + 20, iy, w - 40, 66);
    const s = t < cfg.sendAt ? typed(cfg.prompt, t, cfg.typeAt, cfg.cps || 20) : '';
    const tw = text(ctx, s || (t < cfg.typeAt || t >= cfg.sendAt ? 'Ask Claude to build something...' : ''), x + 40, iy + 42, { size: 23, col: s ? '#fff' : '#59618F' });
    if (t >= cfg.typeAt && t < cfg.sendAt && Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x + 42 + (s ? tw : 0), iy + 18, 3, 30); }
    const press = t > cfg.sendAt - 0.15 && t < cfg.sendAt + 0.1 ? 1 : 0;
    button(ctx, 'SEND', x + w - 150, iy + 12, 110, 42, { col: PAL.blue, size: 14, press });
  }

  // A card that says what broke and what to do next. lines: [[text, color, fam?]]
  function problemCard(ctx, x, y, w, t, t0, cfg) {
    if (t < t0) return;
    const a = ease.outBack(prog(t, t0, t0 + 0.45));
    const h = 92 + cfg.lines.length * 46 + (cfg.button ? 90 : 0);
    ctx.save(); ctx.translate(x + (1 - a) * 500, y);
    panel(ctx, 0, 0, w, h, { fill: '#1C1424', border: '#05060d' });
    ctx.fillStyle = PAL.red; ctx.fillRect(8, 8, w - 16, 60);
    cross(ctx, 26, 26, 4.4, '#fff');
    text(ctx, cfg.title, 72, 50, { size: 18, fam: 'pixel', col: '#fff' });
    cfg.lines.forEach(([s, col, fam], i) => text(ctx, s, 30, 116 + i * 46, { size: fam === 'mono' ? 23 : 26, fam: fam || 'sans', col: col || '#E8EAFF' }));
    if (cfg.button) button(ctx, cfg.button, 30, h - 82, w - 60, 54, { col: PAL.blue, size: 16, press: cfg.press || 0 });
    ctx.restore();
  }

  // ---------- test path ----------
  function route(points) {
    const tiles = [];
    for (let k = 0; k < points.length - 1; k++) {
      const [ax, ay] = points[k], [bx, by] = points[k + 1];
      const n = Math.abs(bx - ax) + Math.abs(by - ay), sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
      for (let i = 0; i < n; i++) tiles.push([ax + sx * i, ay + sy * i]);
    }
    tiles.push(points[points.length - 1]);
    return tiles;
  }
  function shopperAt(tiles, s) {
    const i = Math.min(tiles.length - 2, Math.floor(s)), f = Math.min(1, s - i);
    const [ax, ay] = tiles[i], [bx, by] = tiles[i + 1];
    return { x: lerp(ax, bx, f) + 0.5, y: lerp(ay, by, f) + 0.5, dir: [bx - ax, by - ay] };
  }

  // cfg: {tiles, steps: [[index, name]], s, failAt (index), failed (bool), extra items, ground:[x,y,nx,ny], decor items}
  function testWorld(ctx, v, t, cfg) {
    ground(ctx, v, ...cfg.ground);
    const items = [...(cfg.decor || [])];
    const stepIdx = new Set(cfg.steps.map(([i]) => i));
    cfg.tiles.forEach(([x, y], i) => {
      let col = PAL.stone;
      if (i < cfg.s - 0.4) col = '#7ED957';
      if (cfg.failed && i === cfg.failAt) col = Math.sin(t * 12) > 0 ? PAL.red : '#B3261E';
      const step = stepIdx.has(i);
      items.push({ x: x + 0.04, y: y + 0.04, z: 0, w: 0.92, d: 0.92, h: step ? 0.22 : 0.1, col, o: { tex: 4, seed: i + 40 } });
    });
    const p = shopperAt(cfg.tiles, cfg.s);
    items.push(...shopper(p.x, p.y, p.dir, t * 12, { walking: cfg.walking, scale: 1.1 }));
    scene(ctx, v, items);
    for (const [i, name] of cfg.steps) {
      const [x, y] = cfg.tiles[i];
      const passed = i < cfg.s - 0.4, failed = cfg.failed && i === cfg.failAt;
      const [sx, sy] = v.p(x + 0.5, y + 0.5, 2.3);
      tag(ctx, name.toUpperCase(), sx, sy, { size: 13, bg: failed ? PAL.red : passed ? '#2E8B47' : 'rgba(11,16,32,0.85)' });
    }
    if (cfg.failed) {
      const [sx, sy] = v.p(p.x, p.y, 2.6);
      const b = ease.outBack(prog(t, cfg.failT, cfg.failT + 0.4));
      ctx.save(); ctx.translate(sx, sy - 30 - Math.abs(Math.sin(t * 5)) * 8); ctx.scale(b, b);
      ctx.fillStyle = '#05060d'; ctx.fillRect(-26, -34, 52, 60); ctx.fillStyle = PAL.red; ctx.fillRect(-22, -30, 44, 52);
      text(ctx, '!', 2, 0, { size: 34, fam: 'pixel', col: '#fff', align: 'center', base: 'middle' });
      ctx.restore();
    }
    return p;
  }

  // ---------- hologram backdrop: faint camera picture with scanlines ----------
  function holoBg(ctx, t) {
    ctx.fillStyle = '#05060D'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H * 0.55, 50, W / 2, H * 0.55, 900);
    g.addColorStop(0, 'rgba(60,90,120,0.35)'); g.addColorStop(1, 'rgba(5,6,13,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // a soft, blocky silhouette of the person in front of the camera
    ctx.fillStyle = 'rgba(120,150,180,0.07)';
    const px = 40;
    for (let j = 0; j < 14; j++) for (let i = 0; i < 16; i++) {
      const dx = (i - 7.5) / 7.5, dy = (j - 5) / 5;
      const head = dx * dx * 4 + (dy + 0.3) ** 2 * 3 < 1 && j < 7, body = j >= 7 && Math.abs(dx) < 0.25 + (j - 7) * 0.12;
      if (head || body) ctx.fillRect(W / 2 - 8 * px + i * px, 380 + j * px, px - 2, px - 2);
    }
    ctx.fillStyle = 'rgba(92,242,255,0.035)';
    for (let y = (t * 60) % 6; y < H; y += 6) ctx.fillRect(0, y, W, 2);
  }

  // ---------- end card ----------
  const ARROW = ['..XX..', '..XX..', '..XX..', 'XXXXXX', '.XXXX.', '..XX..', 'XXXXXX'];
  function endCard(ctx, t, t0, town) {
    ctx.fillStyle = '#F7F9FF'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(66,133,244,0.06)';
    for (let i = 0; i < W; i += 64) for (let j = 0; j < H; j += 64) if (hash(i * 0.37 + j * 1.91) > 0.7) ctx.fillRect(i, j, 60, 60);
    const v = view({ scale: 24, cx: W / 2, cy: 905, yaw: 0.75 + (t - t0) * 0.22, pitch: 0.55, fx: 8, fy: 5 });
    drawTown(ctx, v, town, 999, { ground: [-3, -3, 23, 16], labels: false, links: false });
    const fade = ctx.createLinearGradient(0, 640, 0, 780);
    fade.addColorStop(0, 'rgba(247,249,255,1)'); fade.addColorStop(1, 'rgba(247,249,255,0)');
    ctx.fillStyle = fade; ctx.fillRect(0, 600, W, 180);
    ctx.fillStyle = '#F7F9FF'; ctx.fillRect(0, 0, W, 600);
    logo(ctx, W / 2, 210, 92, t, t0 + 0.1);
    headline(ctx, [['Vibe', PAL.blue], ['code.', PAL.red], ['See', PAL.yellow], ['it', PAL.green], ['build.', PAL.ink]], t, t0 + 0.7, W / 2, 360, { size: 82, shadow: 'rgba(11,16,32,0.12)' });
    const b = prog(t, t0 + 1.3, t0 + 1.8);
    if (b > 0) {
      const s = ease.outBack(b) * (1 + 0.035 * Math.sin((t - t0) * 6));
      ctx.save(); ctx.translate(W / 2, 500); ctx.scale(s, s);
      button(ctx, '    DOWNLOAD FOR WINDOWS', -330, -42, 660, 84, { col: PAL.green, size: 22 });
      bitmap(ctx, ARROW, -280, -24, 6, { X: '#fff' });
      ctx.restore();
      text(ctx, 'github.com/dharaneechinnu/codeville/releases', W / 2, 600, { size: 26, fam: 'silk', col: '#3A4170', align: 'center', alpha: b });
    }
  }

  // Opening title: "Built for vibe coders." and a prompt bar that types the promise.
  function titleCard(ctx, t, t0, line = 'your prompts, made visual') {
    CV.darkBg(ctx, t);
    for (let k = 0; k < 28; k++) {
      const s = 18 + hash(k) * 34, x = hash(k + 1) * W, y = H + 60 - (((t - t0) * 140 * (0.5 + hash(k + 2)) + hash(k + 3) * (H + 120)) % (H + 120));
      ctx.fillStyle = shade(RAINBOW[k % 4], 1, 0.28); ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, s, s * 0.2);
    }
    headline(ctx, [['Built', '#fff'], ['for', '#fff']], t, t0 + 0.1, W / 2, 360, { size: 104 });
    headline(ctx, [['vibe', PAL.cyan], ['coders.', PAL.yellow]], t, t0 + 0.35, W / 2, 540, { size: 168 });
    const a = prog(t, t0 + 0.8, t0 + 1.1);
    if (a <= 0) return;
    const bw = 980, bx = W / 2 - bw / 2, by = 680, s = ease.outBack(a);
    ctx.save(); ctx.translate(W / 2, by + 50); ctx.scale(s, s); ctx.translate(-W / 2, -(by + 50));
    panel(ctx, bx, by, bw, 100, { fill: '#0B1020' });
    text(ctx, '>', bx + 36, by + 64, { size: 30, fam: 'pixel', col: PAL.green });
    const str = typed(line, t, t0 + 0.95, 26), w = text(ctx, str, bx + 90, by + 64, { size: 40, col: '#fff' });
    if (Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = PAL.cyan; ctx.fillRect(bx + 96 + w, by + 28, 6, 46); }
    ctx.restore();
  }

  // A small prompt bar used to show that every scene starts from a prompt.
  function promptPill(ctx, x, y, w, s, t, t0, o = {}) {
    if (t < t0) return;
    const a = ease.outBack(prog(t, t0, t0 + 0.3));
    ctx.save(); ctx.translate(x, y); ctx.scale(a, a);
    panel(ctx, 0, 0, w, 72, { fill: '#0B1020' });
    text(ctx, 'PROMPT', 24, 44, { size: 14, fam: 'pixel', col: PAL.green });
    const str = typed(s, t, t0 + 0.2, o.cps || 24), tw = text(ctx, str, 140, 47, { size: 28, col: '#fff' });
    const sent = o.sendAt != null && t >= o.sendAt;
    if (!sent && Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = PAL.cyan; ctx.fillRect(144 + tw, 20, 4, 34); }
    if (sent) { const k = prog(t, o.sendAt, o.sendAt + 0.25); ctx.fillStyle = shade(PAL.green, 1, 1 - k * 0.6); ctx.fillRect(w - 64, 18, 40, 36); check(ctx, w - 58, 26, 3, '#fff'); }
    ctx.restore();
  }

  // ---------- holo-lab dressing: projector rings, light columns, particles, scan plane, HUD panels ----------
  const CY_ = PAL.cyan;
  function ringPath(ctx, v, cx, cy, r, z = 0, a0 = 0, a1 = Math.PI * 2) {
    ctx.beginPath();
    for (let k = 0; k <= 72; k++) { const a = lerp(a0, a1, k / 72), p = v.p(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z); k ? ctx.lineTo(...p) : ctx.moveTo(...p); }
  }
  function glowStroke(ctx, col, w, a) {
    ctx.lineWidth = w * 4; ctx.strokeStyle = shade(col, 1, a * 0.15); ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = shade(col, 1.2, a); ctx.stroke();
  }
  // Under the town: the projector. power 0..1 fades it in.
  function holoBase(ctx, v, t, cx, cy, power = 1) {
    if (power <= 0) return;
    ringPath(ctx, v, cx, cy, 14.5); ctx.fillStyle = shade(CY_, 1, 0.05 * power); ctx.fill();
    [[11.5, [18, 10], 30, 2], [13, [4, 6], -60, 3], [14.5, [60, 20, 6, 20], 20, 2.5], [15.4, [2, 14], -10, 2]].forEach(([r, dash, sp, w]) => {
      ctx.setLineDash(dash); ctx.lineDashOffset = t * sp; ringPath(ctx, v, cx, cy, r); glowStroke(ctx, CY_, w, 0.8 * power);
    });
    ctx.setLineDash([]);
    for (let k = 0; k < 72; k++) {
      const a = k / 72 * Math.PI * 2 + t * 0.15, l = k % 6 ? 0.4 : 1.1;
      const p1 = v.p(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 0), p2 = v.p(cx + Math.cos(a) * (16 + l), cy + Math.sin(a) * (16 + l), 0);
      ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.lineWidth = 2; ctx.strokeStyle = shade(CY_, 1, 0.6 * power); ctx.stroke();
    }
    // a bright arc sweeping around
    ringPath(ctx, v, cx, cy, 15.4, 0, t * 1.2, t * 1.2 + 0.9); glowStroke(ctx, '#ffffff', 4, power);
  }
  // Over the town: light columns, rising particles, the scan plane.
  function holoAir(ctx, v, t, cx, cy, power = 1, scanZ = null) {
    if (power <= 0) return;
    for (let k = 0; k < 44; k++) {
      const a = k / 44 * Math.PI * 2, r = 15.4, h = 3 + hash(k) * 7 * (0.6 + 0.4 * Math.sin(t * 2 + k));
      const p1 = v.p(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0), p2 = v.p(cx + Math.cos(a) * r, cy + Math.sin(a) * r, h);
      const g = ctx.createLinearGradient(p1[0], p1[1], p2[0], p2[1]);
      g.addColorStop(0, shade(CY_, 1, 0.35 * power)); g.addColorStop(1, shade(CY_, 1, 0));
      ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.stroke();
    }
    for (let k = 0; k < 90; k++) {
      const a = hash(k) * Math.PI * 2, r = Math.sqrt(hash(k + 50)) * 14, z = ((t * (0.5 + hash(k + 9)) + hash(k + 3) * 9) % 9);
      const p = v.p(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z), s = 2 + hash(k + 7) * 3;
      ctx.fillStyle = shade(k % 7 ? CY_ : '#ffffff', 1, (1 - z / 9) * 0.8 * power); ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
    }
    if (scanZ != null) {
      ringPath(ctx, v, cx, cy, 14.5, scanZ); ctx.fillStyle = shade(CY_, 1, 0.08); ctx.fill(); glowStroke(ctx, '#ffffff', 3, 0.9);
      const p = v.p(cx + 14.5, cy, scanZ);
      text(ctx, `SCAN ${Math.round(scanZ / 5 * 100)}%`, p[0] + 20, p[1], { size: 14, fam: 'pixel', col: CY_ });
    }
  }
  function brackets(ctx, x, y, w, h, col, a = 1, l = 18) {
    ctx.strokeStyle = shade(col, 1, a); ctx.lineWidth = 3; ctx.beginPath();
    for (const [px, py, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(px + dx * l, py); ctx.lineTo(px, py); ctx.lineTo(px, py + dy * l);
    }
    ctx.stroke();
  }
  // A floating HUD panel that flickers on at t0. rows: [[label, value]]
  function holoPanel(ctx, x, y, w, t, t0, title, rows, o = {}) {
    if (t < t0) return;
    const on = prog(t, t0, t0 + 0.5), flick = on < 1 ? (Math.floor(t * 40) % 3 ? 1 : 0.3) : 1, a = on * flick;
    const h = 64 + rows.length * 42 + (o.bars ? 70 : 0);
    ctx.fillStyle = `rgba(6,30,44,${0.55 * a})`; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = shade(CY_, 1, 0.35 * a); ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
    brackets(ctx, x - 6, y - 6, w + 12, h + 12, CY_, a);
    text(ctx, title, x + 18, y + 34, { size: 14, fam: 'pixel', col: CY_, alpha: a });
    ctx.fillStyle = shade(CY_, 1, 0.5 * a); ctx.fillRect(x + 18, y + 46, (w - 36) * on, 2);
    rows.forEach(([k, val], i) => {
      text(ctx, k, x + 18, y + 90 + i * 42, { size: 20, fam: 'silk', col: '#9FDDE8', alpha: a });
      const shown = typeof val === 'number' ? String(Math.round(val * ease.outCubic(prog(t, t0 + 0.2 + i * 0.1, t0 + 1.2 + i * 0.1)))).padStart(2, '0') : val;
      text(ctx, shown, x + w - 18, y + 90 + i * 42, { size: 22, fam: 'pixel', col: '#ffffff', align: 'right', alpha: a });
    });
    if (o.bars) {
      for (let k = 0; k < 14; k++) {
        const bh = 10 + 46 * Math.abs(Math.sin(t * 2.2 + k * 0.7)) * hash(k + 4);
        ctx.fillStyle = shade(k % 5 ? CY_ : PAL.yellow, 1, 0.75 * a); ctx.fillRect(x + 18 + k * ((w - 36) / 14), y + h - 14 - bh, (w - 36) / 14 - 5, bh);
      }
    }
  }
  function radar(ctx, x, y, r, t, a = 1) {
    ctx.globalAlpha = a;
    for (const k of [1, 0.66, 0.33]) { ctx.beginPath(); ctx.arc(x, y, r * k, 0, Math.PI * 2); ctx.strokeStyle = shade(CY_, 1, 0.4); ctx.lineWidth = 1.5; ctx.stroke(); }
    const s = t * 2.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, s - 0.6, s); ctx.closePath(); ctx.fillStyle = shade(CY_, 1, 0.25); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(s) * r, y + Math.sin(s) * r); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    for (let k = 0; k < 6; k++) { const aa = hash(k) * 6.28, rr = r * (0.2 + hash(k + 1) * 0.75); ctx.fillStyle = PAL.yellow; ctx.fillRect(x + Math.cos(aa) * rr - 3, y + Math.sin(aa) * rr - 3, 6, 6); }
    ctx.globalAlpha = 1;
  }
  // Tracking box around a hand, as the hand tracker would show it.
  function handLock(ctx, x, y, t, label) {
    const s = 170 + Math.sin(t * 6) * 6;
    brackets(ctx, x - s / 2, y - s / 2 - 10, s, s, PAL.yellow, 0.95, 26);
    ctx.save(); ctx.translate(x, y - 10); ctx.rotate(t * 1.5);
    ctx.setLineDash([12, 10]); ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2); ctx.strokeStyle = shade(PAL.yellow, 1, 0.5); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    text(ctx, label, x - s / 2, y - s / 2 - 22, { size: 12, fam: 'pixel', col: PAL.yellow });
  }

  Object.assign(CV, { holoBase, holoAir, holoPanel, radar, handLock, brackets, titleCard, promptPill, chat, problemCard, route, shopperAt, testWorld, holoBg, endCard });
})();
