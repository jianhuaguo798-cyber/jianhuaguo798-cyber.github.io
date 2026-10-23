# PORTFOLIO 2026 · 郭建华

UI/UX 设计作品集个人网站首页。线上地址：https://jianhuaguo798-cyber.github.io/

## 本地预览

纯静态站，无需构建。WebGL 贴图不能从 `file://` 读取，请用本地服务器打开：

```bash
python3 tools/serve.py 8140
```

然后访问 http://localhost:8140

## 结构

- `index.html` — 页面结构与文字
- `assets/css/style.css` — 版式（桌面按 2000×1125 设计稿等比映射，手机竖屏按 750×1500 重排）
- `assets/js/stage.js` — WebGL 舞台（three.js r147）：天空海、竖纹玻璃、标题、圆环 / 气泡 / 棱柱、薰衣草、蝴蝶、后期
- `assets/js/shaders.js` — 全部着色器
- `assets/js/main.js` — 布局、加载、开场时间轴、滚动、交互
- `assets/img/` — 分层素材与抠图蒙版（`tools/cutout.js` 用 macOS Vision 生成）

## 调试参数

- `?at=秒数` 冻结开场时间轴
- `?p=0~1` 固定滚动进度
- `?dbg=0.5` 叠加设计稿对位
