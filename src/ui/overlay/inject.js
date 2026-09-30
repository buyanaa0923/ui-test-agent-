/* Runs INSIDE the page under test (injected on every navigation by overlay/index.mjs).
 * Everything lives in one shadow root on <html> (outside <body>), pointer-events:none, so it cannot restyle the page,
 * intercept clicks, or be picked up by the design checks. The engine hides it while measuring and screenshotting.
 * window.__mole API: hud(state) feed(kind, text) sweep(rects, ms) target(rect, label) badge(text, kind) click() clear() hide() show() result(status, text) */
(() => {
  if (window.top !== window || window.__mole) return;
  const SPRITE = window.__MOLE_SPRITE;
  const host = document.createElement('mole-overlay');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:strict';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box}
    .layer{position:fixed;inset:0;pointer-events:none;overflow:hidden}
    .box{position:absolute;border-radius:3px;opacity:0;animation:pop .35s ease-out forwards}
    .box.ok{outline:1px solid rgba(74,222,128,.55);background:rgba(74,222,128,.07)}
    .box.bad{outline:2px solid #F87171;background:rgba(248,113,113,.16);box-shadow:0 0 14px rgba(248,113,113,.7);animation:pop .35s ease-out forwards,throb 1s ease-in-out .4s infinite}
    .box .chip{position:absolute;left:-2px;top:-19px;font:600 11px/16px ui-monospace,Consolas,monospace;color:#1a0b0b;background:#F87171;padding:0 6px;border-radius:4px;white-space:nowrap}
    .box.fade{transition:opacity .6s;opacity:0 !important}
    @keyframes pop{from{opacity:0;transform:scale(1.06)}to{opacity:1;transform:scale(1)}}
    @keyframes throb{50%{box-shadow:0 0 4px rgba(248,113,113,.4)}}
    .laser{position:absolute;left:0;right:0;height:2px;top:0;background:linear-gradient(90deg,transparent,#FFA030,transparent);box-shadow:0 0 18px 4px rgba(255,160,48,.6);opacity:0}
    .target{position:absolute;border:2px solid #FFA030;border-radius:6px;box-shadow:0 0 0 4px rgba(255,160,48,.22),0 0 22px rgba(255,160,48,.55);transition:all .22s cubic-bezier(.2,.9,.3,1);opacity:0}
    .target .tag{position:absolute;left:-2px;bottom:calc(100% + 6px);white-space:nowrap;font:600 12px/18px ui-monospace,Consolas,monospace;padding:1px 8px;border-radius:5px;background:#12151a;color:#E6E6E6;border:1px solid #FFA030}
    .target .tag.safe{border-color:#4ADE80}.target .tag.risky{border-color:#F87171;color:#F87171}
    .rip{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #FFA030;animation:rip .55s ease-out forwards}
    @keyframes rip{to{transform:scale(5);opacity:0}}
    .mole{position:absolute;left:0;top:0;transition:transform .28s cubic-bezier(.2,.9,.3,1);opacity:0}
    .mole canvas{image-rendering:pixelated;width:66px;height:48px;display:block;animation:bob .5s ease-in-out infinite}
    @keyframes bob{50%{transform:translateY(-3px)}}
    .hud{position:absolute;left:16px;bottom:16px;width:330px;background:rgba(11,13,16,.93);color:#E6E6E6;border:1px solid rgba(255,160,48,.4);border-radius:14px;padding:12px 14px;font:12px/1.35 ui-monospace,Consolas,monospace;box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(6px)}
    .hud .top{display:flex;gap:12px;align-items:center}
    .hud canvas{image-rendering:pixelated;width:88px;height:64px;flex:none}
    .hud .name{font-weight:800;color:#FFA030;font-size:15px;letter-spacing:.06em}
    .hud .sub{color:#8A8F98;margin-top:2px}
    .hud .url{color:#8A8F98;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
    .bar{height:4px;background:#2a2f38;border-radius:2px;margin:10px 0 8px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#FFA030,#FBBF24);transition:width .3s}
    .stats{display:flex;justify-content:space-between;color:#8A8F98}.stats b{color:#E6E6E6;font-weight:700}
    .feed{margin-top:8px;border-top:1px solid #23272f;padding-top:6px;min-height:15px}
    .feed div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:in .25s ease-out}
    @keyframes in{from{opacity:0;transform:translateY(4px)}}
    .k-jev{color:#2DD4BF}.k-claude{color:#C084FC}.k-human{color:#FBBF24}.k-rule{color:#A3A8B4}.k-fail{color:#F87171}.k-pass{color:#4ADE80}
    .final{margin-top:8px;padding:6px 8px;border-radius:8px;font-weight:800;text-align:center;letter-spacing:.05em}
    .final.pass{background:rgba(74,222,128,.15);color:#4ADE80}.final.defects{background:rgba(248,113,113,.16);color:#F87171}.final.not_run{background:rgba(251,191,36,.16);color:#FBBF24}
  </style>
  <div class="layer" id="layer"></div>
  <div class="layer"><div class="laser" id="laser"></div><div class="target" id="target"><div class="tag" id="tag"></div></div><div class="mole" id="mole"></div></div>
  <div class="hud" id="hud"><div class="top"><canvas id="hudmole"></canvas><div><div class="name">MOLE</div><div class="sub" id="sub">starting…</div><div class="url" id="url"></div></div></div>
    <div class="bar"><i id="prog"></i></div><div class="stats"><span><b id="s-el">0</b> elements</span><span><b id="s-ng">0</b> nuggets</span><span><b id="s-usd">$0</b></span><span><b id="s-t">0.0s</b></span></div>
    <div class="feed" id="feed"></div><div id="final"></div></div>`;
  const $ = (id) => root.getElementById(id);

  // The mole: sprite grid -> canvas (nearest-neighbour scaling done in CSS)
  const paint = (cv) => {
    if (!SPRITE) return;
    cv.width = SPRITE.width; cv.height = SPRITE.height;
    const c = cv.getContext('2d');
    SPRITE.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') { c.fillStyle = SPRITE.palette[ch.charCodeAt(0) - 97]; c.fillRect(x, y, 1, 1); } }));
  };
  const cursor = document.createElement('canvas'); paint(cursor); $('mole').appendChild(cursor); paint($('hudmole'));

  let t0 = Date.now(), timer = null, off = false;
  const fmt = (ms) => (ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm' + String(Math.round((ms % 60000) / 1000)).padStart(2, '0') + 's');
  const tick = () => { $('s-t').textContent = fmt(Date.now() - t0); };
  // Init scripts run before <html> exists on a fresh navigation: mount as soon as it does, and re-mount if a framework drops it.
  let watching = false;
  const mount = () => {
    const de = document.documentElement;
    if (!de) return;
    if (!host.isConnected) de.appendChild(host);
    if (!watching) { watching = true; new MutationObserver(mount).observe(de, { childList: true }); }
  };
  mount();
  new MutationObserver(mount).observe(document, { childList: true });
  document.addEventListener('DOMContentLoaded', mount);

  const api = {
    hud(s) {
      if (s.startedAtWall) t0 = s.startedAtWall;
      if (s.sub != null) $('sub').textContent = s.sub;
      if (s.url != null) $('url').textContent = s.url;
      if (s.elements != null) $('s-el').textContent = s.elements;
      if (s.nuggets != null) $('s-ng').textContent = s.nuggets;
      if (s.usd != null) $('s-usd').textContent = s.usd;
      if (s.progress != null) $('prog').style.width = Math.round(s.progress * 100) + '%';
      if (s.feed) { $('feed').innerHTML = ''; s.feed.forEach((f) => api.feed(f.kind, f.text)); }
      if (s.final) api.result(s.final.status, s.final.text); else $('final').innerHTML = '';
      clearInterval(timer); timer = setInterval(tick, 200); tick();
    },
    feed(kind, text) {
      const d = document.createElement('div'); d.className = 'k-' + kind; d.textContent = text;
      const f = $('feed'); f.appendChild(d); while (f.children.length > 4) f.firstChild.remove();
    },
    // Every measured element gets a box the moment the laser passes it; flagged ones stay red.
    sweep(rects, ms = 800) {
      const layer = $('layer'); layer.innerHTML = '';
      const maxY = Math.max(1, ...rects.map((r) => r.y + r.h)), frag = document.createDocumentFragment();
      for (const r of rects) {
        const b = document.createElement('div'); b.className = 'box ' + (r.rule ? 'bad' : 'ok');
        b.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;animation-delay:${Math.round((r.y / maxY) * ms)}ms`;
        if (r.rule) b.innerHTML = `<span class="chip">${r.rule}</span>`;
        frag.appendChild(b);
      }
      layer.appendChild(frag);
      const laser = $('laser'); laser.style.transition = 'none'; laser.style.top = '0px'; laser.style.opacity = '1';
      requestAnimationFrame(() => requestAnimationFrame(() => { laser.style.transition = `top ${ms}ms linear`; laser.style.top = maxY + 'px'; }));
      setTimeout(() => { laser.style.opacity = '0'; layer.querySelectorAll('.box.ok').forEach((b) => b.classList.add('fade')); }, ms + 350);
    },
    target(r, label) {
      const t = $('target'), m = $('mole');
      if (!r) { t.style.opacity = '0'; return; }
      Object.assign(t.style, { left: r.x - 3 + 'px', top: r.y - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px', opacity: '1' });
      $('tag').textContent = label || ''; $('tag').className = 'tag';
      m.style.opacity = '1'; m.style.transform = `translate(${Math.max(0, r.x - 40)}px, ${Math.max(0, r.y + r.height - 6)}px)`;
    },
    badge(text, kind) { $('tag').textContent = text; $('tag').className = 'tag ' + (kind || ''); },
    click() {
      const t = $('target').getBoundingClientRect(), d = document.createElement('div');
      d.className = 'rip'; d.style.left = t.x + t.width / 2 + 'px'; d.style.top = t.y + t.height / 2 + 'px';
      $('layer').appendChild(d); setTimeout(() => d.remove(), 600);
    },
    clear() { $('layer').innerHTML = ''; $('target').style.opacity = '0'; $('mole').style.opacity = '0'; $('laser').style.opacity = '0'; },
    result(status, text) { $('final').innerHTML = `<div class="final ${status}"></div>`; $('final').firstChild.textContent = text; clearInterval(timer); },
    hide() { host.style.display = 'none'; off = true; },
    show() { host.style.display = ''; off = false; },
  };
  window.__mole = api;
})();
