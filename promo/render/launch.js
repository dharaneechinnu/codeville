// 30 second launch ad. Each scene draws from the absolute time t.
(function () {
  'use strict';
  const { W, H, PAL, prog, ease, lerp, hash, view, drawTown, headline, wipe, sky, logo, text, tag, panel,
    chat, route, testWorld, holoBg, hand, endCard, scene, problemCard, shopper } = CV;

  const town = CV.makeTown({
    features: [
      { name: 'auth', at: [0, 0], fe: 6, be: 5, test: 3 },
      { name: 'catalog', at: [6, 0], fe: 9, be: 7, test: 4 },
      { name: 'admin', at: [0, 6], fe: 5, be: 6, test: 2 },
      { name: 'payment', at: [6, 6], fe: 4, be: 8, test: 4 },
      { name: 'cart', at: [12, 6], fe: 7, be: 6, test: 3 },
    ],
    db: { at: [12, 0], n: 14 },
    svc: [{ name: 'stripe', at: [16, 3] }],
    trees: [[-2, 4], [5, -2], [11, 4], [5, 11], [-2, 10], [17, 10], [10, 11], [17, 0]],
    links: [['auth/ui', 'auth/api'], ['catalog/ui', 'catalog/api'], ['catalog/api', 'database'], ['payment/api', 'stripe'],
      ['auth/api', 'database'], ['cart/api', 'database'], ['payment/ui', 'payment/api'], ['admin/api', 'database']],
  });
  // The cart district is built live in the chat scene; the rest rains down in "Meet Codeville".
  const CART_FE = 13.9, CART_BE = 14.6, CART_TEST = 15.7;
  const rest = town.blocks.filter((b) => b.feature !== 'cart');
  rest.map((b) => [b, b.z + hash(b.id) * 2.5]).sort((a, b) => a[1] - b[1]).forEach(([b], i) => { b.born = 6.25 + (i / rest.length) * 3.2 + hash(b.id + 9) * 0.2; });
  for (const b of town.blocks) {
    if (b.feature !== 'cart') continue;
    const layer = town.buildings[b.b].layer;
    b.born = (layer === 'fe' ? CART_FE : layer === 'be' ? CART_BE : CART_TEST) + b.k * 0.11;
  }
  town.trees.forEach((tr, i) => { tr.born = 9.0 + i * 0.12; });
  const GROUND = [-3, -3, 23, 16];

  // ---------- 0-6: code wall that breaks into blocks ----------
  const KW = '#C792EA', STR = '#C3E88D', FN = '#82AAFF', PL = '#D4DAFF', CM = '#59618F', NUM = '#F78C6C';
  const CODE = [
    [['import', KW], [' { useState }', PL], [' from', KW], [" 'react'", STR]],
    [['export function', KW], [' Cart', FN], ['({ items }) {', PL]],
    [['  const', KW], [' [total, setTotal]', PL], [' = ', PL], ['useState', FN], ['(', PL], ['0', NUM], [')', PL]],
    [['  // TODO: the agent wrote 400 lines here', CM]],
    [['def', KW], [' checkout', FN], ['(request, cart_id):', PL]],
    [['    cart', PL], [' = ', PL], ['Cart', FN], ['.objects.get(', PL], ['pk', PL], ['=cart_id)', PL]],
    [['    charge', PL], [' = ', PL], ['stripe', FN], ['.Charge.create(', PL], ['amount', PL], ['=cart.total)', PL]],
    [['  return', KW], [' <List', FN], [' items', PL], ['={items}', PL], [' />', FN]],
    [['class', KW], [' WishlistSerializer', FN], ['(serializers.ModelSerializer):', PL]],
    [['router', PL], ['.register(', PL], ["r'orders'", STR], [', OrderViewSet)', PL]],
    [['test(', FN], ["'adds item to cart'", STR], [', async () => {', PL]],
    [['  expect', FN], ['(cart.total).toBe(', PL], ['59.98', NUM], [')', PL]],
    [['@login_required', KW]],
    [['const', KW], [' api', PL], [' = ', PL], ['fetch', FN], ['(', PL], ['`/api/cart/${id}`', STR], [')', PL]],
    [['    for', KW], [' item', PL], [' in', KW], [' cart.items.all():', PL]],
    [['// 1,284 files changed', CM]],
  ];
  function codeWall(ctx, t) {
    ctx.fillStyle = '#0B1020'; ctx.fillRect(0, 0, W, H);
    const lh = 50, tt = Math.min(t, 3.2), scroll = 30 * tt + 240 * tt * tt;
    const first = Math.floor(scroll / lh) - 1;
    ctx.font = CV.font(30, 'mono');
    for (let li = first; li < first + H / lh + 2; li++) {
      const y = 90 + li * lh - scroll;
      const line = CODE[((li % CODE.length) + CODE.length) % CODE.length];
      text(ctx, String(li + 1).padStart(3), 60, y, { size: 26, fam: 'mono', col: '#39427A' });
      let x = 170;
      ctx.font = CV.font(30, 'mono');
      line.forEach(([s, col], k) => {
        const w = ctx.measureText(s).width, id = li * 31 + k;
        if (t < 3.35) {
          text(ctx, s, x, y, { size: 30, fam: 'mono', col });
        } else {
          const tk = 3.5 + hash(id) * 1.4 + (1 - y / H) * 0.3, f = Math.max(0, t - tk);
          const lead = s.length - s.trimStart().length;
          const bx = x + lead * w / s.length, bw = w - lead * w / s.length;
          ctx.save(); ctx.translate(bx + bw / 2, y - 10 + 0.5 * 2600 * f * f); ctx.rotate((hash(id + 3) - 0.5) * f * 4);
          ctx.fillStyle = CV.shade(col, 0.5); ctx.fillRect(-bw / 2 + 4, -14 + 4, bw, 30);
          ctx.fillStyle = col; ctx.fillRect(-bw / 2, -14, bw, 30);
          ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-bw / 2, -14, bw, 5);
          ctx.restore();
        }
        x += w;
      });
    }
    if (t < 0.9 && Math.floor(t * 4) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(170, 66, 16, 32); }
    const band = Math.max(CV.win(t, 0.15, 2.95, 0.25, 0.25), CV.win(t, 3.0, 5.6, 0.25, 0.3));
    ctx.fillStyle = `rgba(11,16,32,${0.78 * band})`; ctx.fillRect(0, 420, W, 230);
    headline(ctx, [['Your', '#fff'], ['AI', PAL.cyan], ['writes', '#fff'], ['the', '#fff'], ['code...', PAL.yellow]], t, 0.25, W / 2, 540, { size: 104, out: 2.75 });
    headline(ctx, [['...but', '#fff'], ['what', '#fff'], ['did', '#fff'], ['it', '#fff'], ['actually', PAL.red], ['build?', PAL.yellow]], t, 3.05, W / 2, 540, { size: 96, out: 5.4 });
  }

  // ---------- 6-12: the town rains down, "Meet Codeville" ----------
  function meet(ctx, t) {
    sky(ctx, t);
    const e = ease.inOut(prog(t, 6, 12));
    const v = view({ scale: lerp(36, 50, e), cx: W / 2, cy: lerp(700, 690, e), yaw: lerp(0.45, 0.85, e), fx: 8, fy: 5 });
    drawTown(ctx, v, town, t, { ground: GROUND, labelAlpha: () => prog(t, 9.6, 10.0), linkAlpha: () => prog(t, 10, 10.6) });
    headline(ctx, [['Every', '#fff'], ['feature', '#fff'], ['becomes', '#fff'], ['a', '#fff'], ['building.', PAL.yellow]], t, 6.35, W / 2, 150, { size: 80, out: 8.45 });
    headline(ctx, [['Meet', '#fff']], t, 8.7, W / 2, 110, { size: 60 });
    if (t > 8.9) logo(ctx, W / 2, 210, 88, t, 8.9);
  }

  // ---------- 12-17: chat, the cart district appears live ----------
  const CHAT = {
    prompt: 'add a shopping cart', typeAt: 12.35, sendAt: 13.45, cps: 18,
    rows: [[CART_FE, 'WRITE', 'src/cart/Cart.tsx', PAL.blue], [CART_BE, 'WRITE', 'api/cart.py', PAL.green],
      [15.15, 'EDIT', 'api/urls.py', PAL.green], [CART_TEST, 'WRITE', 'tests/test_cart.py', PAL.yellow]],
    doneAt: 16.35, doneText: '16 files - cart is live',
  };
  function live(ctx, t) {
    sky(ctx, t);
    const e = ease.inOut(prog(t, 12, 17));
    const v = view({ scale: lerp(44, 52, e), cx: 1290, cy: 650, yaw: lerp(0.9, 1.05, e), fx: lerp(8, 11, e), fy: lerp(5, 6.5, e) });
    drawTown(ctx, v, town, t, { ground: GROUND, hl: t > CART_FE ? CV.bByName(town, 'cart/ui').id : null });
    // "+1" pops over each new cart block
    for (const b of town.blocks) {
      if (b.feature !== 'cart' || t < b.born || t > b.born + 0.8) continue;
      const a = prog(t, b.born, b.born + 0.8), [sx, sy] = v.p(b.x + 0.5, b.y + 0.5, b.z + 1.4 + a * 1.5);
      text(ctx, '+1', sx, sy, { size: 18, fam: 'pixel', col: '#fff', align: 'center', shadow: '#05060d', sd: 3, alpha: 1 - a });
    }
    CV.chat(ctx, 90, 250, 640, 700, t, CHAT);
    headline(ctx, [['Watch', '#fff'], ['every', '#fff'], ['file', '#fff'], ['appear.', '#fff'], ['Live.', PAL.red]], t, 12.15, W / 2, 130, { size: 84 });
  }

  // ---------- 17-22: the shopper runs the tests ----------
  const TILES = route([[0, 0], [9, 0], [9, 5]]);
  const STEPS = [[0, 'Home'], [3, 'Login'], [6, 'Add item'], [10, 'Cart'], [14, 'Pay']];
  const FAIL = 10, WALK0 = 17.35, SPEED = 4.1, FAIL_T = WALK0 + FAIL / SPEED;
  const DECOR = [];
  [[1, -3, PAL.blue, 3], [2, -3, PAL.blue, 2], [4, -3, PAL.green, 4], [5, -3, PAL.green, 3], [7, -3, PAL.yellow, 2], [10, -3, PAL.purple, 3],
    [11, -3, PAL.purple, 2], [6, 3, PAL.blue, 1], [6, 4, PAL.blue, 2], [12, 1, PAL.green, 1]].forEach(([x, y, col, h], i) => {
    for (let z = 0; z < h; z++) DECOR.push({ x: x + 0.03, y: y + 0.03, z, w: 0.94, d: 0.94, h: 0.94, col, o: { seed: i * 9 + z } });
  });
  function tests(ctx, t) {
    sky(ctx, t);
    const s = Math.min(FAIL, Math.max(0, (t - WALK0) * SPEED)), failed = t >= FAIL_T;
    const p = CV.shopperAt(TILES, s);
    const v = view({ scale: 78, cx: 820, cy: 660, yaw: 0.8, fx: lerp(p.x, 6, 0.4), fy: lerp(p.y, 1.5, 0.4) });
    testWorld(ctx, v, t, { ground: [-4, -5, 18, 14], tiles: TILES, steps: STEPS, s, failAt: FAIL, failed, failT: FAIL_T, walking: !failed && t > WALK0, decor: DECOR });
    problemCard(ctx, 1230, 560, 610, t, FAIL_T + 0.25, {
      title: 'TEST FAILED',
      lines: [['cart total is wrong', '#fff'], ['expected 59.98, got 29.99', '#FF9AA6', 'mono'], ['Next: fix api/cart.py:42', '#8dffa8', 'mono']],
    });
    headline(ctx, [['Tests', '#fff'], ['you', '#fff'], ['can', '#fff'], ['see.', PAL.green]], t, 17.15, W / 2, 130, { size: 96 });
  }

  // ---------- 22-26: hologram + hand control ----------
  function holo(ctx, t) {
    holoBg(ctx, t);
    const k = t - 22, hx = 960 + Math.sin(k * 1.7) * 430, hy = 700 + Math.cos(k * 3.4) * 50;
    const v = view({ scale: 44, cx: W / 2, cy: 640, yaw: 0.8 + Math.sin(k * 1.7) * 0.75, pitch: 0.62 + Math.cos(k * 3.4) * 0.08, fx: 8, fy: 5 });
    drawTown(ctx, v, town, 99, { holo: true, ground: GROUND, labels: true });
    hand(ctx, hx, hy + 80, 20);
    tag(ctx, 'OPEN PALM  =  ROTATE', W / 2, 1000, { size: 18, col: PAL.cyan, bg: 'rgba(6,16,26,0.85)' });
    const flick = t < 22.25 ? (Math.floor(t * 30) % 2 ? 0.6 : 0) : 0;
    if (flick) { ctx.fillStyle = `rgba(92,242,255,${flick * 0.25})`; ctx.fillRect(0, 0, W, H); }
    headline(ctx, [['Control', '#fff'], ['it', '#fff'], ['with', '#fff'], ['your', '#fff'], ['hands.', PAL.cyan]], t, 22.2, W / 2, 130, { size: 96 });
  }

  function render(ctx, t) {
    if (t < 6.0) codeWall(ctx, t);
    else if (t < 12.0) meet(ctx, t);
    else if (t < 17.0) live(ctx, t);
    else if (t < 22.0) tests(ctx, t);
    else if (t < 26.0) holo(ctx, t);
    else endCard(ctx, t, 26.0, town);
    wipe(ctx, t, 5.55, 0.9);
    wipe(ctx, t, 11.55, 0.9);
    wipe(ctx, t, 16.55, 0.9);
    wipe(ctx, t, 25.55, 0.9);
  }

  CV.scenes = CV.scenes || {};
  CV.scenes.launch = { duration: 30, render };
})();
