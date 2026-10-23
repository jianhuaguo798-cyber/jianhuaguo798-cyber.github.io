/* WebGL 舞台：多 pass 管线
   field → main(天空海/圆环/人像) → reed(竖纹玻璃+标题) → fg(棱柱/气泡/薰衣草/蝴蝶/云雾) → bloom → post */
(function () {
  'use strict';
  var SH = window.SH;
  var FOV = 30, TANH = Math.tan(FOV * Math.PI / 360);
  var HORIZON = 915;                  // 背景图（2000×1126）里的地平线 y

  /* 两套构图：桌面按设计稿 2000×1125；手机竖屏 750×1500 重新编排 */
  var LAYOUTS = {
    desk: {
      fw: 2000, fh: 1125, horizon: 915,
      ring: { x: 1440, y: 465, r: 368 },
      portrait: { x: 763, y: 76, w: 928 },
      glass: { x0: 1068, x1: 1580, full: 720 },
      prisms: [
        { dx0: 780, dx1: 925, top: 670, base: 1000, D: 10.4, rot: 0.42 },
        { dx0: 950, dx1: 1030, top: 790, base: 1002, D: 10.9, rot: 0.34 },
        { dx0: 1415, dx1: 1595, top: 655, base: 1004, D: 9.9, rot: -0.20 },
        { dx0: 1730, dx1: 1782, top: 820, base: 1006, D: 10.6, rot: -0.32 }
      ],
      bubbles: [{ dx: 1652, dy: 553, r: 72, D: 10.5 }, { dx: 46, dy: 1112, r: 238, D: 6.0 }],
      lav: { cx: 1750, bottom: 1068, size: 340 },
      fly: { x: 1866, y: 728, w: 118, from: [2160, 330], c1: [1640, 360], c2: [1700, 760], loop: [1560, 520, 300, 190] },
      spawn: [640, 1940],
      title: { cap: 218, rows: [
        { from: 0, to: 4, align: 'l', x: 80, base: 428, gap: 10, mode: 'glass' },
        { from: 5, to: 8, align: 'r', x: 1925, base: 428, gap: 18, mode: 'glass' }
      ] }
    },
    mob: {
      fw: 750, fh: 1500, horizon: 1200,
      ring: { x: 580, y: 670, r: 294 },
      portrait: { x: 40, y: 360, w: 740 },
      glass: { x0: 283, x1: 691, full: 20 },
      prisms: [
        { dx0: 30, dx1: 118, top: 1010, base: 1240, D: 10.4, rot: 0.42 },
        { dx0: 128, dx1: 176, top: 1090, base: 1242, D: 10.9, rot: 0.34 },
        { dx0: 520, dx1: 628, top: 1000, base: 1244, D: 9.9, rot: -0.20 },
        null
      ],
      bubbles: [{ dx: 664, dy: 930, r: 48, D: 10.5 }, { dx: 14, dy: 1470, r: 160, D: 6.0 }],
      lav: { cx: 650, bottom: 1272, size: 230 },
      fly: { x: 708, y: 1094, w: 82, from: [900, 780], c1: [560, 820], c2: [600, 1120], loop: [500, 930, 190, 150] },
      spawn: [120, 720],
      title: { cap: 150, rows: [
        { from: 0, to: 4, align: 'l', x: 40, base: 330, gap: 7, mode: 'dark' },
        { from: 5, to: 8, align: 'r', x: 710, base: 505, gap: 12, mode: 'white' }
      ] }
    }
  };
  Stage.LAYOUTS = LAYOUTS;

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function smooth(x) { return x * x * (3 - 2 * x); }
  function oCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function oQuint(x) { return 1 - Math.pow(1 - x, 5); }
  function ioCubic(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function oBack(x) { var c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(a, b, l, dt) { return lerp(a, b, 1 - Math.exp(-l * dt)); }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  var CUSTOM_COVER = { // 写入覆盖率（人像）
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor
  };
  var CUSTOM_KEEPA = { // 不改动 alpha（圆环）
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor
  };

  function mat(o) {
    var m = new THREE.ShaderMaterial({
      uniforms: o.uniforms, vertexShader: o.vs || SH.VS_MESH, fragmentShader: o.fs,
      transparent: o.transparent !== false, depthTest: !!o.depthTest, depthWrite: !!o.depthWrite,
      side: o.side || THREE.FrontSide
    });
    if (o.blend) { for (var k in o.blend) m[k] = o.blend[k]; }
    else if (o.noBlend) m.blending = THREE.NoBlending;
    return m;
  }

  function Stage(canvas, opts) {
    opts = opts || {};
    this.opts = opts;
    var r = this.renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', premultipliedAlpha: false
    });
    r.autoClear = false;
    r.setClearColor(0xe4e6f8, 1);
    this.gl2 = r.capabilities.isWebGL2;
    this.maxTex = r.capabilities.maxTextureSize;
    this.budget = opts.lowPower ? 1.6e6 : 3.4e6;   // 渲染像素预算
    this.cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.tex = {};
    this.t = 0;
    this.ready = false;
    this.W = 2; this.H = 2; this.dpr = 1;
    this.L = { u: 1, ox: 0, oy: 0 };
    this.sm = { mx: 0, my: 0, lx: 0.5, ly: 0.5, lensX: 0, lensY: 0, lensVX: 0, lensVY: 0, fly: 0 };
    this.shock = { x: 0, y: 0, age: 9, amp: 0 };
    this.bubbles = [];
    this.fly = { mode: 'intro', t0: 0, path: null, x: 0, y: 0, dir: 1, flap: 0.3, burstAt: 4, lastPos: null };
    this.perf = { acc: 0, n: 0, steps: 0 };
  }

  /* ---------- 资源 ---------- */
  Stage.prototype.load = function (base, onProgress) {
    var self = this;
    var list = [
      ['bg', 'bg.webp'], ['portrait', 'portrait.webp'], ['portraitMask', 'portrait-mask.png'],
      ['lav', 'lavender.webp'], ['lavMask', 'lavender-mask.png'],
      ['fly', 'butterfly.webp'], ['flyMask', 'butterfly-mask.png']
    ];
    if (this.opts.debug) list.push(['design', 'design.webp']);
    var loader = new THREE.TextureLoader();
    var done = 0;
    return Promise.all(list.map(function (it) {
      return new Promise(function (res, rej) {
        loader.load(base + it[1], function (tx) {
          tx.anisotropy = Math.min(4, self.renderer.capabilities.getMaxAnisotropy());
          self.tex[it[0]] = tx;
          done++; onProgress && onProgress(done / list.length);
          res();
        }, undefined, function () { rej(new Error('load ' + it[1])); });
      });
    }));
  };

  /* ---------- 构建场景 ---------- */
  Stage.prototype.build = function () {
    var self = this, tx = this.tex;
    var halfF = THREE.HalfFloatType;

    // 渲染目标
    var rtOpt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, Object.assign({}, rtOpt, this.gl2 ? { samples: 4 } : {}));
    this.rtReed = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    this.rtFg = new THREE.WebGLRenderTarget(4, 4, Object.assign({}, rtOpt, { depthBuffer: true }, this.gl2 ? { samples: 4 } : {}));
    this.rtBloomA = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    this.rtBloomB = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    // 交互场需要能渲染到半浮点纹理（部分 iOS 只有 half_float 扩展），都没有就关掉擦亮效果
    var gl = this.renderer.getContext();
    var cbf = this.gl2 && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.fieldOn = cbf ? 1 : 0;
    var fOpt = Object.assign({}, rtOpt, { type: this.gl2 ? halfF : THREE.UnsignedByteType });
    this.rtFieldA = new THREE.WebGLRenderTarget(4, 4, fOpt);
    this.rtFieldB = new THREE.WebGLRenderTarget(4, 4, fOpt);

    function quadScene(material) {
      var s = new THREE.Scene(); var q = new THREE.Mesh(self.quadGeo, material); q.frustumCulled = false; s.add(q); return s;
    }

    // 交互场
    this.mField = mat({ vs: SH.VS_QUAD, fs: SH.FS_FIELD, noBlend: true, transparent: false, uniforms: {
      tPrev: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uA: { value: new THREE.Vector2(-1, -1) }, uB: { value: new THREE.Vector2(-1, -1) },
      uVel: { value: new THREE.Vector2() }, uDt: { value: 0.016 }, uAspect: { value: 1 }, uRad: { value: 0.075 }, uAmt: { value: 0 }, uHold: { value: 0 }
    } });
    this.sField = quadScene(this.mField);

    // —— main：天空海 + 圆环 + 人像
    this.sMain = new THREE.Scene();
    this.mBg = mat({ fs: SH.FS_BG, noBlend: true, transparent: false, uniforms: {
      tBg: { value: tx.bg }, tField: { value: null }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uHorizon: { value: HORIZON / 1126 }, uWhite: { value: 0 }, uBright: { value: 0 }, uFieldOn: { value: this.fieldOn }
    } });
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mBg);
    this.bg.renderOrder = 0; this.bg.frustumCulled = false;
    this.sMain.add(this.bg);

    this.glassU = function (extra) {
      var u = {
        tScene: { value: null }, uRes: { value: new THREE.Vector2() }, uBgRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uBgMap: { value: 0 },
        uLight: { value: new THREE.Vector3(0, 2, 2) }, uTime: { value: 0 }, uRefr: { value: 0.03 }, uDisp: { value: 0.12 },
        uIri: { value: 0.3 }, uOpacity: { value: 1 }, uKind: { value: 0 }, uEdge: { value: 0.02 }, uRim: { value: 1 }, uRefl: { value: 0 }, uWaterY: { value: -999 }, uBack: { value: 0 },
        uSize: { value: new THREE.Vector3(1, 1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) }
      };
      for (var k in extra) u[k].value = extra[k];
      return u;
    };

    this.mRing = mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, blend: CUSTOM_KEEPA, uniforms: this.glassU({
      tScene: tx.bg, uBgMap: 1, uKind: 0, uRefr: 0.026, uDisp: 0.45, uIri: 0.9, uRim: 1.35, uTint: new THREE.Vector3(1.02, 1.0, 1.05)
    }) });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.036, 48, 280), this.mRing);
    this.ring.renderOrder = 1;
    this.sMain.add(this.ring);

    this.mPortrait = mat({ fs: SH.FS_PORTRAIT, blend: CUSTOM_COVER, uniforms: {
      tColor: { value: tx.portrait }, tMask: { value: tx.portraitMask }, uKeyR: { value: 0.011 }, uSkin: { value: 0.75 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(0.90, 0.88, 0.99) }
    } });
    this.portrait = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mPortrait);
    this.portrait.renderOrder = 2;
    this.sMain.add(this.portrait);

    // —— reed：竖纹玻璃 + 标题
    this.mReed = mat({ vs: SH.VS_QUAD, fs: SH.FS_REED, noBlend: true, transparent: false, uniforms: {
      tScene: { value: this.rtScene.texture }, tField: { value: null }, uRes: { value: new THREE.Vector2() },
      uGlass: { value: new THREE.Vector4(0.5, 0.75, 22, 2.2) }, uTime: { value: 0 }, uChroma: { value: 0.35 },
      uFieldOn: { value: this.fieldOn }, uFrost: { value: 0.05 }, uLight: { value: new THREE.Vector2(0.5, 0.5) }, uPanelA: { value: 1 }
    } });
    this.sReed = quadScene(this.mReed);
    this.sTitle = new THREE.Scene();
    this.letters = [];

    // —— fg：棱柱 / 气泡 / 薰衣草 / 蝴蝶 / 云雾
    this.mCopy = mat({ vs: SH.VS_QUAD, fs: SH.FS_COPY, noBlend: true, transparent: false, uniforms: { tSrc: { value: this.rtReed.texture } } });
    this.sCopy = quadScene(this.mCopy);
    this.sFg = new THREE.Scene();

    // 棱柱：立在水面（底边 y≈1000），带倒影
    this.prisms = [0, 1, 2, 3].map(function (i) {
      var p = { delay: i * 0.13 };
      function gm(refl, back) {
        var m = mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, transparent: true, depthTest: !refl && !back, depthWrite: !refl && !back,
          side: back ? THREE.BackSide : THREE.FrontSide, uniforms: self.glassU({
          tScene: self.rtReed.texture, uKind: 2, uRefr: 0.03, uDisp: 0.3, uIri: 0.3, uRim: 1.0, uRefl: refl ? 1 : 0, uBack: back ? 1 : 0,
          uTint: new THREE.Vector3(1.0, 0.99, 1.04)
        }) });
        return m;
      }
      p.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), gm(false, false));
      p.mesh.renderOrder = 12 + i;
      p.back = new THREE.Mesh(p.mesh.geometry, gm(false, true));
      p.back.renderOrder = 8 + i;
      p.refl = new THREE.Mesh(p.mesh.geometry, gm(true, false));
      p.refl.renderOrder = 4 + i;
      self.sFg.add(p.refl);
      self.sFg.add(p.back);
      self.sFg.add(p.mesh);
      return p;
    });

    var sphere = new THREE.SphereGeometry(1, 72, 48);
    this.bubbleGeo = sphere;
    this.mainBubbles = [{ ph: 0.3, delay: 2.05 }, { ph: 1.7, delay: 1.75 }].map(function (b, i) {
      b.mesh = new THREE.Mesh(sphere, mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, transparent: true, depthTest: true, depthWrite: true, uniforms: self.glassU({
        tScene: self.rtReed.texture, uKind: 1, uRefr: 0.05, uDisp: 0.16, uIri: i === 1 ? 0.38 : 0.62, uRim: 1.0, uTint: new THREE.Vector3(1.02, 1.01, 1.05)
      }) }));
      b.mesh.renderOrder = 20 + i;
      self.sFg.add(b.mesh);
      return b;
    });
    // 漂浮小气泡池
    for (var i = 0; i < 7; i++) {
      var bm = new THREE.Mesh(sphere, mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, transparent: true, depthTest: true, depthWrite: false, uniforms: self.glassU({
        tScene: self.rtReed.texture, uKind: 1, uRefr: 0.02, uDisp: 0.2, uIri: 0.7, uRim: 1.0, uTint: new THREE.Vector3(1.02, 1.01, 1.05)
      }) }));
      bm.visible = false; bm.renderOrder = 30 + i;
      this.sFg.add(bm);
      this.bubbles.push({ mesh: bm, alive: false, born: 0, life: 8, pop: -1 });
    }
    this.nextBubble = 3.2;

    this.mLav = mat({ vs: SH.VS_LAV, fs: SH.FS_SPRITE, uniforms: {
      tColor: { value: tx.lav }, tMask: { value: tx.lavMask }, uKeyR: { value: 0.008 }, uSkin: { value: 0 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uShine: { value: 1 }, uGrow: { value: 0 },
      uSize: { value: new THREE.Vector2(1, 1) }, uPush: { value: new THREE.Vector2() }
    } });
    this.lav = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 30, 30), this.mLav);
    this.lav.renderOrder = 40;
    this.sFg.add(this.lav);

    var fa = 1313 / 1198;
    this.mFly = mat({ vs: SH.VS_FLY, fs: SH.FS_SPRITE, side: THREE.DoubleSide, uniforms: {
      tColor: { value: tx.fly }, tMask: { value: tx.flyMask }, uKeyR: { value: 0.008 }, uSkin: { value: 0 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uShine: { value: 1.6 }, uFlap: { value: 0.3 },
      uSize: { value: new THREE.Vector2(fa, 1) },
      uAxA: { value: new THREE.Vector2(505 / 1313, 1 - 752 / 1198) }, uAxB: { value: new THREE.Vector2(735 / 1313, 1 - 1095 / 1198) }
    } });
    this.flyMesh = new THREE.Mesh(new THREE.PlaneGeometry(fa, 1, 36, 36), this.mFly);
    this.flyMesh.renderOrder = 41;
    this.sFg.add(this.flyMesh);

    this.fogs = [3.0, 2.1, 1.25, 0.55, -0.4].map(function (z, i) {
      var m = mat({ fs: SH.FS_FOG, uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: i * 3.7 } } });
      var f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
      f.renderOrder = 60 + i; f.userData.z = z;
      self.sFg.add(f);
      return f;
    });

    // —— bloom + post
    this.mBright = mat({ vs: SH.VS_QUAD, fs: SH.FS_BRIGHT, noBlend: true, transparent: false, uniforms: { tSrc: { value: this.rtFg.texture }, uThr: { value: 0.975 } } });
    this.sBright = quadScene(this.mBright);
    this.mBlur = mat({ vs: SH.VS_QUAD, fs: SH.FS_BLUR, noBlend: true, transparent: false, uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } } });
    this.sBlur = quadScene(this.mBlur);
    this.mPost = mat({ vs: SH.VS_QUAD, fs: SH.FS_POST, noBlend: true, transparent: false, uniforms: {
      tColor: { value: this.rtFg.texture }, tBloom: { value: this.rtBloomA.texture }, tDesign: { value: tx.design || null },
      uRes: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uLens: { value: new THREE.Vector3(-999, -999, 20) }, uLensV: { value: new THREE.Vector2() }, uLensA: { value: 0 },
      uShock: { value: new THREE.Vector4(0, 0, 9, 0) },
      uWhite: { value: 1 }, uBurst: { value: 0 }, uCA: { value: 0 }, uBloom: { value: 0.32 }, uGrain: { value: 0.022 },
      uDbg: { value: this.opts.debug || 0 }, uFrame: { value: new THREE.Vector4() }
    } });
    this.sPost = quadScene(this.mPost);

    this.ready = true;
  };

  /* ---------- 标题字形 ---------- */
  Stage.prototype.buildTitle = function () {
    var self = this;
    var WORD = 'PORTFOLIO';
    var FONT = '"Mont", "Montserrat", "Helvetica Neue", Arial, sans-serif';
    var c = document.createElement('canvas').getContext('2d');
    c.font = '800 100px ' + FONT;
    var capR = c.measureText('H').actualBoundingBoxAscent / 100 || 0.70;
    var LT = (this.LY || LAYOUTS.desk).title;
    var fsD = LT.cap / capR;                      // 设计稿字号（按 cap height 反推）
    c.font = '800 ' + fsD + 'px ' + FONT;
    var adv = [], i;
    for (i = 0; i < WORD.length; i++) adv.push(c.measureText(WORD[i]).width);
    // 设计稿：PORTF 紧排从 80 开始，OLIO 右对齐到 1925，中间留给侧脸
    var inkL = [], inkR = [];
    for (i = 0; i < WORD.length; i++) {
      var mm = c.measureText(WORD[i]);
      inkL.push(-mm.actualBoundingBoxLeft); inkR.push(mm.actualBoundingBoxRight);
    }
    // Montserrat 比设计稿字形宽约 12%，横向收窄对齐
    var CX = 0.89;
    var penX = [], rowOf = [], xx;
    LT.rows.forEach(function (row, ri) {
      var j;
      if (row.align === 'l') {
        xx = row.x;
        for (j = row.from; j <= row.to; j++) { penX[j] = xx - inkL[j] * CX; xx = penX[j] + inkR[j] * CX + row.gap; rowOf[j] = row; }
      } else {
        xx = row.x;
        for (j = row.to; j >= row.from; j--) { penX[j] = xx - inkR[j] * CX; xx = penX[j] + inkL[j] * CX - row.gap; rowOf[j] = row; }
      }
    });
    var pad = fsD * 0.12, asc = fsD * 0.98, desc = fsD * 0.28;
    var cellH = asc + desc + pad * 2;
    this.titleMeta = { fsD: fsD, capR: capR, capH: LT.cap, cellH: cellH };

    // 高清字形条（最终字母）
    var dpr = this.dpr;
    var capPx = LT.cap * this.L.u * dpr;
    var fsT = clamp(capPx / capR * 1.05, 120, 720);
    var k = fsT / fsD;
    var cols = 5, rows = 2;
    var cellWs = adv.map(function (a) { return (a + pad * 2); });
    var maxCW = Math.max.apply(null, cellWs);
    var gc = document.createElement('canvas');
    gc.width = Math.min(this.maxTex, Math.ceil(maxCW * k * cols));
    gc.height = Math.min(this.maxTex, Math.ceil(cellH * k * rows));
    var g = gc.getContext('2d');
    g.font = '800 ' + fsT + 'px ' + FONT;
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';

    // 乱码字形图集
    var POOL = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+<>/=';
    var fsS = 150, kS = fsS / fsD, sCols = 11, sRows = Math.ceil(POOL.length / sCols);
    var sCellW = maxCW * kS, sCellH = cellH * kS;
    var sc = document.createElement('canvas');
    sc.width = Math.ceil(sCellW * sCols); sc.height = Math.ceil(sCellH * sRows);
    var s = sc.getContext('2d');
    s.font = '800 ' + fsS + 'px ' + FONT; s.fillStyle = '#fff'; s.textAlign = 'center'; s.textBaseline = 'alphabetic';
    for (i = 0; i < POOL.length; i++) {
      var cx = (i % sCols) * sCellW, cy = Math.floor(i / sCols) * sCellH;
      s.fillText(POOL[i], cx + sCellW / 2, cy + (pad + asc) * kS);
    }
    var texS = new THREE.CanvasTexture(sc);
    var texG = new THREE.CanvasTexture(gc);
    texG.generateMipmaps = true; texG.minFilter = THREE.LinearMipmapLinearFilter;
    texG.anisotropy = 4;

    // 清掉旧字母
    this.letters.forEach(function (L) { self.sTitle.remove(L.mesh); L.mesh.geometry.dispose(); L.mesh.material.dispose(); });
    this.letters = [];
    var geo = new THREE.PlaneGeometry(1, 1);
    for (i = 0; i < WORD.length; i++) {
      var x = penX[i];
      var col = i % cols, row = Math.floor(i / cols);
      var gx = col * maxCW * k, gy = row * cellH * k;
      g.fillText(WORD[i], gx + pad * k, gy + (pad + asc) * k);
      var u0 = gx / gc.width, u1 = (gx + cellWs[i] * k) / gc.width;
      var v1 = 1 - gy / gc.height, v0 = 1 - (gy + cellH * k) / gc.height;
      // 乱码采样窗口：与本字母同宽高比，居中
      var winW = cellWs[i] * kS;
      var m = mat({ fs: SH.FS_TITLE, uniforms: {
        tGlyph: { value: texG }, uRect: { value: new THREE.Vector4(u0, v0, u1, v1) },
        tScene: { value: this.rtScene.texture }, uRes: { value: new THREE.Vector2() },
        uSplit: { value: 0.5 }, uAlpha: { value: 0 },
        uDark: { value: new THREE.Vector3(0.165, 0.165, 0.196) }, uWhite: { value: new THREE.Vector3(1, 1, 1) }
      } });
      var mesh = new THREE.Mesh(geo, m);
      this.sTitle.add(mesh);
      this.letters.push({
        ch: WORD[i], mesh: mesh, rectHi: m.uniforms.uRect.value.clone(),
        dx: x - pad * CX, dy: rowOf[i].base - asc - pad, dw: cellWs[i] * CX, dh: cellH, mode: rowOf[i].mode,
        winW: winW, i: i, glyph: -1
      });
      m.uniforms.uRes.value.set(this.rw || 2, this.rh || 2);
    }
    this.titleInk = penX.map(function (px, j) { return [Math.round(px + inkL[j] * CX), Math.round(px + inkR[j] * CX)]; });
    texG.needsUpdate = true;
    this.texScr = texS; this.texGlyph = texG;
    this.scr = { pool: POOL, cols: sCols, cellW: sCellW, cellH: sCellH, w: sc.width, h: sc.height };
    this.titleBuilt = true;
    this.layoutObjects();
  };

  /* ---------- 视口 / 设计稿映射 ---------- */
  Stage.prototype.resize = function (W, H, L) {
    if (!(W > 2 && H > 2)) return;              // 隐藏面板 / 折叠窗口时宽高可能为 0
    this.W = W; this.H = H; this.L = L;
    var base = Math.min(window.devicePixelRatio || 1, 2);
    var dpr = Math.min(base, Math.sqrt(this.budget / (W * H)));
    this.dpr = Math.max(0.6, dpr);
    var rw = Math.round(W * this.dpr), rh = Math.round(H * this.dpr);
    this.rw = rw; this.rh = rh;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(rw, rh, false);
    this.cam.aspect = W / H; this.cam.updateProjectionMatrix();
    if (!this.ready) return;
    this.rtScene.setSize(rw, rh); this.rtReed.setSize(rw, rh); this.rtFg.setSize(rw, rh);
    var bw = Math.max(2, rw >> 2), bh = Math.max(2, rh >> 2);
    this.rtBloomA.setSize(bw, bh); this.rtBloomB.setSize(bw, bh);
    var fw = Math.max(2, Math.round(W / 4)), fh = Math.max(2, Math.round(H / 4));
    this.rtFieldA.setSize(fw, fh); this.rtFieldB.setSize(fw, fh);
    this.mField.uniforms.uSize.value.set(fw, fh);
    var res = new THREE.Vector2(rw, rh);
    [this.mBg, this.mReed, this.mPost, this.mRing].forEach(function (m) { m.uniforms.uRes.value.copy(res); });
    this.prisms.forEach(function (p) { p.mesh.material.uniforms.uRes.value.copy(res); });
    this.mainBubbles.forEach(function (b) { b.mesh.material.uniforms.uRes.value.copy(res); });
    this.bubbles.forEach(function (b) { b.mesh.material.uniforms.uRes.value.copy(res); });
    this.letters.forEach(function (l) { l.mesh.material.uniforms.uRes.value.copy(res); });
    this.LY = LAYOUTS[L.mode] || LAYOUTS.desk;
    this.mPost.uniforms.uFrame.value.set(L.ox * this.dpr, L.oy * this.dpr, this.LY.fw * L.u * this.dpr, this.LY.fh * L.u * this.dpr);
    this.layoutObjects();
  };

  // 设计稿坐标 → 静止相机下深度 D 处的世界坐标
  Stage.prototype.wPx = function (sx, sy, D, out) {
    var nx = sx / this.W * 2 - 1, ny = 1 - sy / this.H * 2;
    out = out || new THREE.Vector3();
    return out.set(nx * D * TANH * this.cam.aspect, ny * D * TANH, -D);
  };
  Stage.prototype.wAt = function (dx, dy, D, out) {
    return this.wPx(this.L.ox + dx * this.L.u, this.L.oy + dy * this.L.u, D, out);
  };
  Stage.prototype.wLenPx = function (px, D) { return px / this.H * 2 * D * TANH; };
  Stage.prototype.wLen = function (d, D) { return this.wLenPx(d * this.L.u, D); };

  Stage.prototype.layoutObjects = function () {
    if (!this.ready) return;
    var W = this.W, H = this.H, L = this.L, self = this, LY = this.LY || LAYOUTS.desk;
    // 背景：按地平线对齐 + 覆盖视口 + 视差余量
    var D = 60, mg = 0.06;
    var sc = Math.max(W / 2000, H / 1126) * 1.16;
    var hy = L.oy + LY.horizon * L.u, cy;
    for (var it = 0; it < 8; it++) {
      cy = hy - (HORIZON - 563) * sc;
      var top = cy - 563 * sc, bot;
      if (top > -H * mg) cy -= top + H * mg;
      bot = cy + 563 * sc;
      if (bot < H * (1 + mg)) { sc *= 1.06; continue; }
      break;
    }
    this.bgLay = { D: D, cx: W / 2, cy: cy, sc: sc };
    this.wPx(W / 2, cy, D, this.bg.position);
    this.bg.scale.set(this.wLenPx(2000 * sc, D), this.wLenPx(1126 * sc, D), 1);

    // 圆环
    this.ringD = 14;
    this.wAt(LY.ring.x, LY.ring.y, this.ringD, this.ring.position);
    this.ringR = this.wLen(LY.ring.r, this.ringD);
    this.ring.scale.setScalar(this.ringR);
    this.ringBase = this.ring.position.clone();

    // 人像
    var pD = 12, pw = LY.portrait.w, ph = pw * 1339 / 1175;
    this.wAt(LY.portrait.x + pw / 2, LY.portrait.y + ph / 2, pD, this.portrait.position);
    this.portrait.scale.set(this.wLen(pw, pD), this.wLen(ph, pD), 1);
    this.portraitBase = this.portrait.position.clone();

    // 竖纹玻璃（虚拟面板深度 11）
    this.glassD = 11;
    this.glassX0 = this.wAt(LY.glass.x0, 0, this.glassD).x;
    this.glassX1 = this.wAt(LY.glass.x1, 0, this.glassD).x;
    this.glassXFull = this.wAt(LY.glass.full, 0, this.glassD).x;

    // 棱柱：从顶部到水面
    this.prisms.forEach(function (p, i) {
      var cfg = LY.prisms[i];
      p.off = !cfg;
      if (!cfg) { p.mesh.visible = p.refl.visible = p.back.visible = false; return; }
      for (var k in cfg) p[k] = cfg[k];
      var w = self.wLen(p.dx1 - p.dx0, p.D);
      var h = self.wLen(p.base - p.top, p.D);
      var d = w * 0.62;
      p.mesh.geometry.dispose();
      p.mesh.geometry = new THREE.BoxGeometry(w, h, d);
      p.refl.geometry = p.mesh.geometry; p.back.geometry = p.mesh.geometry;
      var c = self.wAt((p.dx0 + p.dx1) / 2, (p.top + p.base) / 2, p.D);
      p.c = c; p.h = h;
      p.waterY = self.wAt(0, p.base, p.D).y;
      p.mesh.position.copy(c);
      p.mesh.rotation.set(0.0, p.rot, 0);
      p.refl.rotation.set(0.0, p.rot, 0);
      p.back.rotation.set(0.0, p.rot, 0);
      [p.mesh, p.refl, p.back].forEach(function (m) {
        var u = m.material.uniforms;
        u.uSize.value.set(w / 2, h / 2, d / 2);
        u.uEdge.value = Math.min(w, d) * 0.06;
      });
    });
    this.mainBubbles.forEach(function (b, i) {
      var cfg = LY.bubbles[i];
      b.dx = cfg.dx; b.dy = cfg.dy; b.r = cfg.r; b.D = cfg.D;
      b.base = self.wAt(b.dx, b.dy, b.D);
      b.R = self.wLen(b.r, b.D);
      b.mesh.position.copy(b.base);
    });

    // 薰衣草（底部锚定）
    var lavD = 9, ls = LY.lav.size;
    this.wAt(LY.lav.cx, LY.lav.bottom - ls / 2, lavD, this.lav.position);
    this.lav.scale.set(this.wLen(ls, lavD), this.wLen(ls, lavD), 1);
    this.lavBase = this.lav.position.clone();

    // 蝴蝶停在右侧花穗顶端
    this.flyD = 9;
    this.flyPerch = { dx: LY.fly.x, dy: LY.fly.y };
    this.flyScale = this.wLen(LY.fly.w, this.flyD);

    // 云雾：按相机起点覆盖
    this.fogs.forEach(function (f) {
      var dist = 4.6 - f.userData.z + 2.0;
      var hh = dist * TANH * 2 * 1.6;
      f.scale.set(hh * Math.max(1, self.cam.aspect), hh * Math.max(1, 1 / self.cam.aspect), 1);
      f.position.set(0, 0, f.userData.z);
    });

    // 标题字母
    this.letters.forEach(function (l) {
      var tD = 13;
      l.D = tD;
      l.base = self.wAt(l.dx + l.dw / 2, l.dy + l.dh / 2, tD);
      l.mesh.scale.set(self.wLen(l.dw, tD), self.wLen(l.dh, tD), 1);
      l.mesh.position.copy(l.base);
    });
  };

  /* ---------- 每帧状态 ---------- */
  Stage.prototype.update = function (S) {
    if (!this.ready) return;
    var t = S.t, dt = S.dt, T = S.T, p = S.p, self = this, sm = this.sm;
    this.t = t;
    var W = this.W, H = this.H, dpr = this.dpr;
    var reduced = S.reduced;

    // —— 鼠标平滑
    // 没有光标时（触屏 / 光标离开）镜头自己缓慢呼吸漂移
    var mx = S.inside ? (S.mx / W) * 2 - 1 : Math.sin(t * 0.23) * 0.35, my = S.inside ? (S.my / H) * 2 - 1 : Math.sin(t * 0.17 + 1.0) * 0.22;
    if (reduced) { mx = 0; my = 0; }
    sm.mx = damp(sm.mx, mx, 2.6, dt); sm.my = damp(sm.my, my, 2.6, dt);
    sm.lx = damp(sm.lx, S.inside ? S.mx / W : 0.62, 4, dt);
    sm.ly = damp(sm.ly, S.inside ? S.my / H : 0.35, 4, dt);

    // —— 开场
    var camZ = 4.4 * (1 - oCubic(seg(T, 0, 2.6)));
    var white = 1 - smooth(seg(T, 0.0, 0.6));

    // —— 滚动编排
    // 三拍：碎（0~0.4 标题散开、人像化进竖纹）→ 清（0.4~0.62 玻璃幕褪去、圆环居中）→ 穿（0.72 穿环，之后进入亮天空）
    // 先缓推（圆环移到画面中央），玻璃幕褪去后加速冲进圆环
    var CROSS = 0.70;
    var zA = -3.0 * smooth(seg(p, 0.06, 0.45));
    var zB = -(this.ringD - 3.0) * Math.pow(seg(p, 0.45, CROSS), 2.0);
    var beyond = oCubic(seg(p, CROSS, 1.0));
    var toRing = smooth(seg(p, 0.10, 0.58));
    var rc = this.ringBase;
    var bx = rc.x * toRing, by = rc.y * toRing;
    var bz = camZ + zA + zB - 4.5 * beyond;
    this.scrollK = { beyond: beyond };
    var parA = 1 - seg(p, 0.05, 0.5) * 0.7;
    var cx = bx + sm.mx * 0.30 * parA, cy = by - sm.my * 0.17 * parA;
    this.cam.position.set(cx, cy, bz);
    this.cam.lookAt(bx, by, bz - 12);

    var burst = Math.exp(-Math.pow((p - CROSS) / 0.03, 2)) * 0.32;
    var bright = smooth(seg(p, CROSS, 0.95)) * 0.32;

    // —— 交互场
    var fu = this.mField.uniforms;
    if (this.fieldOn) {
      var ux = S.mx / W, uy = 1 - S.my / H;
      if (!S.inside || reduced) { fu.uA.value.set(-5, -5); fu.uB.value.set(-5, -5); fu.uAmt.value = 0; fu.uHold.value = 0; }
      else {
        var pa = this.prevU || { x: ux, y: uy };
        fu.uA.value.set(pa.x, pa.y); fu.uB.value.set(ux, uy);
        var spd = Math.hypot(S.mvx / H, S.mvy / H);
        fu.uAmt.value = clamp(spd * dt * 9.0, 0, 0.55) * seg(T, 2.4, 3.2);
        fu.uHold.value = 1.4 * seg(T, 2.4, 3.2);
        fu.uVel.value.set(clamp(S.mvx / H * dt * 0.26, -0.05, 0.05), clamp(-S.mvy / H * dt * 0.26, -0.05, 0.05));
      }
      this.prevU = { x: ux, y: uy };
      fu.uDt.value = dt; fu.uAspect.value = W / H;
    }

    // —— 天空海
    var bu = this.mBg.uniforms;
    bu.uTime.value = t; bu.uWhite.value = white * 0.5; bu.uBright.value = bright;
    this.mBg.uniforms.uFieldOn.value = this.fieldOn;

    // 背景在屏幕上的矩形（给圆环采样）
    var hw = this.bg.scale.x / 2, hh = this.bg.scale.y / 2;
    var v = new THREE.Vector3(this.bg.position.x - hw, this.bg.position.y - hh, this.bg.position.z).project(this.cam);
    var v2 = new THREE.Vector3(this.bg.position.x + hw, this.bg.position.y + hh, this.bg.position.z).project(this.cam);
    var rx0 = v.x * 0.5 + 0.5, ry0 = v.y * 0.5 + 0.5, rx1 = v2.x * 0.5 + 0.5, ry1 = v2.y * 0.5 + 0.5;

    // 光源跟随光标
    var light = this.wPx(sm.lx * W, sm.ly * H, 5.5).add(new THREE.Vector3(0, 0, 0));
    light.z += 3.0;
    light.applyMatrix4(new THREE.Matrix4().makeTranslation(this.cam.position.x, this.cam.position.y, this.cam.position.z));

    // —— 圆环
    var ringIn = seg(T, 1.25, 2.9);
    var rr = this.ring;
    rr.rotation.set(0.07 * Math.sin(t * 0.17 + 1) - sm.my * 0.05, lerp(1.25, 0.2, ioCubic(ringIn)) + Math.sin(t * 0.21) * 0.09 + sm.mx * 0.06, 0.04 * Math.sin(t * 0.13));
    rr.scale.setScalar(this.ringR * lerp(0.86, 1, oCubic(ringIn)));
    var ru = this.mRing.uniforms;
    ru.uBgRect.value.set(rx0, ry0, rx1 - rx0, ry1 - ry0);
    ru.uTime.value = t; ru.uLight.value.copy(light); ru.uOpacity.value = smooth(ringIn);

    // —— 人像
    var pu = this.mPortrait.uniforms;
    var pIn = smooth(seg(T, 0.95, 2.1));
    var pOut = 1 - smooth(seg(p, 0.22, 0.40));
    pu.uOpacity.value = pIn * pOut; pu.uTime.value = t;
    var breathe = Math.sin(t * 0.9) * 0.004;
    this.portrait.position.copy(this.portraitBase);
    this.portrait.position.y += this.portrait.scale.y * (breathe - (1 - oCubic(seg(T, 0.95, 2.6))) * 0.035);

    // —— 竖纹玻璃
    var gx0w = lerp(this.glassX0, this.glassXFull, smooth(seg(p, 0.04, 0.26)));
    var g0 = new THREE.Vector3(gx0w, this.portraitBase.y, -this.glassD).project(this.cam);
    var g1 = new THREE.Vector3(this.glassX1, this.portraitBase.y, -this.glassD).project(this.cam);
    var gu = this.mReed.uniforms;
    var focus = 1 - oCubic(seg(T, 1.0, 3.1));
    var shatter = smooth(seg(p, 0.04, 0.30));
    var strength = 1.35 + focus * 6.5 + shatter * 7.0;
    var ribPx = 38 * this.L.u * dpr * (1 + shatter * 0.5);
    gu.uGlass.value.set(g0.x * 0.5 + 0.5, g1.x * 0.5 + 0.5, ribPx, strength);
    gu.uPanelA.value = 1 - smooth(seg(p, 0.34, 0.48));
    gu.uTime.value = t; gu.uChroma.value = 0.42 + focus * 0.8 + shatter * 0.6;
    gu.uLight.value.set(sm.lx, 1 - sm.ly);
    gu.uFrost.value = 0.05 + focus * 0.12;

    // —— 标题
    var split = g0.x * 0.5 + 0.5;
    var tm = this.titleMeta;
    var drift = oCubic(seg(p, 0.0, 0.42));
    var hoverT = S.titleHoverT;
    this.letters.forEach(function (l, i) {
      var a0 = 1.05 + i * 0.07, s0 = 1.45 + i * 0.09;
      var ap = seg(T, a0, a0 + 0.22);
      var rise = (1 - oCubic(seg(T, a0, s0 + 0.35))) * 0.30;
      var settled = T >= s0;
      var hs = hoverT >= 0 ? (t - hoverT) : 99;
      var hEnd = 0.10 + Math.abs(i - (S.titleHoverIdx || 4)) * 0.05;
      var scrambling = !settled || (hs >= 0 && hs < hEnd);
      var u = l.mesh.material.uniforms;
      if (scrambling && !reduced) {
        var gi = Math.floor(hash(i * 13.1 + Math.floor(t / 0.055)) * self.scr.pool.length);
        var col = gi % self.scr.cols, row = Math.floor(gi / self.scr.cols);
        var cx0 = col * self.scr.cellW + (self.scr.cellW - l.winW) / 2;
        u.tGlyph.value = self.texScr;
        u.uRect.value.set(cx0 / self.scr.w, 1 - (row + 1) * self.scr.cellH / self.scr.h, (cx0 + l.winW) / self.scr.w, 1 - row * self.scr.cellH / self.scr.h);
      } else {
        u.tGlyph.value = self.texGlyph; u.uRect.value.copy(l.rectHi);
      }
      u.uSplit.value = l.mode === 'dark' ? 2.0 : l.mode === 'white' ? -1.0 : split;
      u.uAlpha.value = ap * (1 - smooth(seg(p, 0.22, 0.46)));
      var side = (i - 4) / 4;
      l.mesh.position.copy(l.base);
      l.mesh.position.y -= rise * l.mesh.scale.y * 0.6;
      l.mesh.position.x += side * drift * 3.2;
      l.mesh.position.y += drift * (0.6 + Math.abs(side) * 0.8);
      l.mesh.position.z += drift * (2.5 + hash(i) * 3.0);
      l.mesh.quaternion.copy(self.cam.quaternion);
    });

    // —— 棱柱
    this.prisms.forEach(function (pr, i) {
      if (pr.off) return;
      var rp = oBack(seg(T, 1.55 + pr.delay, 2.75 + pr.delay));
      var sink = (1 - rp) * pr.h * 1.02;
      pr.mesh.position.copy(pr.c);
      pr.mesh.position.y -= sink;
      // 倒影：以水面为轴镜像
      pr.refl.position.copy(pr.c);
      pr.refl.position.y = 2 * pr.waterY - (pr.c.y - sink);
      pr.refl.scale.set(1, -1, 1);
      pr.back.position.copy(pr.mesh.position);
      var op = smooth(seg(T, 1.55 + pr.delay, 2.1 + pr.delay));
      [pr.mesh, pr.refl, pr.back].forEach(function (m) {
        var u = m.material.uniforms;
        u.uTime.value = t; u.uLight.value.copy(light); u.uOpacity.value = op;
        u.uWaterY.value = pr.waterY;
        m.visible = op > 0.001;
      });
    });

    // —— 主气泡
    var projR = function (pos, R) {
      var a = pos.clone().project(self.cam), b = pos.clone().add(new THREE.Vector3(0, R, 0)).project(self.cam);
      return Math.abs(b.y - a.y) * 0.5;   // 以屏高为单位的半径
    };
    this.mainBubbles.forEach(function (b, i) {
      var k = oBack(seg(T, b.delay, b.delay + 0.95));
      b.mesh.position.copy(b.base);
      b.mesh.position.y += Math.sin(t * 0.7 + b.ph) * b.R * 0.10;
      b.mesh.position.x += Math.sin(t * 0.43 + b.ph * 2.0) * b.R * 0.05;
      b.mesh.scale.setScalar(Math.max(0.0001, b.R * k));
      var u = b.mesh.material.uniforms;
      u.uTime.value = t; u.uLight.value.copy(light);
      u.uRefr.value = projR(b.mesh.position, b.R) * 1.0;
      u.uOpacity.value = smooth(seg(T, b.delay, b.delay + 0.4));
    });

    // —— 漂浮小气泡
    if (!reduced && T > 3.2) this.tickBubbles(t, dt, light, projR);

    // —— 薰衣草
    var lu = this.mLav.uniforms;
    lu.uTime.value = t; lu.uGrow.value = oCubic(seg(T, 2.0, 3.3)); lu.uOpacity.value = smooth(seg(T, 2.0, 2.5));
    var lavS = this.lav.position.clone().project(this.cam);
    var ldx = (S.mx / W) - (lavS.x * 0.5 + 0.5), ldy = (S.my / H) - (0.5 - lavS.y * 0.5);
    var lnear = S.inside ? Math.exp(-(ldx * ldx * 18 + ldy * ldy * 10)) : 0;
    sm.push = damp(sm.push || 0, clamp(S.mvx / W * 0.04, -0.06, 0.06) * lnear, 3.5, dt);
    lu.uPush.value.set(sm.push, 0);

    // —— 蝴蝶
    this.tickFly(S, light);

    // —— 云雾
    this.fogs.forEach(function (f, i) {
      var u = f.material.uniforms;
      u.uTime.value = t;
      var distCam = self.cam.position.z - f.userData.z;
      var near = smooth(seg(distCam, 0.05, 0.9));
      u.uAlpha.value = (1 - smooth(seg(T, 0.45 + i * 0.1, 1.45 + i * 0.1))) * near * (i === 4 ? 0.6 : 0.95);
      f.visible = u.uAlpha.value > 0.002 && distCam > 0.02;
      f.position.x = self.cam.position.x * 0.0;
    });

    // —— 后期
    var po = this.mPost.uniforms;
    po.uTime.value = t;
    po.uWhite.value = white;
    po.uBurst.value = burst;
    po.uCA.value = burst * 0.06 + seg(p, 0.5, CROSS) * (1 - seg(p, CROSS, 0.8)) * 0.008;
    var lensA = reduced ? 0 : seg(T, 2.6, 3.3) * (S.inside ? 1 : 0) * (S.overUI ? 0.0 : 1) * (1 - seg(p, 0.6, 0.8));
    sm.lensA = damp(sm.lensA || 0, lensA, 8, dt);
    var lx = S.mx * dpr, ly = (H - S.my) * dpr;
    var nlx = damp(sm.lensX || lx, lx, 14, dt), nly = damp(sm.lensY || ly, ly, 14, dt);
    var vx = (nlx - (sm.lensX || nlx)) / Math.max(dt, 1e-3), vy = (nly - (sm.lensY || nly)) / Math.max(dt, 1e-3);
    sm.lensVX = damp(sm.lensVX, vx, 10, dt); sm.lensVY = damp(sm.lensVY, vy, 10, dt);
    sm.lensX = nlx; sm.lensY = nly;
    po.uLens.value.set(nlx, nly, 30 * dpr * (1 + (S.down ? 0.25 : 0)));
    po.uLensV.value.set(sm.lensVX / dpr, sm.lensVY / dpr);
    po.uLensA.value = sm.lensA;
    // 冲击波
    this.shock.age += dt;
    po.uShock.value.set(this.shock.x * dpr, (H - this.shock.y) * dpr, this.shock.age, this.shock.age < 2.5 ? this.shock.amp : 0);

    // 性能自适应
    this.perf.acc += dt; this.perf.n++;
    if (this.perf.acc > 2.5) {
      var avg = this.perf.acc / this.perf.n;
      if (avg > 1 / 42 && this.perf.steps < 3 && T > 4) {
        this.perf.steps++; this.budget *= 0.66;
        this.resize(this.W, this.H, this.L);
      }
      this.perf.acc = 0; this.perf.n = 0;
    }
  };

  Stage.prototype.tickBubbles = function (t, dt, light, projR) {
    var self = this;
    if (t > this.nextBubble) {
      var b = this.bubbles.filter(function (x) { return !x.alive; })[0];
      if (b) {
        var r = hash(t * 3.1);
        b.alive = true; b.born = t; b.life = 7 + hash(t * 1.7) * 5; b.pop = -1;
        b.D = 9.5 + hash(t * 5.3) * 3.5;
        var sp = self.LY.spawn;
        b.dx = sp[0] + r * (sp[1] - sp[0]); b.dy = self.LY.horizon + 10;
        b.r = 9 + hash(t * 7.7) * 20;
        b.seed = hash(t * 9.1) * 6.28;
      }
      this.nextBubble = t + 1.6 + hash(t) * 2.6;
    }
    this.bubbles.forEach(function (b) {
      if (!b.alive) { b.mesh.visible = false; return; }
      var age = t - b.born;
      var k = age / b.life;
      if (b.pop < 0 && k >= 1) b.pop = t;
      var popK = b.pop >= 0 ? (t - b.pop) / 0.28 : 0;
      if (popK >= 1) { b.alive = false; b.mesh.visible = false; return; }
      var dy = b.dy - age * (48 + b.r * 1.6);
      var dx = b.dx + Math.sin(age * 1.3 + b.seed) * 18 + age * 6;
      var pos = self.wAt(dx, dy, b.D);
      var R = self.wLen(b.r * (0.6 + 0.4 * Math.min(1, age * 0.8)), b.D) * (1 + popK * 0.45);
      b.mesh.position.copy(pos);
      b.mesh.scale.setScalar(R);
      b.mesh.visible = true;
      var u = b.mesh.material.uniforms;
      u.uTime.value = t; u.uLight.value.copy(light);
      u.uRefr.value = projR(pos, R) * 1.5;
      u.uOpacity.value = smooth(seg(age, 0, 0.6)) * (1 - popK) * (1 - smooth(seg(k, 0.85, 1.0)) * 0.3);
      b.screen = pos.clone().project(self.cam);
    });
  };

  // 点击：冲击波 + 戳破附近气泡
  Stage.prototype.click = function (x, y) {
    this.shock.x = x; this.shock.y = y; this.shock.age = 0; this.shock.amp = 1;
    var W = this.W, H = this.H, t = this.t;
    this.bubbles.forEach(function (b) {
      if (!b.alive || b.pop >= 0 || !b.screen) return;
      var sx = (b.screen.x * 0.5 + 0.5) * W, sy = (0.5 - b.screen.y * 0.5) * H;
      if (Math.hypot(sx - x, sy - y) < 140) b.pop = t + Math.hypot(sx - x, sy - y) / 900;
    });
  };

  /* ---------- 蝴蝶 ---------- */
  Stage.prototype.tickFly = function (S, light) {
    var f = this.fly, t = S.t, T = S.T, dt = S.dt, u = this.mFly.uniforms, self = this;
    var perch = this.flyPerch;
    var pos = { x: perch.dx, y: perch.dy };
    var flap, dir = 1, tilt = 0;
    u.uTime.value = t;
    u.uOpacity.value = smooth(seg(T, 2.55, 2.9)) * (1 - smooth(seg(S.p, 0.3, 0.5)));

    if (T < 4.0 && !S.reduced) {
      // 开场：从右上方飞入落到花穗
      var k = ioCubic(seg(T, 2.55, 4.0));
      var FL = this.LY.fly;
      var a = { x: FL.from[0], y: FL.from[1] }, c1 = { x: FL.c1[0], y: FL.c1[1] }, c2 = { x: FL.c2[0], y: FL.c2[1] };
      pos = bez(a, c1, c2, perch, k);
      flap = 0.2 + 1.0 * (0.5 + 0.5 * Math.sin(t * 26));
      flap = lerp(flap, 0.35, smooth(seg(k, 0.85, 1)));
      dir = 1;
      f.mode = 'perch'; f.burstAt = t + 3;
    } else if (f.mode === 'perch') {
      flap = 0.32 + 0.16 * Math.sin(t * 1.4);
      if (t > f.burstAt) {
        var bk = (t - f.burstAt) / 0.7;
        if (bk < 1) flap = 0.3 + 0.95 * Math.abs(Math.sin(bk * Math.PI * 3)) * (1 - bk * 0.3);
        else f.burstAt = t + 3.5 + hash(t) * 4;
      }
      // 光标靠近 → 起飞
      if (S.inside && !S.reduced && S.p < 0.1) {
        var sp = this.wAt(perch.dx, perch.dy, this.flyD).project(this.cam);
        var sx = (sp.x * 0.5 + 0.5) * this.W, sy = (0.5 - sp.y * 0.5) * this.H;
        if (Math.hypot(S.mx - sx, S.my - sy) < 110 * Math.max(0.6, this.L.u * 1.4) && t - (f.landAt || 0) > 1.2) {
          f.mode = 'fly'; f.t0 = t; f.seed = hash(t) * 6.28;
        }
      }
    }
    if (f.mode === 'fly') {
      var age = t - f.t0, dur = 5.2;
      var q = age / dur;
      if (q >= 1) { f.mode = 'perch'; f.landAt = t; f.burstAt = t + 2.5; }
      else {
        // 绕一圈再回到原位：出发 → 盘旋 → 返回
        var ang = q * Math.PI * 2 + f.seed * 0.0;
        var lp = this.LY.fly.loop, cx = lp[0], cy = lp[1], rx = lp[2], ry = lp[3];
        var loop = { x: cx + Math.cos(ang * 1.0 + 0.3) * rx + Math.sin(ang * 2.0) * 60, y: cy + Math.sin(ang * 1.0 + 0.3) * ry - Math.sin(ang * 3.0) * 40 };
        var w = smooth(seg(q, 0, 0.18)) * (1 - smooth(seg(q, 0.80, 1.0)));
        pos = { x: lerp(perch.dx, loop.x, w), y: lerp(perch.dy, loop.y, w) };
        pos.y += Math.sin(age * 9.0) * 6;
        flap = 0.15 + 1.05 * (0.5 + 0.5 * Math.sin(t * 27));
        flap = lerp(flap, 0.35, smooth(seg(q, 0.93, 1)));
      }
    }
    // 朝向：按水平速度翻转
    if (f.last) {
      var vx = (pos.x - f.last.x) / Math.max(dt, 1e-3);
      f.vx = damp(f.vx || 0, vx, 6, dt);
      if (f.vx > 60) f.dir = -1; else if (f.vx < -60) f.dir = 1;
      tilt = clamp(-(pos.y - f.last.y) / Math.max(dt, 1e-3) * 0.0006, -0.35, 0.35);
    }
    f.last = { x: pos.x, y: pos.y };
    if (f.mode === 'perch' && T >= 4.0) f.dir = 1;
    f.flap = flap;
    this.wAt(pos.x, pos.y, this.flyD, this.flyMesh.position);
    var s = this.flyScale;
    this.flyMesh.scale.set(s * (f.dir || 1), s, s);
    this.flyMesh.rotation.set(0, 0, tilt * (f.dir || 1));
    u.uFlap.value = flap;
    this.flyMesh.visible = u.uOpacity.value > 0.002;
  };
  function bez(a, b, c, d, t) {
    var it = 1 - t;
    return {
      x: it * it * it * a.x + 3 * it * it * t * b.x + 3 * it * t * t * c.x + t * t * t * d.x,
      y: it * it * it * a.y + 3 * it * it * t * b.y + 3 * it * t * t * c.y + t * t * t * d.y
    };
  }

  /* ---------- 渲染 ---------- */
  Stage.prototype.render = function () {
    if (!this.ready || !(this.rw > 2 && this.rh > 2)) return;
    var r = this.renderer;
    // 交互场 ping-pong
    if (this.fieldOn) {
      this.mField.uniforms.tPrev.value = this.rtFieldA.texture;
      r.setRenderTarget(this.rtFieldB); r.render(this.sField, this.ortho);
      var tmp = this.rtFieldA; this.rtFieldA = this.rtFieldB; this.rtFieldB = tmp;
      this.mBg.uniforms.tField.value = this.rtFieldA.texture;
      this.mReed.uniforms.tField.value = this.rtFieldA.texture;
    }
    r.setRenderTarget(this.rtScene); r.setClearColor(0xe4e6f8, 0); r.clear(true, false, false);
    r.render(this.sMain, this.cam);

    r.setRenderTarget(this.rtReed); r.clear(true, false, false);
    r.render(this.sReed, this.ortho);
    r.render(this.sTitle, this.cam);

    r.setRenderTarget(this.rtFg); r.setClearColor(0xe4e6f8, 1); r.clear(true, true, false);
    r.render(this.sCopy, this.ortho);
    r.render(this.sFg, this.cam);

    // bloom
    r.setRenderTarget(this.rtBloomA); r.render(this.sBright, this.ortho);
    var bw = this.rtBloomA.width, bh = this.rtBloomA.height;
    this.mBlur.uniforms.tSrc.value = this.rtBloomA.texture; this.mBlur.uniforms.uDir.value.set(1.6 / bw, 0);
    r.setRenderTarget(this.rtBloomB); r.render(this.sBlur, this.ortho);
    this.mBlur.uniforms.tSrc.value = this.rtBloomB.texture; this.mBlur.uniforms.uDir.value.set(0, 1.6 / bh);
    r.setRenderTarget(this.rtBloomA); r.render(this.sBlur, this.ortho);

    r.setRenderTarget(null); r.render(this.sPost, this.ortho);
  };

  window.Stage = Stage;
})();
