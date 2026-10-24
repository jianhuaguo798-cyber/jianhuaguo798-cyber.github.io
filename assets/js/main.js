(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var Q = {
    at: qs.has('at') ? parseFloat(qs.get('at')) : null,   // 冻结时间轴（秒）用于截图验证
    p: qs.has('p') ? parseFloat(qs.get('p')) : null,       // 强制滚动进度
    dbg: qs.has('dbg') ? parseFloat(qs.get('dbg')) || 0.5 : 0, // 叠加设计稿对位
    low: qs.has('low'),
    mx: qs.has('mx') ? parseFloat(qs.get('mx')) : null,     // 模拟光标位置（0~1）
    my: qs.has('my') ? parseFloat(qs.get('my')) : null
  };
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && matchMedia('(pointer: fine)').matches;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function smooth(x) { return x * x * (3 - 2 * x); }
  function oCubic(x) { return 1 - Math.pow(1 - x, 3); }

  var root = document.documentElement;
  var body = document.body;
  var canvas = $('#gl');
  var hero = $('#hero');

  /* ---------- 布局：设计稿 2000×1125 映射到视口 ---------- */
  var L = { u: 1, ox: 0, oy: 0, mode: 'desk' };
  var W = innerWidth, H = innerHeight;
  function layout() {
    W = innerWidth; H = innerHeight;
    var mob = W / H < 0.82;
    var fw = mob ? 750 : 2000, fh = mob ? 1500 : 1125;
    var u = Math.min(W / fw, H / fh);
    L.mode = mob ? 'mob' : 'desk';
    L.u = u; L.ox = (W - fw * u) / 2; L.oy = (H - fh * u) / 2;
    body.classList.toggle('is-mob', mob);
    canvas.style.height = H + 'px';
    root.style.setProperty('--u', u + 'px');
    root.style.setProperty('--ox', L.ox + 'px');
    root.style.setProperty('--oy', L.oy + 'px');
  }
  layout();

  /* ---------- 小字解码 ---------- */
  var POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#*+';
  var typers = $$('[data-type]').map(function (el, k) {
    var chars = [];
    (function walk(n) {
      Array.prototype.slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.textContent.split('').forEach(function (ch) {
            var s = document.createElement('span'); s.className = 'ch'; s.textContent = ch;
            s.dataset.f = ch; s.style.opacity = 0; chars.push(s); frag.appendChild(s);
          });
          n.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
      });
    })(el);
    var start = el.classList.contains('tag--tl') ? 1.75 : el.classList.contains('tag--tr') ? 1.95 : 2.7;
    return { el: el, chars: chars, start: start, cn: /[一-龥]/.test(el.textContent) };
  });
  var CN_POOL = '体验设计视觉探索交互界面系统逻辑惊喜';
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function tickTypers(T, t) {
    typers.forEach(function (ty, k) {
      var n = ty.chars.length;
      ty.chars.forEach(function (s, j) {
        var a = ty.start + j * 0.014, b = a + 0.22 + j * 0.006;
        var st;
        if (T < a) st = 0; else if (T < b) st = 1; else st = 2;
        if (s._st === st && st !== 1) return;
        s._st = st;
        if (st === 0) { s.style.opacity = 0; }
        else if (st === 1) {
          s.style.opacity = 0.55;
          if (s.dataset.f !== ' ') { var pool = ty.cn ? CN_POOL : POOL; s.textContent = pool[Math.floor(hash(j * 7.3 + k * 19.1 + Math.floor(t / 0.05)) * pool.length)]; }
        } else { s.style.opacity = 1; s.textContent = s.dataset.f; }
      });
    });
  }

  /* ---------- DOM 时间轴 ---------- */
  var lines = $$('.ln');
  var lineT = [[0.65, 1.75], [1.05, 1.85], [1.15, 1.95], [0.8, 1.9], [0.95, 2.05]];
  var pill = $('#pill'), year = $('.pill__year'), mottoLis = $$('#motto li'), cue = $('#cue'), frame = $('#frame');
  var yearShown = '';
  function tickDom(T, t, p) {
    lines.forEach(function (ln, i) { ln.style.setProperty('--p', oCubic(seg(T, lineT[i][0], lineT[i][1])).toFixed(4)); });
    tickTypers(T, t);
    var pk = oCubic(seg(T, 2.2, 3.0));
    pill.style.opacity = pk.toFixed(3);
    pill.style.transform = 'translate3d(0,' + ((1 - pk) * 24 * L.u).toFixed(2) + 'px,0)';
    var yk = seg(T, 2.25, 2.95);
    var yv = yk >= 1 ? '2026' : String(1990 + Math.floor(yk * 36));
    if (yv !== yearShown) { year.textContent = yv; yearShown = yv; }
    mottoLis.forEach(function (li, i) {
      var k = oCubic(seg(T, 2.45 + i * 0.12, 3.15 + i * 0.12));
      li.style.opacity = k.toFixed(3);
      li.style.transform = 'translate3d(0,' + ((1 - k) * 16 * L.u).toFixed(2) + 'px,0)';
      li.classList.toggle('is-on', p > 0.02 + i * 0.05 && p < 0.6);
    });
    cue.style.opacity = (seg(T, 3.6, 4.3) * (1 - seg(p, 0.0, 0.05))).toFixed(3);
    var fo = 1 - smooth(seg(p, 0.30, 0.46));
    frame.style.opacity = fo.toFixed(3);
    frame.style.visibility = fo < 0.01 ? 'hidden' : 'visible';
    frame.style.transform = 'translate3d(0,' + (-p * 60).toFixed(1) + 'px,0)';
  }

  /* ---------- 输入 ---------- */
  var S = {
    t: 0, dt: 1 / 60, T: 0, p: 0, mx: W * 0.62, my: H * 0.4, mvx: 0, mvy: 0,
    inside: false, down: false, overUI: false, reduced: reduced, titleHoverT: -1, titleHoverIdx: 4
  };
  var lastMove = { x: 0, y: 0, time: 0 };
  var lastDrop = { x: -999, y: -999, t: 0 };
  var dot = $('#cursorDot');
  var ring = $('#cursorRing');
  var ringP = { x: -100, y: -100 };
  if (finePointer) body.classList.add('has-cursor');
  addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    var now = performance.now();
    var dtm = Math.max(1, now - (lastMove.time || now - 16)) / 1000;
    var vx = (e.clientX - S.mx) / dtm, vy = (e.clientY - S.my) / dtm;
    S.mvx = S.mvx * 0.6 + vx * 0.4; S.mvy = S.mvy * 0.6 + vy * 0.4;
    S.mx = e.clientX; S.my = e.clientY; S.inside = true;
    lastMove.time = now;
    dot.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    // 光标划过水面：沿途荡起涟漪
    if (stage && stage.ready && S.T > 3 && S.p < 0.25 && e.clientY > stage.horizonPx + 8) {
      var dd = Math.hypot(e.clientX - (lastDrop.x || -999), e.clientY - (lastDrop.y || -999));
      if (dd > 34 && now - lastDrop.t > 70) {
        var spd = Math.min(1, Math.hypot(S.mvx, S.mvy) / 1400);
        stage.addDrop(e.clientX, e.clientY, 0.45 + 0.55 * spd);
        lastDrop.x = e.clientX; lastDrop.y = e.clientY; lastDrop.t = now;
      }
    }
    var tgt = e.target;
    var ui = tgt && tgt.closest && tgt.closest('a, button, .pill, .card');
    S.overUI = !!ui;
    dot.classList.toggle('is-link', !!ui);
    ring.classList.toggle('is-link', !!ui);
  }, { passive: true });
  document.addEventListener('pointerleave', function () { S.inside = false; });
  addEventListener('blur', function () { S.inside = false; });
  var touchTO = 0;
  addEventListener('pointerdown', function (e) {
    S.down = true;
    if (e.pointerType === 'touch') {
      // 触屏：点一下就在指尖处擦亮玻璃 + 冲击波
      S.mx = e.clientX; S.my = e.clientY; S.inside = true; S.mvx = 0; S.mvy = 0;
      clearTimeout(touchTO); touchTO = setTimeout(function () { S.inside = false; }, 900);
    }
    if (stage && stage.ready && S.T > 3 && !(e.target.closest && e.target.closest('a, button, .pill')) && S.p < 0.3) {
      // 点水面：溅起一圈大涟漪；点天空：吹出一个肥皂泡
      if (e.clientY > stage.horizonPx + 8) stage.addDrop(e.clientX, e.clientY, 1.7);
      else stage.blowBubble(e.clientX, e.clientY);
    }
  });
  addEventListener('pointerup', function () { S.down = false; });
  var titleHit = $('#titleHit');
  titleHit.addEventListener('pointerenter', function (e) {
    if (S.T < 3 || S.t - S.titleHoverT < 0.9) return;
    S.titleHoverT = S.t;
    var r = titleHit.getBoundingClientRect();
    S.titleHoverIdx = clamp(Math.floor((e.clientX - r.left) / r.width * 9), 0, 8);
  });

  /* ---------- 滚动 ---------- */
  var lenis = null;
  if (!reduced && window.Lenis && Q.p === null) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true, autoRaf: false });
    lenis.stop();
  }
  function scrollP() {
    var span = hero.offsetHeight - innerHeight;
    var y = lenis ? lenis.scroll : (window.scrollY || 0);
    return clamp(y / Math.max(1, span), 0, 1);
  }

  /* ---------- 第二屏入场 ---------- */
  var works = $('#works');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) works.classList.add('is-in'); }); }, { threshold: 0.18 }).observe(works);
  } else works.classList.add('is-in');

  /* ---------- 舞台 ---------- */
  var stage = null;
  // 双击本地文件打开时浏览器禁止 WebGL 读本地图片 → 直接用静态设计稿兜底（线上 / 本地服务器不受影响）
  if (location.protocol === 'file:') { body.classList.add('no-gl'); console.warn('请用 python3 tools/serve.py 预览，file:// 下 WebGL 贴图会被浏览器拦截'); }
  else try {
    var weak = L.mode === 'mob' || (navigator.hardwareConcurrency || 8) <= 4;
    stage = new window.Stage(canvas, { debug: Q.dbg, lowPower: Q.low || weak });
  } catch (err) {
    console.error(err);
    body.classList.add('no-gl');
  }

  var loaderNum = $('#loaderNum'), loaderBar = $('#loaderBar');
  var shown = 0, target = 0;
  function setProgress(k) { target = Math.max(target, k); }

  var fontsReady = (document.fonts && document.fonts.load)
    ? document.fonts.load('800 100px Mont').catch(function () {})
    : Promise.resolve();

  var started = false, introStart = 0;
  var clock = { t: 0, last: performance.now() };

  function start() {
    started = true;
    introStart = clock.t;
    $('#loader').classList.add('is-done');
    if (Q.at !== null) $('#loader').style.display = 'none';
    body.classList.remove('is-loading');

  }

  if (stage) {
    stage.resize(W, H, L);
    Promise.all([
      stage.load('assets/img/', function (k) { setProgress(k * 0.85); }),
      fontsReady.then(function () { setProgress(Math.max(target, 0.2)); })
    ]).then(function () {
      stage.build();
      stage.resize(W, H, L);
      stage.buildTitle();
      setProgress(1);
      // 预热一帧，避免开场卡顿
      stage.update(Object.assign({}, S, { T: 0, t: 0 }));
      stage.render();
      setTimeout(start, 380);
    }).catch(function (err) {
      console.error(err);
      body.classList.add('no-gl');
      start();
    });
  } else {
    setProgress(1); setTimeout(start, 300);
  }

  var resizeTO = 0, lastW = innerWidth, lastH = innerHeight;
  addEventListener('resize', function () {
    // 手机地址栏伸缩只改高度：小幅变化不重排，避免画面跳动
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 140 && L.mode === 'mob') return;
    lastW = innerWidth; lastH = innerHeight;
    layout();
    if (stage && stage.ready) stage.resize(W, H, L);
    clearTimeout(resizeTO);
    resizeTO = setTimeout(function () { if (stage && stage.ready) stage.buildTitle(); }, 160);
  });

  /* ---------- 主循环（虚拟时钟：dt 封顶，隐藏标签页不发散） ---------- */
  function frame_(now) {
    requestAnimationFrame(frame_);
    var dt = Math.min(1 / 20, Math.max(0, (now - clock.last) / 1000));
    clock.last = now;
    clock.t += dt;

    // 加载数字
    shown += (target - shown) * 0.18;
    if (!started || shown < 0.999) {
      loaderNum.textContent = Math.round(shown * 100);
      loaderBar.style.transform = 'scaleX(' + shown.toFixed(4) + ')';
    }
    if (!started) { if (stage && stage.ready) { stage.update(Object.assign({}, S, { T: 0, t: clock.t, dt: dt })); stage.render(); } return; }

    var T = clock.t - introStart;
    if (reduced) T = 20;
    var t = clock.t;
    if (Q.at !== null) { T = Q.at; t = Q.at; dt = 1 / 60; }

    if (lenis) {
      lenis.raf(clock.t * 1000);
      if (T > 2.6 && lenis.isStopped) lenis.start();
    }
    var p = Q.p !== null ? Q.p : scrollP();
    S.mvx *= Math.exp(-dt * 6); S.mvy *= Math.exp(-dt * 6);
    if (Q.mx !== null) { S.mx = Q.mx * W; S.my = Q.my * H; S.inside = true; }
    S.t = t; S.dt = dt; S.T = T; S.p = p;

    tickDom(T, t, p);
    if (finePointer) {
      ringP.x += (S.mx - ringP.x) * (1 - Math.exp(-dt * 16));
      ringP.y += (S.my - ringP.y) * (1 - Math.exp(-dt * 16));
      ring.style.transform = 'translate3d(' + ringP.x.toFixed(1) + 'px,' + ringP.y.toFixed(1) + 'px,0)';
      ring.style.opacity = S.inside ? '' : '0';
    }
    if (stage && stage.ready) {
      stage.update(S);
      stage.render();
    }
  }
  requestAnimationFrame(frame_);

  window.__app = { S: S, Q: Q, get stage() { return stage; }, L: L };
  // 开发辅助：把当前 WebGL 画面（可裁切，CSS 像素）存到本地预览服务器
  window.__shot = function (name, crop) {
    var fz = Q.at !== null ? Q.at : null;
    var s = Object.assign({}, S, { dt: 1 / 60 });
    if (fz !== null) { s.T = fz; s.t = fz; }
    if (Q.p !== null) s.p = Q.p;
    for (var i = 0; i < 4; i++) stage.update(s);
    stage.render();
    var d = stage.dpr, x = 0, y = 0, w = canvas.width, h = canvas.height;
    if (crop) { x = crop[0] * d; y = crop[1] * d; w = crop[2] * d; h = crop[3] * d; }
    var out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: out.toDataURL('image/png') }).then(function (r) { return r.text(); });
  };
})();
