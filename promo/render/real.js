// The real-UI demo's frame: title card, captions around the recorded app, and the end card.
// The recording itself (promo/capture) is laid over the window rectangle by promo/capture/mux.py.
(function () {
  'use strict';
  const { W, H, PAL, RAINBOW, prog, ease, text, shade, darkBg, titleCard, endCard, wipe } = CV;
  const R = CV.REAL;
  const UI = { x: 160, y: 160, w: 1600, h: 900 };
  const town = CV.makeTown({
    features: [
      { name: 'auth', at: [0, 0], fe: 6, be: 5, test: 3 }, { name: 'catalog', at: [6, 0], fe: 9, be: 7, test: 4 },
      { name: 'cart', at: [0, 6], fe: 7, be: 6, test: 3 }, { name: 'payment', at: [6, 6], fe: 4, be: 8, test: 4 },
      { name: 'wishlist', at: [12, 6], fe: 5, be: 4, test: 2 },
    ],
    db: { at: [12, 0], n: 14 }, svc: [{ name: 'stripe', at: [16, 4] }],
    trees: [[-2, 4], [5, -2], [11, 4], [5, 11], [-2, 10], [17, 10], [10, 11], [17, -1]],
  });

  function caption(ctx, t, s, i) {
    const a = prog(t, s.start + 0.05, s.start + 0.5), o = prog(t, s.end - 0.3, s.end);
    if (a <= 0 || o >= 1) return;
    const col = RAINBOW[i % 4], k = ease.outBack(a) * (1 - ease.inCubic(o));
    ctx.save(); ctx.translate(UI.x + 36, 80); ctx.scale(k, k);
    ctx.fillStyle = shade(col, 0.5); ctx.fillRect(-36, -30, 72, 72); ctx.fillStyle = col; ctx.fillRect(-36, -36, 72, 72);
    text(ctx, s.num, 0, 2, { size: 24, fam: 'pixel', col: '#fff', align: 'center', base: 'middle', shadow: 'rgba(0,0,0,0.3)', sd: 3 });
    ctx.restore();
    const dx = (1 - ease.outCubic(a)) * -50 - ease.inCubic(o) * 50, al = Math.min(1, a * 1.5) * (1 - o);
    text(ctx, s.title, UI.x + 100 + dx, 74, { size: 28, fam: 'pixel', col: '#fff', alpha: al, shadow: '#05060d', sd: 4 });
    text(ctx, s.sub, UI.x + 100 + dx, 124, { size: 28, col: '#AEB6E8', alpha: al });
    if (s.note) text(ctx, s.note, UI.x + UI.w, 132, { size: 17, fam: 'silk', col: '#7E87BF', align: 'right', alpha: al });
  }

  function render(ctx, t) {
    if (t < R.intro) { titleCard(ctx, t, 0); wipe(ctx, t, R.intro - 0.45, 0.9); return; }
    if (t >= R.uiEnd) { endCard(ctx, t, R.uiEnd, town); wipe(ctx, t, R.uiEnd - 0.45, 0.9); return; }
    darkBg(ctx, t);
    // the window the recording sits in
    ctx.fillStyle = 'rgba(92,242,255,0.10)'; ctx.fillRect(UI.x - 14, UI.y - 14, UI.w + 28, UI.h + 28);
    ctx.strokeStyle = PAL.cyan; ctx.lineWidth = 3; ctx.strokeRect(UI.x - 5, UI.y - 5, UI.w + 10, UI.h + 10);
    ctx.fillStyle = '#000'; ctx.fillRect(UI.x, UI.y, UI.w, UI.h);
    const i = R.scenes.findIndex((s) => t >= s.start && t < s.end), s = R.scenes[Math.max(0, i)];
    caption(ctx, t, s, Math.max(0, i));
    // "real app" badge, with the playback speed when a scene is sped up
    const bx = UI.x + UI.w, on = Math.floor(t * 1.6) % 2 === 0;
    ctx.font = CV.font(14, 'pixel'); const label = 'REAL APP - RECORDED LIVE', bw = ctx.measureText(label).width + 56;
    ctx.fillStyle = '#0B1020'; ctx.fillRect(bx - bw, 52, bw, 40); ctx.strokeStyle = '#39427A'; ctx.lineWidth = 2; ctx.strokeRect(bx - bw, 52, bw, 40);
    ctx.fillStyle = on ? PAL.red : '#6b1d18'; ctx.fillRect(bx - bw + 16, 64, 16, 16);
    text(ctx, label, bx - bw + 42, 79, { size: 14, fam: 'pixel', col: '#fff' });
    if (s.speed > 1) text(ctx, `>> ${s.speed}X SPEED`, bx - bw - 20, 79, { size: 14, fam: 'pixel', col: PAL.yellow, align: 'right' });
    wipe(ctx, t, R.intro - 0.45, 0.9);
    wipe(ctx, t, R.uiEnd - 0.45, 0.9);
  }

  CV.scenes = CV.scenes || {};
  CV.scenes.real = { duration: R.total, render };
})();
