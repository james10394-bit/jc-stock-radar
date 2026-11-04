"""Public MIS quote snapshots. No order execution or trading credentials."""
import argparse
import concurrent.futures
import datetime as dt
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TZ = dt.timezone(dt.timedelta(hours=8), 'Asia/Taipei')
ENDPOINT = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp'


def number(x):
    try:
        if x is None or str(x).strip() in ('', '-', '--'):
            return None
        value = float(str(x).replace(',', ''))
        return value if value == value and abs(value) != float('inf') else None
    except (TypeError, ValueError):
        return None


def phase(now):
    minutes = now.hour * 60 + now.minute
    return 'trading' if now.weekday() < 5 and 540 <= minutes < 810 else 'closed'


def parse_quote(row, now):
    code = str(row.get('c', ''))
    if not re.fullmatch(r'\d{4}', code) or row.get('ex') not in ('tse', 'otc'):
        return None
    date = str(row.get('d', ''))
    if date != now.strftime('%Y%m%d'):
        return None
    # Only actual executed trade price; bids/asks are not substituted.
    price, volume = number(row.get('z')), number(row.get('v'))
    opening, previous = number(row.get('o')), number(row.get('y'))
    high, low = number(row.get('h')), number(row.get('l'))
    if not all(x is not None and x > 0 for x in (price, opening, previous)) or volume is None or volume < 0:
        return None
    if high is None or low is None or not (high >= low > 0):
        return None
    try:
        stamp = dt.datetime.strptime(date+' '+str(row.get('t')), '%Y%m%d %H:%M:%S').replace(tzinfo=TZ)
    except ValueError:
        return None
    return {'code': code, 'name': row.get('n', code), 'market': '上市' if row['ex'] == 'tse' else '上櫃',
            'price': price, 'open': opening, 'previous_close': previous,
            'high': high, 'low': low,
            'volume': int(volume * 1000), 'timestamp': stamp.isoformat(),
            'date': stamp.date().isoformat(), 'opening_complete': False,
            'volume_unit': 'shares'}


def symbols(market):
    registry = dict(market.get('security_registry', {}))
    registry.update(market.get('company_profiles', {}))
    for stocks in market.get('days', {}).values():
        for code, stock in stocks.items():
            registry[code] = {**registry.get(code, {}), **stock}
    return [(code, 'tse' if p.get('market') == '上市' else 'otc') for code, p in registry.items()
            if re.fullmatch(r'\d{4}', code) and p.get('market') in ('上市', '上櫃')]


def request_batch(batch):
    query = urllib.parse.urlencode({'ex_ch': '|'.join(f'{exchange}_{code}.tw' for code, exchange in batch), 'json': '1', 'delay': '0'})
    request = urllib.request.Request(ENDPOINT+'?'+query, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.loads(response.read(4000000))
    if payload.get('rtcode') != '0000':
        raise ValueError('MIS quote service did not return success')
    return payload


def capture_opening(q, old, now):
    # Persist the actual observation time; never label a late-start day as 09:00 data.
    if old and old.get('opening_complete') and old.get('date') == q['date']:
        for key in ('opening_volume', 'opening_low', 'opening_high', 'opening_observed_at', 'opening_complete'):
            q[key] = old[key]
        return q
    stamp = dt.datetime.fromisoformat(q['timestamp'])
    seconds = stamp.hour * 3600 + stamp.minute * 60 + stamp.second
    if 9 * 3600 + 4 * 60 + 45 <= seconds <= 9 * 3600 + 5 * 60 + 30 and now.hour == 9 and now.minute <= 6:
        q.update(opening_complete=True, opening_volume=q['volume'], opening_low=q['low'],
                 opening_high=q['high'], opening_observed_at=q['timestamp'])
    return q


def collect(market, previous=None, now=None, fetch=request_batch):
    now = now or dt.datetime.now(TZ)
    today = now.date().isoformat()
    old = previous or {}
    if old.get('date') != today:
        old = {}
    base = {'date': today, 'generated_at': now.isoformat(), 'phase': phase(now),
            'source': 'TWSE MIS 公開成交快照', 'quotes': {}, 'errors': [],
            'opening_window': '09:04:45～09:05:30 實際觀測，非逐筆開盤成交量',
            'mode': 'snapshot'}
    sessions = market.get('trading_sessions', [])
    # Official confirmed holidays override the weekday-only clock.
    if market.get('calendar_month') == today[:7] and today not in sessions:
        # Historical calendar records contain completed sessions only. A known
        # market holiday is separately provided; absence alone is NOT a holiday.
        if today in market.get('market_holidays', []):
            base['phase'] = 'closed'
    if base['phase'] != 'trading':
        base['quotes'] = old.get('quotes', {})
        return base
    universe = symbols(market)
    batches = [universe[i:i+60] for i in range(0, len(universe), 60)]
    def task(batch):
        try:
            return fetch(batch), None
        except Exception as exc:
            return None, str(exc)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for payload, error in pool.map(task, batches):
            if error:
                base['errors'].append(error)
                continue
            for row in payload.get('msgArray', []):
                q = parse_quote(row, now)
                if q:
                    capture_opening(q, old.get('quotes', {}).get(q['code']), now)
                    base['quotes'][q['code']] = q
    # Failed batches do not inherit stale prices as fresh data.
    base['generated_at'] = dt.datetime.now(TZ).isoformat()
    base['coverage'] = {'requested': len(universe), 'received': len(base['quotes']), 'batches_failed': len(base['errors'])}
    return base


def save(snapshot, path=None):
    path = Path(path or ROOT / 'data' / 'intraday.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    os.replace(temp, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    market = json.loads((ROOT/'data'/'market.json').read_text(encoding='utf-8'))
    path = ROOT/'data'/'intraday.json'
    previous = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    snapshot = collect(market, previous)
    save(snapshot)
    print(json.dumps({k: v for k, v in snapshot.items() if k != 'quotes'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
