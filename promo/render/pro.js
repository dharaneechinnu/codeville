// The pro cuts: a 30 s launch ad, a 15 s social cut, and the frame for the narrated demo. Clean light frames,
// masked word reveals, a laptop with the real app on its screen (frames extracted by promo/capture/shots.py),
// slow camera pushes, Google-colour wipes, and voxel cubes as accents.
(function () {
  'use strict';
  const { W, H, PAL, prog, ease, lerp, hash, clamp, view, scene, shade } = CV;
  const INK = '#0B1020', MUTED = '#5B6178', BG = '#F5F6FA';
  const G = [PAL.blue, PAL.red, PAL.yellow, PAL.green];
  const DISPLAY = '800 {s}px "Bricolage Grotesque", sans-serif';
  const BODY = '700 {s}px "Instrument Sans", sans-serif';
  const BODY_M = '500 {s}px "Instrument Sans", sans-serif';
  const f = (tpl, s) => tpl.replace('{s}', s);

  // ---------- real-app frames ----------
  const SHOT_DIR = new URLSearchParams(location.search).get('shots') || '';
  const cache = new Map();
  const shotInfo = (id) => CV.PRO.shots[id] || (CV.FILM && CV.FILM.shots[id]);
  function shotFrame(id, tl) {
    const s = shotInfo(id), n = Math.max(1, Math.round(s.len * 30));
    return `${SHOT_DIR}/${id}/${String(clamp(Math.floor(tl * 30), 0, n - 1) + 1).padStart(5, '0')}.jpg`;
  }
  function load(src) {
    if (cache.has(src)) return cache.get(src);
    const p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    cache.set(src, p);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return p;
  }
  const ready = new Map();
  async function prepareShots(list) {
    for (const [id, tl] of list) { const src = shotFrame(id, tl); ready.set(id, await load(src)); }
  }
  // Draw shot `id` at local time tl into rect (x,y,w,h), cropping the 1920x1080 frame from crop0 to crop1 ([x, y, width]).
  function drawShot(ctx, id, tl, x, y, w, h, crop0 = [0, 0, 1920], crop1 = crop0, ease_ = ease.inOut) {
    const im = ready.get(id);
    ctx.fillStyle = '#0d1124'; ctx.fillRect(x, y, w, h);
    if (!im) return;
    const k = ease_(clamp(tl / shotInfo(id).len));
    const cw = lerp(crop0[2], crop1[2], k), ch = cw * h / w;
    ctx.drawImage(im, lerp(crop0[0], crop1[0], k), lerp(crop0[1], crop1[1], k), cw, ch, x, y, w, h);
  }

  // ---------- type ----------
  // lines: [[[word, color], ...], ...]; each word slides up out of a mask, then slides out at `out`.
  function reveal(ctx, lines, t, t0, x, y, o = {}) {
    const size = o.size || 120, lh = o.lh || size * 1.08, st = o.stagger ?? 0.07;
    ctx.font = f(o.font || DISPLAY, size); ctx.textBaseline = 'alphabetic';
    let i = 0;
    lines.forEach((words, li) => {
      const widths = words.map(([w]) => ctx.measureText(w).width), gap = size * 0.26;
      const total = widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
      let cx = o.align === 'center' ? x - total / 2 : x;
      const by = y + li * lh;
      words.forEach(([w, col], wi) => {
        const p = ease.outCubic(prog(t, t0 + i * st, t0 + i * st + 0.6));
        const q = o.out != null ? ease.inCubic(prog(t, o.out + i * 0.025, o.out + i * 0.025 + 0.32)) : 0;
        if (p > 0 && q < 1) {
          ctx.save(); ctx.beginPath(); ctx.rect(cx - 10, by - size * 1.0, widths[wi] + 20, size * 1.32); ctx.clip();
          ctx.fillStyle = col || o.col || INK; ctx.font = f(o.font || DISPLAY, size);
          ctx.fillText(w, cx, by + (1 - p) * size * 1.15 - q * size * 1.2);
          ctx.restore();
        }
        cx += widths[wi] + gap; i++;
      });
    });
  }
  function label(ctx, s, x, y, t, t0, o = {}) {
    const a = ease.outCubic(prog(t, t0, t0 + 0.5)) * (o.out != null ? 1 - prog(t, o.out, o.out + 0.3) : 1);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; ctx.font = f(o.font || BODY_M, o.size || 36);
    ctx.fillStyle = o.col || MUTED; ctx.textAlign = o.align || 'left'; ctx.fillText(s, x, y + (1 - a) * 18); ctx.restore();
  }
  function pill(ctx, s, x, y, t, t0, col = PAL.blue, o = {}) {
    const a = ease.outBack(prog(t, t0, t0 + 0.45)) * (o.out != null ? 1 - ease.inCubic(prog(t, o.out, o.out + 0.3)) : 1);
    if (a <= 0) return;
    ctx.font = f(BODY, o.size || 30); const w = ctx.measureText(s).width + 84, h = (o.size || 30) * 2;
    ctx.save(); ctx.translate(x, y); ctx.scale(a, a);
    ctx.shadowColor = 'rgba(11,16,32,0.18)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    CV.rr(ctx, 0, -h / 2, w, h, h / 2); ctx.fillStyle = o.bg || '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.beginPath(); ctx.arc(h / 2, 0, (o.size || 30) * 0.32, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = o.col || INK; ctx.textBaseline = 'middle'; ctx.fillText(s, h * 0.85, 2); ctx.restore();
  }

  // ---------- set pieces ----------
  function bg(ctx, t, dark) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (dark) { g.addColorStop(0, '#0A0F1F'); g.addColorStop(1, '#04060C'); } else { g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, BG); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = dark ? 'rgba(92,242,255,0.06)' : 'rgba(11,16,32,0.05)';
    for (let x = 40; x < W; x += 48) for (let y = 40; y < H; y += 48) ctx.fillRect(x, y, 2, 2);
  }
  // Small flat voxel cubes drifting at the edges.
  function cubes(ctx, t, n = 7, o = {}) {
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1, x = W / 2 + side * (620 + hash(k) * 260), y = 160 + hash(k + 5) * 760 + Math.sin(t * 0.8 + k) * 14;
      const s = 26 + hash(k + 9) * 34, a = o.alpha ?? 1;
      if (a <= 0) continue;
      const v = view({ scale: s, cx: x, cy: y, yaw: 0.78 + t * 0.15 * (k % 3 - 1), pitch: 0.62 });
      ctx.globalAlpha = a;
      CV.box(ctx, v, -0.5, -0.5, -0.5, 1, 1, 1, G[k % 4], { tex: false, lw: 1 });
      ctx.globalAlpha = 1;
    }
  }
  // A laptop: screen rect is returned so the caller can draw the app into it.
  function laptop(ctx, cx, cy, scale, drawScreen) {
    const sw = 1180 * scale, sh = sw * 9 / 16, b = 22 * scale, x = cx - sw / 2, y = cy - sh / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(11,16,32,0.28)'; ctx.shadowBlur = 80 * scale; ctx.shadowOffsetY = 40 * scale;
    CV.rr(ctx, x - b, y - b, sw + 2 * b, sh + 2 * b, 26 * scale); ctx.fillStyle = '#16181F'; ctx.fill();
    ctx.restore();
    CV.rr(ctx, x - b + 3, y - b + 3, sw + 2 * b - 6, sh + 2 * b - 6, 24 * scale); ctx.strokeStyle = '#2C303B'; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); CV.rr(ctx, x, y, sw, sh, 6 * scale); ctx.clip(); drawScreen(x, y, sw, sh); ctx.restore();
    // base
    const by = y + sh + b, bw = sw * 1.2;
    const g = ctx.createLinearGradient(0, by, 0, by + 26 * scale);
    g.addColorStop(0, '#D9DCE4'); g.addColorStop(1, '#A9AEBB');
    ctx.beginPath(); ctx.moveTo(cx - sw / 2 - b, by); ctx.lineTo(cx + sw / 2 + b, by); ctx.lineTo(cx + bw / 2, by + 22 * scale);
    ctx.quadraticCurveTo(cx + bw / 2, by + 30 * scale, cx + bw / 2 - 30 * scale, by + 30 * scale); ctx.lineTo(cx - bw / 2 + 30 * scale, by + 30 * scale);
    ctx.quadraticCurveTo(cx - bw / 2, by + 30 * scale, cx - bw / 2, by + 22 * scale); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = '#8D93A1'; CV.rr(ctx, cx - 90 * scale, by, 180 * scale, 9 * scale, 4 * scale); ctx.fill();
    return { x, y, w: sw, h: sh };
  }
  // Diagonal bars in the four colours sweep across: covered at t0 + dur/2.
  function wipe(ctx, t, t0, dur = 0.7) {
    if (t < t0 || t > t0 + dur) return;
    const p = (t - t0) / dur;
    G.forEach((col, i) => {
      const d = i * 0.07, a = ease.inOut(clamp((p - d) / 0.5)), b2 = ease.inOut(clamp((p - 0.5 - d * 0.6) / 0.45));
      const x0 = lerp(-700, W + 700, b2), x1 = lerp(-700, W + 700, a);
      if (x1 <= x0) return;
      ctx.beginPath(); ctx.moveTo(x0 - 300, H); ctx.lineTo(x0, 0); ctx.lineTo(x1, 0); ctx.lineTo(x1 - 300, H); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
    });
  }
  // The Codeville mark: four flat cubes that drop into place, then the wordmark slides up.
  function mark(ctx, cx, cy, s, t, t0) {
    const parts = [[-0.5, -0.5, 0, PAL.blue], [0.55, -0.5, 0, PAL.green], [-0.5, 0.55, 0, PAL.yellow], [-0.45, -0.45, 1, PAL.red]];
    const items = parts.map(([x, y, z, col], i) => {
      const p = ease.outBounce(prog(t, t0 + i * 0.09, t0 + i * 0.09 + 0.55));
      return { x, y, z: z + (1 - p) * 6, w: 0.95, d: 0.95, h: 0.95, col, o: { tex: false, lw: 1.2, alpha: p > 0 ? 1 : 0 } };
    });
    scene(ctx, view({ scale: s, cx, cy, yaw: 0.78, pitch: 0.62 }), items);
  }
  function lockup(ctx, cx, cy, size, t, t0) {
    ctx.font = f(DISPLAY, size); const tw = ctx.measureText('Codeville').width, iw = size * 1.15, total = iw + 24 + tw;
    mark(ctx, cx - total / 2 + iw / 2, cy - size * 0.28, size * 0.42, t, t0);
    reveal(ctx, [[['Codeville', INK]]], t, t0 + 0.25, cx - total / 2 + iw + 24, cy, { size });
  }
  function endCard(ctx, t, t0) {
    bg(ctx, t); cubes(ctx, t, 8, { alpha: prog(t, t0 + 0.6, t0 + 1.2) });
    lockup(ctx, W / 2, 430, 150, t, t0);
    reveal(ctx, [[['Vibe', PAL.blue], ['code.', PAL.red], ['See', '#E8A400'], ['it', PAL.green], ['build.', INK]]], t, t0 + 0.7, W / 2, 590, { size: 76, align: 'center', stagger: 0.06 });
    const a = ease.outBack(prog(t, t0 + 1.2, t0 + 1.7));
    if (a > 0) {
      const w = 520, h = 96, x = W / 2, y = 720, pulse = 1 + 0.02 * Math.sin((t - t0) * 5);
      ctx.save(); ctx.translate(x, y); ctx.scale(a * pulse, a * pulse);
      ctx.shadowColor = 'rgba(66,133,244,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
      CV.rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = PAL.blue; ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#fff'; ctx.font = f(BODY, 34); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Download for Windows', 0, 2);
      ctx.restore();
    }
    label(ctx, 'github.com/dharaneechinnu/codeville', W / 2, 840, t, t0 + 1.5, { align: 'center', size: 30 });
  }

  // ---------- launch ad (30 s) ----------
  const L = {
    duration: 30,
    shotsAt(t) {
      if (t >= 8.57 && t < 12.86) return [['L_town', t - 8.57]];
      if (t >= 12.86 && t < 17.14) return [['L_chat', t - 12.86]];
      if (t >= 17.14 && t < 19.4) return [['L_test', t - 17.14]];
      if (t >= 19.4 && t < 21.43) return [['L_fix', t - 19.4]];
      if (t >= 21.43 && t < 25.71) return [['L_holo', t - 21.43]];
      return [];
    },
    render(ctx, t) {
      if (t < 5.36) {
        bg(ctx, t); cubes(ctx, t, 6, { alpha: prog(t, 0.2, 1) });
        reveal(ctx, [[['You', INK], ['vibe', PAL.blue], ['code.', INK]]], t, 0.15, W / 2, 590, { size: 170, align: 'center', out: 2.35 });
        reveal(ctx, [[['But', INK], ['what', INK], ['did', INK], ['your', INK], ['AI', PAL.red]], [['actually', INK], ['build?', INK]]], t, 2.6, W / 2, 500, { size: 130, align: 'center', out: 4.95 });
      } else if (t < 8.57) {
        bg(ctx, t); cubes(ctx, t, 8, { alpha: prog(t, 5.6, 6.2) });
        lockup(ctx, W / 2, 560, 170, t, 5.36);
        label(ctx, 'Built for vibe coders.', W / 2, 680, t, 6.6, { align: 'center', size: 46, out: 8.2 });
      } else if (t < 12.86) {
        bg(ctx, t);
        const k = ease.outCubic(prog(t, 8.57, 9.4)), push = ease.inOut(prog(t, 9.4, 12.86));
        laptop(ctx, lerp(1290, 1250, push), lerp(680, 560, k), lerp(0.84, 0.92, push) * lerp(0.9, 1, k), (x, y, w, h) => drawShot(ctx, 'L_town', t - 8.57, x, y, w, h, [0, 0, 1920], [300, 140, 1380]));
        reveal(ctx, [[['Every', INK], ['feature,', INK]], [['a', INK], ['district.', PAL.blue]]], t, 8.75, 110, 400, { size: 84 });
        reveal(ctx, [[['Every', INK], ['file,', INK]], [['a', INK], ['block.', PAL.green]]], t, 10.3, 110, 660, { size: 84 });
      } else if (t < 17.14) {
        bg(ctx, t);
        const push = ease.inOut(prog(t, 12.86, 17.14));
        laptop(ctx, lerp(1240, 1020, push), lerp(580, 600, push), lerp(0.72, 1.18, push), (x, y, w, h) => drawShot(ctx, 'L_chat', t - 12.86, x, y, w, h, [0, 40, 1920], [0, 60, 1180]));
        pill(ctx, 'Prompt it.', 120, 300, t, 13.0, PAL.blue, { size: 40, out: 16.7 });
        pill(ctx, 'Watch it build.', 120, 410, t, 13.6, PAL.green, { size: 40, out: 16.75 });
      } else if (t < 21.43) {
        bg(ctx, t);
        const fix = t >= 19.4, tl = fix ? t - 19.4 : t - 17.14;
        laptop(ctx, W / 2, 600, 1.2, (x, y, w, h) => drawShot(ctx, fix ? 'L_fix' : 'L_test', tl, x, y, w, h, fix ? [362, 55, 1216] : [362, 55, 1216], fix ? [380, 100, 1100] : [400, 160, 1000]));
        pill(ctx, 'See exactly what broke.', 150, 150, t, 17.3, PAL.red, { size: 42, out: 19.2 });
        pill(ctx, 'Fix it with one prompt.', 150, 150, t, 19.5, PAL.green, { size: 42, out: 21.1 });
      } else if (t < 25.71) {
        bg(ctx, t, true);
        const push = ease.inOut(prog(t, 21.43, 25.71));
        const sw = lerp(1500, 1700, push), sh = sw * 9 / 16, x = (W - sw) / 2, y = 150 + (1 - push) * 20;
        ctx.save(); ctx.shadowColor = 'rgba(92,242,255,0.35)'; ctx.shadowBlur = 80; CV.rr(ctx, x, y, sw, sh, 18); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
        ctx.save(); CV.rr(ctx, x, y, sw, sh, 18); ctx.clip(); drawShot(ctx, 'L_holo', t - 21.43, x, y, sw, sh, [300, 190, 1560], [420, 250, 1250]); ctx.restore();
        reveal(ctx, [[['Steer', '#fff'], ['it', '#fff'], ['with', '#fff'], ['your', '#fff'], ['hands.', PAL.cyan]]], t, 21.6, W / 2, 110, { size: 78, align: 'center', out: 25.3 });
      } else endCard(ctx, t, 25.71);
      for (const w of [5.01, 8.22, 12.51, 21.08, 25.36]) wipe(ctx, t, w);
    },
  };

  // ---------- social cut (15 s) ----------
  const S = {
    duration: 15,
    shotsAt(t) {
      if (t >= 3.75 && t < 6.75) return [['S_chat', t - 3.75]];
      if (t >= 6.75 && t < 9.35) return [['S_test', t - 6.75]];
      if (t >= 9.12 && t < 11.52) return [['S_holo', t - 9.12]];
      return [];
    },
    render(ctx, t) {
      if (t < 1.61) {
        bg(ctx, t); cubes(ctx, t, 6);
        reveal(ctx, [[['You', INK], ['vibe', PAL.blue], ['code.', INK]]], t, 0.05, W / 2, 590, { size: 170, align: 'center', out: 1.3 });
      } else if (t < 3.75) {
        bg(ctx, t); cubes(ctx, t, 8, { alpha: prog(t, 1.8, 2.3) });
        lockup(ctx, W / 2, 540, 170, t, 1.61);
        label(ctx, 'See what your AI builds.', W / 2, 660, t, 2.4, { align: 'center', size: 46, out: 3.45 });
      } else if (t < 6.75) {
        bg(ctx, t);
        const push = ease.inOut(prog(t, 3.75, 6.75));
        laptop(ctx, W / 2, 600, lerp(1.0, 1.25, push), (x, y, w, h) => drawShot(ctx, 'S_chat', t - 3.75, x, y, w, h, [0, 40, 1920], [0, 60, 1200]));
        pill(ctx, 'Prompt it. Watch it build.', 150, 120, t, 3.9, PAL.blue, { size: 40, out: 6.45 });
      } else if (t < 9.12) {
        bg(ctx, t);
        laptop(ctx, W / 2, 600, 1.2, (x, y, w, h) => drawShot(ctx, 'S_test', t - 6.75, x, y, w, h, [362, 55, 1216], [400, 160, 1000]));
        pill(ctx, 'See exactly what broke.', 150, 120, t, 6.9, PAL.red, { size: 40, out: 8.85 });
      } else if (t < 11.52) {
        bg(ctx, t, true);
        const sw = 1640, sh = sw * 9 / 16, x = (W - sw) / 2, y = 160;
        ctx.save(); CV.rr(ctx, x, y, sw, sh, 18); ctx.clip(); drawShot(ctx, 'S_holo', t - 9.12, x, y, sw, sh, [300, 190, 1560], [420, 250, 1250]); ctx.restore();
        reveal(ctx, [[['Steer', '#fff'], ['it', '#fff'], ['with', '#fff'], ['your', '#fff'], ['hands.', PAL.cyan]]], t, 9.25, W / 2, 112, { size: 78, align: 'center', out: 11.2 });
      } else endCard(ctx, t, 11.52);
      for (const w of [1.26, 3.4, 6.4, 8.77, 11.17]) wipe(ctx, t, w);
      if (CV.drawCaptions && CV.SOCIAL_CAPTIONS) CV.drawCaptions(ctx, t, CV.SOCIAL_CAPTIONS);
    },
  };

  // ---------- frame for the narrated demo (the recording is laid over SCREEN by mux.py) ----------
  const SCREEN = { x: 200, y: 168, w: 1520, h: 855 };
  const D = {
    get duration() { return CV.REAL.total; },
    render(ctx, t) {
      const R = CV.REAL;
      if (t < R.intro) {
        bg(ctx, t); cubes(ctx, t, 7, { alpha: prog(t, 0.2, 0.8) });
        lockup(ctx, W / 2, 500, 150, t, 0.1);
        reveal(ctx, [[['Built', INK], ['for', INK], ['vibe', PAL.blue], ['coders.', INK]]], t, 0.9, W / 2, 650, { size: 72, align: 'center', out: 3.1 });
        wipe(ctx, t, R.intro - 0.35);
        return;
      }
      if (t >= R.uiEnd) { endCard(ctx, t, R.uiEnd); wipe(ctx, t, R.uiEnd - 0.35); return; }
      bg(ctx, t);
      // monitor
      ctx.save(); ctx.shadowColor = 'rgba(11,16,32,0.25)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 30;
      CV.rr(ctx, SCREEN.x - 18, SCREEN.y - 18, SCREEN.w + 36, SCREEN.h + 36, 22); ctx.fillStyle = '#16181F'; ctx.fill(); ctx.restore();
      ctx.fillStyle = '#000'; ctx.fillRect(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h);
      const i = Math.max(0, R.scenes.findIndex((s) => t >= s.start && t < s.end)), s = R.scenes[i];
      const col = G[i % 4];
      // chapter header
      const a = ease.outCubic(prog(t, s.start, s.start + 0.5)) * (1 - prog(t, s.end - 0.25, s.end));
      ctx.save(); ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(SCREEN.x + 14, 78, 12, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      ctx.font = f(BODY, 24); ctx.fillStyle = MUTED; ctx.fillText(`${s.num} / ${String(R.scenes.length).padStart(2, '0')}`, SCREEN.x + 40, 87);
      ctx.restore();
      reveal(ctx, [[[s.title.charAt(0) + s.title.slice(1).toLowerCase(), INK]]], t, s.start + 0.05, SCREEN.x + 150, 92, { size: 52, out: s.end - 0.35 });
      label(ctx, s.sub, SCREEN.x + 150, 140, t, s.start + 0.25, { size: 28, out: s.end - 0.3 });
      ctx.font = f(BODY, 20); ctx.textAlign = 'right'; ctx.fillStyle = MUTED;
      ctx.fillText(s.speed > 1 ? `Real app · ${s.speed}× speed` : 'Real app · recorded live', SCREEN.x + SCREEN.w, 84);
      if (s.note) ctx.fillText(s.note, SCREEN.x + SCREEN.w, 118);
      ctx.textAlign = 'left';
      wipe(ctx, t, R.intro - 0.35); wipe(ctx, t, R.uiEnd - 0.35);
    },
  };

  CV.scenes = CV.scenes || {};
  CV.scenes['pro-launch'] = { duration: L.duration, render: L.render, prepare: (t) => prepareShots(L.shotsAt(t)) };
  CV.scenes['pro-social'] = { duration: S.duration, render: S.render, prepare: (t) => prepareShots(S.shotsAt(t)) };
  CV.scenes['pro-demo'] = { get duration() { return D.duration; }, render: D.render };
  CV.PRO_SCREEN = SCREEN;
  // Shared with film.js.
  CV.P = { INK, MUTED, G, DISPLAY, BODY, BODY_M, f, reveal, label, pill, bg, cubes, laptop, wipe, mark, lockup, drawShot, prepareShots };
})();
