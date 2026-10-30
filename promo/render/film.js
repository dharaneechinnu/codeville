// The narrated launch film: hook, why, what, five "when" moments, close. Every scene is as long as its narration
// (promo/capture/film_plan.py writes CV.FILM), so the picture follows the voice. Captions are burned in.
(function () {
  'use strict';
  const { W, H, PAL, prog, ease, lerp, clamp, hash } = CV;
  const { INK, MUTED, G, DISPLAY, BODY, BODY_M, f, reveal, label, bg, cubes, laptop, wipe, lockup, drawShot, prepareShots } = CV.P;
  const F = CV.FILM;
  const sc = (id) => F.scenes.find((s) => s.id === id);
  const caps = (s) => F.captions.filter((c) => c.start >= s.start && c.start < s.end);
  const CAP_Y = 1000;

  // ---------- hook: an agent writing files faster than anyone can read ----------
  const FILES = ['frontend/src/features/wishlist/Wishlist.tsx', 'frontend/src/features/wishlist/HeartButton.tsx', 'backend/store/wishlist.py',
    'backend/store/wishlist_api.py', 'backend/store/urls.py', 'backend/tests/test_wishlist.py', 'frontend/src/api.ts', 'frontend/src/App.tsx',
    'backend/store/models.py', 'frontend/src/features/catalog/ProductCard.tsx', 'backend/store/serializers.py', 'frontend/src/hooks/useWishlist.ts'];
  function hook(ctx, t, s) {
    const c = caps(s), q = c[2] ? c[2].start : s.end;
    bg(ctx, t, true);
    if (t < q - 0.15) {
      const n = Math.min(FILES.length, Math.floor((t - s.start - 0.3) / 0.33) + 1);
      ctx.font = f('500 {s}px "JetBrains Mono", "DejaVu Sans Mono", monospace', 26);
      for (let i = 0; i < Math.max(0, n); i++) {
        const a = ease.outCubic(prog(t, s.start + 0.3 + i * 0.33, s.start + 0.6 + i * 0.33)), y = 230 + i * 50 - Math.max(0, n - 12) * 50;
        ctx.globalAlpha = a * (i < n - 6 ? 0.45 : 1);
        ctx.fillStyle = PAL.green; ctx.fillText('+', 1000, y); ctx.fillStyle = '#D4DAFF'; ctx.fillText(FILES[i], 1036 + (1 - a) * 30, y);
      }
      ctx.globalAlpha = 1;
      const k = Math.max(0, n);
      reveal(ctx, [[[String(k).padStart(2, '0'), PAL.cyan]], [['files', '#fff']]], t, s.start + 0.3, 130, 470, { size: 190, stagger: 0.05 });
      label(ctx, `in ${Math.min(30, Math.round((t - s.start) * 6.5))} seconds`, 140, 640, t, c[1] ? c[1].start : s.start + 2, { size: 52, col: '#9AA1BC' });
    } else {
      reveal(ctx, [[['Do', '#fff'], ['you', '#fff'], ['know', '#fff'], ['what', '#fff'], ['it', '#fff']], [['actually', '#fff'], ['built?', PAL.yellow]]], t, q, W / 2, 470, { size: 140, align: 'center', stagger: 0.06 });
    }
  }

  // ---------- why: diffs are slow to read; failures are hard to place ----------
  const DIFF = [[' ', 'export function Cart() {'], ['-', '  const total = items.reduce((s, i) => s + i.price, 0)'], ['+', '  const total = useCartTotal(items)'],
    [' ', '  return ('], ['+', '    <CartSummary total={total} />'], ['-', '    <p>Total: {total.toFixed(2)}</p>'], [' ', '  )'], [' ', '}'],
    [' ', ''], ['+', 'def cart_total(lines):'], ['+', '    return round(sum(l["price"] for l in lines), 2)'], ['-', 'def total(cart):'],
    ['-', '    return cart.total'], [' ', ''], ['+', '@api_view(["GET", "POST"])'], ['+', 'def wishlist(request):'], ['+', '    global SAVED'],
    ['+', '    SAVED = toggle(SAVED, request.data["product"])'], ['-', 'urlpatterns = ['], ['+', 'urlpatterns = [  # +3 routes']];
  function why(ctx, t, s) {
    const c = caps(s), broke = c[2] ? c[2].start : s.end;
    bg(ctx, t);
    const x = 900, y = 150, w = 900, h = 720, shake = t > broke && t < broke + 0.35 ? Math.sin(t * 90) * 8 : 0;
    ctx.save(); ctx.translate(shake, 0);
    ctx.shadowColor = 'rgba(11,16,32,0.2)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
    CV.rr(ctx, x, y, w, h, 20); ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.save(); CV.rr(ctx, x, y, w, h, 20); ctx.clip();
    ctx.fillStyle = '#F5F6FA'; ctx.fillRect(x, y, w, 56);
    ctx.font = f(BODY, 22); ctx.fillStyle = MUTED; ctx.fillText('Files changed  47      +1,284  −391', x + 26, y + 36);
    const scroll = (t - s.start) * 120;
    ctx.font = f('500 {s}px "JetBrains Mono", "DejaVu Sans Mono", monospace', 22);
    for (let i = 0; i < 40; i++) {
      const [k, line] = DIFF[i % DIFF.length], ly = y + 80 + i * 40 - (scroll % (DIFF.length * 40));
      if (ly < y + 50 || ly > y + h) continue;
      if (k !== ' ') { ctx.fillStyle = k === '+' ? 'rgba(52,168,83,0.12)' : 'rgba(234,67,53,0.12)'; ctx.fillRect(x, ly - 28, w, 40); }
      ctx.fillStyle = k === '+' ? '#1E7E34' : k === '-' ? '#B3261E' : '#8A90A6'; ctx.fillText(k, x + 24, ly);
      ctx.fillStyle = '#2B3040'; ctx.fillText(line, x + 56, ly);
    }
    ctx.restore();
    if (t > broke) {
      const a = ease.outBack(prog(t, broke, broke + 0.4));
      ctx.save(); ctx.translate(x + w / 2, y + h - 120); ctx.scale(a, a);
      ctx.shadowColor = 'rgba(234,67,53,0.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
      CV.rr(ctx, -380, -60, 760, 120, 18); ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = PAL.red; CV.rr(ctx, -380, -60, 10, 120, 5); ctx.fill();
      ctx.font = f(BODY, 26); ctx.fillStyle = INK; ctx.fillText('TypeError: cannot read “total” of undefined', -340, -8);
      ctx.font = f(BODY_M, 22); ctx.fillStyle = MUTED; ctx.fillText('at Cart (Cart.tsx:12) · 3 of 47 files touched this', -340, 30);
      ctx.restore();
    }
    ctx.restore();
    reveal(ctx, [[['Fast', INK], ['to', INK], ['write.', PAL.green]]], t, s.start + 0.3, 110, 400, { size: 96 });
    reveal(ctx, [[['Slow', INK], ['to', INK], ['read.', PAL.red]]], t, (c[1] || c[0]).start, 110, 520, { size: 96 });
    label(ctx, 'And when it breaks, where do you look?', 114, 640, t, broke, { size: 36 });
  }

  // ---------- what ----------
  function what(ctx, t, s) {
    const c = caps(s), town = c[1] ? c[1].start : s.end;
    bg(ctx, t);
    if (t < town - 0.1) {
      cubes(ctx, t, 8, { alpha: prog(t, s.start + 0.4, s.start + 1) });
      lockup(ctx, W / 2, 470, 160, t, s.start + 0.1);
      label(ctx, 'A desktop workspace built for vibe coders.', W / 2, 600, t, s.start + 1.2, { align: 'center', size: 44 });
    } else {
      const k = ease.outCubic(prog(t, town, town + 0.7)), push = ease.inOut(prog(t, town, s.end));
      laptop(ctx, lerp(1300, 1240, push), lerp(640, 520, k), lerp(0.86, 0.95, push), (x, y, w, h) => drawShot(ctx, 'what', t - s.start, x, y, w, h, [0, 0, 1920], [260, 120, 1440]));
      reveal(ctx, [[['Your', INK], ['project,', INK]], [['as', INK], ['a', INK], ['town.', PAL.blue]]], t, town, 110, 330, { size: 84 });
      const d = c[3] || c[2];
      reveal(ctx, [[['Every', INK], ['feature,', INK]], [['a', INK], ['district.', PAL.green]]], t, d ? d.start : town + 2, 110, 560, { size: 60, stagger: 0.05 });
      reveal(ctx, [[['Every', INK], ['file,', INK], ['a', INK], ['block.', PAL.red]]], t, d ? d.start + 1.3 : town + 3.3, 110, 720, { size: 60, stagger: 0.05 });
    }
  }

  // ---------- when: one moment in a coder's day, with the real app ----------
  const WHEN = {
    open: { n: 1, sub: 'See the stack, the features and how they connect.', col: PAL.yellow },
    prompt: { n: 2, sub: 'Every file it writes lands in the town, live.', col: PAL.green },
    test: { n: 3, sub: 'See which test broke, and the fix to make.', col: PAL.red },
    ship: { n: 4, sub: 'Stage, commit and push in one click.', col: PAL.blue },
    holo: { n: 5, sub: 'Turn on the camera. Steer it with your hands.', col: PAL.cyan },
  };
  function when(ctx, t, s) {
    const m = WHEN[s.id], dark = s.id === 'holo';
    bg(ctx, t, dark);
    const tl = t - s.start, push = ease.inOut(prog(t, s.start, s.end)), k = ease.outCubic(prog(t, s.start, s.start + 0.6));
    const [cx, cy0, cw] = s.crop, crop1 = [cx + cw * 0.06, cy0 + cw * 0.034, cw * 0.88];
    if (dark) {
      const sw = 1180, sh = sw * 9 / 16, x = 660, y = 170;
      ctx.save(); ctx.shadowColor = 'rgba(92,242,255,0.4)'; ctx.shadowBlur = 90; CV.rr(ctx, x, y, sw, sh, 18); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
      ctx.save(); CV.rr(ctx, x, y, sw, sh, 18); ctx.clip(); drawShot(ctx, s.shot, tl, x, y, sw, sh, s.crop, crop1); ctx.restore();
    } else {
      laptop(ctx, lerp(1360, 1330, push), lerp(600, 520, k), lerp(0.84, 0.9, push), (x, y, w, h) => drawShot(ctx, s.shot, tl, x, y, w, h, s.crop, crop1));
    }
    const ink = dark ? '#fff' : INK;
    ctx.save(); ctx.globalAlpha = k;
    ctx.font = f(BODY, 22); ctx.fillStyle = dark ? '#9AA1BC' : MUTED; ctx.fillText(`WHEN ${m.n} / 5`, 110, 300);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i < m.n ? m.col : (dark ? '#2A3045' : '#E3E6EF'); CV.rr(ctx, 110 + i * 34, 318, 26, 6, 3); ctx.fill(); }
    ctx.restore();
    const words = s.when.split(' ');
    const lines = words.length > 3 ? [words.slice(0, 2), words.slice(2)] : [words];
    reveal(ctx, lines.map((ws, li) => ws.map((w, wi) => [w, li === lines.length - 1 && wi === ws.length - 1 ? m.col : ink])), t, s.start + 0.15, 110, 430, { size: 72, stagger: 0.05 });
    ctx.font = f(BODY_M, 30);
    const subLines = [''];
    for (const w of m.sub.split(' ')) {
      const next = (subLines[subLines.length - 1] + ' ' + w).trim();
      if (ctx.measureText(next).width > 520 && subLines[subLines.length - 1]) subLines.push(w); else subLines[subLines.length - 1] = next;
    }
    subLines.forEach((l, i) => label(ctx, l, 112, 430 + lines.length * 78 + 14 + i * 42, t, s.start + 0.6 + i * 0.08, { size: 30, col: dark ? '#9AA1BC' : MUTED }));
  }

  // ---------- close ----------
  function close(ctx, t, s) {
    bg(ctx, t); cubes(ctx, t, 8, { alpha: prog(t, s.start + 0.5, s.start + 1.1) });
    lockup(ctx, W / 2, 400, 150, t, s.start);
    reveal(ctx, [[['See', INK], ['what', INK], ['your', INK], ['AI', PAL.blue], ['builds.', INK]]], t, s.start + 0.8, W / 2, 560, { size: 76, align: 'center', stagger: 0.05 });
    const c = caps(s), b = c[2] ? c[2].start - 0.2 : s.start + 2.2, a = ease.outBack(prog(t, b, b + 0.5));
    if (a > 0) {
      const w = 540, h = 96, pulse = 1 + 0.02 * Math.sin((t - b) * 5);
      ctx.save(); ctx.translate(W / 2, 700); ctx.scale(a * pulse, a * pulse);
      ctx.shadowColor = 'rgba(66,133,244,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
      CV.rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = PAL.blue; ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#fff'; ctx.font = f(BODY, 34); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Download for Windows', 0, 2);
      ctx.restore(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    label(ctx, 'github.com/dharaneechinnu/codeville', W / 2, 820, t, b + 0.3, { align: 'center', size: 30 });
  }

  // ---------- chrome: chapter marker and captions ----------
  function chapterMark(ctx, t, s, dark) {
    if (s.id === 'close') return;
    const a = prog(t, s.start + 0.1, s.start + 0.5) * (1 - prog(t, s.end - 0.3, s.end));
    const chapters = F.scenes.filter((x) => x.id !== 'close');
    ctx.save(); ctx.globalAlpha = a * 0.9; ctx.font = f(BODY, 20); ctx.textBaseline = 'middle';
    let x = 110;
    chapters.forEach((c) => {
      const on = c.id === s.id, label_ = c.chapter.toUpperCase();
      ctx.fillStyle = on ? (dark ? '#fff' : INK) : (dark ? '#4A5170' : '#B4B9C9');
      ctx.fillText(label_, x, 80); x += ctx.measureText(label_).width + 30;
    });
    ctx.restore();
  }
  function caption(ctx, t, list = F.captions) {
    const c = list.find((x) => t >= x.start - 0.05 && t < x.end + 0.15);
    if (!c) return;
    const a = Math.min(prog(t, c.start - 0.05, c.start + 0.12), 1 - prog(t, c.end + 0.05, c.end + 0.15));
    ctx.save(); ctx.globalAlpha = a; ctx.font = f(BODY, 36);
    const w = Math.min(1500, ctx.measureText(c.text).width + 64), h = 66;
    CV.rr(ctx, W / 2 - w / 2, CAP_Y - h / 2, w, h, 14); ctx.fillStyle = 'rgba(11,16,32,0.82)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.text, W / 2, CAP_Y + 2, 1440);
    ctx.restore();
  }

  const DRAW = { hook, why, what, open: when, prompt: when, test: when, ship: when, holo: when, close };
  function render(ctx, t) {
    const s = F.scenes.find((x) => t >= x.start && t < x.end) || F.scenes[F.scenes.length - 1];
    DRAW[s.id](ctx, t, s);
    chapterMark(ctx, t, s, s.id === 'hook' || s.id === 'holo');
    for (const x of F.scenes.slice(1)) wipe(ctx, t, x.start - 0.35);
    caption(ctx, t);
  }
  function shotsAt(t) {
    const s = F.scenes.find((x) => t >= x.start && t < x.end);
    return s && s.shot ? [[s.shot, t - s.start]] : [];
  }
  CV.drawCaptions = caption;
  CV.scenes = CV.scenes || {};
  CV.scenes['pro-film'] = { duration: F.total, render, prepare: (t) => prepareShots(shotsAt(t)) };
})();
