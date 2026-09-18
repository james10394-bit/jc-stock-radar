#!/usr/bin/env python3
"""Build a dated TWSE snapshot for the static GitHub Pages dashboard."""
import datetime as dt
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'market.json'
WATCHLIST = ROOT / 'data' / 'watchlist.json'
TAIPEI = ZoneInfo('Asia/Taipei')
T86 = 'https://www.twse.com.tw/rwd/zh/fund/T86'
QUOTES = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
PE = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d'
MI_INDEX = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'


def number(value):
    if value is None:
        return None
    cleaned = re.sub(r'<[^>]*>', '', str(value)).replace(',', '').replace('＋', '+').replace('−', '-').strip()
    if cleaned in ('', '-', '--', 'N/A', 'X'):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def label(value):
    return re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', re.sub(r'<[^>]*>', '', str(value)))


def date_string(value):
    s = re.sub(r'\D', '', str(value))
    if len(s) == 8 and int(s[:4]) > 1911:
        return f'{s[:4]}-{s[4:6]}-{s[6:8]}'
    if len(s) == 7:
        return f'{int(s[:3]) + 1911:04d}-{s[3:5]}-{s[5:7]}'
    return None


def field_index(fields, *, include=(), exclude=()):
    for i, raw in enumerate(fields):
        f = label(raw)
        if all(word in f for word in include) and not any(word in f for word in exclude):
            return i
    return None


def value(row, fields, include, exclude=()):
    idx = field_index(fields, include=include, exclude=exclude)
    return number(row[idx]) if idx is not None and idx < len(row) else None


def institutions(payload, day=None):
    if not isinstance(payload, dict) or payload.get('stat') != 'OK':
        return {}
    fields = payload.get('fields') or []
    if not fields or not isinstance(payload.get('data'), list):
        return {}
    ci = field_index(fields, include=('證券代號',))
    ni = field_index(fields, include=('證券名稱',))
    if ci is None or ni is None:
        raise ValueError('T86 column names changed; refusing to store incomplete data')
    result = {}
    for row in payload['data']:
        if len(row) <= max(ci, ni):
            continue
        code = label(row[ci])
        if not re.fullmatch(r'\d{4,6}', code):
            continue
        foreign = {
            'buy': value(row, fields, ('外陸資', '買進')),
            'sell': value(row, fields, ('外陸資', '賣出')),
            'net': value(row, fields, ('外陸資', '買賣超')),
        }
        if foreign['net'] is None:
            foreign = {
                'buy': value(row, fields, ('外資及陸資', '買進')),
                'sell': value(row, fields, ('外資及陸資', '賣出')),
                'net': value(row, fields, ('外資及陸資', '買賣超')),
            }
        trust = {
            'buy': value(row, fields, ('投信', '買進')),
            'sell': value(row, fields, ('投信', '賣出')),
            'net': value(row, fields, ('投信', '買賣超')),
        }
        dealer = {'buy': None, 'sell': None, 'net': None}
        for i, raw in enumerate(fields):
            f = label(raw)
            if not f.startswith('自營商') or '自行買賣' in f or '避險' in f:
                continue
            if '買賣超' in f:
                dealer['net'] = number(row[i])
            elif '買進' in f:
                dealer['buy'] = number(row[i])
            elif '賣出' in f:
                dealer['sell'] = number(row[i])
        if dealer['net'] is None:
            own = value(row, fields, ('自營商自行買賣', '買賣超'))
            hedge = value(row, fields, ('自營商避險', '買賣超'))
            if own is not None and hedge is not None:
                dealer['net'] = own + hedge
        for action, key in [('買進', 'buy'), ('賣出', 'sell')]:
            if dealer[key] is not None:
                continue
            parts = []
            for category in ('自行買賣', '避險'):
                matches = [number(row[i]) for i, raw in enumerate(fields)
                           if label(raw).startswith('自營商') and category in label(raw) and action in label(raw)]
                if matches and matches[0] is not None:
                    parts.append(matches[0])
            if len(parts) == 2:
                dealer[key] = sum(parts)
        if foreign['net'] is None or trust['net'] is None or dealer['net'] is None:
            raise ValueError('T86 institution columns changed; refusing to publish misleading totals')
        result[code] = {'name': str(row[ni]).strip(), 'foreign': foreign, 'trust': trust, 'dealer': dealer}
    return result


def rows_by_code(payload):
    if not isinstance(payload, list):
        raise ValueError('Expected an array from TWSE OpenAPI')
    return {str(x.get('Code', '')).strip(): x for x in payload if isinstance(x, dict) and x.get('Code')}


def extract_quote(row):
    return {
        'open': number(row.get('OpeningPrice')),
        'high': number(row.get('HighestPrice')),
        'low': number(row.get('LowestPrice')),
        'close': number(row.get('ClosingPrice')),
        'volume': number(row.get('TradeVolume')),
    }


def price_rows(payload):
    """Normalize STOCK_DAY rows; reject a changed schema rather than guess."""
    if not isinstance(payload, dict) or payload.get('stat') != 'OK':
        return []
    fields = payload.get('fields') or []
    indexes = {
        'date': field_index(fields, include=('日期',)),
        'volume': field_index(fields, include=('成交股數',)),
        'open': field_index(fields, include=('開盤價',)),
        'high': field_index(fields, include=('最高價',)),
        'low': field_index(fields, include=('最低價',)),
        'close': field_index(fields, include=('收盤價',)),
    }
    if any(v is None for v in indexes.values()):
        raise ValueError('STOCK_DAY column names changed')
    result = []
    for row in payload.get('data') or []:
        parsed = {'date': date_string(row[indexes['date']])}
        parsed.update({key: number(row[idx]) for key, idx in indexes.items() if key != 'date'})
        if parsed['date'] and all(parsed[x] is not None for x in ('open', 'high', 'low', 'close')):
            result.append(parsed)
    return result


def all_market_rows(payload, day):
    """Return all listed OHLC rows from the dated MI_INDEX report."""
    if not isinstance(payload, dict) or payload.get('stat') != 'OK':
        return {}
    for table in payload.get('tables') or []:
        fields = table.get('fields') or []
        required = {
            'code': field_index(fields, include=('證券代號',)),
            'volume': field_index(fields, include=('成交股數',)),
            'open': field_index(fields, include=('開盤價',)),
            'high': field_index(fields, include=('最高價',)),
            'low': field_index(fields, include=('最低價',)),
            'close': field_index(fields, include=('收盤價',)),
        }
        if any(v is None for v in required.values()):
            continue
        result = {}
        for row in table.get('data') or []:
            code = label(row[required['code']])
            if not re.fullmatch(r'\d{4,6}', code):
                continue
            parsed = {'date': day}
            parsed.update({key: number(row[idx]) for key, idx in required.items() if key != 'code'})
            if all(parsed[x] is not None for x in ('open', 'high', 'low', 'close')):
                result[code] = parsed
        if result:
            return result
    raise ValueError('MI_INDEX all-stock OHLC table not found')


def http_json(url, params=None):
    if params:
        url += '?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={'User-Agent': 'TWSE-Flow/2.0 (public-market-research)', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if 'json' not in response.headers.get('content-type', '').lower():
            raise ValueError(f'Non-JSON response from {url.split("?")[0]}')
        return json.load(response)


def load_watchlist():
    raw = json.loads(WATCHLIST.read_text(encoding='utf-8')) if WATCHLIST.exists() else {}
    pages = raw.get('pages')
    if not isinstance(pages, list):
        pages = [{'title': '我的自選股', 'subtitle': '重點觀察清單', 'codes': raw.get('codes', ['2330', '2615'])}]
    clean = []
    for index, page in enumerate(pages[:10], 1):
        if not isinstance(page, dict):
            continue
        codes = [str(code).strip() for code in page.get('codes', [])
                 if re.fullmatch(r'\d{4,6}', str(code).strip())]
        clean.append({
            'title': str(page.get('title') or f'自選股第{index}頁')[:30],
            'subtitle': str(page.get('subtitle') or '每頁最多10支股票')[:60],
            'codes': list(dict.fromkeys(codes))[:10],
        })
    return clean


def main():
    now = dt.datetime.now(TAIPEI)
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    days = old.get('days', {})
    histories = old.get('price_history', {})
    price_sessions = set(old.get('all_price_sessions', []))
    target = now.date()
    changed = False

    lookback = 45 if len(days) < 20 else 7
    for ago in range(lookback, -1, -1):
        day = target - dt.timedelta(days=ago)
        iso = day.isoformat()
        if day.weekday() >= 5 or iso in days or (ago == 0 and now.hour < 18):
            continue
        try:
            parsed = institutions(http_json(T86, {'date': day.strftime('%Y%m%d'), 'selectType': 'ALLBUT0999', 'response': 'json'}), iso)
            if parsed:
                days[iso] = parsed
                changed = True
                print(f'{iso}: {len(parsed)} securities')
        except Exception as exc:
            print(f'{iso}: {exc}')
        time.sleep(0.55)

    latest = max(days) if days else None
    if latest:
        try:
            quote_rows = rows_by_code(http_json(QUOTES))
            pe_rows = rows_by_code(http_json(PE))
            for code, stock in days[latest].items():
                quote = quote_rows.get(code)
                valuation = pe_rows.get(code)
                if quote and (not quote.get('Date') or date_string(quote['Date']) == latest):
                    values = extract_quote(quote)
                    if values['close'] and values['high'] and values['low']:
                        stock['quote'] = values
                if valuation and (not valuation.get('Date') or date_string(valuation['Date']) == latest):
                    stock['pe'] = number(valuation.get('PEratio'))
            changed = True
        except Exception as exc:
            print(f'OpenAPI quote/PE unavailable: {exc}; institution data preserved')

    watchlist_pages = load_watchlist()
    # A single dated MI_INDEX request contains daily OHLC for the whole listed
    # market. This avoids one request per stock and lets every listed security
    # receive KD/Bollinger/support-resistance data after 20 saved sessions.
    for iso in sorted(days)[-60:]:
        if iso in price_sessions:
            continue
        try:
            parsed = all_market_rows(http_json(MI_INDEX, {
                'date': iso.replace('-', ''), 'type': 'ALLBUT0999', 'response': 'json'
            }), iso)
            for code, row in parsed.items():
                merged = {item['date']: item for item in histories.get(code, [])}
                merged[iso] = row
                histories[code] = [merged[key] for key in sorted(merged)[-80:]]
            price_sessions.add(iso)
            changed = True
            print(f'{iso}: {len(parsed)} all-market prices')
        except Exception as exc:
            print(f'{iso} MI_INDEX: {exc}')
        time.sleep(0.55)

    if not days:
        print('No trading session available; existing snapshot preserved')
        return
    old.update({
        'version': '2.0.1',
        'days': {key: days[key] for key in sorted(days)[-100:]},
        'price_history': histories,
        'all_price_sessions': sorted(price_sessions)[-80:],
        'watchlist_pages': watchlist_pages,
        'updated_at': now.isoformat(timespec='seconds'),
        'latest_session': max(days),
    })
    if not changed:
        print('No new data; existing snapshot preserved')
        return
    OUT.parent.mkdir(exist_ok=True)
    temp = OUT.with_suffix('.tmp')
    temp.write_text(json.dumps(old, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    os.replace(temp, OUT)


if __name__ == '__main__':
    main()
