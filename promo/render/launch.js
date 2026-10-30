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
  function codeWall(ctx, g) {
    const t = g - 2.7 + 1.6; // local time: already scrolling fast when the title card hands over
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
    const band = Math.max(CV.win(g, 2.75, 4.35, 0.2, 0.2), CV.win(g, 4.4, 5.65, 0.2, 0.3));
    ctx.fillStyle = `rgba(11,16,32,${0.8 * band})`; ctx.fillRect(0, 420, W, 230);
    headline(ctx, [['Your', '#fff'], ['prompt', PAL.cyan], ['writes', '#fff'], ['1,284', PAL.yellow], ['lines...', '#fff']], g, 2.8, W / 2, 540, { size: 100, out: 4.15, stagger: 0.07 });
    headline(ctx, [['...now', '#fff'], ['SEE', PAL.red], ['what', '#fff'], ['it', '#fff'], ['built.', PAL.yellow]], g, 4.45, W / 2, 540, { size: 104, out: 5.45, stagger: 0.07 });
  }

  // ---------- 6-12: the town rains down, "Meet Codeville" ----------
  function meet(ctx, t) {
    sky(ctx, t);
    const e = ease.inOut(prog(t, 6, 12));
    const v = view({ scale: lerp(36, 50, e), cx: W / 2, cy: lerp(700, 690, e), yaw: lerp(0.45, 0.85, e), fx: 8, fy: 5 });
    drawTown(ctx, v, town, t, { ground: GROUND, labelAlpha: () => prog(t, 9.6, 10.0), linkAlpha: () => prog(t, 10, 10.6) });
    headline(ctx, [['Your', '#fff'], ['prompts,', '#fff'], ['made', '#fff'], ['visual.', PAL.yellow]], t, 6.35, W / 2, 150, { size: 92, out: 8.45 });
    headline(ctx, [['Meet', '#fff']], t, 8.7, W / 2, 110, { size: 60 });
    if (t > 8.9) logo(ctx, W / 2, 210, 88, t, 8.9);
  }

  // ---------- 12-26: the real app (promo/capture records it; mux.py lays it into this window) ----------
  const SLOT = { x: 272, y: 236, w: 1376, h: 774 };
  function slot(ctx, holo) {
    ctx.fillStyle = holo ? 'rgba(92,242,255,0.12)' : 'rgba(5,6,13,0.25)'; ctx.fillRect(SLOT.x - 16, SLOT.y - 16, SLOT.w + 32, SLOT.h + 32);
    ctx.fillStyle = '#05060d'; ctx.fillRect(SLOT.x - 6, SLOT.y - 6, SLOT.w + 12, SLOT.h + 12);
    ctx.strokeStyle = holo ? PAL.cyan : '#fff'; ctx.lineWidth = 3; ctx.strokeRect(SLOT.x - 6, SLOT.y - 6, SLOT.w + 12, SLOT.h + 12);
    tag(ctx, 'REAL APP', SLOT.x + SLOT.w - 70, SLOT.y + SLOT.h + 30, { size: 14, col: '#fff', bg: PAL.red });
  }
  function live(ctx, t) {
    sky(ctx, t); slot(ctx);
    headline(ctx, [['Prompt', PAL.cyan], ['it.', '#fff'], ['Watch', '#fff'], ['it', '#fff'], ['build.', '#fff'], ['Live.', PAL.red]], t, 12.15, W / 2, 130, { size: 84 });
  }
  function tests(ctx, t) {
    sky(ctx, t); slot(ctx);
    headline(ctx, [['Tests', '#fff'], ['you', '#fff'], ['can', '#fff'], ['see.', PAL.green]], t, 17.15, W / 2, 130, { size: 96 });
  }
  function holo(ctx, t) {
    holoBg(ctx, t); slot(ctx, true);
    headline(ctx, [['Control', '#fff'], ['it', '#fff'], ['with', '#fff'], ['your', '#fff'], ['hands.', PAL.cyan]], t, 22.2, W / 2, 130, { size: 96 });
  }

  function render(ctx, t) {
    if (t < 2.7) CV.titleCard(ctx, t, 0);
    else if (t < 6.0) codeWall(ctx, t);
    else if (t < 12.0) meet(ctx, t);
    else if (t < 17.0) live(ctx, t);
    else if (t < 22.0) tests(ctx, t);
    else if (t < 26.0) holo(ctx, t);
    else endCard(ctx, t, 26.0, town);
    wipe(ctx, t, 2.25, 0.9);
    wipe(ctx, t, 5.55, 0.9);
    wipe(ctx, t, 11.55, 0.9);
    wipe(ctx, t, 16.55, 0.9);
    wipe(ctx, t, 25.55, 0.9);
  }

  CV.scenes = CV.scenes || {};
  CV.scenes.launch = { duration: 30, render };
})();
