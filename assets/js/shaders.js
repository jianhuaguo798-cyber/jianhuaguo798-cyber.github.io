/* 全部 GLSL（GLSL1 写法，three 在 WebGL2 下自动转换） */
(function () {
  var NOISE = [
    'float hash1(float n){ return fract(sin(n)*43758.5453123); }',
    'float hash2(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }',
    'float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);',
    '  float a=hash2(i), b=hash2(i+vec2(1.0,0.0)), c=hash2(i+vec2(0.0,1.0)), d=hash2(i+vec2(1.0,1.0));',
    '  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y); }',
    'float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }',
    'float fbm3(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<3;i++){ v+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }'
  ].join('\n');

  // 全屏四边形
  var VS_QUAD = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  // 普通 3D 网格
  var VS_MESH = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');

  /* ---------- 交互场：R=擦亮度 GB=速度 ---------- */
  var FS_FIELD = [
    'uniform sampler2D tPrev;',
    'uniform vec2 uSize;',          // 场分辨率
    'uniform vec2 uA; uniform vec2 uB;',  // 上一帧 / 本帧光标（uv）
    'uniform vec2 uVel;',           // 光标速度（uv/s，已缩放）
    'uniform float uDt, uAspect, uRad, uAmt, uHold;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 px = 1.0/uSize;',
    '  vec4 c = texture2D(tPrev, vUv);',
    '  vec4 n = texture2D(tPrev, vUv+vec2(px.x,0.0)) + texture2D(tPrev, vUv-vec2(px.x,0.0))',
    '         + texture2D(tPrev, vUv+vec2(0.0,px.y)) + texture2D(tPrev, vUv-vec2(0.0,px.y));',
    '  c = mix(c, n*0.25, 0.22);',
    '  c.r *= exp(-uDt*0.72);',
    '  c.gb *= exp(-uDt*2.6);',
    '  vec2 p = vec2(vUv.x*uAspect, vUv.y);',
    '  vec2 a = vec2(uA.x*uAspect, uA.y), b = vec2(uB.x*uAspect, uB.y);',
    '  vec2 ab = b-a; float h = clamp(dot(p-a, ab)/max(dot(ab,ab), 1e-7), 0.0, 1.0);',
    '  float d = length(p - a - ab*h);',
    '  float br = exp(-d*d/(uRad*uRad));',
    '  float hold = exp(-dot(p-b,p-b)/(uRad*uRad*0.55));',
    '  c.r = min(1.0, c.r + br*uAmt + hold*uHold*uDt);',
    '  c.gb = clamp(c.gb + br*uVel, -1.0, 1.0);',
    '  gl_FragColor = c;',
    '}'
  ].join('\n');

  /* ---------- 天空 + 海 ---------- */
  var FS_BG = [
    NOISE,
    'uniform sampler2D tBg; uniform sampler2D tField;',
    'uniform vec2 uRes; uniform float uTime, uHorizon, uWhite, uBright, uFieldOn;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 uv = vUv; float vt = 1.0 - uv.y;',
    '  vec2 suv = gl_FragCoord.xy/uRes;',
    '  vec4 F = texture2D(tField, suv) * uFieldOn;',
    '  float seaM = smoothstep(uHorizon-0.0015, uHorizon+0.0035, vt);',
    // —— 天空：双相位流动 + 域扭曲，云缓慢漂移翻涌
    '  float hy = clamp((uHorizon - vt)/uHorizon, 0.0, 1.0);',
    '  vec2 q = uv*vec2(3.2,1.8);',
    '  vec2 warp = vec2(fbm3(q*1.4 + vec2(uTime*0.045, 0.0)), fbm3(q*1.4 + vec2(5.2, uTime*0.038))) - 0.5;',
    '  float ph0 = fract(uTime*0.03), ph1 = fract(uTime*0.03 + 0.5);',
    '  vec2 flow = vec2(-0.026, 0.002) * (0.25 + 0.75*hy);',
    '  vec2 w = warp*0.0055*(0.35 + hy) + F.gb*0.018;',
    '  vec2 s0 = uv + flow*ph0 + w; s0.y = max(s0.y, 1.0-uHorizon+0.004);',
    '  vec2 s1 = uv + flow*ph1 + w; s1.y = max(s1.y, 1.0-uHorizon+0.004);',
    '  float fl = abs(1.0 - 2.0*ph0);',
    '  vec3 sky = mix(texture2D(tBg, s0).rgb, texture2D(tBg, s1).rgb, fl);',
    // —— 海：透视波纹位移 + 闪烁碎光 + 光柱呼吸 + 光标尾流
    '  float dz = clamp((vt - uHorizon)/(1.0 - uHorizon), 0.0, 1.0);',
    '  float zz = 1.0/(dz + 0.07);',
    '  vec2 wp = vec2((uv.x - 0.5)*zz*7.0, zz*2.6 + uTime*0.42);',
    '  float w1 = vnoise(wp*vec2(1.0, 2.4)) - 0.5;',
    '  float w2 = vnoise(wp*vec2(2.6, 5.2) + vec2(3.1, uTime*0.25)) - 0.5;',
    '  vec2 disp = vec2(w1*0.9 + w2*0.5, (w2 - w1)*0.35) * (0.0016 + 0.010*dz);',
    '  disp += F.gb * 0.035 * (0.3 + dz);',
    '  vec2 su = uv + disp; su.y = min(su.y, 1.0-uHorizon-0.002);',
    '  vec3 sea = texture2D(tBg, su).rgb;',
    '  float lum = dot(sea, vec3(0.299, 0.587, 0.114));',
    '  float col = vnoise(vec2(uv.x*70.0, vt*26.0 - uTime*1.6));',
    '  sea *= 1.0 + (col - 0.5)*0.10*smoothstep(0.80, 0.95, lum);',
    '  float g = vnoise(wp*vec2(7.0, 13.0) + vec2(uTime*0.6, uTime*1.9));',
    '  g = pow(g, 16.0) * 5.0;',
    '  float gate = smoothstep(0.70, 0.93, lum);',
    '  sea += vec3(1.0, 0.97, 0.99) * g * gate * (0.35 + 0.9*dz);',
    '  sea += vec3(0.85, 0.9, 1.0) * pow(vnoise(wp*vec2(11.0,19.0) - uTime*0.7), 22.0) * 2.2 * (0.2+dz) * smoothstep(0.55,0.8,lum);',
    '  vec3 c = mix(sky, sea, seaM);',
    '  c = mix(c, vec3(1.0, 0.96, 0.99), exp(-abs(vt - uHorizon)*380.0)*0.18);',
    '  c = mix(c, vec3(0.985, 0.975, 1.0), uBright);',
    '  c = mix(c, vec3(1.0, 0.985, 1.0), uWhite);',
    '  gl_FragColor = vec4(c, 0.0);',
    '}'
  ].join('\n');

  /* ---------- 抠图层（人像 / 薰衣草 / 蝴蝶共用片元） ---------- */
  var CUT_FN = [
    'uniform sampler2D tColor; uniform sampler2D tMask; uniform float uKeyR; uniform float uSkin;',
    'vec4 cutout(vec2 uv){',
    '  vec3 c = texture2D(tColor, uv).rgb;',
    // 皮肤上的 AI 涡纹：只对低饱和的肤色区做轻微模糊，发丝保持锐利
    '  if (uSkin > 0.0) {',
    '    vec3 cb = texture2D(tColor, uv, 1.6).rgb;',
    '    float skin = 1.0 - smoothstep(0.06, 0.20, c.b - c.r);',
    '    c = mix(c, cb, skin*uSkin);',
    '  }',
    '  float m = texture2D(tMask, uv).r;',
    '  float a = smoothstep(0.16, 0.88, m);',
    '  vec3 f = clamp((c - (1.0 - a)) / max(a, 0.6), 0.0, 1.0);',   // 轻度去白边
    '  return vec4(mix(c, f, 0.55), a);',
    '}'
  ].join('\n');

  var FS_PORTRAIT = [
    CUT_FN,
    'uniform float uOpacity, uTime; uniform vec3 uTint;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 c = cutout(vUv);',
    '  float a = c.a;',
    '  float bottom = smoothstep(0.0, 0.26, vUv.y);',
    '  float sides = mix(1.0, smoothstep(0.0, 0.10, vUv.x)*smoothstep(1.0, 0.86, vUv.x), smoothstep(0.42, 0.0, vUv.y));',
    '  a *= bottom * sides;',
    '  vec3 col = mix(c.rgb, uTint, 0.07 + 0.25*(1.0-bottom));',
    '  col = mix(col, col*vec3(1.02,1.0,1.04) + 0.03, 0.5);',
    '  gl_FragColor = vec4(col, a*uOpacity);',
    '}'
  ].join('\n');

  /* ---------- 薰衣草：风摆 ---------- */
  var VS_LAV = [
    'uniform float uTime, uGrow; uniform vec2 uSize; uniform vec2 uPush;',
    'varying vec2 vUv; varying float vShade;',
    'void main(){',
    '  vUv = uv; vShade = 1.0;',
    '  vec3 p = position;',
    '  float h = uv.y;',
    '  float bend = pow(h, 1.7);',
    '  float ph = uv.x*3.4;',
    '  float sw = sin(uTime*1.05 + ph)*0.55 + sin(uTime*1.85 + ph*2.2 + 1.3)*0.28 + sin(uTime*0.47 + 0.5)*0.45;',
    '  p.x += (sw*0.016 + uPush.x) * bend * uSize.x;',
    '  p.y -= abs(sw)*bend*uSize.y*0.004;',
    '  p.y = mix(-0.5*uSize.y, p.y, uGrow);',
    '  p.x *= mix(0.6, 1.0, uGrow);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var FS_SPRITE = [
    CUT_FN,
    'uniform float uOpacity, uTime, uShine;',
    'varying vec2 vUv; varying float vShade;',
    'void main(){',
    '  vec4 c = cutout(vUv);',
    '  vec3 col = c.rgb;',
    '  float sh = 0.5 + 0.5*sin(uTime*1.3 + vUv.x*6.0 - vUv.y*4.0);',
    '  col += pow(sh, 8.0)*0.10*uShine;',
    '  col *= mix(0.86, 1.06, vShade);',
    '  gl_FragColor = vec4(col, c.a*uOpacity);',
    '}'
  ].join('\n');

  var VS_SPRITE = [
    'varying vec2 vUv; varying float vShade;',
    'void main(){ vUv = uv; vShade = 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');

  /* ---------- 蝴蝶：沿身体轴翻折扇翅 ---------- */
  var VS_FLY = [
    'uniform float uFlap; uniform vec2 uSize; uniform vec2 uAxA; uniform vec2 uAxB;',
    'varying vec2 vUv; varying float vShade;',
    'void main(){',
    '  vUv = uv;',
    '  vec2 P = (uv - 0.5)*uSize;',
    '  vec2 A = (uAxA - 0.5)*uSize, B = (uAxB - 0.5)*uSize;',
    '  vec2 ax = normalize(B - A); vec2 pr = vec2(-ax.y, ax.x);',
    '  float d = dot(P - A, pr); float al = dot(P - A, ax);',
    '  float side = smoothstep(0.0, 0.045*uSize.x, d);',
    '  float ang = uFlap*side;',
    '  vec3 p = vec3(A + ax*al + pr*d*cos(ang), d*sin(ang));',
    '  vShade = mix(1.0, 0.55 + 0.45*abs(cos(ang)), side);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  /* ---------- 竖纹玻璃（招牌） ---------- */
  var FS_REED = [
    NOISE,
    'uniform sampler2D tScene; uniform sampler2D tField;',
    'uniform vec2 uRes; uniform vec4 uGlass;',   // x0, x1（uv）, 肋宽 px, 折射强度
    'uniform float uTime, uChroma, uFieldOn, uFrost, uPanelA; uniform vec2 uLight;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 uv = vUv;',
    '  vec4 base = texture2D(tScene, uv);',
    '  float px = uv.x*uRes.x;',
    '  float x0 = uGlass.x*uRes.x, x1 = uGlass.y*uRes.x, rw = uGlass.z;',
    '  float gm = smoothstep(x0 - 1.5, x0 + rw*0.35, px) * (1.0 - smoothstep(x1 - rw*2.6, x1 + rw*0.6, px)) * uPanelA;',
    '  if (gm <= 0.0) { gl_FragColor = vec4(base.rgb, 1.0); return; }',
    '  vec4 F = texture2D(tField, uv) * uFieldOn;',
    '  float wipe = smoothstep(0.06, 0.80, F.r);',
    '  float u = (px - x0)/rw;',
    '  u += 0.42*sin(u*0.31 + 1.7) + 0.22*sin(u*0.87 + 0.4);',
    '  u += sin(uTime*0.33 + uv.y*1.6)*0.05 + F.g*7.0;',
    '  float id = floor(u); float r = fract(u);',
    '  float hid = hash1(id*12.9898 + 3.1);',
    '  float s = r - 0.5;',
    '  float k = uGlass.w * (0.70 + 0.6*hid) * gm * (1.0 - wipe);',
    '  float oy = (hash1(id*7.31 + 1.0) - 0.5) * 7.0 * k / max(uGlass.w, 0.001);',
    '  vec2 o = vec2(s*rw*k/uRes.x, oy/uRes.y);',
    '  float ch = uChroma * (0.10 + 0.55*step(0.82, hid) + 0.25*step(0.6, fract(hid*7.0)));',
    '  vec3 col;',
    '  col.r = texture2D(tScene, uv + o*(1.0 + ch)).r;',
    '  col.g = texture2D(tScene, uv + o).g;',
    '  col.b = texture2D(tScene, uv + o*(1.0 - ch)).b;',
    '  float e = abs(2.0*r - 1.0);',
    '  float cyl = 1.0 - e*e;',
    '  float g2 = gm*(1.0 - wipe);',
    '  col *= mix(1.0, mix(0.955, 1.04, cyl), g2);',
    // 少数肋片带粉 / 蓝棱镜光，越往下（脖颈）越浓
    '  float tsel = fract(hid*13.7);',
    '  vec3 tint = tsel < 0.24 ? vec3(1.0, 0.56, 0.68) : (tsel < 0.46 ? vec3(0.62, 0.74, 1.0) : vec3(1.0));',
    '  float tw = (0.08 + 0.42*smoothstep(0.70, 0.12, uv.y)) * g2 * (0.6 + 0.4*sin(uTime*0.4 + id*1.7));',
    '  col = mix(col, col*tint + (1.0 - tint)*0.10, tw);',
    '  col += smoothstep(0.80, 1.0, e) * 0.13 * g2;',
    '  col += smoothstep(0.94, 1.0, e) * vec3(1.0,0.85,0.95) * 0.08 * g2 * step(0.5, hid);',
    '  float lx = uv.x - uLight.x;',
    '  col += exp(-lx*lx*90.0) * pow(cyl, 5.0) * 0.10 * g2;',
    '  col = mix(col, vec3(0.97, 0.96, 1.0), uFrost*g2);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---------- 标题字母（在竖纹 pass 里叠加） ---------- */
  var FS_TITLE = [
    'uniform sampler2D tGlyph; uniform vec4 uRect;',
    'uniform sampler2D tScene; uniform vec2 uRes;',
    'uniform float uSplit, uAlpha; uniform vec3 uDark; uniform vec3 uWhite;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 g = mix(uRect.xy, uRect.zw, vUv);',
    '  float cov = texture2D(tGlyph, g).a;',
    '  float sh = texture2D(tGlyph, g + vec2(0.0, (uRect.w - uRect.y)*0.035), 3.2).a;',
    '  vec2 suv = gl_FragCoord.xy/uRes;',
    '  float pa = texture2D(tScene, suv).a;',
    '  float right = smoothstep(uSplit - 0.0015, uSplit + 0.0015, suv.x);',
    '  vec3 dark = mix(uDark*1.35, uDark, smoothstep(0.15, 0.85, vUv.y));',
    '  float aW = cov + (1.0 - cov)*sh*0.20;',
    '  vec3 white = mix(vec3(0.45, 0.42, 0.66), uWhite, cov/max(aW, 1e-3));',
    '  float aD = cov * (1.0 - smoothstep(0.35, 0.85, pa));',
    '  vec3 c = mix(dark, white, right);',
    '  float vis = mix(aD, aW, right) * uAlpha;',
    '  gl_FragColor = vec4(c, vis);',
    '}'
  ].join('\n');

  /* ---------- 玻璃物体（圆环 / 气泡 / 棱柱） ---------- */
  var VS_GLASS = [
    'varying vec3 vNW; varying vec3 vPW; varying vec3 vNV; varying vec3 vLP;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vPW = wp.xyz; vLP = position;',
    '  vNW = normalize(mat3(modelMatrix) * normal);',
    '  vNV = normalize(normalMatrix * normal);',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var FS_GLASS = [
    'uniform sampler2D tScene; uniform vec2 uRes; uniform vec4 uBgRect; uniform float uBgMap;',
    'uniform vec3 uLight; uniform float uTime, uRefr, uDisp, uIri, uOpacity, uKind, uEdge, uRim, uRefl, uWaterY, uBack;',
    'uniform vec3 uSize; uniform vec3 uTint;',
    'varying vec3 vNW; varying vec3 vPW; varying vec3 vNV; varying vec3 vLP;',
    'vec3 sampleScene(vec2 s){',
    '  if (uBgMap > 0.5) { vec2 q = (s - uBgRect.xy)/uBgRect.zw; return texture2D(tScene, q).rgb; }',
    '  return texture2D(tScene, s).rgb;',
    '}',
    'vec3 envMap(vec3 r){',
    '  vec3 c = mix(vec3(0.60,0.60,0.80), vec3(0.97,0.95,1.0), smoothstep(-0.2, 0.75, r.y));',
    '  c = mix(c, vec3(0.98,0.80,0.90), smoothstep(0.0, -0.8, r.y)*0.5);',
    '  float b1 = smoothstep(0.80, 0.97, dot(r, normalize(vec3(-0.55, 0.72, 0.42))));',
    '  float b2 = smoothstep(0.88, 0.985, dot(r, normalize(vec3(0.85, 0.15, 0.5))));',
    '  float b3 = smoothstep(0.90, 0.99, dot(r, normalize(vec3(0.1, -0.4, 0.9))));',
    '  float d1 = smoothstep(0.65, 0.95, dot(r, normalize(vec3(0.9, -0.1, -0.2))));',
    '  return c*(1.0 - d1*0.35) + b1*0.9 + b2*vec3(0.75,0.85,1.0)*0.6 + b3*vec3(1.0,0.75,0.88)*0.45;',
    '}',
    'void main(){',
    '  if (uRefl < 0.5 && vPW.y < uWaterY) discard;',
    '  if (uRefl > 0.5 && vPW.y > uWaterY) discard;',
    '  vec2 suv = gl_FragCoord.xy/uRes;',
    '  vec3 N = normalize(vNW);',
    '  vec3 V = normalize(cameraPosition - vPW);',
    '  float ndv = clamp(dot(N, V), 0.0, 1.0);',
    '  bool isBub = uKind > 0.5 && uKind < 1.5; bool isBox = uKind > 1.5;',
    '  float fr = pow(1.0 - ndv, isBub ? 3.6 : 2.6);',
    '  vec2 dir = normalize(vNV).xy;',
    '  vec2 off = -dir * uRefr * (0.30 + 0.70*(1.0 - ndv));',
    '  if (uKind > 0.5 && uKind < 1.5) off = -dir * uRefr * (0.55 + 0.45*(1.0-ndv*ndv));',
    '  off.x *= uRes.y/uRes.x;',
    '  if (uRefl > 0.5) off.x += sin(gl_FragCoord.y*0.11 + uTime*2.4)*0.004;',
    '  vec3 col;',
    '  col.r = sampleScene(suv + off*(1.0 + uDisp)).r;',
    '  col.g = sampleScene(suv + off).g;',
    '  col.b = sampleScene(suv + off*(1.0 - uDisp)).b;',
    '  col *= uTint;',
    '  vec3 R = reflect(-V, N);',
    '  vec3 env = envMap(R);',
    '  vec3 L = normalize(uLight - vPW);',
    '  vec3 H = normalize(L + V);',
    '  float nh = max(dot(N, H), 0.0);',
    '  float spec = isBox ? pow(nh, 2400.0)*0.8 + pow(nh, 260.0)*0.05 : pow(nh, 160.0)*1.5 + pow(nh, 24.0)*0.14;',
    '  vec3 iri = 0.5 + 0.5*cos(6.2831*(vec3(0.0, 0.33, 0.67) + fr*1.5 + uTime*0.035 + dot(vPW, vec3(0.06, 0.04, 0.0))));',
    // 轮廓处全反射发暗 —— 浅色背景上玻璃能被看见的关键
    '  float sil = smoothstep(0.45, 0.0, ndv);',
    '  col = mix(col, col*vec3(0.60, 0.60, 0.80), sil*0.55*uRim);',
    '  col = mix(col, env, fr*0.5*uRim);',
    '  col += iri * fr * uIri;',
    '  col += spec * vec3(1.0, 0.98, 1.0);',
    '  if (uKind < 0.5) col += 0.06 + smoothstep(0.55, 0.15, ndv)*0.10;',
    '  float a = uOpacity;',
    '  if (uKind > 1.5) {',
    '    vec3 q = abs(vLP)/uSize;',
    '    vec3 e = smoothstep(1.0 - uEdge/uSize, vec3(1.0), q);',
    '    float edge = max(max(e.x*e.y, e.y*e.z), e.x*e.z);',
    '    vec3 qq = vLP/uSize;',
    '    float hx = qq.x*0.5 + 0.5;',
    '    vec3 band = mix(vec3(1.0, 0.76, 0.88), vec3(0.76, 0.85, 1.0), hx);',
    '    float edgeV = pow(abs(qq.x), 5.0);',
    '    col = mix(col, vec3(0.97, 0.96, 1.0), 0.16);',
    '    col = mix(col, col*band + 0.05, 0.40 + 0.45*edgeV);',
    '    col += vec3(1.0, 0.92, 0.97) * smoothstep(0.55, 1.0, qq.y) * 0.07;',
    '    col += edge * (0.55 + 0.35*iri);',
    '    if (uBack > 0.5) { gl_FragColor = vec4(mix(vec3(1.0, 0.95, 1.0), iri, 0.3), edge*0.5*uOpacity); return; }',
    '    float face = dot(N, normalize(vec3(-0.6, 0.5, 0.6)));',
    '    col += face*0.05;',
    '    if (uRefl > 0.5) a *= 0.34 * smoothstep(uWaterY - uSize.y*1.5, uWaterY, vPW.y);',
    '    else col = mix(col, vec3(0.94, 0.93, 1.0), smoothstep(uWaterY + uSize.y*0.16, uWaterY, vPW.y)*0.4);',
    '  }',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\n');

  /* ---------- 开场云雾 ---------- */
  var FS_FOG = [
    NOISE,
    'uniform float uTime, uAlpha, uSeed;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 p = vUv*vec2(9.0, 6.0) + uSeed;',
    '  float n = fbm(p + vec2(uTime*0.04, 0.0));',
    '  float n2 = fbm(p*2.3 - vec2(0.0, uTime*0.03) + 4.0);',
    '  float dens = n*0.8 + n2*0.35;',
    '  float d = smoothstep(0.34, 0.66, dens);',
    // 云的明暗：厚处亮、薄处带一点薰衣草灰，才有体积
    '  float lit = smoothstep(0.35, 0.85, fbm(p*1.3 + vec2(2.0, -uTime*0.02)));',
    '  vec3 c = mix(vec3(0.74, 0.72, 0.90), vec3(1.0, 0.985, 1.0), lit);',
    '  c = mix(c, vec3(1.0, 0.88, 0.94), smoothstep(0.6, 0.95, n2)*0.35);',
    '  gl_FragColor = vec4(c, d*uAlpha);',
    '}'
  ].join('\n');

  /* ---------- 复制 / 泛光 / 后期 ---------- */
  var FS_COPY = [
    'uniform sampler2D tSrc; varying vec2 vUv;',
    'void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }'
  ].join('\n');

  var FS_BRIGHT = [
    'uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;',
    'void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(max(c.r, c.g), c.b);',
    '  gl_FragColor = vec4(c * smoothstep(uThr, uThr + 0.12, l), 1.0); }'
  ].join('\n');

  var FS_BLUR = [
    'uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv).rgb*0.227;',
    '  c += (texture2D(tSrc, vUv + uDir*1.385).rgb + texture2D(tSrc, vUv - uDir*1.385).rgb)*0.316;',
    '  c += (texture2D(tSrc, vUv + uDir*3.231).rgb + texture2D(tSrc, vUv - uDir*3.231).rgb)*0.070;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var FS_POST = [
    NOISE,
    'uniform sampler2D tColor; uniform sampler2D tBloom; uniform sampler2D tDesign;',
    'uniform vec2 uRes; uniform float uTime;',
    'uniform vec3 uLens; uniform vec2 uLensV; uniform float uLensA;',
    'uniform vec4 uShock;',   // x, y(px), 年龄 s, 强度
    'uniform float uWhite, uBurst, uBloom, uGrain, uDbg, uCA; uniform vec4 uFrame;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 uv = vUv; vec2 p = uv*uRes;',
    '  vec2 o = vec2(0.0); float chrom = 0.0;',
    // 点击冲击波
    '  if (uShock.w > 0.0) {',
    '    float age = uShock.z; float rad = age*uRes.y*1.25;',
    '    vec2 dv = p - uShock.xy; float d = length(dv);',
    '    float ring = exp(-pow((d - rad)/(uRes.y*0.045), 2.0)) * uShock.w * exp(-age*1.6);',
    '    o += dv/max(d, 1.0) * ring * uRes.y*0.022;',
    '    chrom += ring*1.2;',
    '  }',
    // 光标玻璃水滴
    '  vec2 d = p - uLens.xy;',
    '  float sp = length(uLensV); vec2 vd = sp > 1.0 ? uLensV/sp : vec2(1.0, 0.0);',
    '  float st = clamp(sp/2600.0, 0.0, 0.5);',
    '  vec2 dl = vec2(dot(d, vd)/(1.0 + st), dot(d, vec2(-vd.y, vd.x))*(1.0 + st*0.45));',
    '  float r = length(dl)/max(uLens.z, 1.0);',
    '  float inL = (1.0 - smoothstep(0.97, 1.0, r)) * uLensA;',
    '  float z = sqrt(max(1.0 - r*r, 0.0));',
    '  o += -d*(1.0 - z)*0.85*inL;',
    '  chrom += (1.0 - z)*inL*1.6;',
    '  vec2 q = uv + o/uRes;',
    '  float ca = 0.004*chrom + uCA;',
    '  vec3 col;',
    '  col.r = texture2D(tColor, q + (q-0.5)*ca).r;',
    '  col.g = texture2D(tColor, q).g;',
    '  col.b = texture2D(tColor, q - (q-0.5)*ca).b;',
    '  float rim = smoothstep(0.80, 0.98, r) * (1.0 - smoothstep(0.98, 1.04, r)) * uLensA;',
    '  vec3 iri = 0.5 + 0.5*cos(6.2831*(vec3(0.0,0.33,0.67) + atan(dl.y, dl.x)*0.16 + uTime*0.12));',
    '  col += rim * (0.22 + 0.25*iri);',
    '  vec2 hl = dl/max(uLens.z,1.0) - vec2(-0.32, 0.38);',
    '  col += exp(-dot(hl, hl)*40.0) * 0.45 * uLensA * step(r, 1.0);',
    '  col += texture2D(tBloom, uv).rgb * uBloom;',
    '  float lm = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(vec3(lm), col, 1.12);',
    '  col = (col - 0.62)*1.05 + 0.62;',
    '  col += vec3(1.0, 0.97, 1.0) * uBurst;',
    '  vec2 vg = uv - 0.5; col *= 1.0 - dot(vg, vg)*0.16;',
    '  col = mix(col, vec3(0.99, 0.985, 1.0), uWhite);',
    '  if (uDbg > 0.0) {',
    '    vec2 fu = (vec2(p.x, uRes.y - p.y) - uFrame.xy)/uFrame.zw;',
    '    if (fu.x > 0.0 && fu.x < 1.0 && fu.y > 0.0 && fu.y < 1.0) col = mix(col, texture2D(tDesign, vec2(fu.x, 1.0 - fu.y)).rgb, uDbg);',
    '  }',
    '  col += (hash2(p + fract(uTime)*137.0) - 0.5) * uGrain;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  window.SH = {
    VS_QUAD: VS_QUAD, VS_MESH: VS_MESH, FS_FIELD: FS_FIELD, FS_BG: FS_BG,
    FS_PORTRAIT: FS_PORTRAIT, VS_LAV: VS_LAV, VS_SPRITE: VS_SPRITE, VS_FLY: VS_FLY, FS_SPRITE: FS_SPRITE,
    FS_REED: FS_REED, FS_TITLE: FS_TITLE, VS_GLASS: VS_GLASS, FS_GLASS: FS_GLASS, FS_FOG: FS_FOG,
    FS_COPY: FS_COPY, FS_BRIGHT: FS_BRIGHT, FS_BLUR: FS_BLUR, FS_POST: FS_POST
  };
})();
