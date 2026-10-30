// 90 second demo: a walk through every widget of the Codeville window.
(function () {
  'use strict';
  const { W, H, PAL, RAINBOW, prog, ease, lerp, hash, view, drawTown, wipe, text, tag, panel, headline, button, check, cross, spinner,
    cursor, typed, darkBg, chat, route, shopperAt, testWorld, problemCard, holoBg, hand, endCard, shade, win } = CV;

  // ---------- the window ----------
  const WX = 150, WY = 180, WW = 1620, WH = 860, SB = 76, TB = 46;
  const CX = WX + SB, CY = WY + TB, CW = WW - SB, CH = WH - TB;
  const NAV = ['CHAT', 'TOWN', 'FILES', 'GIT', 'EXT'];
  const NAV_COL = [PAL.blue, PAL.green, PAL.yellow, PAL.orange, PAL.purple];

  function windowFrame(ctx, active) {
    panel(ctx, WX - 6, WY - 6, WW + 12, WH + 12, { fill: '#0D1124', c: 10 });
    ctx.fillStyle = '#0D1124'; ctx.fillRect(WX, WY, WW, TB);
    CV.bitmap(ctx, ['XX', 'XX'], WX + 18, WY + 15, 8, { X: PAL.green });
    text(ctx, 'Codeville  -  shop-app', WX + 50, WY + 31, { size: 18, fam: 'silk', col: '#C9CEF0' });
    ctx.fillStyle = '#9AA3D6';
    ctx.fillRect(WX + WW - 130, WY + 24, 18, 3); ctx.strokeStyle = '#9AA3D6'; ctx.lineWidth = 3; ctx.strokeRect(WX + WW - 88, WY + 15, 16, 14);
    CV.bitmap(ctx, ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'], WX + WW - 44, WY + 14, 3.4, { X: '#9AA3D6' });
    ctx.fillStyle = '#0A0E1E'; ctx.fillRect(WX, WY + TB, SB, WH - TB);
    NAV.forEach((n, i) => {
      const y = WY + TB + 22 + i * 92, on = active === n;
      if (on) { ctx.fillStyle = NAV_COL[i]; ctx.fillRect(WX, y - 6, 5, 76); }
      ctx.fillStyle = on ? NAV_COL[i] : '#262C52'; ctx.fillRect(WX + 20, y, 36, 36);
      ctx.fillStyle = on ? shade(NAV_COL[i], 0.6) : '#1A2040'; ctx.fillRect(WX + 20, y + 30, 36, 6);
      text(ctx, n, WX + SB / 2, y + 60, { size: 9, fam: 'pixel', col: on ? '#fff' : '#59618F', align: 'center' });
    });
    ctx.fillStyle = PAL.night; ctx.fillRect(CX, CY, CW, CH);
  }

  function caption(ctx, t, t0, t1, num, title, sub, col) {
    const a = prog(t, t0 + 0.05, t0 + 0.5), o = prog(t, t1 - 0.35, t1);
    if (a <= 0 || o >= 1) return;
    const s = ease.outBack(a) * (1 - ease.inCubic(o));
    ctx.save(); ctx.translate(WX + 40, 112); ctx.scale(s, s);
    ctx.fillStyle = shade(col, 0.5); ctx.fillRect(-40, -34, 80, 80); ctx.fillStyle = col; ctx.fillRect(-40, -40, 80, 80);
    text(ctx, num, 0, 4, { size: 28, fam: 'pixel', col: '#fff', align: 'center', base: 'middle', shadow: 'rgba(0,0,0,0.3)', sd: 3 });
    ctx.restore();
    const dx = (1 - ease.outCubic(a)) * -60 - ease.inCubic(o) * 60, al = Math.min(a * 1.5, 1) * (1 - o);
    text(ctx, title, WX + 110 + dx, 104, { size: 30, fam: 'pixel', col: '#fff', alpha: al, shadow: '#05060d', sd: 4 });
    text(ctx, sub, WX + 110 + dx, 150, { size: 30, col: '#AEB6E8', alpha: al });
  }

  function toolbar(ctx, t, o = {}) {
    const x = CX + 20, y = CY + 16;
    ctx.fillStyle = 'rgba(13,17,36,0.92)'; ctx.fillRect(x, y, CW - 40, 58);
    ['BUILD', 'TEST'].forEach((s, i) => {
      const on = (o.mode || 'BUILD') === s;
      ctx.fillStyle = on ? (i ? PAL.yellow : PAL.green) : '#1A2040'; ctx.fillRect(x + 12 + i * 130, y + 10, 124, 38);
      text(ctx, s, x + 74 + i * 130, y + 30, { size: 14, fam: 'pixel', col: on ? '#0B1020' : '#9AA3D6', align: 'center', base: 'middle' });
    });
    text(ctx, o.links || 'LINKS: MAIN', x + 310, y + 36, { size: 13, fam: 'pixel', col: '#9AA3D6' });
    ['ROTATE', 'ZOOM', 'RESET'].forEach((s, i) => text(ctx, s, x + CW - 470 + i * 120, y + 36, { size: 12, fam: 'pixel', col: '#59618F' }));
    ctx.fillStyle = o.hand ? PAL.cyan : '#262C52'; ctx.fillRect(x + CW - 104, y + 10, 38, 38);
    CV.bitmap(ctx, ['.X.X.', '.X.X.', 'XXXXX', 'XXXXX', '.XXX.'], x + CW - 97, y + 17, 5, { X: o.hand ? '#05060d' : '#9AA3D6' });
  }

  // ---------- the town ----------
  const town = CV.makeTown({
    features: [
      { name: 'auth', at: [0, 0], fe: 6, be: 5, test: 3 },
      { name: 'catalog', at: [6, 0], fe: 9, be: 7, test: 4 },
      { name: 'cart', at: [0, 6], fe: 7, be: 6, test: 3 },
      { name: 'payment', at: [6, 6], fe: 4, be: 8, test: 4 },
      { name: 'wishlist', at: [12, 6], fe: 5, be: 4, test: 2 },
    ],
    db: { at: [12, 0], n: 14 },
    svc: [{ name: 'stripe', at: [16, 4] }, { name: 'sendgrid', at: [16, 1] }],
    trees: [[-2, 4], [5, -2], [11, 4], [5, 11], [-2, 10], [17, 10], [10, 11], [17, -1]],
    links: [['auth/ui', 'auth/api'], ['catalog/ui', 'catalog/api'], ['catalog/api', 'database'], ['payment/api', 'stripe'],
      ['auth/api', 'database'], ['cart/api', 'database'], ['cart/ui', 'cart/api'], ['payment/ui', 'payment/api'], ['payment/api', 'database'],
      ['auth/api', 'sendgrid'], ['wishlist/ui', 'wishlist/api'], ['wishlist/api', 'database']],
  });
  const GROUND = [-3, -3, 23, 16];
  const R = [43.6, 44.7, 45.8, 46.9, 48.0, 49.1, 50.2];
  const rest = town.blocks.filter((b) => b.feature !== 'wishlist');
  rest.map((b) => [b, b.z + hash(b.id) * 2.5]).sort((a, b) => a[1] - b[1]).forEach(([b], i) => { b.born = 25.3 + (i / rest.length) * 2.2 + hash(b.id + 9) * 0.15; });
  for (const b of town.blocks) {
    if (b.feature !== 'wishlist') continue;
    const layer = town.buildings[b.b].layer;
    b.born = (layer === 'fe' ? R[2] : layer === 'be' ? R[3] : R[5]) + b.k * 0.13;
  }
  town.trees.forEach((tr, i) => { tr.born = 27.2 + i * 0.08; });

  // ---------- 0-10 first run ----------
  function welcome(ctx, t) {
    const w = 820, h = 600, x = CX + (CW - w) / 2, y = CY + 100;
    panel(ctx, x, y, w, h, { fill: PAL.panel });
    text(ctx, 'WELCOME TO CODEVILLE', x + w / 2, y + 74, { size: 26, fam: 'pixel', col: '#fff', align: 'center', shadow: '#05060d', sd: 4 });
    text(ctx, "Let's check your setup", x + w / 2, y + 122, { size: 26, col: '#9AA3D6', align: 'center' });
    [['Git', 'git 2.47', 1.3], ['Claude Code', 'claude 2.1', 2.1], ['Node.js', 'node 22.11', 2.9]].forEach(([n, ver, d], i) => {
      const ry = y + 170 + i * 76;
      ctx.fillStyle = '#0B1020'; ctx.fillRect(x + 60, ry, w - 120, 60);
      text(ctx, n, x + 90, ry + 40, { size: 28, col: '#fff' });
      if (t < d) spinner(ctx, x + w - 110, ry + 30, t, 6);
      else { check(ctx, x + w - 130, ry + 16, 4.2); text(ctx, ver, x + w - 160, ry + 40, { size: 22, fam: 'mono', col: '#8dffa8', align: 'right', alpha: prog(t, d, d + 0.3) }); }
    });
    const btns = [['OPEN FOLDER', PAL.green], ['NEW PROJECT', PAL.blue], ['COPY A REPO', PAL.orange]];
    btns.forEach(([s, col], i) => {
      const a = prog(t, 3.3 + i * 0.12, 3.7 + i * 0.12);
      if (a > 0) button(ctx, s, x + 50 + i * 250, y + 450, 230, 70, { col, size: 14, scale: ease.outBack(a), press: i === 0 && t > 5.95 && t < 6.2 ? 1 : 0 });
    });
    if (t > 6.3) {
      const a = ease.outBack(prog(t, 6.3, 6.7)), px = x + 110, py = y + 140;
      ctx.save(); ctx.translate(px + 300, py + 170); ctx.scale(a, a); ctx.translate(-300, -170);
      panel(ctx, 0, 0, 600, 340, { fill: '#1A2040' });
      text(ctx, 'CHOOSE A FOLDER', 30, 50, { size: 16, fam: 'pixel', col: '#fff' });
      ['Documents', 'projects/shop-app', 'projects/blog'].forEach((f, i) => {
        const on = i === 1 && t > 7.4;
        ctx.fillStyle = on ? PAL.blue : '#11162B'; ctx.fillRect(30, 80 + i * 70, 540, 56);
        ctx.fillStyle = PAL.yellow; ctx.fillRect(50, 96 + i * 70, 30, 24);
        text(ctx, f, 100, 117 + i * 70, { size: 24, fam: 'mono', col: '#fff' });
      });
      ctx.restore();
      if (t > 7.9) {
        ctx.fillStyle = 'rgba(11,16,32,0.92)'; ctx.fillRect(px, py, 600, 340);
        spinner(ctx, px + 300, py + 130, t, 8);
        text(ctx, 'OPENING SHOP-APP...', px + 300, py + 230, { size: 18, fam: 'pixel', col: PAL.cyan, align: 'center' });
      }
    }
    const btn = [x + 165, y + 485], row = [x + 400, y + 140 + 80 + 70 + 28];
    let cp = [1500, 960];
    if (t > 4.2) cp = [lerp(1500, btn[0], ease.inOut(prog(t, 4.2, 5.8))), lerp(960, btn[1], ease.inOut(prog(t, 4.2, 5.8)))];
    if (t > 6.6) cp = [lerp(btn[0], row[0], ease.inOut(prog(t, 6.6, 7.3))), lerp(btn[1], row[1], ease.inOut(prog(t, 6.6, 7.3)))];
    if (t > 3.8) cursor(ctx, cp[0], cp[1], t > 6.6 ? prog(t, 7.4, 7.8) : prog(t, 6.0, 6.4));
  }

  // ---------- 10-25 project analysis ----------
  const STEPS = ['scan_files', 'read_identity', 'detect_stack', 'classify_layers', 'find_features', 'find_connections', 'find_commands', 'find_tests', 'summarize'];
  const DONE = STEPS.map((_, i) => 11.2 + i * 1.25);
  function chip(ctx, s, x, y, col, a = 1) {
    if (a <= 0) return 0;
    ctx.font = CV.font(22); const w = ctx.measureText(s).width + 28;
    ctx.save(); ctx.translate(x + w / 2, y + 20); ctx.scale(ease.outBack(a), ease.outBack(a));
    ctx.fillStyle = shade(col, 0.5); ctx.fillRect(-w / 2, -16, w, 40); ctx.fillStyle = col; ctx.fillRect(-w / 2, -20, w, 40);
    text(ctx, s, 0, 1, { size: 22, col: '#fff', align: 'center', base: 'middle' });
    ctx.restore();
    return w + 12;
  }
  function analysis(ctx, t) {
    const lx = CX + 24, ly = CY + 24, lw = 520, lh = CH - 48;
    panel(ctx, lx, ly, lw, lh, { fill: PAL.panel });
    text(ctx, 'ANALYSIS AGENT', lx + 28, ly + 52, { size: 16, fam: 'pixel', col: '#fff' });
    STEPS.forEach((s, i) => {
      const y = ly + 84 + i * 72, start = i ? DONE[i - 1] : 10.4, done = t >= DONE[i], run = t >= start && !done;
      if (run) { ctx.fillStyle = 'rgba(92,242,255,0.10)'; ctx.fillRect(lx + 16, y, lw - 32, 60); }
      if (done) check(ctx, lx + 34, y + 18, 3.6);
      else if (run) spinner(ctx, lx + 50, y + 30, t, 5);
      else { ctx.fillStyle = '#39427A'; ctx.fillRect(lx + 44, y + 24, 12, 12); }
      text(ctx, s, lx + 90, y + 39, { size: 26, fam: 'mono', col: done ? '#fff' : run ? PAL.cyan : '#59618F' });
    });
    const rx = CX + 568, ry = CY + 24, rw = CW - 592;
    panel(ctx, rx, ry, rw, CH - 48, { fill: PAL.panel });
    text(ctx, 'REPORT', rx + 28, ry + 52, { size: 16, fam: 'pixel', col: '#fff' });
    const A = (i) => prog(t, DONE[i], DONE[i] + 0.4);
    if (A(1) > 0) {
      text(ctx, 'shop-app', rx + 28, ry + 112, { size: 24, fam: 'pixel', col: PAL.yellow, alpha: A(1) });
      text(ctx, 'An online store for handmade goods  (from README)', rx + 28, ry + 156, { size: 25, col: '#C9CEF0', alpha: A(1) });
    }
    if (A(2) > 0) {
      [['Frontend', ['React', 'Vite'], PAL.blue], ['Backend', ['Django REST'], PAL.green], ['Database', ['PostgreSQL'], PAL.purple], ['Services', ['Stripe', 'SendGrid'], PAL.orange]]
        .forEach(([n, cs, col], i) => {
          const x = rx + 28 + (i % 2) * (rw / 2), y = ry + 190 + Math.floor(i / 2) * 64, a = prog(t, DONE[2] + i * 0.12, DONE[2] + i * 0.12 + 0.35);
          text(ctx, n, x, y + 28, { size: 22, col: '#7E87BF', alpha: a });
          let cx = x + 120;
          cs.forEach((c) => { cx += chip(ctx, c, cx, y, col, a); });
        });
    }
    if (A(3) > 0) {
      [['Frontend', 42, PAL.blue], ['Backend', 31, PAL.green], ['Tests', 18, PAL.yellow]].forEach(([n, v, col], i) => {
        const y = ry + 340 + i * 44, e = ease.outCubic(prog(t, DONE[3] + i * 0.1, DONE[3] + i * 0.1 + 0.8));
        text(ctx, n, rx + 28, y + 24, { size: 22, col: '#7E87BF' });
        ctx.fillStyle = '#0B1020'; ctx.fillRect(rx + 150, y + 4, rw - 300, 26);
        ctx.fillStyle = col; ctx.fillRect(rx + 150, y + 4, (rw - 300) * (v / 42) * e, 26);
        text(ctx, `${Math.round(v * e)} files`, rx + rw - 130, y + 25, { size: 22, fam: 'mono', col: '#fff' });
      });
    }
    if (A(4) > 0) {
      text(ctx, 'Features', rx + 28, ry + 510, { size: 22, col: '#7E87BF' });
      let cx = rx + 150;
      ['auth', 'catalog', 'cart', 'payment'].forEach((f, i) => { cx += chip(ctx, f, cx, ry + 482, RAINBOW[i], prog(t, DONE[4] + i * 0.15, DONE[4] + i * 0.15 + 0.35)); });
    }
    const lines = [[5, '38 links: 12 API calls, 9 database users, 2 outside services', '#C9CEF0'], [6, 'pytest (backend)   npm run build (frontend)', '#FFD98A'], [7, '24 test cases found', '#C9CEF0']];
    lines.forEach(([i, s, col], k) => { if (A(i) > 0) text(ctx, s, rx + 28 + (1 - A(i)) * 30, ry + 580 + k * 46, { size: k === 1 ? 22 : 24, fam: k === 1 ? 'mono' : 'sans', col, alpha: A(i) }); });
    if (A(8) > 0) {
      const s = ease.outBack(A(8));
      ctx.save(); ctx.translate(rx + rw / 2, ry + CH - 120); ctx.scale(s, s);
      ctx.fillStyle = shade(PAL.green, 0.5); ctx.fillRect(-300, -24, 600, 56); ctx.fillStyle = PAL.green; ctx.fillRect(-300, -30, 600, 56);
      text(ctx, 'READY: BUILDING THE TOWN', 0, 0, { size: 16, fam: 'pixel', col: '#fff', align: 'center', base: 'middle' });
      ctx.restore();
    }
  }

  // ---------- 25-40 block town ----------
  const CLICK_BLOCK = town.blocks.filter((b) => b.feature === 'cart' && town.buildings[b.b].layer === 'fe').pop();
  const PAY = CV.bByName(town, 'payment/api');
  const townView = (t) => view({ scale: 40, cx: CX + CW / 2 - 90, cy: CY + CH / 2 + 60, yaw: lerp(0.55, 1.05, ease.inOut(prog(t, 25, 40))), fx: 8, fy: 5 });
  const CODE = [
    [['import', '#C792EA'], [' { useCart } ', '#D4DAFF'], ['from', '#C792EA'], [" './api'", '#C3E88D']],
    [['', '#fff']],
    [['export function', '#C792EA'], [' Cart', '#82AAFF'], ['() {', '#D4DAFF']],
    [['  const', '#C792EA'], [' { items, total } = ', '#D4DAFF'], ['useCart', '#82AAFF'], ['()', '#D4DAFF']],
    [['  return', '#C792EA'], [' (', '#D4DAFF']],
    [['    <', '#D4DAFF'], ['List', '#82AAFF'], [' items={items} />', '#D4DAFF']],
    [['    <', '#D4DAFF'], ['Total', '#82AAFF'], [' value={total} />', '#D4DAFF']],
    [['  )', '#D4DAFF']],
    [['}', '#D4DAFF']],
  ];
  function townScene(ctx, t) {
    const v = townView(t);
    const payMode = t > 35.9;
    drawTown(ctx, v, town, t, {
      ground: GROUND, hlBlock: t > 31.5 && t < 35.2 ? CLICK_BLOCK.id : null, hl: payMode ? PAY.id : null,
      labelAlpha: () => prog(t, 27.4, 27.8), linkAlpha: (L) => prog(t, 27.8, 28.4) * (payMode && L.a !== PAY && L.b !== PAY ? 0.12 : 1),
    });
    toolbar(ctx, t, { links: payMode ? 'LINKS: PAYMENT/API' : 'LINKS: MAIN' });
    // file popup
    const open = prog(t, 31.7, 32.1) * (1 - prog(t, 34.9, 35.2));
    if (open > 0) {
      const w = 560, x = CX + CW - w - 24 + (1 - ease.outBack(open)) * 600, y = CY + 96;
      panel(ctx, x, y, w, 580, { fill: '#11162B' });
      text(ctx, 'src/cart/Cart.tsx', x + 28, y + 52, { size: 24, fam: 'mono', col: '#fff' });
      chip(ctx, 'frontend - cart', x + 28, y + 76, PAL.blue);
      ctx.fillStyle = '#0B1020'; ctx.fillRect(x + 20, y + 140, w - 40, 330);
      CODE.forEach((line, i) => {
        let cx = x + 70;
        text(ctx, String(i + 1), x + 50, y + 178 + i * 34, { size: 18, fam: 'mono', col: '#39427A', align: 'right' });
        line.forEach(([s, col]) => { cx += text(ctx, s, cx, y + 178 + i * 34, { size: 19, fam: 'mono', col }); });
      });
      button(ctx, 'OPEN IN EDITOR', x + 28, y + 494, w - 56, 56, { col: PAL.blue, size: 16 });
    }
    // cursor: block, then the payment building
    const bp = v.p(CLICK_BLOCK.x + 0.5, CLICK_BLOCK.y + 0.5, CLICK_BLOCK.z + 1);
    const pp = v.p(PAY.x + 1, PAY.y + 1, CV.buildingTop(town, PAY, t));
    if (t > 30) {
      let cp = [lerp(1500, bp[0], ease.inOut(prog(t, 30, 31.3))), lerp(980, bp[1], ease.inOut(prog(t, 30, 31.3)))];
      if (t > 31.3) cp = bp;
      if (t > 35) cp = [lerp(bp[0], pp[0], ease.inOut(prog(t, 35, 35.8))), lerp(bp[1], pp[1], ease.inOut(prog(t, 35, 35.8)))];
      cursor(ctx, cp[0], cp[1], t > 35 ? prog(t, 35.8, 36.2) : prog(t, 31.4, 31.8));
    }
  }

  // ---------- 40-55 chat ----------
  const CHAT = {
    prompt: 'add a wishlist feature with tests', typeAt: 40.8, sendAt: 42.9, cps: 18,
    rows: [[R[0], 'READ', 'src/catalog/Product.tsx'], [R[1], 'TASK', 'plan the wishlist (sub-agent)'],
      [R[2], 'WRITE', 'src/wishlist/Wishlist.tsx', PAL.blue], [R[3], 'WRITE', 'api/wishlist.py', PAL.green],
      [R[4], 'EDIT', 'api/urls.py', PAL.green], [R[5], 'WRITE', 'tests/test_wishlist.py', PAL.yellow], [R[6], 'BASH', 'npm run build  ok']],
    doneAt: 51.2, doneText: 'Done: 5 files changed',
  };
  function chatScene(ctx, t) {
    const v = view({ scale: 36, cx: CX + 1010, cy: CY + CH / 2 + 70, yaw: lerp(0.9, 1.1, prog(t, 40, 55)), fx: 10, fy: 6 });
    const cur = t > R[5] ? 'wishlist/tests' : t > R[3] ? 'wishlist/api' : 'wishlist/ui';
    drawTown(ctx, v, town, t, { ground: GROUND, hl: t > R[2] && t < 51 ? CV.bByName(town, cur).id : null });
    for (const b of town.blocks) {
      if (b.feature !== 'wishlist' || t < b.born || t > b.born + 0.8) continue;
      const a = prog(t, b.born, b.born + 0.8), [sx, sy] = v.p(b.x + 0.5, b.y + 0.5, b.z + 1.4 + a * 1.5);
      text(ctx, '+1', sx, sy, { size: 16, fam: 'pixel', col: '#fff', align: 'center', shadow: '#05060d', sd: 3, alpha: 1 - a });
    }
    chat(ctx, CX + 24, CY + 24, 620, CH - 48, t, CHAT);
  }

  // ---------- 55-70 test view ----------
  const TILES = route([[0, 0], [9, 0], [9, 6]]);
  const TSTEPS = [[0, 'Home'], [3, 'Login'], [6, 'Catalog'], [9, 'Add to cart'], [12, 'Cart total'], [15, 'Pay']];
  const CASES = [['test_login', 3], ['test_browse_catalog', 6], ['test_add_to_cart', 9], ['test_cart_total', 12], ['test_checkout', 15]];
  const FAIL = 12, WALK0 = 56.9, SPEED = 1.95, FAIL_T = WALK0 + FAIL / SPEED;
  const DECOR = [];
  [[1, -3, PAL.blue, 3], [2, -3, PAL.blue, 2], [4, -3, PAL.green, 3], [7, -3, PAL.yellow, 2], [10, -3, PAL.purple, 3], [6, 3, PAL.green, 1], [6, 4, PAL.blue, 2]]
    .forEach(([x, y, col, h], i) => { for (let z = 0; z < h; z++) DECOR.push({ x: x + 0.03, y: y + 0.03, z, w: 0.94, d: 0.94, h: 0.94, col, o: { seed: i * 9 + z } }); });
  function testScene(ctx, t) {
    const s = Math.min(FAIL, Math.max(0, (t - WALK0) * SPEED)), failed = t >= FAIL_T;
    const p = shopperAt(TILES, s);
    const v = view({ scale: 60, cx: CX + 1000, cy: CY + CH / 2 + 60, yaw: 0.8, fx: lerp(p.x, 6, 0.5), fy: lerp(p.y, 2, 0.5) });
    testWorld(ctx, v, t, { ground: [-4, -5, 18, 15], tiles: TILES, steps: TSTEPS, s, failAt: FAIL, failed, failT: FAIL_T, walking: !failed && t > WALK0, decor: DECOR });
    toolbar(ctx, t, { mode: 'TEST', links: 'SHOPPER ROUTE' });
    const lx = CX + 24, ly = CY + 94, lw = 500;
    panel(ctx, lx, ly, lw, 560, { fill: PAL.panel });
    text(ctx, 'TEST CASES', lx + 28, ly + 48, { size: 16, fam: 'pixel', col: '#fff' });
    button(ctx, 'PYTEST - BACKEND', lx + 28, ly + 74, lw - 56, 52, { col: PAL.green, size: 14, press: t > 56.25 && t < 56.5 ? 1 : 0 });
    CASES.forEach(([n, idx], i) => {
      const y = ly + 160 + i * 74;
      const pass = s > idx + 0.6, fail = failed && idx === FAIL, skip = failed && idx > FAIL, run = t > WALK0 && !pass && !fail && !skip && (i === 0 || s > CASES[i - 1][1] + 0.6);
      ctx.fillStyle = fail ? 'rgba(234,67,53,0.18)' : run ? 'rgba(92,242,255,0.10)' : '#11162B'; ctx.fillRect(lx + 20, y, lw - 40, 60);
      if (pass) check(ctx, lx + 38, y + 18, 3.6);
      else if (fail) cross(ctx, lx + 40, y + 20, 3.6);
      else if (run) spinner(ctx, lx + 56, y + 30, t, 5);
      else { ctx.fillStyle = '#39427A'; ctx.fillRect(lx + 50, y + 24, 12, 12); }
      text(ctx, n, lx + 96, y + 38, { size: 22, fam: 'mono', col: fail ? '#FF9AA6' : skip ? '#59618F' : '#fff' });
      if (skip) text(ctx, 'skipped', lx + lw - 40, y + 38, { size: 18, fam: 'silk', col: '#59618F', align: 'right' });
    });
    problemCard(ctx, CX + CW - 650, CY + CH - 400, 620, t, FAIL_T + 0.4, {
      title: 'TEST_CART_TOTAL FAILED', press: t > 66.9 && t < 67.2 ? 1 : 0, button: 'ASK CLAUDE TO FIX',
      lines: [['The total ignores quantity', '#fff'], ['expected 59.98, got 29.99', '#FF9AA6', 'mono'], ['api/cart.py:42', '#FFD98A', 'mono'], ['Next: multiply price by quantity', '#8dffa8']],
    });
    if (t > 55.3 && t < 57) { const e = ease.inOut(prog(t, 55.3, 56.2)); cursor(ctx, lerp(1300, lx + 250, e), lerp(950, ly + 100, e), prog(t, 56.2, 56.6)); }
    if (t > 65.4) { const e = ease.inOut(prog(t, 65.4, 66.8)); cursor(ctx, lerp(1300, CX + CW - 340, e), lerp(700, CY + CH - 74, e), prog(t, 66.9, 67.3)); }
    if (t > 67.3) {
      const a = prog(t, 67.3, 67.6);
      tag(ctx, 'SENT TO CLAUDE CODE', CX + CW - 340, CY + CH - 440, { size: 14, col: '#0B1020', bg: shade(PAL.cyan, 1, a) });
    }
  }

  // ---------- 70-80 source control ----------
  const FILES = [['M', 'api/cart.py'], ['A', 'src/wishlist/Wishlist.tsx'], ['A', 'api/wishlist.py'], ['M', 'api/urls.py'], ['A', 'tests/test_wishlist.py']];
  const MSG = 'Add wishlist, fix cart total';
  function gitScene(ctx, t) {
    darkBg(ctx, t);
    const x = CX + 24, y = CY + 24, w = 880, h = CH - 48;
    panel(ctx, x, y, w, h, { fill: PAL.panel });
    text(ctx, 'SOURCE CONTROL', x + 28, y + 52, { size: 16, fam: 'pixel', col: '#fff' });
    const pushed = t > 77.5;
    text(ctx, pushed ? 'main  up to date' : 'main  5 changes', x + w - 28, y + 52, { size: 20, fam: 'mono', col: pushed ? '#8dffa8' : '#FFD98A', align: 'right' });
    FILES.forEach(([b, f], i) => {
      const ry = y + 90 + i * 62, staged = t > 71 + i * 0.35;
      ctx.fillStyle = '#11162B'; ctx.fillRect(x + 20, ry, w - 40, 52);
      ctx.strokeStyle = staged ? PAL.green : '#39427A'; ctx.lineWidth = 3; ctx.strokeRect(x + 38, ry + 14, 24, 24);
      if (staged) check(ctx, x + 40, ry + 18, 2.2);
      text(ctx, f, x + 84, ry + 34, { size: 22, fam: 'mono', col: pushed ? '#7E87BF' : '#fff' });
      ctx.fillStyle = b === 'M' ? PAL.yellow : PAL.green; ctx.fillRect(x + w - 76, ry + 10, 32, 32);
      text(ctx, b, x + w - 60, ry + 27, { size: 14, fam: 'pixel', col: '#0B1020', align: 'center', base: 'middle' });
    });
    const my = y + 420;
    ctx.fillStyle = '#0B1020'; ctx.fillRect(x + 20, my, w - 40, 64);
    ctx.strokeStyle = t > 72.8 && t < 75 ? PAL.cyan : PAL.line; ctx.lineWidth = 3; ctx.strokeRect(x + 20, my, w - 40, 64);
    const m = typed(MSG, t, 72.8, 16), mw = text(ctx, m || 'Commit message', x + 40, my + 42, { size: 24, col: m ? '#fff' : '#59618F' });
    if (t > 72.8 && t < 75 && Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x + 42 + (m ? mw : 0), my + 16, 3, 32); }
    button(ctx, 'COMMIT', x + 20, my + 94, 250, 62, { col: PAL.blue, size: 15 });
    button(ctx, 'COMMIT AND PUSH', x + 290, my + 94, w - 310, 62, { col: PAL.green, size: 15, press: t > 75.9 && t < 76.15 ? 1 : 0 });
    if (t > 76.1) {
      const e = prog(t, 76.1, 77.4);
      ctx.fillStyle = '#0B1020'; ctx.fillRect(x + 20, my + 186, w - 40, 30);
      ctx.fillStyle = PAL.green; ctx.fillRect(x + 20, my + 186, (w - 40) * ease.inOut(e), 30);
      if (!pushed) text(ctx, 'pushing to origin/main...', x + 20, my + 250, { size: 22, fam: 'mono', col: '#9AA3D6' });
      else {
        const a = ease.outBack(prog(t, 77.5, 77.9));
        ctx.save(); ctx.translate(x + 20, my + 228); ctx.scale(a, a);
        check(ctx, 0, 4, 3.6); text(ctx, 'Pushed to origin/main: 1 commit', 50, 26, { size: 26, col: '#8dffa8' });
        ctx.restore();
      }
    }
    if (t > 74.5) { const e = ease.inOut(prog(t, 74.5, 75.7)); cursor(ctx, lerp(1400, x + 590, e), lerp(950, my + 128, e), prog(t, 75.9, 76.3)); }
    // history
    const hx = CX + 930, hw = CW - 954;
    panel(ctx, hx, y, hw, h, { fill: PAL.panel });
    text(ctx, 'HISTORY', hx + 28, y + 52, { size: 16, fam: 'pixel', col: '#fff' });
    const commits = [[MSG, 'just now', PAL.green], ['Add hand control with a hologram look', '2 days ago', PAL.blue], ['Codeville: desktop workspace for vibe coding', '5 days ago', PAL.yellow]];
    const ins = ease.outBack(prog(t, 77.5, 77.95));
    let cy = y + 96;
    commits.forEach(([s, when, col], i) => {
      if (i === 0 && t < 77.5) return;
      const k = i === 0 ? ins : 1;
      ctx.save(); ctx.translate(hx + 24, cy); ctx.scale(k, k);
      ctx.fillStyle = '#11162B'; ctx.fillRect(0, 0, hw - 48, 96);
      ctx.fillStyle = col; ctx.fillRect(18, 18, 20, 20);
      ctx.fillStyle = '#39427A'; ctx.fillRect(25, 42, 6, 54);
      text(ctx, s.length > 34 ? s.slice(0, 33) + '...' : s, 56, 38, { size: 21, col: '#fff' });
      text(ctx, when, 56, 74, { size: 18, fam: 'silk', col: '#7E87BF' });
      ctx.restore();
      cy += 110 * (i === 0 ? ins : 1);
    });
  }

  // ---------- 80-93 hand control: full-screen hologram lab ----------
  // power on 80-81.6, palm rotate 81.6-86.8, two-hand zoom 86.8-88.6, fist hold 88.6-89.8, double pinch reset 89.8-91.2
  const GEST = [['OPEN PALM', 'ROTATE'], ['TWO HANDS', 'ZOOM'], ['FIST', 'HOLD'], ['DOUBLE PINCH', 'RESET']];
  const HP = [81.6, 86.8, 88.6, 89.8, 91.2];
  function handScene(ctx, t) {
    holoBg(ctx, t);
    const power = prog(t, 80.1, 80.7), scanZ = t < 81.7 ? lerp(-0.5, 5.5, prog(t, 80.3, 81.7)) : null;
    const phase = t < HP[0] ? -1 : t < HP[1] ? 0 : t < HP[2] ? 1 : t < HP[3] ? 2 : t < HP[4] ? 3 : 4;
    const rot = (x) => 0.8 + Math.sin(Math.min(x, HP[1] - HP[0]) * 1.25) * 0.75;
    const yawA = rot(99);
    let yaw = t < HP[0] ? 0.8 + (t - 80) * 0.15 : rot(t - HP[0]), scale = 40 + 14 * ease.inOut(prog(t, HP[1] + 0.2, HP[2]));
    if (t < HP[0]) yaw = lerp(0.8 + (t - 80) * 0.15, rot(0), prog(t, HP[0] - 0.4, HP[0]));
    if (t > HP[3] + 0.4) { const e = ease.inOut(prog(t, HP[3] + 0.5, HP[4])); yaw = lerp(yawA, 0.8, e); scale = lerp(54, 40, e); }
    if (t > HP[4]) yaw = 0.8 + (t - HP[4]) * 0.12;
    const v = view({ scale, cx: W / 2 + 40, cy: 620, yaw, pitch: 0.6, fx: 8, fy: 5 });
    CV.holoBase(ctx, v, t, 8, 5, power);
    drawTown(ctx, v, town, 999, { holo: true, ground: GROUND, maxZ: scanZ, links: t > HP[0], labels: t > HP[0] });
    CV.holoAir(ctx, v, t, 8, 5, power, scanZ);
    CV.holoPanel(ctx, 70, 250, 330, t, 80.8, 'HOLO // SHOP-APP', [['FEATURES', 5], ['FILES', 96], ['LINKS', 12], ['TESTS', 24]], { bars: true });
    CV.holoPanel(ctx, W - 400, 250, 330, t, 81.1, 'HAND TRACKING', [['HANDS', phase === 1 ? 2 : 1], ['LANDMARKS', phase === 1 ? 42 : 21], ['GESTURE', phase < 0 ? '...' : GEST[Math.min(phase, 3)][0].split(' ').pop()]]);
    if (t > 81.1) CV.radar(ctx, W - 235, 640, 95, t, prog(t, 81.1, 81.6));
    const midX = W / 2 + 40, hy = 840;
    if (phase === 0) { const hx = midX + Math.sin(Math.min(t - HP[0], HP[1] - HP[0]) * 1.25) * 380; hand(ctx, hx, hy, 15); CV.handLock(ctx, hx, hy, t, 'HAND 1  99%'); }
    else if (phase === 1) {
      const sep = lerp(130, 430, ease.inOut(prog(t, HP[1] + 0.2, HP[2])));
      hand(ctx, midX - sep, hy, 15, { flip: true }); hand(ctx, midX + sep, hy, 15);
      CV.handLock(ctx, midX - sep, hy, t, 'HAND 1'); CV.handLock(ctx, midX + sep, hy, t, 'HAND 2');
      ctx.setLineDash([10, 10]); ctx.beginPath(); ctx.moveTo(midX - sep + 90, hy); ctx.lineTo(midX + sep - 90, hy); ctx.strokeStyle = PAL.yellow; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    } else if (phase === 2) { hand(ctx, midX + 260, hy, 15, { fist: true }); CV.handLock(ctx, midX + 260, hy, t, 'HOLD'); }
    else if (phase === 3) { const pinch = (t > HP[3] + 0.2 && t < HP[3] + 0.35) || (t > HP[3] + 0.45 && t < HP[3] + 0.6); hand(ctx, midX + 260, hy, 15, { fist: pinch }); CV.handLock(ctx, midX + 260, hy, t, pinch ? 'PINCH' : 'HAND 1'); }
    GEST.forEach(([g, d], i) => {
      const w = 380, x = W / 2 - 2 * (w + 16) + 8 + i * (w + 16), y = 990, on = i === phase;
      ctx.fillStyle = on ? PAL.cyan : 'rgba(6,30,44,0.8)'; ctx.fillRect(x, y, w, 56);
      if (!on) { ctx.strokeStyle = 'rgba(92,242,255,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, 56); }
      text(ctx, `${g} = ${d}`, x + w / 2, y + 29, { size: 14, fam: 'pixel', col: on ? '#05060d' : '#9FDDE8', align: 'center', base: 'middle' });
    });
    if (t > HP[4]) headline(ctx, [['Your', '#fff'], ['code,', '#fff'], ['as', '#fff'], ['a', '#fff'], ['hologram.', PAL.cyan]], t, HP[4] + 0.05, W / 2, 245, { size: 64 });
    else tag(ctx, 'THE CAMERA PICTURE STAYS ON THIS COMPUTER', W / 2, 230, { size: 12, col: PAL.cyan, bg: 'rgba(6,16,26,0.85)' });
  }

  // ---------- timeline ----------
  const SCENES = [
    [0, 10, '01', 'FIRST RUN', 'Connect Claude Code once. After that, you just prompt.', null, welcome],
    [10, 25, '02', 'PROJECT ANALYSIS', 'Open any vibe-coded project and see what is really inside', 'FILES', analysis],
    [25, 40, '03', 'BLOCK TOWN', 'Your prompts, made visual: one building per feature, one block per file', 'TOWN', townScene],
    [40, 55, '04', 'PROMPT IT, WATCH IT BUILD', 'Type a prompt. Every file the agent writes drops into the town, live.', 'CHAT', chatScene],
    [55, 70, '05', 'TEST VIEW', 'A shopper walks your tests, stops where it breaks, and you prompt the fix', 'TOWN', testScene],
    [70, 80, '06', 'SOURCE CONTROL', 'Ship what you prompted: stage, commit and push in one click', 'GIT', gitScene],
    [80, 93, '07', 'HOLOGRAM MODE', 'Like a sci-fi lab: turn on the camera and steer the town with your hands', 'TOWN', handScene, true],
  ];

  const INTRO = 3.5;
  function render(ctx, g) {
    if (g < INTRO) { CV.titleCard(ctx, g, 0); wipe(ctx, g, INTRO - 0.45, 0.9); return; }
    const t = g - INTRO;
    if (t < 0.45) { renderWalk(ctx, t); wipe(ctx, g, INTRO - 0.45, 0.9); return; }
    renderWalk(ctx, t);
  }
  const END = 93;
  function renderWalk(ctx, t) {
    if (t >= END) { endCard(ctx, t, END, town); wipe(ctx, t, END - 0.45, 0.9); return; }
    darkBg(ctx, t);
    const i = SCENES.findIndex(([a, b]) => t >= a && t < b), [t0, t1, num, title, sub, nav, draw, full] = SCENES[i];
    const fade = 1 - win(t, t0, t1, 0.3, 0.3);
    if (full) {
      draw(ctx, t);
      if (fade > 0) { ctx.fillStyle = `rgba(5,6,13,${fade})`; ctx.fillRect(0, 0, W, H); }
    } else {
      const pop = ease.outBack(prog(t, 0, 0.6));
      ctx.save(); ctx.translate(W / 2, WY + WH / 2); ctx.scale(pop, pop); ctx.translate(-W / 2, -(WY + WH / 2));
      windowFrame(ctx, nav);
      ctx.save(); ctx.beginPath(); ctx.rect(CX, CY, CW, CH); ctx.clip();
      if (draw !== gitScene && draw !== welcome && draw !== analysis) { ctx.fillStyle = '#0E1A2A'; ctx.fillRect(CX, CY, CW, CH); }
      draw(ctx, t);
      if (fade > 0 && !(t0 === 0 && t < 0.3)) { ctx.fillStyle = `rgba(6,16,26,${fade})`; ctx.fillRect(CX, CY, CW, CH); }
      ctx.restore();
      ctx.restore();
    }
    caption(ctx, t, t0, t1, num, title, sub, RAINBOW[i % 4]);
    wipe(ctx, t, END - 0.45, 0.9);
  }

  CV.scenes = CV.scenes || {};
  CV.scenes.demo = { duration: END + 4 + INTRO, render };
})();
