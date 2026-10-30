// A visible mouse pointer for the recording (screen captures do not include the system cursor).
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);will-change:transform';
  c.innerHTML = '<svg width="26" height="38" viewBox="0 0 13 19" shape-rendering="crispEdges"><path d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1H8v1h1v1h1v1h1v1h1v1h-2v-1H9v-1H8v-1H7v1H6v1H5v1H4v1H3v1H2v1H1v1H0z" fill="#05060d"/><path d="M1 2h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1H7v1h1v1h1v1h1v1h1v1h-1v-1H9v-1H8v-1H7v-1H6v1H5v1H4v1H3v1H2v1H1z" fill="#fff"/></svg>';
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border:3px solid #5cf2ff;z-index:2147483646;pointer-events:none;opacity:0';
  document.body.append(c, ring);
  addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 1}px,${e.clientY - 1}px)`; }, true);
  addEventListener('mousedown', (e) => {
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
    ring.animate([{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 450, easing: 'ease-out' });
  }, true);
});
