# -*- coding: utf-8 -*-
"""로컬 개발 서버 — 오디오 seek(재생바 이동)을 위해 HTTP Range 요청 지원.
   (기본 python -m http.server 는 Range 미지원이라 seek이 안 됨)
   실행:  python tools/serve.py   또는  serve.cmd
"""
import os, re, http.server, socketserver

PORT = 8777
SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
os.chdir(SITE)

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # 개발 중 stale 방지
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()
        path = self.translate_path(self.path)
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found"); return None
        try:
            size = os.fstat(f.fileno()).st_size
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if not m:
                return super().send_head()
            s, e = m.group(1), m.group(2)
            start = int(s) if s else 0
            end = int(e) if e else size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                self.send_error(416, "Range Not Satisfiable"); f.close(); return None
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            f.seek(start)
            self.wfile.write(f.read(end - start + 1))
        finally:
            f.close()
        return None   # 본문은 이미 전송

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    print(f"jp-reader: http://localhost:{PORT}/  (Range 지원, Ctrl+C 종료)")
    Server(("", PORT), Handler).serve_forever()
