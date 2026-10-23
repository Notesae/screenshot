#!/usr/bin/env python3
"""把唯一 tokens.json、CSS 和 JavaScript 打包成不依赖网络的 HTML。"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import http.server
import socketserver
import os

ROOT = Path(__file__).resolve().parent

def build(destination: Path) -> Path:
    tokens = json.loads((ROOT / 'tokens.json').read_text(encoding='utf-8'))
    html = (ROOT / 'demo/index.html').read_text(encoding='utf-8')
    css = (ROOT / 'demo/style.css').read_text(encoding='utf-8')
    js = (ROOT / 'demo/app.js').read_text(encoding='utf-8')
    html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n'+css+'\n</style>')
    embedded = json.dumps(tokens, ensure_ascii=False).replace('</', '<\\/')
    html = html.replace('<script src="app.js"></script>', '<script>window.LIQUID_TOKENS='+embedded+';</script><script>\n'+js.replace('</script', '<\\/script')+'\n</script>')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html, encoding='utf-8')
    return destination

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'standalone.html')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int, default=8765)
    args=parser.parse_args()
    print(build(args.output))
    if args.serve:
        os.chdir(ROOT)
        with socketserver.TCPServer(('127.0.0.1',args.port),http.server.SimpleHTTPRequestHandler) as server:
            print(f'Local only: http://127.0.0.1:{args.port}/standalone.html')
            try: server.serve_forever()
            except KeyboardInterrupt: pass
