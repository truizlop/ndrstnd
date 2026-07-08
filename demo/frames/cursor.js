/* Shared demo cursor: a macOS-style pointer the recorder animates across the page.
   Exposes window.__cursor = { show(x,y), moveTo(x,y,ms), click(), moveToEl(selector,ms) }. */
(() => {
  const cursor = document.createElement("div");
  cursor.id = "__demo-cursor";
  cursor.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:26px;height:30px;opacity:0;transition:opacity 200ms ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))";
  cursor.innerHTML = '<svg viewBox="0 0 26 30" width="26" height="30"><polygon points="2,1 2,23 8.2,17.4 12,26 15.6,24.4 11.7,15.9 20,15.9" fill="#0b0b0b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ring = document.createElement("div");
  ring.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;border-radius:50%;border:2.5px solid rgba(60,120,255,.85);opacity:0;transform:translate(-50%,-50%) scale(.4)";
  document.body.append(cursor, ring);

  let x = innerWidth / 2, y = innerHeight / 2;
  const place = () => { cursor.style.transform = `translate(${x}px, ${y}px)`; };
  place();

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.__cursor = {
    async show(nx = x, ny = y) { x = nx; y = ny; place(); cursor.style.opacity = "1"; await sleep(220); },
    async hide() { cursor.style.opacity = "0"; await sleep(220); },
    async moveTo(nx, ny, ms = 700) {
      const sx = x, sy = y, start = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          const t = Math.min(1, (now - start) / ms);
          const k = ease(t);
          x = sx + (nx - sx) * k; y = sy + (ny - sy) * k; place();
          if (t < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
    },
    async moveToEl(selector, ms = 700, align = { dx: 0.5, dy: 0.5 }) {
      const el = typeof selector === "string" ? document.querySelector(selector) : selector;
      if (!el) return;
      const box = el.getBoundingClientRect();
      await this.moveTo(box.left + box.width * align.dx, box.top + box.height * align.dy, ms);
    },
    async press() {
      ring.style.left = `${x + 2}px`; ring.style.top = `${y + 2}px`;
      ring.style.transition = "none"; ring.style.opacity = ".9"; ring.style.transform = "translate(-50%,-50%) scale(.4)";
      ring.getBoundingClientRect();
      ring.style.transition = "opacity 420ms ease, transform 420ms ease";
      ring.style.opacity = "0"; ring.style.transform = "translate(-50%,-50%) scale(1.25)";
      await sleep(120);
    },
    async click(target) {
      ring.style.left = `${x + 2}px`; ring.style.top = `${y + 2}px`;
      ring.style.transition = "none"; ring.style.opacity = ".9"; ring.style.transform = "translate(-50%,-50%) scale(.4)";
      ring.getBoundingClientRect();
      ring.style.transition = "opacity 420ms ease, transform 420ms ease";
      ring.style.opacity = "0"; ring.style.transform = "translate(-50%,-50%) scale(1.25)";
      const el = target ? (typeof target === "string" ? document.querySelector(target) : target) : document.elementFromPoint(x, y);
      if (el) { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y })); }
      await sleep(260);
    },
  };
})();
