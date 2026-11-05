"""Local dashboard + quote collector. Public market data only; no trading API."""
import datetime as dt
import http.server
import json
import os
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
import intraday

ROOT = Path(__file__).resolve().parents[1]
REMOTE = 'https://james10394-bit.github.io/jc-stock-radar/data/market.json'
market = {}
snapshot = {}
lock = threading.Lock()


def refresh_market():
    global market
    try:
        with urllib.request.urlopen(REMOTE+'?live='+str(int(time.time())), timeout=30) as response:
            fresh = json.loads(response.read(90000000))
        if not fresh.get('latest_session'):
            raise ValueError('Missing daily snapshot')
        with lock:
            market = fresh
        path = ROOT/'data'/'market.json'
        path.parent.mkdir(exist_ok=True)
        temp = path.with_suffix('.live.tmp')
        temp.write_text(json.dumps(fresh, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        os.replace(temp, path)
        print('Daily data:', fresh['latest_session'], flush=True)
    except Exception as exc:
        path = ROOT/'data'/'market.json'
        if path.exists():
            with lock:
                market = json.loads(path.read_text(encoding='utf-8'))
        print('Daily sync:', exc, flush=True)


def collector():
    global snapshot
    next_daily = time.time()+1800
    while True:
        try:
            if time.time() >= next_daily:
                refresh_market()
                next_daily = time.time()+1800
            with lock:
                m, old = market, snapshot
            if m:
                fresh = intraday.collect(m, old)
                fresh['mode'] = 'local_live'
                with lock:
                    snapshot = fresh
                intraday.save(fresh)
                print('Quotes:', fresh.get('coverage', {}), 'phase:', fresh['phase'], flush=True)
        except Exception as exc:
            print('Quote sync:', exc, flush=True)
        time.sleep(30)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/intraday':
            with lock:
                data = snapshot or {'phase': 'loading', 'quotes': {}}
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json;charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path not in ('/', '/index.html', '/app.js', '/risk-engine.js', '/market-signals.js', '/intraday-ui.js', '/style.css', '/data/market.json', '/data/intraday.json', '/data/watchlist.json'):
            self.send_error(404)
            return
        super().do_GET()


if __name__ == '__main__':
    # Loopback only by default. No inbound account or file-management endpoint.
    refresh_market()
    saved = ROOT/'data'/'intraday.json'
    if saved.exists():
        try:
            snapshot = json.loads(saved.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            pass
    threading.Thread(target=collector, daemon=True).start()
    print('Open http://127.0.0.1:8765 — keep this window running.', flush=True)
    webbrowser.open('http://127.0.0.1:8765')
    http.server.ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()

