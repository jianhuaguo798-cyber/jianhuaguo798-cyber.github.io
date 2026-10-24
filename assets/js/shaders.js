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
    'uniform vec4 uContact[4];',   // 入水点：xy 屏幕 uv，z 半宽（uv），w 强度
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
    '  vec2 rip = vec2(0.0); float rh = 0.0;',
    '  for (int i = 0; i < 4; i++) {',
    '    vec4 C = uContact[i];',
    '    if (C.w > 0.0) {',
    '      vec2 dv = (suv - C.xy)*vec2(uRes.x/uRes.y, 1.0);',
    '      float hw = C.z*uRes.x/uRes.y;',
    '      vec2 q = vec2(max(abs(dv.x) - hw, 0.0), dv.y/(dv.y < 0.0 ? 0.20 : 0.07));',
    '      float dd = length(q);',
    '      float ph = dd*150.0 - uTime*1.9;',
    '      float en = exp(-dd*6.5)*smoothstep(0.0, 0.006, dd)*C.w;',
    '      rh += sin(ph)*en;',
    '      rip += vec2(sign(dv.x)*step(hw, abs(dv.x)), sign(dv.y))*cos(ph)*en;',
    '    }',
    '  }',
    '  disp += rip*0.0030;',
    '  vec2 su = uv + disp; su.y = min(su.y, 1.0-uHorizon-0.002);',
    '  vec3 sea = texture2D(tBg, su).rgb;',
    '  sea += vec3(1.0, 0.98, 1.0)*max(rh, 0.0)*0.07;',
    '  sea *= 1.0 + min(rh, 0.0)*0.035;',
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
    'uniform float uOpacity, uTime, uWaterV; uniform vec3 uTint;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 uv = vUv;',
    '  float wv = uWaterV + sin(uv.x*70.0 + uTime*2.1)*0.0016 + sin(uv.x*27.0 - uTime*1.3)*0.0022;',
    '  float below = wv - uv.y;',
    '  vec4 c;',
    '  if (below > 0.0) {',
    // 水下：被水折射、发蓝、越深越淡
    '    float w1 = sin(uv.y*420.0 + uTime*2.3)*0.0035 + sin(uv.y*150.0 - uTime*1.4 + uv.x*9.0)*0.0028;',
    '    c = cutout(vec2(uv.x + w1, uv.y));',
    '    float dr = exp(-below*30.0);',
    '    c.rgb = mix(c.rgb, vec3(0.80, 0.84, 0.98), 0.40 + 0.45*(1.0 - dr));',
    '    c.a *= dr*0.7;',
    '  } else {',
    '    c = cutout(uv);',
    '  }',
    '  float a = c.a;',
    '  a *= mix(1.0, smoothstep(0.0, 0.08, uv.x)*smoothstep(1.0, 0.88, uv.x), smoothstep(0.30, 0.0, uv.y));',
    '  vec3 col = mix(c.rgb, uTint, 0.06);',
    '  col = mix(col, col*vec3(1.02, 1.0, 1.04) + 0.03, 0.5);',
    '  float glint = 0.55 + 0.45*sin(uv.x*140.0 - uTime*3.0)*sin(uv.x*37.0 + uTime*1.7);',
    '  col += exp(-pow((uv.y - wv)/0.0022, 2.0))*0.20*glint;',
    '  gl_FragColor = vec4(col, a*uOpacity);',
    '}'
  ].join('\n');

  // 人物在水面的倒影：镜像网格，离水线越远越淡、波纹越大
  var FS_PREFL = [
    CUT_FN,
    'uniform float uOpacity, uTime, uWaterV;',
    'varying vec2 vUv;',
    'void main(){',
    '  float wv = uWaterV + sin(vUv.x*70.0 + uTime*2.1)*0.0016 + sin(vUv.x*27.0 - uTime*1.3)*0.0022;',
    '  float k = vUv.y - wv;',
    '  if (k < 0.0) discard;',
    '  vec2 uv = vUv;',
    '  float w = sin(gl_FragCoord.y*0.21 + uTime*2.4)*0.6 + sin(gl_FragCoord.y*0.083 - uTime*1.5 + vUv.x*7.0)*0.4;',
    '  uv.x += w*(0.0015 + k*0.045);',
    '  uv.y += sin(gl_FragCoord.y*0.5 + uTime*3.1)*k*0.004;',
    '  vec4 c = cutout(uv);',
    '  float fade = exp(-k*4.2);',
    // 倒影比反射天空的水面更暗、更偏蓝，轮廓才看得出来
    '  vec3 col = mix(c.rgb*vec3(0.70, 0.72, 0.90), vec3(0.74, 0.78, 0.95), 0.12 + 0.40*(1.0 - fade));',
    '  col *= 1.0 - exp(-k*k/0.00002)*0.25;',   // 入水处一条细暗线
    '  float a = c.a*fade*0.85*uOpacity;',
    '  a *= 0.82 + 0.18*sin(gl_FragCoord.y*0.85 + uTime*3.0 + vUv.x*30.0);',
    '  gl_FragColor = vec4(col, a);',
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
    'uniform float uOpacity, uTime, uShine, uRefl;',
    'varying vec2 vUv; varying float vShade;',
    'void main(){',
    '  vec2 uv = vUv;',
    '  if (uRefl > 0.5) uv.x += sin(uv.y*90.0 + uTime*2.6)*0.006*smoothstep(0.0, 0.25, uv.y);',
    '  vec4 c = cutout(uv);',
    '  vec3 col = c.rgb;',
    '  float sh = 0.5 + 0.5*sin(uTime*1.3 + uv.x*6.0 - uv.y*4.0);',
    '  col += pow(sh, 8.0)*0.10*uShine;',
    '  col *= mix(0.86, 1.06, vShade);',
    '  float a = c.a*uOpacity;',
    '  if (uRefl > 0.5) { a *= 0.30*(1.0 - smoothstep(0.0, 0.40, uv.y)); col = mix(col, vec3(0.82, 0.85, 0.98), 0.35); }',
    '  gl_FragColor = vec4(col, a);',
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
    'uniform sampler2D tScene; uniform sampler2D tField;',
    'uniform vec2 uRes; uniform vec4 uGlass;',   // x0, x1（uv）, 棱宽 px, 凸起程度
    'uniform float uTime, uFieldOn, uFrost, uPanelA, uDistP, uDistS, uChroma;',
    'uniform vec3 uLight;',                      // 光标光源：xy 像素，z 高度（像素）
    'uniform float uWaterPx;',                   // 玻璃板所在深度的水线（像素，自下而上）
    'varying vec2 vUv;',
    'float dispX(vec3 n, float eta){',
    '  vec3 a = refract(vec3(0.0, 0.0, -1.0), n, 1.0/eta);',
    '  vec3 b = refract(a, vec3(0.0, 0.0, 1.0), eta);',
    '  if (dot(b, b) < 1e-4) return a.x/(-a.z)*2.2;',
    '  return b.x/(-b.z);',
    '}',
    'void main(){',
    '  vec2 uv = vUv;',
    '  vec4 base = texture2D(tScene, uv);',
    '  vec2 P = uv*uRes;',
    '  float x0 = uGlass.x*uRes.x, x1 = uGlass.y*uRes.x, rw = uGlass.z;',
    '  float gm = smoothstep(x0 - 0.75, x0 + 0.75, P.x)*(1.0 - smoothstep(x1 - 0.75, x1 + 0.75, P.x))*uPanelA;',
    '  float under = smoothstep(uWaterPx + 0.5, uWaterPx - 1.5, P.y);',
    '  gm *= 1.0 - under*0.72;',
    '  if (gm <= 0.0) { gl_FragColor = vec4(base.rgb, 1.0); return; }',
    '  vec4 Fd = texture2D(tField, uv)*uFieldOn;',
    '  float wipe = smoothstep(0.05, 0.75, Fd.r);',
    // 棱片坐标：宽窄不一 + 光标拨动 + 竖直方向轻微的制造波纹
    '  float wy = uWaterPx - P.y;',
    '  float u = (P.x - x0 + under*(sin(P.y*0.18 + uTime*2.2)*2.5 + sin(P.y*0.07 - uTime*1.3)*3.0)*(1.0 + wy*0.01))/rw;',
    '  u += 0.30*sin(u*0.37 + 1.7) + 0.16*sin(u*1.13 + 0.4);',
    '  u += Fd.g*5.0;',
    '  float idc = floor(u);',
    '  u += sin(uv.y*7.0 + idc*1.7)*0.0045;',
    '  float id = floor(u), r = fract(u);',
    '  float s = 2.0*r - 1.0;',
    '  float A = uGlass.w*(1.0 - wipe);',     // 擦亮 = 把棱压平
    '  float q = max(1.0 - 0.93*s*s, 0.04);',
    '  vec3 n = normalize(vec3(A*0.93*s/sqrt(q), 0.0, 1.0));',
    // 后面是人像（近）还是天空（远）决定位移量：远处扭曲更大
    '  float near = smoothstep(0.15, 0.85, base.a);',
    '  float dist = mix(uDistS, uDistP, near);',
    '  float ch = uChroma;',
    '  float dR = dispX(n, 1.50 - 0.030*ch), dG = dispX(n, 1.50), dB = dispX(n, 1.50 + 0.036*ch);',
    '  vec3 col;',
    '  col.r = texture2D(tScene, uv + vec2(dR*dist/uRes.x, 0.0)).r;',
    '  col.g = texture2D(tScene, uv + vec2(dG*dist/uRes.x, 0.0)).g;',
    '  col.b = texture2D(tScene, uv + vec2(dB*dist/uRes.x, 0.0)).b;',
    // 菲涅尔：棱的侧坡更亮（反射身后的亮天空）
    '  float cosi = n.z;',
    '  float F = 0.04 + 0.96*pow(1.0 - cosi, 5.0);',
    '  vec3 envc = mix(vec3(0.90, 0.89, 0.99), vec3(1.0, 0.99, 1.0), uv.y);',
    '  col = mix(col, envc, F*0.85);',
    // 相邻两根棱交界的细缝：一条暗线
    '  float edgePx = min(r, 1.0 - r)*rw;',
    '  col *= 1.0 - 0.16*exp(-edgePx*edgePx/0.8)*(1.0 - wipe);',
    // 高光：光标点光源（随鼠标在棱上滑动）+ 左上主光
    '  vec3 V = vec3(0.0, 0.0, 1.0);',
    '  vec3 Lc = normalize(vec3(uLight.xy - P, uLight.z));',
    '  float hc = max(dot(n, normalize(Lc + V)), 0.0);',
    '  float hk = max(dot(n, normalize(normalize(vec3(-0.42, 0.30, 0.86)) + V)), 0.0);',
    '  col += (pow(hc, 340.0)*0.55 + pow(hc, 30.0)*0.03 + pow(hk, 160.0)*0.16)*(1.0 - wipe*0.6);',
    // 玻璃本身极淡的冷色
    '  col *= vec3(0.985, 0.985, 1.0);',
    // 玻璃板的切割边：一条亮线
    '  col += (exp(-pow((P.x - x0)/1.3, 2.0)) + exp(-pow((P.x - x1)/1.3, 2.0)))*0.22*(1.0 - under);',
    // 玻璃板底边插进水里：一条亮线 + 一点接触暗影
    '  float wl = uWaterPx + sin(P.x*0.06 + uTime*2.0)*1.2 + sin(P.x*0.021 - uTime*1.2)*1.6;',
    '  col += exp(-pow((P.y - wl)/1.2, 2.0))*0.18*(0.6 + 0.4*sin(P.x*0.13 - uTime*2.7));',
    '  col *= 1.0 - exp(-pow((P.y - uWaterPx + 4.0)/3.0, 2.0))*0.05;',
    '  col = mix(col, vec3(0.97, 0.96, 1.0), uFrost);',
    '  gl_FragColor = vec4(mix(base.rgb, col, gm), 1.0);',
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
    'varying vec3 vPW;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vPW = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var FS_GLASS = [
    NOISE,
    'uniform sampler2D tScene; uniform sampler2D tEnv; uniform float uSeedB;',
    'uniform vec4 uBgRect; uniform float uBgMap;',
    'uniform mat4 uModel; uniform mat4 uInvModel; uniform mat4 uViewProj;',
    'uniform vec3 uLight; uniform float uTime, uOpacity, uKind, uIri, uRefl, uWaterY, uBehind, uAbsorb, uTube, uBevel, uEps, uTMax, uObjScale, uWave;',
    'uniform vec3 uSize; uniform vec3 uTint; uniform vec3 uAbsorbCol;',
    'varying vec3 vPW;',
    'float sdRBox(vec3 p){ vec3 q = abs(p) - (uSize - uBevel); return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - uBevel; }',
    'float sdTorus(vec3 p){ vec2 q = vec2(length(p.xy) - 1.0, p.z); return length(q) - uTube; }',
    'float map(vec3 p){ return uKind < 0.5 ? sdTorus(p) : sdRBox(p); }',
    'vec3 nrm(vec3 p){',
    '  if (uKind > 0.5 && uKind < 1.5) return normalize(p);',
    '  vec2 e = vec2(1.0, -1.0)*uEps;',
    '  return normalize(e.xyy*map(p + e.xyy) + e.yyx*map(p + e.yyx) + e.yxy*map(p + e.yxy) + e.xxx*map(p + e.xxx));',
    '}',
    'bool hitOut(vec3 ro, vec3 rd, out float t){',
    '  t = 0.0;',
    '  if (uKind > 0.5 && uKind < 1.5) {',
    '    float b = dot(ro, rd), c = dot(ro, ro) - 1.0, h = b*b - c;',
    '    if (h < 0.0) return false;',
    '    t = -b - sqrt(h); return t > 0.0;',
    '  }',
    '  for (int i = 0; i < 96; i++) { float d = map(ro + rd*t); if (d < uEps*0.4) return true; t += d; if (t > uTMax) break; }',
    '  return false;',
    '}',
    // 在玻璃内部沿 d 走到另一侧表面
    'vec3 marchIn(vec3 p, vec3 d, out float len){',
    '  if (uKind > 0.5 && uKind < 1.5) { len = max(-2.0*dot(p, d), 0.0); return p + d*len; }',
    '  float t = uEps*4.0;',
    '  for (int i = 0; i < 56; i++) { float h = -map(p + d*t); if (h < uEps*0.4) break; t += max(h, uEps*0.5); if (t > uTMax) break; }',
    '  len = t; return p + d*t;',
    '}',
    'vec3 sampleScene(vec2 s){',
    '  if (uBgMap > 0.5) s = (s - uBgRect.xy)/uBgRect.zw;',
    '  return texture2D(tScene, clamp(s, 0.002, 0.998)).rgb;',
    '}',
    // 出射光线继续走 uBehind 后投回屏幕，取那里的画面
    'vec3 behind(vec3 Po, vec3 Do){',
    '  vec3 Pw = (uModel*vec4(Po, 1.0)).xyz;',
    '  vec3 Dw = normalize(mat3(uModel)*Do);',
    '  vec4 c = uViewProj*vec4(Pw + Dw*uBehind, 1.0);',
    '  return sampleScene(c.xy/max(c.w, 1e-3)*0.5 + 0.5);',
    '}',
    // 环境：用天空海贴图当穹顶（模糊）+ 两盏柔光
    'vec3 env(vec3 R){',
    '  vec2 eu = vec2(0.5 + R.x*0.42, R.y >= 0.0 ? mix(0.36, 0.97, R.y) : mix(0.16, 0.02, -R.y));',
    '  vec3 c = texture2D(tEnv, eu, 3.0).rgb;',
    '  float k1 = smoothstep(0.84, 0.97, dot(R, normalize(vec3(-0.55, 0.72, 0.42))));',
    '  float k2 = smoothstep(0.90, 0.985, dot(R, normalize(vec3(0.82, 0.22, 0.52))));',
    '  return c*1.04 + k1*0.6 + k2*vec3(0.86, 0.9, 1.0)*0.4;',
    '}',
    // 薄膜干涉：厚度 d（纳米）+ 入射角 → RGB 三个波长的干涉强度
    'vec3 filmColor(float d, float cosi){',
    '  float sint = sqrt(max(1.0 - cosi*cosi, 0.0))/1.33;',
    '  float cost = sqrt(max(1.0 - sint*sint, 0.0));',
    '  vec3 ph = 12.566*1.33*d*cost/vec3(650.0, 532.0, 450.0);',
    '  return 0.5 - 0.5*cos(ph);',
    '}',
    // 柔光箱窗户的反射（带一根窗框），肥皂泡照片里最典型的高光
    'float windowLight(vec3 R){',
    '  vec3 W = normalize(vec3(-0.50, 0.55, 0.67));',
    '  float k = dot(R, W);',
    '  if (k <= 0.05) return 0.0;',
    '  vec3 U = normalize(cross(vec3(0.0, 1.0, 0.0), W)); vec3 V = cross(W, U);',
    '  vec3 q = R/k - W;',
    '  vec2 b = vec2(dot(q, U), dot(q, V));',
    '  float box = smoothstep(0.15, 0.12, abs(b.x))*smoothstep(0.10, 0.075, abs(b.y));',
    '  float bar = 1.0 - (1.0 - smoothstep(0.0, 0.010, abs(b.x)))*0.85;',
    '  return box*bar;',
    '}',
    'void main(){',
    '  vec3 rdW = normalize(vPW - cameraPosition);',
    '  if (uRefl > 0.5) rdW = normalize(rdW + vec3(sin(vPW.y*55.0 + uTime*2.2)*0.0035*uWave, 0.0, 0.0));',
    '  vec3 ro = (uInvModel*vec4(cameraPosition, 1.0)).xyz;',
    '  vec3 rd = normalize(mat3(uInvModel)*rdW);',
    // —— 肥皂泡
    '  if (uKind > 0.5 && uKind < 1.5) {',
    '    float b = dot(ro, rd), c = dot(ro, ro) - 1.0, h = b*b - c;',
    '    if (h < 0.0) discard;',
    '    float m = sqrt(max(c + 1.0 - b*b, 0.0));',
    '    float aa = max(fwidth(m), 1e-4);',
    '    float edgeA = 1.0 - smoothstep(1.0 - aa*1.5, 1.0, m);',
    '    vec3 P1 = ro + rd*(-b - sqrt(h));',
    '    vec3 P2 = ro + rd*(-b + sqrt(h));',
    '    vec3 n1w = normalize((vec4(P1, 0.0)*uInvModel).xyz);',
    '    vec3 n2w = normalize((vec4(-P2, 0.0)*uInvModel).xyz);',
    '    float c1 = clamp(dot(-rdW, n1w), 0.0, 1.0), c2 = clamp(dot(-rdW, n2w), 0.0, 1.0);',
    '    float F1 = 0.02 + 0.98*pow(1.0 - c1, 5.0), F2 = 0.02 + 0.98*pow(1.0 - c2, 5.0);',
    '    float rim = 1.0 - c1;',
    // 透射：薄膜几乎不偏折，只在边缘有一点压缩
    '    vec3 trans = behind(P1, normalize(rd - P1*rim*rim*0.05));',
    // 膜厚：缓慢流动的涡旋，重力让上薄下厚
    '    vec2 q1 = P1.xy*1.7 + vec2(uTime*0.045, -uTime*0.07) + uSeedB;',
    '    float th1 = mix(180.0, 760.0, fbm3(q1 + fbm3(q1*1.3 + uTime*0.05)*1.3))*mix(0.5, 1.35, 0.5 - 0.5*P1.y);',
    '    vec2 q2 = P2.xy*1.7 + vec2(-uTime*0.04, uTime*0.06) + uSeedB + 7.0;',
    '    float th2 = mix(180.0, 760.0, fbm3(q2 + fbm3(q2*1.3 - uTime*0.05)*1.3))*mix(0.5, 1.35, 0.5 - 0.5*P2.y);',
    '    vec3 f1 = filmColor(th1, c1), f2 = filmColor(th2, c2);',
    '    vec3 R1 = reflect(rdW, n1w), R2 = reflect(rdW, n2w);',
    '    vec3 e1 = env(R1) + windowLight(R1)*14.0, e2 = env(R2) + windowLight(R2)*14.0;',
    '    vec3 r1 = min(F1*2.0*f1, vec3(1.0)), r2 = min(F2*2.0*f2, vec3(1.0))*0.75;',
    '    vec3 col = trans*(1.0 - 0.5*(r1 + r2));',
    '    col += e1*r1;',          // 外表面反射（正像）
    '    col += e2*r2;',          // 内表面反射（倒像）
    '    vec3 Lp = normalize(uLight - (uModel*vec4(P1, 1.0)).xyz);',
    '    col += pow(max(dot(n1w, normalize(Lp - rdW)), 0.0), 900.0)*1.6;',
    '    gl_FragColor = vec4(col, uOpacity*edgeA);',
    '    return;',
    '  }',
    '  if (uKind < 0.5) {',
    '    float rb = 1.0 + uTube*1.8; float b = dot(ro, rd), c = dot(ro, ro) - rb*rb, h = b*b - c;',
    '    if (h < 0.0) discard;',
    '    ro += rd*max(-b - sqrt(h), 0.0);',
    '  } else if (uKind > 1.5) {',
    '    ro = (uInvModel*vec4(vPW, 1.0)).xyz - rd*uEps*6.0;',
    '  }',
    '  float t;',
    '  if (!hitOut(ro, rd, t)) discard;',
    '  vec3 P1 = ro + rd*t;',
    '  vec3 n1 = nrm(P1);',
    '  vec3 P1w = (uModel*vec4(P1, 1.0)).xyz;',
    '  if (uRefl < 0.5 && P1w.y < uWaterY) discard;',
    '  if (uRefl > 0.5 && P1w.y > uWaterY) discard;',
    '  vec3 n1w = normalize((vec4(n1, 0.0)*uInvModel).xyz);',
    '  float cosi = clamp(dot(-rdW, n1w), 0.0, 1.0);',
    '  float F = 0.04 + 0.96*pow(1.0 - cosi, 5.0);',
    // 三个通道折射率不同：G 通道完整追踪，R/B 共用出射面
    '  vec3 eta = vec3(1.465, 1.50, 1.54);',
    '  vec3 tR = refract(rd, n1, 1.0/eta.r), tG = refract(rd, n1, 1.0/eta.g), tB = refract(rd, n1, 1.0/eta.b);',
    '  float len; vec3 P2 = marchIn(P1, tG, len);',
    '  vec3 n2 = nrm(P2);',
    '  vec3 oR = refract(tR, -n2, eta.r), oG = refract(tG, -n2, eta.g), oB = refract(tB, -n2, eta.b);',
    '  float travel = len;',
    '  if (dot(oG, oG) < 1e-4) {',
    // 全内反射：在玻璃里再弹一次
    '    vec3 tG2 = reflect(tG, n2); float l2; vec3 P3 = marchIn(P2, tG2, l2); travel += l2;',
    '    vec3 n3 = nrm(P3);',
    '    oG = refract(tG2, -n3, eta.g); oR = refract(reflect(tR, n2), -n3, eta.r); oB = refract(reflect(tB, n2), -n3, eta.b);',
    '    if (dot(oG, oG) < 1e-4) oG = reflect(tG2, n3);',
    '    P2 = P3;',
    '  }',
    '  if (dot(oR, oR) < 1e-4) oR = oG;',
    '  if (dot(oB, oB) < 1e-4) oB = oG;',
    '  vec3 col = vec3(behind(P2, oR).r, behind(P2, oG).g, behind(P2, oB).b);',
    // 玻璃自身的吸收（越厚越带淡紫）
    '  col *= exp(-uAbsorbCol*travel*uObjScale*uAbsorb) * uTint;',
    '  vec3 Rw = reflect(rdW, n1w);',
    '  col = mix(col, env(Rw), F);',
    // 跟随光标的点光源高光（锐利）
    '  vec3 L = normalize(uLight - P1w); vec3 H = normalize(L - rdW);',
    '  float nh = max(dot(n1w, H), 0.0);',
    '  col += (pow(nh, 1400.0)*2.4 + pow(nh, 120.0)*0.10)*vec3(1.0, 0.99, 1.0);',
    // 薄膜虹彩（主要在边缘）
    '  vec3 iri = 0.5 + 0.5*cos(6.2831*(vec3(0.0, 0.33, 0.67) + cosi*1.6 + uTime*0.03 + P1w.y*0.15));',
    '  col += (iri - 0.35)*pow(1.0 - cosi, 2.5)*uIri;',
    '  float a = uOpacity;',
    '  if (uKind > 1.5 && uRefl < 0.5) col = mix(col, vec3(0.96, 0.96, 1.0), exp(-(P1w.y - uWaterY)*90.0/uObjScale)*0.35);',
    '  if (uRefl > 0.5) a *= 0.30*smoothstep(uWaterY - uSize.y*1.3, uWaterY, P1w.y);',
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

  var FS_COPYA = [
    'uniform sampler2D tSrc; varying vec2 vUv;',
    'void main(){ gl_FragColor = texture2D(tSrc, vUv); }'
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
    'vec2 lensOff(vec3 n, float eta){',
    '  vec3 a = refract(vec3(0.0, 0.0, -1.0), n, 1.0/eta);',
    '  vec3 b = refract(a, vec3(0.0, 0.0, 1.0), eta);',
    '  if (dot(b, b) < 1e-4) return a.xy/(-a.z);',
    '  return b.xy/(-b.z);',
    '}',
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
    // 光标玻璃水滴：平凸透镜，按折射算放大 + 三通道色散 + 菲涅尔 + 两处高光
    '  vec2 d = p - uLens.xy;',
    '  float sp = length(uLensV); vec2 vd = sp > 1.0 ? uLensV/sp : vec2(1.0, 0.0);',
    '  float st = clamp(sp/2600.0, 0.0, 0.5);',
    '  vec2 dl = vec2(dot(d, vd)/(1.0 + st), dot(d, vec2(-vd.y, vd.x))*(1.0 + st*0.45));',
    '  float r = length(dl)/max(uLens.z, 1.0);',
    '  float inL = (1.0 - smoothstep(0.975, 1.0, r))*uLensA;',
    '  vec2 q = uv + o/uRes;',
    '  float ca = 0.004*chrom + uCA;',
    '  vec3 col;',
    '  col.r = texture2D(tColor, q + (q-0.5)*ca).r;',
    '  col.g = texture2D(tColor, q).g;',
    '  col.b = texture2D(tColor, q - (q-0.5)*ca).b;',
    '  if (inL > 0.0) {',
    '    vec2 dd = (d/max(uLens.z, 1.0))*min(1.0, 0.999/max(r, 1e-3));',
    '    float zz = sqrt(max(1.0 - dot(dd, dd), 0.0));',
    '    vec3 n = normalize(vec3(dd*0.92, zz));',
    '    float dep = uLens.z*1.6;',
    '    vec2 oR = lensOff(n, 1.325)*dep, oG = lensOff(n, 1.34)*dep, oB = lensOff(n, 1.36)*dep;',
    '    vec3 lc = vec3(texture2D(tColor, (p + oR)/uRes).r, texture2D(tColor, (p + oG)/uRes).g, texture2D(tColor, (p + oB)/uRes).b);',
    '    float Fl = 0.02 + 0.98*pow(1.0 - n.z, 5.0);',
    '    lc = mix(lc, vec3(0.97, 0.97, 1.0), Fl*0.85);',
    '    lc += pow(max(dot(n, normalize(vec3(-0.30, 0.42, 0.86))), 0.0), 260.0)*1.3;',
    '    lc += pow(max(dot(n, normalize(vec3(0.40, -0.42, 0.82))), 0.0), 70.0)*0.16;',
    '    col = mix(col, lc, inL);',
    '  }',
    '  col *= 1.0 - 0.07*exp(-pow((r - 1.04)/0.05, 2.0))*uLensA;',
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
    FS_PORTRAIT: FS_PORTRAIT, FS_PREFL: FS_PREFL, VS_LAV: VS_LAV, VS_SPRITE: VS_SPRITE, VS_FLY: VS_FLY, FS_SPRITE: FS_SPRITE,
    FS_REED: FS_REED, FS_TITLE: FS_TITLE, VS_GLASS: VS_GLASS, FS_GLASS: FS_GLASS, FS_FOG: FS_FOG,
    FS_COPY: FS_COPY, FS_COPYA: FS_COPYA, FS_BRIGHT: FS_BRIGHT, FS_BLUR: FS_BLUR, FS_POST: FS_POST
  };
})();
