#!/usr/bin/env python3
"""本地预览（禁用缓存）。用法：python3 tools/serve.py [端口]，默认 8140，根目录为 home-v2。
开发辅助：POST /__shot?name=xxx（body 为 dataURL）会把画面存到 ../shots/xxx.png，供核对细节。"""
import http.server, functools, os, sys, base64, urllib.parse
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(os.path.dirname(ROOT), 'shots')
PORT = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8140))

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, *a):
        pass

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/__shot':
            self.send_error(404); return
        qs = urllib.parse.parse_qs(u.query)
        name = qs.get('name', ['shot'])[0]
        name = ''.join(ch for ch in name if ch.isalnum() or ch in '-_') or 'shot'
        ext = qs.get('ext', ['png'])[0]
        ext = ext if ext in ('png', 'webp', 'jpg') else 'png'
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n).decode()
        if ',' in data:
            data = data.split(',', 1)[1]
        os.makedirs(SHOTS, exist_ok=True)
        with open(os.path.join(SHOTS, name + '.' + ext), 'wb') as f:
            f.write(base64.b64decode(data))
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')

http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(H, directory=ROOT)).serve_forever()
