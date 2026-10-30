// Stands in for MediaPipe's hand tracker during the recording: the real gesture code in the app gets these 21-point
// hands as if a hand were in front of the camera. window.__cvGesture = { mode, t0 } picks what the hand does.
(() => {
  // An open right hand, wrist at (0,0), fingers up (y negative), in units of the wrist-to-middle-knuckle length.
  const OPEN = [[0, 0], [-0.35, -0.25], [-0.6, -0.45], [-0.8, -0.62], [-0.95, -0.78], [-0.3, -1], [-0.33, -1.4], [-0.35, -1.65], [-0.37, -1.9],
    [0, -1], [0, -1.45], [0, -1.75], [0, -2], [0.27, -0.95], [0.3, -1.35], [0.32, -1.6], [0.34, -1.82], [0.5, -0.82], [0.58, -1.12], [0.63, -1.32], [0.67, -1.5]];
  const FIST = OPEN.map((p) => [...p]);
  [[6, -0.33, -1.25], [7, -0.3, -1.05], [8, -0.28, -0.85], [10, 0, -1.3], [11, 0.02, -1.05], [12, 0.03, -0.85], [14, 0.29, -1.22], [15, 0.29, -1.0], [16, 0.28, -0.82],
    [18, 0.55, -1.0], [19, 0.53, -0.85], [20, 0.5, -0.72], [2, -0.45, -0.5], [3, -0.3, -0.62], [4, 0.12, -0.62]].forEach(([i, x, y]) => { FIST[i] = [x, y]; });
  const PINCH = OPEN.map((p) => [...p]);
  [[6, -0.4, -1.32], [7, -0.45, -1.3], [8, -0.47, -1.18], [3, -0.6, -0.9], [4, -0.5, -1.12]].forEach(([i, x, y]) => { PINCH[i] = [x, y]; });

  function hand(shape, cx, cy, s, mirror = false) {
    // cx, cy: palm position in the camera image (0..1). The tracker works on the unmirrored image.
    return shape.map(([x, y], i) => ({ x: cx + (mirror ? -x : x) * s + Math.sin(performance.now() / 260 + i) * 0.0015, y: cy + 0.06 + y * s * 1.33, z: 0 }));
  }

  window.__cvHands = () => {
    const g = window.__cvGesture;
    if (!g) return [];
    const k = (performance.now() - g.t0) / 1000;
    if (g.mode === 'rotate') return [hand(OPEN, 0.5 + 0.2 * Math.sin(k * 1.3), 0.62 + 0.035 * Math.sin(k * 2.1), 0.13)];
    if (g.mode === 'zoom') { const gap = 0.12 + Math.min(1, k / 2.4) * 0.2; return [hand(OPEN, 0.5 - gap, 0.62, 0.12, true), hand(OPEN, 0.5 + gap, 0.62, 0.12)]; }
    if (g.mode === 'hold') return [hand(FIST, 0.5 + 0.06 * Math.sin(k * 3), 0.62, 0.13)];
    if (g.mode === 'reset') {
      const ms = k * 1000, pinch = (ms > 300 && ms < 480) || (ms > 650 && ms < 830);
      return [hand(pinch ? PINCH : OPEN, 0.55, 0.62, 0.13)];
    }
    return [];
  };
})();
