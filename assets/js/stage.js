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
      fw: 2000, fh: 1125, horizon: 915, water: 1000,
      ring: { x: 1440, y: 465, r: 368 },
      portrait: { x: 763, y: 76, w: 928 },
      glass: { x0: 1068, x1: 1580, full: 720, top: -400 },
      prisms: [
        { dx0: 780, dx1: 925, top: 670, base: 993, D: 13.9, rot: 0.40 },
        { dx0: 950, dx1: 1030, top: 790, base: 995, D: 14.2, rot: 0.30 },
        { dx0: 1415, dx1: 1595, top: 655, base: 990, D: 13.7, rot: -0.24 },
        null
      ],
      bubbles: [{ dx: 1652, dy: 553, r: 72, D: 10.5 }, { dx: 46, dy: 1112, r: 238, D: 6.0 }],
      lav: { cx: 1750, bottom: 1068, size: 340 },
      fly: { x: 1866, y: 728, w: 118, from: [2160, 330], c1: [1640, 360], c2: [1700, 760], loop: [1560, 520, 300, 190] },
      spawn: [640, 1940], lavPerch: [0.90, 0.70],
      title: { cap: 218, rows: [
        { from: 0, to: 4, align: 'l', x: 80, base: 428, gap: 10, mode: 'dark' },
        { from: 5, to: 8, align: 'r', x: 1925, base: 428, gap: 18, mode: 'white' }
      ] }
    },
    mob: {
      fw: 750, fh: 1500, horizon: 1200, water: 1240,
      ring: { x: 580, y: 690, r: 294 },
      portrait: { x: 0, y: 420, w: 800 },
      glass: { x0: 263, x1: 712, full: 10, top: 528 },
      prisms: [
        { dx0: 30, dx1: 118, top: 1010, base: 1232, D: 13.9, rot: 0.40 },
        { dx0: 128, dx1: 176, top: 1090, base: 1234, D: 14.2, rot: 0.30 },
        { dx0: 520, dx1: 628, top: 1000, base: 1230, D: 13.7, rot: -0.24 },
        null
      ],
      bubbles: [{ dx: 664, dy: 930, r: 48, D: 10.5 }, { dx: 14, dy: 1470, r: 160, D: 6.0 }],
      lav: { cx: 650, bottom: 1272, size: 230 },
      fly: { x: 708, y: 1094, w: 82, from: [900, 780], c1: [560, 820], c2: [600, 1120], loop: [500, 930, 190, 150] },
      spawn: [120, 720], lavPerch: [0.90, 0.70],
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
    this.fly = { mode: 'intro', dir: 1 };
    this.perf = { acc: 0, n: 0, steps: 0 };
    this.viewProj = new THREE.Matrix4();
  }

  /* ---------- 资源 ---------- */
  Stage.prototype.load = function (base, onProgress) {
    var self = this;
    var list = [
      ['bg', 'bg.webp'], ['portrait', 'portrait.webp'], ['portraitMask', 'portrait-mask.webp'],
      ['lav', 'lavender.webp'], ['lavMask', 'lavender-mask.webp'],
      ['fly', 'butterfly.webp'], ['flyMask', 'butterfly-mask.webp']
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
    this.rtA = new THREE.WebGLRenderTarget(4, 4, Object.assign({}, rtOpt, this.gl2 ? { samples: 4 } : {}));
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, Object.assign({}, rtOpt, this.gl2 ? { samples: 4 } : {}));
    this.rtReed = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    this.rtFg = new THREE.WebGLRenderTarget(4, 4, Object.assign({}, rtOpt, { depthBuffer: true }, this.gl2 ? { samples: 4 } : {}));
    this.rtBloomA = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    this.rtBloomB = new THREE.WebGLRenderTarget(4, 4, rtOpt);
    // 交互场需要能渲染到半浮点纹理（部分 iOS 只有 half_float 扩展），都没有就关掉擦亮效果
    var gl = this.renderer.getContext();
    var cbf = this.gl2 && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.fieldOn = 0;   // 擦玻璃效果已移除；交互改为水面涟漪 / 焦散光
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
      uHorizon: { value: HORIZON / 1126 }, uWhite: { value: 0 }, uBright: { value: 0 }, uFieldOn: { value: this.fieldOn },
      uContact: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uDrops: { value: [0, 1, 2, 3, 4, 5, 6, 7].map(function () { return new THREE.Vector4(); }) }
    } });
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mBg);
    this.bg.renderOrder = 0; this.bg.frustumCulled = false;
    this.sMain.add(this.bg);

    this.glassU = function (extra) {
      var u = {
        tScene: { value: null }, tEnv: { value: tx.bg }, uBgRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uBgMap: { value: 0 }, uSeedB: { value: 0 },
        uModel: { value: new THREE.Matrix4() }, uInvModel: { value: new THREE.Matrix4() }, uViewProj: { value: self.viewProj },
        uLight: { value: new THREE.Vector3(0, 2, 2) }, uTime: { value: 0 }, uOpacity: { value: 1 }, uKind: { value: 0 },
        uIri: { value: 0.3 }, uRefl: { value: 0 }, uWaterY: { value: -999 }, uBehind: { value: 2 }, uAbsorb: { value: 0.5 },
        uTube: { value: 0.03 }, uBevel: { value: 0.02 }, uEps: { value: 0.0015 }, uTMax: { value: 3 }, uObjScale: { value: 1 }, uWave: { value: 1 },
        uSize: { value: new THREE.Vector3(1, 1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
        uAbsorbCol: { value: new THREE.Vector3(0.10, 0.16, 0.03) }
      };
      for (var k in extra) u[k].value = extra[k];
      return u;
    };

    this.ringTube = 0.03;
    this.mRing = mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, blend: CUSTOM_KEEPA, uniforms: this.glassU({
      tScene: tx.bg, uBgMap: 1, uKind: 0, uIri: 0.85, uBehind: 40, uAbsorb: 0, uTube: this.ringTube, uEps: 0.0008, uTMax: 2.4,
      uTint: new THREE.Vector3(1.0, 1.0, 1.02)
    }) });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, this.ringTube * 1.7, 32, 320), this.mRing);
    this.ring.renderOrder = 1;
    this.sMain.add(this.ring);

    this.mPortrait = mat({ fs: SH.FS_PORTRAIT, blend: CUSTOM_COVER, uniforms: {
      tColor: { value: tx.portrait }, tMask: { value: tx.portraitMask }, uKeyR: { value: 0.011 }, uSkin: { value: 0.75 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(0.90, 0.88, 0.99) }, uWaterV: { value: 0.12 },
      tBack: { value: this.rtA.texture }, uRes: { value: new THREE.Vector2(2, 2) }, uHaze: { value: new THREE.Vector3(0.88, 0.90, 1.0) }
    } });
    this.portrait = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mPortrait);
    this.portrait.renderOrder = 20;

    // —— reed：竖纹玻璃 + 标题
    this.mReed = mat({ vs: SH.VS_QUAD, fs: SH.FS_REED, noBlend: true, transparent: false, uniforms: {
      tScene: { value: this.rtScene.texture }, tField: { value: null }, uRes: { value: new THREE.Vector2() },
      uGlass: { value: new THREE.Vector4(0.5, 0.75, 22, 1) }, uTime: { value: 0 }, uChroma: { value: 1 },
      uFieldOn: { value: this.fieldOn }, uFrost: { value: 0 }, uLight: { value: new THREE.Vector3(0, 0, 400) }, uPanelA: { value: 1 },
      uDistP: { value: 30 }, uDistS: { value: 120 }, uWaterPx: { value: -1 }, uCaustic: { value: 0 }, uTopPx: { value: 99999 }
    } });
    this.sReed = quadScene(this.mReed);
    this.sTitle = new THREE.Scene();
    this.letters = [];

    // —— fg：棱柱 / 气泡 / 薰衣草 / 蝴蝶 / 云雾
    this.mCopy = mat({ vs: SH.VS_QUAD, fs: SH.FS_COPY, noBlend: true, transparent: false, uniforms: { tSrc: { value: this.rtReed.texture } } });
    this.sCopy = quadScene(this.mCopy);
    this.sFg = new THREE.Scene();

    // 棱柱：在竖纹玻璃后面、人像前面；立在水里，带倒影
    this.mCopyA = mat({ vs: SH.VS_QUAD, fs: SH.FS_COPYA, noBlend: true, transparent: false, uniforms: { tSrc: { value: this.rtA.texture } } });
    this.sCopyA = quadScene(this.mCopyA);
    this.sPrism = new THREE.Scene();
    this.prisms = [0, 1, 2, 3].map(function (i) {
      var p = { delay: i * 0.13 };
      function gm(refl) {
        return mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, blend: CUSTOM_KEEPA, uniforms: self.glassU({
          tScene: self.rtA.texture, uKind: 2, uIri: 0.5, uRefl: refl ? 1 : 0, uBehind: 1.6, uAbsorb: 0.9,
          uTint: new THREE.Vector3(1.0, 0.99, 1.03)
        }) });
      }
      p.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), gm(false));
      p.mesh.renderOrder = 12 + i;
      p.refl = new THREE.Mesh(p.mesh.geometry, gm(true));
      p.refl.renderOrder = 4 + i;
      self.sPrism.add(p.refl);
      self.sPrism.add(p.mesh);
      return p;
    });
    this.sPrism.add(this.portrait);
    this.mPRefl = mat({ fs: SH.FS_PREFL, blend: CUSTOM_KEEPA, uniforms: {
      tColor: { value: tx.portrait }, tMask: { value: tx.portraitMask }, uKeyR: { value: 0.011 }, uSkin: { value: 0.75 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uWaterV: { value: 0.12 }
    } });
    this.pRefl = new THREE.Mesh(this.portrait.geometry, this.mPRefl);
    this.pRefl.renderOrder = 21;
    this.sPrism.add(this.pRefl);
    // 人像蒙版缩略数据：用来找人在水线处的左右边界（入水涟漪的范围）
    try {
      var mc = document.createElement('canvas'); mc.width = 294; mc.height = 335;
      var mctx = mc.getContext('2d'); mctx.drawImage(tx.portraitMask.image, 0, 0, 294, 335);
      this.maskData = mctx.getImageData(0, 0, 294, 335).data;
    } catch (e) { this.maskData = null; }

    var sphere = new THREE.SphereGeometry(1.03, 72, 48);
    this.bubbleGeo = sphere;
    this.mainBubbles = [{ ph: 0.3, delay: 2.05 }, { ph: 1.7, delay: 1.75 }].map(function (b, i) {
      b.mesh = new THREE.Mesh(sphere, mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, transparent: true, depthTest: true, depthWrite: true, uniforms: self.glassU({
        tScene: self.rtReed.texture, uKind: 1
      }) }));
      b.mesh.material.extensions = { derivatives: true };
      b.mesh.material.uniforms.uSeedB.value = i * 11.3 + 2.0;
      b.mesh.renderOrder = 20 + i;
      self.sFg.add(b.mesh);
      return b;
    });
    // 漂浮小气泡池
    for (var i = 0; i < 7; i++) {
      var bm = new THREE.Mesh(sphere, mat({ vs: SH.VS_GLASS, fs: SH.FS_GLASS, transparent: true, depthTest: true, depthWrite: false, uniforms: self.glassU({
        tScene: self.rtReed.texture, uKind: 1
      }) }));
      bm.material.extensions = { derivatives: true };
      bm.visible = false; bm.renderOrder = 30 + i;
      this.sFg.add(bm);
      this.bubbles.push({ mesh: bm, alive: false, born: 0, life: 8, pop: -1 });
    }
    this.nextBubble = 3.2;

    this.mLav = mat({ vs: SH.VS_LAV, fs: SH.FS_SPRITE, uniforms: {
      tColor: { value: tx.lav }, tMask: { value: tx.lavMask }, uKeyR: { value: 0.008 }, uSkin: { value: 0 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uShine: { value: 1 }, uGrow: { value: 0 }, uRefl: { value: 0 },
      uSize: { value: new THREE.Vector2(1, 1) }, uPush: { value: new THREE.Vector2() }
    } });
    this.lav = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 30, 30), this.mLav);
    this.lav.renderOrder = 40;
    this.sFg.add(this.lav);
    this.mLavR = mat({ vs: SH.VS_LAV, fs: SH.FS_SPRITE, uniforms: {
      tColor: { value: tx.lav }, tMask: { value: tx.lavMask }, uKeyR: { value: 0.008 }, uSkin: { value: 0 },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uShine: { value: 0 }, uGrow: { value: 0 }, uRefl: { value: 1 },
      uSize: { value: new THREE.Vector2(1, 1) }, uPush: { value: new THREE.Vector2() }
    } });
    this.lavR = new THREE.Mesh(this.lav.geometry, this.mLavR);
    this.lavR.renderOrder = 39;
    this.sFg.add(this.lavR);

    var fa = 1313 / 1198;
    var flyGeo = new THREE.PlaneGeometry(fa, 1, 36, 36);
    // 两只蝴蝶：一只停右侧花穗尖，一只小一点停左侧最高的花穗
    this.flies = [
      { perch: [0.90, 0.70], k: 1.0, dir: 1, intro: [2.5, 4.7], seed: 1.7, from: [1.08, 0.29] },
      { perch: [0.40, 0.975], k: 0.80, dir: -1, intro: [3.5, 6.1], seed: 4.3, from: [1.13, 0.08] }
    ].map(function (F, i) {
      F.mat = mat({ vs: SH.VS_FLY, fs: SH.FS_SPRITE, side: THREE.DoubleSide, uniforms: {
        tColor: { value: tx.fly }, tMask: { value: tx.flyMask }, uKeyR: { value: 0.008 }, uSkin: { value: 0 },
        uOpacity: { value: 0 }, uTime: { value: 0 }, uShine: { value: 1.6 }, uFlap: { value: 0.3 }, uRefl: { value: 0 },
        uSize: { value: new THREE.Vector2(fa, 1) },
        uAxA: { value: new THREE.Vector2(505 / 1313, 1 - 752 / 1198) }, uAxB: { value: new THREE.Vector2(735 / 1313, 1 - 1095 / 1198) }
      } });
      F.mesh = new THREE.Mesh(flyGeo, F.mat);
      F.mesh.renderOrder = 41 + i;
      F.mode = 'intro';
      self.sFg.add(F.mesh);
      return F;
    });

    this.fogs = [3.0, 2.1, 1.25, 0.55, -0.4].map(function (z, i) {
      var m = mat({ fs: SH.FS_FOG, uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: i * 3.7 } } });
      var f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
      f.renderOrder = 60 + i; f.userData.z = z;
      self.sFg.add(f);
      return f;
    });

    // —— bloom + post
    this.mBright = mat({ vs: SH.VS_QUAD, fs: SH.FS_BRIGHT, noBlend: true, transparent: false, uniforms: { tSrc: { value: this.rtFg.texture }, uThr: { value: 0.95 } } });
    this.sBright = quadScene(this.mBright);
    this.mBlur = mat({ vs: SH.VS_QUAD, fs: SH.FS_BLUR, noBlend: true, transparent: false, uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } } });
    this.sBlur = quadScene(this.mBlur);
    this.mPost = mat({ vs: SH.VS_QUAD, fs: SH.FS_POST, noBlend: true, transparent: false, uniforms: {
      tColor: { value: this.rtFg.texture }, tBloom: { value: this.rtBloomA.texture }, tDesign: { value: tx.design || null },
      uRes: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uLens: { value: new THREE.Vector3(-999, -999, 20) }, uLensV: { value: new THREE.Vector2() }, uLensA: { value: 0 },
      uShock: { value: new THREE.Vector4(0, 0, 9, 0) },
      uWhite: { value: 1 }, uBurst: { value: 0 }, uCA: { value: 0 }, uBloom: { value: 0.35 }, uGrain: { value: 0.018 },
      uWB: { value: new THREE.Vector3(0.975, 1.0, 1.045) }, uExpo: { value: 1.04 }, uVib: { value: 0.35 }, uClarity: { value: 0.55 }, uGradeOn: { value: 1 },
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
    this.letters.forEach(function (L) { if (L.mesh.parent) L.mesh.parent.remove(L.mesh); L.mesh.material.dispose(); });
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
      var dark = rowOf[i].mode === 'dark';
      var m = mat({ fs: SH.FS_TITLE, blend: CUSTOM_COVER, uniforms: {
        tGlyph: { value: texG }, uRect: { value: new THREE.Vector4(u0, v0, u1, v1) },
        uAlpha: { value: 0 }, uDarkK: { value: dark ? 1 : 0 }, uFadeF: { value: (dark && i === rowOf[i].to && rowOf[i].align === 'l' && LT.rows.length > 1 && rowOf[i].base === LT.rows[1].base) ? 1 : 0 },
        uCapV: { value: new THREE.Vector2((pad + desc) / cellH, (pad + desc + LT.cap) / cellH) },
        uColor: { value: dark ? new THREE.Vector3(0.165, 0.165, 0.196) : new THREE.Vector3(1, 1, 1) }
      } });
      var mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = dark ? 18 : 25;      // 黑字在人后面（被脸挡住），白字在人前、竖纹玻璃后
      this.sPrism.add(mesh);
      this.letters.push({
        ch: WORD[i], mesh: mesh, rectHi: m.uniforms.uRect.value.clone(),
        dx: x - pad * CX, dy: rowOf[i].base - asc - pad, dw: cellWs[i] * CX, dh: cellH, mode: rowOf[i].mode,
        winW: winW, i: i, glyph: -1
      });
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
    this.rtA.setSize(rw, rh); this.rtScene.setSize(rw, rh); this.rtReed.setSize(rw, rh); this.rtFg.setSize(rw, rh);
    var bw = Math.max(2, rw >> 2), bh = Math.max(2, rh >> 2);
    this.rtBloomA.setSize(bw, bh); this.rtBloomB.setSize(bw, bh);
    var fw = Math.max(2, Math.round(W / 4)), fh = Math.max(2, Math.round(H / 4));
    this.rtFieldA.setSize(fw, fh); this.rtFieldB.setSize(fw, fh);
    this.mField.uniforms.uSize.value.set(fw, fh);
    var res = new THREE.Vector2(rw, rh);
    [this.mBg, this.mReed, this.mPost, this.mPortrait].forEach(function (m) { m.uniforms.uRes.value.copy(res); });

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
    this.horizonPx = hy;
    this.wPx(W / 2, cy, D, this.bg.position);
    this.bg.scale.set(this.wLenPx(2000 * sc, D), this.wLenPx(1126 * sc, D), 1);

    // 圆环
    this.ringD = 15;
    this.wAt(LY.ring.x, LY.ring.y, this.ringD, this.ring.position);
    this.ringR = this.wLen(LY.ring.r, this.ringD);
    this.ring.scale.setScalar(this.ringR);
    this.ringBase = this.ring.position.clone();

    // 人像
    var pD = 13, pw = LY.portrait.w, ph = pw * 1339 / 1175;
    this.wAt(LY.portrait.x + pw / 2, LY.portrait.y + ph / 2, pD, this.portrait.position);
    this.portrait.scale.set(this.wLen(pw, pD), this.wLen(ph, pD), 1);
    this.portraitBase = this.portrait.position.clone();
    this.waterYp = this.wAt(0, LY.water, pD).y;          // 人像所在深度处的水面高度
    this.bodyWater = null;
    if (this.maskData) {
      var ry = Math.round(clamp((LY.water - LY.portrait.y) / ph, 0, 0.997) * 335), bx0 = -1, bx1 = -1;
      for (var xx = 0; xx < 294; xx++) { if (this.maskData[(ry * 294 + xx) * 4] > 128) { if (bx0 < 0) bx0 = xx; bx1 = xx; } }
      if (bx0 >= 0) this.bodyWater = [LY.portrait.x + bx0 / 294 * pw, LY.portrait.x + bx1 / 294 * pw];
    }

    // 竖纹玻璃（虚拟面板深度 11）
    this.glassD = 11;
    this.glassX0 = this.wAt(LY.glass.x0, 0, this.glassD).x;
    this.glassX1 = this.wAt(LY.glass.x1, 0, this.glassD).x;
    this.glassXFull = this.wAt(LY.glass.full, 0, this.glassD).x;

    // 棱柱：从顶部到水面
    this.prisms.forEach(function (p, i) {
      var cfg = LY.prisms[i];
      p.off = !cfg;
      if (!cfg) { p.mesh.visible = p.refl.visible = false; return; }
      for (var k in cfg) p[k] = cfg[k];
      var w = self.wLen(p.dx1 - p.dx0, p.D);
      var h = self.wLen(p.base - p.top, p.D);
      var d = w * 0.8;
      p.mesh.geometry.dispose();
      p.mesh.geometry = new THREE.BoxGeometry(w, h, d);
      p.refl.geometry = p.mesh.geometry;
      var c = self.wAt((p.dx0 + p.dx1) / 2, (p.top + p.base) / 2, p.D);
      p.c = c; p.h = h;
      p.waterY = self.wAt(0, p.base, p.D).y;
      p.mesh.position.copy(c);
      p.mesh.rotation.set(0.0, p.rot, 0);
      p.refl.rotation.set(0.0, p.rot, 0);
      var md = Math.min(w, d);
      [p.mesh, p.refl].forEach(function (m) {
        var u = m.material.uniforms;
        u.uSize.value.set(w / 2, h / 2, d / 2);
        u.uBevel.value = md * 0.07;
        u.uEps.value = md * 0.002;
        u.uTMax.value = 3 * Math.hypot(w, h, d);
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
    this.lavR.scale.set(this.lav.scale.x, -this.lav.scale.y, 1);
    this.lavR.position.set(this.lav.position.x, this.lav.position.y - this.lav.scale.y, this.lav.position.z);

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
      var tD = l.mode === 'dark' ? 13.4 : 12.5;
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
    var cx = bx + sm.mx * 0.12 * parA, cy = by - sm.my * 0.07 * parA;
    this.cam.position.set(cx, cy, bz);
    this.cam.lookAt(bx, by, bz - 12);
    this.cam.updateMatrixWorld();
    this.viewProj.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);

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
    ru.uObjScale.value = rr.scale.x;
    this.syncGlass(rr);

    // —— 人像
    var pu = this.mPortrait.uniforms;
    var pIn = smooth(seg(T, 0.95, 2.1));
    var pOut = 1 - smooth(seg(p, 0.22, 0.40));
    pu.uOpacity.value = pIn * pOut; pu.uTime.value = t;
    var breathe = Math.sin(t * 0.9) * 0.004;
    this.portrait.position.copy(this.portraitBase);
    this.portrait.position.y += this.portrait.scale.y * (breathe - (1 - oCubic(seg(T, 0.95, 2.6))) * 0.035);
    pu.uWaterV.value = (this.waterYp - (this.portrait.position.y - this.portrait.scale.y / 2)) / this.portrait.scale.y;
    this.pRefl.position.set(this.portrait.position.x, 2 * this.waterYp - this.portrait.position.y, this.portrait.position.z);
    this.pRefl.scale.set(this.portrait.scale.x, -this.portrait.scale.y, 1);
    var prU = this.mPRefl.uniforms;
    prU.uWaterV.value = pu.uWaterV.value; prU.uOpacity.value = pu.uOpacity.value; prU.uTime.value = t;

    // —— 竖纹玻璃
    var gx0w = lerp(this.glassX0, this.glassXFull, smooth(seg(p, 0.04, 0.26)));
    var g0 = new THREE.Vector3(gx0w, this.portraitBase.y, -this.glassD).project(this.cam);
    var g1 = new THREE.Vector3(this.glassX1, this.portraitBase.y, -this.glassD).project(this.cam);
    var gu = this.mReed.uniforms;
    var focus = 1 - oCubic(seg(T, 1.0, 3.1));
    var shatter = smooth(seg(p, 0.04, 0.30));
    var bulge = 0.72 + focus * 1.6 + shatter * 1.5;
    var ribPx = 38 * this.L.u * dpr * (1 + shatter * 0.5);
    var ud = this.L.u * dpr;
    gu.uGlass.value.set(g0.x * 0.5 + 0.5, g1.x * 0.5 + 0.5, ribPx, bulge);
    gu.uPanelA.value = 1 - smooth(seg(p, 0.34, 0.48));
    gu.uDistP.value = 14 * ud * (1 + focus * 5 + shatter * 4.5);
    gu.uDistS.value = 125 * ud * (1 + focus * 1.5 + shatter * 1.5);
    gu.uTime.value = t; gu.uChroma.value = 1.9 + focus * 1.4 + shatter * 1.0;
    gu.uLight.value.set(sm.lx * this.rw, (1 - sm.ly) * this.rh, 0.32 * this.rh);
    gu.uFrost.value = focus * 0.10;
    gu.uCaustic.value = 0.30 * seg(T, 2.6, 3.4) * (S.inside ? 1 : 0.55) * (1 - seg(p, 0.05, 0.3));
    var du = this.mBg.uniforms.uDrops.value, drops = this.drops || [];
    for (var di = 0; di < 8; di++) {
      var dd = drops[di];
      if (dd && t - dd.t < 4.5) du[di].set(dd.x, dd.y, t - dd.t, dd.a); else du[di].w = 0;
    }
    var wpx = this.wAt(0, this.LY.water, this.glassD).project(this.cam);
    gu.uWaterPx.value = (wpx.y * 0.5 + 0.5) * this.rh;
    var tpx = this.wAt(0, this.LY.glass.top, this.glassD).project(this.cam);
    gu.uTopPx.value = (tpx.y * 0.5 + 0.5) * this.rh + smooth(seg(p, 0.02, 0.3)) * this.rh;   // 滚动时玻璃板长高到顶

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
      var op = smooth(seg(T, 1.55 + pr.delay, 2.1 + pr.delay));
      [pr.mesh, pr.refl].forEach(function (m) {
        var u = m.material.uniforms;
        u.uTime.value = t; u.uLight.value.copy(light); u.uOpacity.value = op;
        u.uWaterY.value = pr.waterY;
        m.visible = op > 0.001;
        self.syncGlass(m);
      });
    });

    // —— 主气泡
    var projR = function (pos, R) {
      var a = pos.clone().project(self.cam), b = pos.clone().add(new THREE.Vector3(0, R, 0)).project(self.cam);
      return Math.abs(b.y - a.y) * 0.5;   // 以屏高为单位的半径
    };
    this.mainBubbles.forEach(function (b, i) {
      var k = oCubic(seg(T, b.delay, b.delay + 1.4));
      b.mesh.position.copy(b.base);
      b.mesh.position.y += Math.sin(t * 0.55 + b.ph) * b.R * 0.07 - (1 - k) * b.R * 0.5;
      b.mesh.position.x += Math.sin(t * 0.37 + b.ph * 2.0) * b.R * 0.05;
      var wob = Math.sin(t * 2.1 + b.ph) * 0.010 + Math.sin(t * 3.3 + b.ph * 1.7) * 0.005;
      b.mesh.scale.set(b.R * (1 + wob), b.R * (1 - wob), b.R);
      b.mesh.rotation.z = Math.sin(t * 0.13 + b.ph) * 0.4;
      var u = b.mesh.material.uniforms;
      u.uTime.value = t; u.uLight.value.copy(light);
      u.uBehind.value = b.R * 4.0; u.uObjScale.value = b.R;
      u.uOpacity.value = smooth(seg(T, b.delay, b.delay + 0.9));
      self.syncGlass(b.mesh);
    });

    // —— 漂浮小气泡
    if (!reduced && T > 3.0) this.tickBubbles(S, light);

    // —— 入水涟漪：人 + 三根长方体
    var cu = this.mBg.uniforms.uContact.value;
    var setC = function (i, x0, x1, dy, D, amp) {
      var a = self.wAt(x0, dy, D).project(self.cam), b = self.wAt(x1, dy, D).project(self.cam);
      cu[i].set((a.x + b.x) / 4 + 0.5, a.y * 0.5 + 0.5, Math.abs(b.x - a.x) / 4, amp);
    };
    if (this.bodyWater) setC(0, this.bodyWater[0], this.bodyWater[1], this.LY.water, 13, pu.uOpacity.value);
    else cu[0].w = 0;
    this.prisms.forEach(function (pr, i) {
      if (i > 2) return;
      if (pr.off) { cu[i + 1].w = 0; return; }
      setC(i + 1, pr.dx0, pr.dx1, pr.base, pr.D, 0.75 * pr.mesh.material.uniforms.uOpacity.value);
    });

    // —— 薰衣草
    var lu = this.mLav.uniforms;
    lu.uTime.value = t; lu.uGrow.value = oCubic(seg(T, 2.0, 3.3)); lu.uOpacity.value = smooth(seg(T, 2.0, 2.5));
    var lavS = this.lav.position.clone().project(this.cam);
    var ldx = (S.mx / W) - (lavS.x * 0.5 + 0.5), ldy = (S.my / H) - (0.5 - lavS.y * 0.5);
    var lnear = S.inside ? Math.exp(-(ldx * ldx * 18 + ldy * ldy * 10)) : 0;
    sm.push = damp(sm.push || 0, clamp(S.mvx / W * 0.04, -0.06, 0.06) * lnear, 3.5, dt);
    lu.uPush.value.set(sm.push, 0);
    var lr = this.mLavR.uniforms;
    lr.uTime.value = t; lr.uGrow.value = lu.uGrow.value; lr.uOpacity.value = lu.uOpacity.value; lr.uPush.value.copy(lu.uPush.value);

    // —— 蝴蝶
    var selfF = this;
    this.flies.forEach(function (F) { selfF.tickFly(S, light, F); });

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

  Stage.prototype.syncGlass = function (m) {
    m.updateMatrixWorld();
    var u = m.material.uniforms;
    u.uModel.value.copy(m.matrixWorld);
    u.uInvModel.value.copy(m.matrixWorld).invert();
  };

  Stage.prototype.tickBubbles = function (S, light) {
    var t = S.t, dt = S.dt, self = this, LY = this.LY;
    var alive = 0;
    this.bubbles.forEach(function (b) { if (b.alive) alive++; });
    if (t > this.nextBubble && alive < 4) {
      var nb = this.bubbles.filter(function (x) { return !x.alive; })[0];
      if (nb) {
        var h1 = hash(t * 3.1), h2 = hash(t * 5.7), h3 = hash(t * 7.3);
        nb.alive = true; nb.born = t; nb.pop = -1; nb.sx = undefined; nb.blown = false;
        nb.r = 12 + h1 * 26;
        nb.D = 7.6 + h2 * 2.8;
        nb.x = -nb.r * 2 - 20; nb.y = LY.fh * (0.26 + 0.46 * h3);
        nb.vx0 = (24 + 26 * hash(t * 9.1)) * LY.fw / 2000; nb.vy0 = -9 + 11 * hash(t * 4.4);
        nb.vx = nb.vx0; nb.vy = nb.vy0;
        nb.life = 12 + 8 * hash(t * 2.2);
        nb.seed = hash(t * 1.9) * 6.28;
        nb.mesh.material.uniforms.uSeedB.value = nb.seed * 3.0;
      }
      this.nextBubble = t + 2.4 + hash(t * 1.3) * 3.0;
    }
    this.bubbles.forEach(function (b) {
      if (!b.alive) { b.mesh.visible = false; return; }
      var age = t - b.born;
      // 风 + 湍流
      var tx = b.vx0 + Math.sin(t * 0.6 + b.seed) * 10 + Math.sin(t * 1.7 + b.seed * 2.3) * 5;
      var ty = b.vy0 + Math.sin(t * 0.8 + b.seed * 1.7) * 8 + Math.sin(t * 2.1 + b.seed) * 3;
      // 光标带起的气流：顺着鼠标运动方向推开
      if (S.inside && b.sx !== undefined) {
        var dx = b.sx - S.mx, dy = b.sy - S.my, d = Math.hypot(dx, dy) + 1e-3;
        var rad = 200 * Math.max(0.6, self.L.u * 1.4);
        if (d < rad) {
          var pw = Math.pow(1 - d / rad, 2);
          tx += (S.mvx / self.L.u) * 0.30 * pw + dx / d * 60 * pw;
          ty += (S.mvy / self.L.u) * 0.30 * pw + dy / d * 60 * pw;
        }
      }
      b.vx = damp(b.vx, tx, 1.2, dt); b.vy = damp(b.vy, ty, 1.2, dt);
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.pop < 0 && (age > b.life || b.x > LY.fw + b.r * 3 || b.y < -b.r * 3 || b.y > LY.water + 30)) b.pop = t;
      var popK = b.pop >= 0 ? (t - b.pop) / 0.09 : 0;
      if (popK >= 1) { b.alive = false; b.mesh.visible = false; b.sx = undefined; return; }
      var pos = self.wAt(b.x, b.y, b.D);
      var R = self.wLen(b.r, b.D) * (1 + popK * 0.06) * (b.blown ? lerp(0.3, 1, oCubic(seg(age, 0, 0.4))) : 1);
      var wob = Math.sin(t * 6.5 + b.seed) * 0.022 + Math.sin(t * 4.1 + b.seed * 2.0) * 0.010;
      b.mesh.position.copy(pos);
      b.mesh.scale.set(R * (1 + wob), R * (1 - wob), R);
      b.mesh.rotation.z = t * 0.15 + b.seed;
      b.mesh.visible = true;
      var u = b.mesh.material.uniforms;
      u.uTime.value = t; u.uLight.value.copy(light);
      u.uBehind.value = R * 4.0; u.uObjScale.value = R;
      u.uOpacity.value = smooth(seg(age, 0, b.blown ? 0.2 : 0.9)) * (1 - popK);
      self.syncGlass(b.mesh);
      var sc = pos.clone().project(self.cam);
      b.screen = sc; b.sx = (sc.x * 0.5 + 0.5) * self.W; b.sy = (0.5 - sc.y * 0.5) * self.H;
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
  function catmull(pts, q) {
    var n = pts.length - 1, x = clamp(q, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    var f2 = f * f, f3 = f2 * f;
    function c(k) { return 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3); }
    return new THREE.Vector3(c('x'), c('y'), p1.z);
  }

  // 与 VS_LAV 相同的摆动公式：花穗尖在世界坐标里的偏移
  Stage.prototype.lavSway = function (u, v, t) {
    var bend = Math.pow(v, 1.7), ph = u * 3.4;
    var sw = Math.sin(t * 1.05 + ph) * 0.55 + Math.sin(t * 1.85 + ph * 2.2 + 1.3) * 0.28 + Math.sin(t * 0.47 + 0.5) * 0.45;
    return { dx: (sw * 0.016 + (this.sm.push || 0)) * bend * this.lav.scale.x, dy: -Math.abs(sw) * bend * 0.004 * this.lav.scale.y };
  };

  // 停着时：翅膀缓慢开合
  Stage.prototype.perchWing = function (t) {
    return 0.60 + 0.42 * Math.sin(t * 0.62 + Math.sin(t * 0.21) * 1.6);
  };

  Stage.prototype.flyPath = function (start, seed, n) {
    var lp = this.LY.fly.loop, pts = [start.clone()];
    for (var i = 0; i < n; i++) {
      var a = hash(seed * 3.1 + i * 7.7) * Math.PI * 2;
      var r = 0.45 + 0.55 * hash(seed * 5.3 + i * 2.9);
      pts.push(this.wAt(lp[0] + Math.cos(a) * lp[2] * r, lp[1] + Math.sin(a) * lp[3] * r, this.flyD));
    }
    return pts;
  };

  Stage.prototype.tickFly = function (S, light, f) {
    var t = S.t, T = S.T, dt = S.dt, u = f.mat.uniforms, LY = this.LY;
    var s = this.flyScale * f.k;
    u.uTime.value = t;
    u.uOpacity.value = smooth(seg(T, f.intro[0], f.intro[0] + 0.3)) * (1 - smooth(seg(S.p, 0.3, 0.5)));
    // 停靠点：花穗尖，跟着薰衣草一起摆
    var PU = f.perch, sw = this.lavSway(PU[0], PU[1], t), grow = this.mLav.uniforms.uGrow.value;
    var perch = new THREE.Vector3(
      (PU[0] - 0.5) * this.lav.scale.x * lerp(0.6, 1, grow) + this.lav.position.x + sw.dx,
      lerp(-0.5, PU[1] - 0.5, grow) * this.lav.scale.y + this.lav.position.y + sw.dy,
      this.lav.position.z + 0.01);
    var seat = function (d) { return perch.clone().add(new THREE.Vector3(0.0138 * s * d, 0.3013 * s, 0)); };
    var tw = t + f.seed * 7.0;

    if (S.reduced) f.mode = 'perch';
    else if (T < f.intro[1]) f.mode = 'intro';
    else if (f.mode === 'intro') { f.mode = 'perch'; f.landAt = t; }

    // 光标靠近 → 惊飞
    if (f.mode === 'perch' && !S.reduced && S.inside && S.p < 0.1 && t - (f.landAt || 0) > 1.5) {
      var sp = seat(f.dir).project(this.cam);
      var sx = (sp.x * 0.5 + 0.5) * this.W, sy = (0.5 - sp.y * 0.5) * this.H;
      if (Math.hypot(S.mx - sx, S.my - sy) < Math.max(70, 150 * this.L.u)) {
        f.mode = 'fly'; f.t0 = t; f.dur = 5.0 + hash(t + f.seed) * 1.5;
        f.pts = this.flyPath(seat(f.dir), t + f.seed, 3);
      }
    }

    var pos, wing;
    if (f.mode === 'intro' || f.mode === 'fly') {
      var q, pts;
      if (f.mode === 'intro') {
        q = seg(T, f.intro[0], f.intro[1]);
        if (!f.introPts) f.introPts = this.flyPath(this.wAt(LY.fw * f.from[0], LY.fh * f.from[1], this.flyD), f.seed, 2);
        pts = f.introPts;
      } else {
        q = (t - f.t0) / f.dur; pts = f.pts;
        if (q >= 1) { f.mode = 'perch'; f.landAt = t; }
      }
      q = clamp(q, 0, 1);
      var land = smooth(seg(q, 0.80, 1.0));
      pos = catmull(pts.concat([seat(f.dir)]), Math.sin(q * Math.PI / 2));   // 起飞快、落地慢
      var ph = tw * 7.6 + Math.sin(tw * 1.3) * 0.8;                          // 约 7~8 次/秒
      var stroke = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);                    // 0 张开 → 1 合拢
      var glide = smooth(seg(Math.sin(tw * 0.9 + 1.7) + Math.sin(tw * 2.3) * 0.4, 0.75, 1.1));
      wing = lerp(0.12 + 1.18 * stroke, 0.18, glide);
      pos.y += Math.sin(ph * Math.PI * 2) * 0.05 * s * (1 - glide) * (1 - land);   // 每次下拍抬升一下
      pos.y -= glide * 0.02 * s;
      pos.x += Math.sin(tw * 5.3) * 0.025 * s * (1 - land);
      wing = lerp(wing, this.perchWing(tw), land);
      if (f.last) {
        var vx = (pos.x - f.last.x) / Math.max(dt, 1e-3);
        f.vx = damp(f.vx || 0, vx, 5, dt);
        // 翅膀合拢、侧影最窄的一瞬再转身，看不出跳变
        if (stroke > 0.82 && land < 0.5) { if (f.vx > 0.05) f.dir = -1; else if (f.vx < -0.05) f.dir = 1; }
        f.tilt = damp(f.tilt || 0, clamp(-(pos.y - f.last.y) / Math.max(dt, 1e-3) * 0.12 / s, -0.3, 0.3), 6, dt);
      }
    } else {
      pos = seat(f.dir);
      wing = this.perchWing(tw);
      f.tilt = damp(f.tilt || 0, 0, 4, dt);
    }
    f.last = pos.clone();
    f.mesh.position.copy(pos);
    f.mesh.scale.set(s * f.dir, s, s);
    f.mesh.rotation.set(0, 0, (f.tilt || 0) * f.dir);
    u.uFlap.value = wing;
    f.mesh.visible = u.uOpacity.value > 0.002;
  };

  // 水面涟漪（屏幕像素坐标）
  Stage.prototype.addDrop = function (x, y, amp) {
    if (!this.drops) this.drops = [];
    this.drops.push({ x: x / this.W, y: 1 - y / this.H, t: this.t, a: amp });
    while (this.drops.length > 8) this.drops.shift();
  };

  // 在光标处吹出一个肥皂泡
  Stage.prototype.blowBubble = function (x, y) {
    var b = this.bubbles.filter(function (q) { return !q.alive; })[0];
    if (!b) return;
    var t = this.t, LY = this.LY;
    b.alive = true; b.born = t; b.pop = -1; b.sx = undefined; b.blown = true;
    b.r = 16 + hash(t * 3.3) * 18; b.D = 8.4;
    b.x = (x - this.L.ox) / this.L.u; b.y = (y - this.L.oy) / this.L.u;
    b.vx0 = (22 + 14 * hash(t * 1.1)) * LY.fw / 2000; b.vy0 = -16 - 8 * hash(t * 2.7);
    b.vx = b.vx0 * 0.4; b.vy = -40;
    b.life = 10 + 6 * hash(t * 5.5);
    b.seed = hash(t * 7.9) * 6.28;
    b.mesh.material.uniforms.uSeedB.value = b.seed * 3.0;
  };

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
    r.setRenderTarget(this.rtA); r.setClearColor(0xe4e6f8, 0); r.clear(true, false, false);
    r.render(this.sMain, this.cam);
    r.setRenderTarget(this.rtScene); r.clear(true, false, false);
    r.render(this.sCopyA, this.ortho);
    r.render(this.sPrism, this.cam);

    r.setRenderTarget(this.rtReed); r.clear(true, false, false);
    r.render(this.sReed, this.ortho);

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
    this.mBlur.uniforms.tSrc.value = this.rtBloomA.texture; this.mBlur.uniforms.uDir.value.set(4.0 / bw, 0);
    r.setRenderTarget(this.rtBloomB); r.render(this.sBlur, this.ortho);
    this.mBlur.uniforms.tSrc.value = this.rtBloomB.texture; this.mBlur.uniforms.uDir.value.set(0, 4.0 / bh);
    r.setRenderTarget(this.rtBloomA); r.render(this.sBlur, this.ortho);

    r.setRenderTarget(null); r.render(this.sPost, this.ortho);
  };

  window.Stage = Stage;
})();
