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


def parse_volume_quote(row, now):
    """Cumulative reported volume is useful even when current trade z is '-'."""
    code = str(row.get('c', ''))
    if not re.fullmatch(r'\d{4}', code) or code.startswith('00') or row.get('ex') not in ('tse', 'otc') or row.get('d') != now.strftime('%Y%m%d'):
        return None
    volume = number(row.get('v'))
    if volume is None or volume < 0:
        return None
    try:
        stamp = dt.datetime.strptime(row['d']+' '+row['t'], '%Y%m%d %H:%M:%S').replace(tzinfo=TZ)
    except (KeyError, ValueError):
        return None
    price = number(row.get('z'))
    return {'code':code, 'name':row.get('n', code), 'date':stamp.date().isoformat(),
            'timestamp':stamp.isoformat(), 'volume':int(volume*1000),
            'price':price if price is not None and price>0 else None,
            'price_available':price is not None and price>0, 'volume_unit':'shares'}


def compact_history(snapshot):
    volumes = snapshot.get('volume_quotes') or snapshot.get('quotes', {})
    top = sorted(volumes.items(), key=lambda item:item[1].get('volume',0), reverse=True)[:100]
    return {'date':snapshot.get('date'), 'generated_at':snapshot.get('generated_at'),
            'opening_observations':snapshot.get('opening_observations', {}), 'volume_quotes':dict(top)}


def parse_order_book(row, now):
    """MIS b/g are bid prices/lots; a/f are ask prices/lots. Not executions."""
    code = str(row.get('c', ''))
    if not re.fullmatch(r'\d{4}', code) or code.startswith('00') or row.get('ex') not in ('tse', 'otc') or row.get('d') != now.strftime('%Y%m%d'):
        return None
    if any(not isinstance(row.get(k), str) or not row[k] for k in ('a', 'b', 'f', 'g')):
        return None
    try:
        stamp = dt.datetime.strptime(row['d']+' '+row['t'], '%Y%m%d %H:%M:%S').replace(tzinfo=TZ)
    except (ValueError, KeyError):
        return None
    def levels(prices, volumes):
        result = []
        prices, volumes = prices.rstrip('_').split('_'), volumes.rstrip('_').split('_')
        if len(prices) != len(volumes) or not 1 <= len(prices) <= 5:
            return None
        for p, v in zip(prices, volumes):
            p, v = number(p), number(v)
            if (p is not None and p > 0) and (v is None or v < 0):
                return None
            if p is not None and p > 0 and v is not None and v >= 0:
                result.append({'price': p, 'shares': int(v*1000)})
        return result
    bids, asks = levels(row['b'], row['g']), levels(row['a'], row['f'])
    if bids is None or asks is None:
        return None
    bid, ask = sum(x['shares'] for x in bids), sum(x['shares'] for x in asks)
    if bid+ask <= 0:
        return None
    return {'code': code, 'name': row.get('n', code), 'date': stamp.date().isoformat(),
            'timestamp': stamp.isoformat(), 'upper_limit': number(row.get('u')),
            'bids': bids, 'asks': asks, 'bid_shares': bid, 'ask_shares': ask,
            'buy_share': bid/(bid+ask), 'investor_identity': 'unknown', 'volume_unit': 'shares'}


def capture_early_book(book, now):
    stamp = dt.datetime.fromisoformat(book['timestamp'])
    seconds = stamp.hour*3600+stamp.minute*60+stamp.second
    age = (now-stamp).total_seconds()
    return (0 <= age <= 30 and 9*3600 <= seconds <= 9*3600+5*60
            and book['bid_shares'] >= 500000 and book['buy_share'] >= .8)


def add_interval(q, previous):
    if not previous or previous.get('date') != q['date']:
        return
    try:
        age = (dt.datetime.fromisoformat(q['timestamp'])-dt.datetime.fromisoformat(previous['timestamp'])).total_seconds()
    except (ValueError, KeyError, TypeError):
        return
    if 10 <= age <= 120 and q['volume'] >= previous['volume'] and previous['price'] > 0:
        q.update(interval_seconds=age, interval_volume=q['volume']-previous['volume'],
                 interval_price_change=(q['price']/previous['price']-1)*100)


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
    history = dict(old.get('history', {}))
    if old.get('date') != today:
        if old.get('date') and (old.get('opening_observations') or old.get('volume_quotes') or old.get('quotes')):
            history[old['date']] = compact_history(old)
        old = {}
    history = {day:history[day] for day in sorted(history)[-5:] if day<today}
    base = {'date': today, 'generated_at': now.isoformat(), 'phase': phase(now),
            'source': 'TWSE MIS 公開成交快照', 'quotes': {}, 'errors': [],
            'opening_window': '09:04:45～09:05:30 實際觀測，非逐筆開盤成交量',
            'mode': 'snapshot', 'order_books': {}, 'early_order_alerts': old.get('early_order_alerts', {}),
            'volume_quotes':{}, 'opening_observations':old.get('opening_observations', {}),
            'history':history, 'checked_at':now.isoformat()}
    sessions = market.get('trading_sessions', [])
    # Official confirmed holidays override the weekday-only clock.
    if market.get('calendar_month') == today[:7] and today not in sessions:
        # Historical calendar records contain completed sessions only. A known
        # market holiday is separately provided; absence alone is NOT a holiday.
        if today in market.get('market_holidays', []):
            base['phase'] = 'closed'
    if base['phase'] != 'trading':
        base['quotes'] = old.get('quotes', {})
        base['order_books'] = old.get('order_books', {})
        base['volume_quotes'] = old.get('volume_quotes', {})
        base['coverage'] = old.get('coverage', {})
        # A check while closed must not make old quotes appear newly fetched.
        base['generated_at'] = old.get('generated_at')
        return base
    universe = symbols(market)
    batches = [universe[i:i+60] for i in range(0, len(universe), 60)]
    def task(batch):
        try:
            return fetch(batch), None
        except Exception as exc:
            return None, str(exc)
    returned = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for payload, error in pool.map(task, batches):
            if error:
                base['errors'].append(error)
                continue
            for row in payload.get('msgArray', []):
                returned += 1
                observed = dt.datetime.now(TZ)
                volume_quote = parse_volume_quote(row, now)
                if volume_quote:
                    base['volume_quotes'][volume_quote['code']] = volume_quote
                book = parse_order_book(row, now)
                if book:
                    base['order_books'][book['code']] = book
                    if capture_early_book(book, observed):
                        base['early_order_alerts'][book['code']] = book
                q = parse_quote(row, now)
                if q:
                    add_interval(q, old.get('quotes', {}).get(q['code']))
                    saved_open = base['opening_observations'].get(q['code']) or old.get('quotes', {}).get(q['code'])
                    capture_opening(q, saved_open, now)
                    if q.get('opening_complete'):
                        base['opening_observations'].setdefault(q['code'], dict(q))
                    base['quotes'][q['code']] = q
    # Failed batches do not inherit stale prices as fresh data.
    base['generated_at'] = dt.datetime.now(TZ).isoformat()
    base['coverage'] = {'requested': len(universe), 'received': len(base['quotes']), 'returned_rows': returned,
                        'volume_received':len(base['volume_quotes']), 'opening_received':len(base['opening_observations']),
                        'order_books': len(base['order_books']), 'batches_failed': len(base['errors']),
                        'note': '成交價為空不以委託價替代；五檔可獨立取得。委託不代表成交，無法辨識外資。'}
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
    print(json.dumps({k: v for k, v in snapshot.items() if k not in ('quotes','order_books','early_order_alerts','volume_quotes','opening_observations','history')}, ensure_ascii=False))


if __name__ == '__main__':
    main()

