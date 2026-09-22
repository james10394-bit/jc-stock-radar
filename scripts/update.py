#!/usr/bin/env python3
"""Build a dated TWSE snapshot for the static GitHub Pages dashboard."""
import datetime as dt
import concurrent.futures
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'market.json'
WATCHLIST = ROOT / 'data' / 'watchlist.json'
RISK_CONFIG = ROOT / 'data' / 'risk_config.json'
TAIPEI = ZoneInfo('Asia/Taipei')
T86 = 'https://www.twse.com.tw/rwd/zh/fund/T86'
QUOTES = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
PE = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d'
COMPANY_INFO = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
MI_INDEX = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'
YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
GOOGLE_NEWS = 'https://news.google.com/rss/search'
TAIFEX_QUOTES = 'https://mis.taifex.com.tw/futures/api/getQuoteList'

POSITIVE_NEWS = ('上漲', '走高', '降息', '寬鬆', '成長', '優於預期', '突破', '創高', '和平', '停火',
                 'rally', 'gain', 'rate cut', 'growth', 'beats', 'ceasefire', 'peace')
NEGATIVE_NEWS = ('下跌', '重挫', '升息', '衰退', '通膨', '關稅', '制裁', '戰爭', '攻擊', '飛彈', '危機',
                 '跌幅', 'tariff', 'sanction', 'war', 'attack', 'missile', 'crisis', 'recession', 'inflation')
WAR_WORDS = ('戰爭', '開戰', '空襲', '攻擊', '飛彈', '無人機', '入侵', '衝突', '封鎖',
             'war', 'airstrike', 'attack', 'missile', 'drone', 'invasion', 'conflict', 'blockade')
EASING_WORDS = ('停火', '和談', '和平協議', '降溫', '撤軍', 'ceasefire', 'peace talk', 'de-escalation', 'withdrawal')
STRAIT_WORDS = ('台海', '台灣海峽', '解放軍', '軍演', '繞台', '共機', '封鎖台灣', 'taiwan strait',
                'pla drill', 'military exercise', 'blockade taiwan')

INDUSTRY_BUSINESS = {
    '01': ('水泥工業', '水泥、預拌混凝土與建材相關業務'),
    '02': ('食品工業', '食品製造、加工與通路銷售'),
    '03': ('塑膠工業', '塑膠原料、加工品與化工材料'),
    '04': ('紡織纖維', '紡織、成衣、布料與機能材料'),
    '05': ('電機機械', '工業機械、馬達與自動化設備'),
    '06': ('電器電纜', '電線電纜、電力與電器設備'),
    '08': ('玻璃陶瓷', '玻璃、陶瓷與相關建材'),
    '09': ('造紙工業', '紙漿、紙品與包裝材料'),
    '10': ('鋼鐵工業', '鋼鐵冶煉、加工與金屬材料'),
    '11': ('橡膠工業', '輪胎與橡膠製品'),
    '12': ('汽車工業', '汽車、零組件與車用系統'),
    '14': ('建材營造', '建設、營造與不動產開發'),
    '15': ('航運業', '海運、航空、物流與運輸服務'),
    '16': ('觀光餐旅', '旅館、餐飲、觀光與休閒服務'),
    '17': ('金融保險', '銀行、保險、證券與金融服務'),
    '18': ('貿易百貨', '商品貿易、零售與百貨通路'),
    '20': ('其他業', '多元產品製造或專業服務'),
    '21': ('化學工業', '化學材料、原料與特用化學品'),
    '22': ('生技醫療', '藥品、生技、醫材與健康服務'),
    '23': ('油電燃氣', '能源、電力、油品與天然氣'),
    '24': ('半導體業', '晶片設計、製造、封測與半導體供應鏈'),
    '25': ('電腦及週邊', '電腦、伺服器與週邊設備'),
    '26': ('光電業', '面板、光學與光電元件'),
    '27': ('通信網路', '電信、網路與通訊設備服務'),
    '28': ('電子零組件', '電子零組件、連接器與電路板'),
    '29': ('電子通路', '電子零組件代理與通路服務'),
    '30': ('資訊服務', '軟體、系統整合與資訊服務'),
    '31': ('其他電子', '電子製造、設備與其他電子產品'),
    '35': ('綠能環保', '再生能源、節能與環境服務'),
    '36': ('數位雲端', '雲端、數位平台與網路服務'),
    '37': ('運動休閒', '運動器材、休閒產品與服務'),
    '38': ('居家生活', '居家用品、生活消費與相關服務'),
}

BUSINESS_OVERRIDES = {
    '2330': '先進晶圓代工與半導體製造', '2317': '電子製造服務、伺服器與消費電子組裝',
    '2454': '手機與通訊晶片設計', '2308': '電源管理、工業自動化與資料中心設備',
    '2382': '電腦、伺服器與雲端設備製造', '2412': '行動通訊、固網與網路服務',
    '6505': '石化、塑膠原料與能源相關業務', '2603': '國際貨櫃海運與物流',
    '2609': '國際貨櫃海運與碼頭物流', '2615': '國際貨櫃海運與物流服務',
    '2605': '散裝航運與船舶代理', '2606': '貨櫃海運與物流服務',
    '2612': '港埠、貨櫃碼頭與物流服務', '2618': '航空客貨運與航空服務',
    '2637': '散裝航運與船舶運輸', '2303': '晶圓代工與半導體製造',
    '2379': 'IC 設計與記憶體相關晶片', '3037': '印刷電路板與高階載板',
    '3231': '電腦、伺服器與電子製造服務', '6669': '伺服器管理晶片設計',
    '2368': '印刷電路板製造', '2344': '記憶體晶片製造',
    '3443': 'IC 設計與高速傳輸晶片', '3661': '高階覆晶封裝基板',
    '3017': '伺服器機殼、散熱與機構件', '4958': '連接器、線材與電子零組件',
}


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


def company_profiles(payload):
    """Build concise company descriptions from the official listed-company registry."""
    if not isinstance(payload, list):
        raise ValueError('Expected company profile array from TWSE OpenAPI')
    result = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        code = str(row.get('公司代號', '')).strip()
        if not re.fullmatch(r'\d{4,6}', code):
            continue
        industry_code = str(row.get('產業別', '')).strip().zfill(2)
        industry, generic = INDUSTRY_BUSINESS.get(industry_code, ('其他業', '多元產品製造或專業服務'))
        result[code] = {
            'name': str(row.get('公司簡稱') or row.get('公司名稱') or '').strip(),
            'full_name': str(row.get('公司名稱') or '').strip(),
            'industry': industry,
            'business': BUSINESS_OVERRIDES.get(code, generic),
            'chairman': str(row.get('董事長') or '').strip(),
            'general_manager': str(row.get('總經理') or '').strip(),
            'established': date_string(row.get('成立日期')),
            'listed': date_string(row.get('上市日期')),
            'capital': number(row.get('實收資本額')),
            'website': str(row.get('網址') or '').strip(),
            'address': str(row.get('住址') or '').strip(),
        }
    if not result:
        raise ValueError('No company profiles returned by TWSE OpenAPI')
    return result


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


def http_post_json(url, payload):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(url, data=body, method='POST', headers={
        'User-Agent': 'Mozilla/5.0 TWSE-Flow/2.4.2',
        'Accept': 'application/json', 'Content-Type': 'application/json',
        'Origin': 'https://mis.taifex.com.tw',
        'Referer': 'https://mis.taifex.com.tw/futures/RegularSession/EquityIndices/FuturesDomestic/',
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        if 'json' not in response.headers.get('content-type', '').lower():
            raise ValueError('Non-JSON response from TAIFEX quote service')
        return json.load(response)


def parse_taifex_night(payload, now):
    """Select the active nearest-month TX future from the official quote list."""
    rows = ((payload or {}).get('RtData') or {}).get('QuoteList') or []
    candidates = []
    for row in rows:
        symbol = str(row.get('SymbolID') or '')
        last_price, volume = number(row.get('CLastPrice')), number(row.get('CTotalVolume'))
        if symbol.startswith('TXF') and symbol.endswith('-M') and last_price not in (None, 0):
            candidates.append((volume or 0, row, last_price))
    if not candidates:
        raise ValueError('No active TX nearest-month quote returned')
    _, row, last_price = max(candidates, key=lambda item: item[0])
    reference = number(row.get('CRefPrice'))
    change = number(row.get('CDiff'))
    if change is None and reference is not None:
        change = last_price - reference
    change_pct = number(row.get('CDiffRate'))
    if change_pct is None and reference:
        change_pct = change / reference * 100
    raw_time = re.sub(r'\D', '', str(row.get('CTime') or ''))
    quote_time = ':'.join([raw_time[:2], raw_time[2:4], raw_time[4:6]]) if len(raw_time) >= 6 else str(row.get('CTime') or '')
    weekday, hour = now.weekday(), now.hour
    is_open = (weekday <= 4 and hour >= 15) or (1 <= weekday <= 5 and hour < 5)
    return {
        'contract': str(row.get('DispCName') or row.get('SymbolName') or '近月臺股期貨'),
        'symbol': str(row.get('SymbolID') or ''), 'last': round(last_price, 2),
        'reference': reference, 'change': round(change, 2) if change is not None else None,
        'change_pct': round(change_pct, 2) if change_pct is not None else None,
        'open': number(row.get('COpenPrice')), 'high': number(row.get('CHighPrice')),
        'low': number(row.get('CLowPrice')), 'volume': number(row.get('CTotalVolume')),
        'quote_date': date_string(row.get('CDate')), 'quote_time': quote_time,
        'session': '夜盤交易中' if is_open else '最近夜盤收盤',
        'updated_at': now.isoformat(timespec='seconds'),
        'source_url': 'https://mis.taifex.com.tw/futures/RegularSession/EquityIndices/FuturesDomestic/',
    }


def fetch_taifex_night(now):
    payload = http_post_json(TAIFEX_QUOTES, {
        'MarketType': '1', 'SymbolType': 'F', 'KindID': '1', 'CID': '', 'ExpireMonth': ''
    })
    return parse_taifex_night(payload, now)


def market_indicator(symbol, name):
    payload = http_json(YAHOO_CHART + urllib.parse.quote(symbol), {
        'range': '10d', 'interval': '1d', 'events': 'history'
    })
    result = payload['chart']['result'][0]
    meta = result.get('meta') or {}
    closes = [x for x in result['indicators']['quote'][0]['close'] if x is not None]
    price = number(meta.get('regularMarketPrice')) or (closes[-1] if closes else None)
    previous = number(meta.get('chartPreviousClose')) or (closes[-2] if len(closes) >= 2 else None)
    if price is None or previous in (None, 0):
        raise ValueError(f'{name} data unavailable')
    change = (price / previous - 1) * 100
    now_ts = int(dt.datetime.now(dt.timezone.utc).timestamp())
    periods = meta.get('currentTradingPeriod') or {}
    state = 'CLOSED'
    for key, label_name in [('pre', 'PRE'), ('regular', 'REGULAR'), ('post', 'POST')]:
        period = periods.get(key) or {}
        if period.get('start', 0) <= now_ts <= period.get('end', -1):
            state = label_name
            break
    quote_time = number(meta.get('regularMarketTime'))
    asof = dt.datetime.fromtimestamp(quote_time, TAIPEI).isoformat(timespec='minutes') if quote_time else None
    return {'name': name, 'symbol': symbol, 'close': round(price, 2), 'previous_close': round(previous, 2),
            'change_pct': round(change, 2), 'market_state': state, 'asof': asof}


def news_score(title):
    text = title.lower()
    positive = sum(1 for word in POSITIVE_NEWS if word in text)
    negative = sum(1 for word in NEGATIVE_NEWS if word in text)
    return max(-3, min(3, positive - negative))


def nth_weekday(year, month, weekday, nth):
    day = dt.date(year, month, 1)
    return day + dt.timedelta(days=(weekday - day.weekday()) % 7 + 7 * (nth - 1))


def last_weekday(year, month, weekday):
    first_next = dt.date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    day = first_next - dt.timedelta(days=1)
    return day - dt.timedelta(days=(day.weekday() - weekday) % 7)


def observed(day):
    if day.weekday() == 5:
        return day - dt.timedelta(days=1)
    if day.weekday() == 6:
        return day + dt.timedelta(days=1)
    return day


def easter_date(year):
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f, g = (b + 8) // 25, (b - (b + 8) // 25 + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    return dt.date(year, month, (h + l - 7 * m + 114) % 31 + 1)


def us_holidays(year):
    holidays = {
        observed(dt.date(year, 1, 1)): ('美國元旦', True),
        nth_weekday(year, 1, 0, 3): ('馬丁路德金恩紀念日', True),
        nth_weekday(year, 2, 0, 3): ('美國總統日', True),
        easter_date(year) - dt.timedelta(days=2): ('美股耶穌受難日休市', True),
        last_weekday(year, 5, 0): ('美國陣亡將士紀念日', True),
        observed(dt.date(year, 6, 19)): ('六月節', True),
        observed(dt.date(year, 7, 4)): ('美國獨立紀念日', True),
        nth_weekday(year, 9, 0, 1): ('美國勞動節', True),
        nth_weekday(year, 10, 0, 2): ('哥倫布日／原住民族日', False),
        observed(dt.date(year, 11, 11)): ('美國退伍軍人節', False),
        nth_weekday(year, 11, 3, 4): ('美國感恩節', True),
        observed(dt.date(year, 12, 25)): ('美國聖誕節', True),
    }
    return holidays


def risk_block(news, category, words):
    selected = [item for item in news if item['category'] == category]
    points = 0
    for item in selected:
        text = item['title'].lower()
        points += sum(1 for word in words if word in text)
        points -= sum(1 for word in EASING_WORDS if word in text)
    points = max(0, points)
    level = '高' if points >= 6 else '中' if points >= 3 else '低'
    return {'level': level, 'points': points, 'impact': -min(15, points * 2), 'headlines': len(selected)}


def fetch_global_context(now):
    indicators = []
    for symbol, name in [('^GSPC', 'S&P 500'), ('^IXIC', 'NASDAQ'), ('^DJI', '道瓊'), ('^VIX', 'VIX恐慌指數')]:
        try:
            indicators.append(market_indicator(symbol, name))
        except Exception as exc:
            print(f'{name}: {exc}')
        time.sleep(0.2)

    topics = [
        ('全球市場', '台股 美股 半導體 全球股市 when:1d'),
        ('川普政策', 'Trump tariff trade Taiwan semiconductor when:1d'),
        ('全球戰爭', 'global war missile attack ceasefire oil market when:1d'),
        ('台海風險', '台海 台灣海峽 解放軍 軍演 封鎖 Taiwan Strait when:2d'),
    ]
    news = []
    for category, query in topics:
        try:
            url = GOOGLE_NEWS + '?' + urllib.parse.urlencode({'q': query, 'hl': 'zh-TW', 'gl': 'TW', 'ceid': 'TW:zh-Hant'})
            request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 TWSE-Flow/2.1'})
            with urllib.request.urlopen(request, timeout=25) as response:
                root = ET.fromstring(response.read())
            for item in root.findall('./channel/item')[:6]:
                title = (item.findtext('title') or '').strip()
                if title:
                    news.append({'category': category, 'title': title, 'url': item.findtext('link') or '',
                                 'published': item.findtext('pubDate') or '', 'score': news_score(title)})
        except Exception as exc:
            print(f'{category} news: {exc}')

    raw = 0.0
    for item in indicators:
        change = item['change_pct'] * (-1 if item['symbol'] == '^VIX' else 1)
        raw += max(-4, min(4, change)) * 3
    raw += sum(item['score'] for item in news) * 1.4
    war = risk_block(news, '全球戰爭', WAR_WORDS)
    strait = risk_block(news, '台海風險', STRAIT_WORDS + WAR_WORDS)
    raw += war['impact'] + strait['impact']
    weekday = now.weekday()
    holiday = {'label': '一般交易週', 'score': 0}
    holiday_factors = []
    config = json.loads(RISK_CONFIG.read_text(encoding='utf-8')) if RISK_CONFIG.exists() else {}
    upcoming = []
    for raw_date, name in (config.get('tw_holidays') or config.get('holidays') or {}).items():
        try:
            day = dt.date.fromisoformat(raw_date)
            gap = (day - now.date()).days
            if 0 <= gap <= 7:
                upcoming.append((gap, day, str(name), '台灣', True))
        except (TypeError, ValueError):
            continue
    for year in {now.year, now.year + 1}:
        for day, (name, market_closed) in us_holidays(year).items():
            gap = (day - now.date()).days
            if 0 <= gap <= 7:
                upcoming.append((gap, day, name, '美國', market_closed))
    if upcoming:
        for gap, day, name, country, market_closed in sorted(upcoming):
            score = -6 if country == '台灣' and gap <= 3 else -4 if market_closed and gap <= 3 else -2
            status = '市場休市' if market_closed else '國定假日（美股照常交易）'
            holiday_factors.append({'country': country, 'date': day.isoformat(), 'name': name,
                                    'days_away': gap, 'market_closed': market_closed, 'score': score,
                                    'label': f'{country}｜{name}｜{status}｜距今{gap}天'})
            raw += score
        holiday = {'label': holiday_factors[0]['label'], 'score': sum(x['score'] for x in holiday_factors)}
    elif weekday == 4:
        holiday = {'label': '週末前風險：留意兩日休市期間消息', 'score': -3}
        raw -= 3
    buy = round(max(10, min(90, 50 + raw)))
    return {'updated_at': now.isoformat(timespec='seconds'), 'buy_percent': buy, 'sell_percent': 100 - buy,
            'holiday_factor': holiday, 'holiday_factors': holiday_factors, 'indicators': indicators, 'news': news[:16],
            'risk_analysis': {'global_war': war, 'taiwan_strait': strait},
            'method': '美股指數日變動、VIX、美台假日、全球戰爭與台海新聞關鍵字之規則式評分'}


def fetch_stock_news(codes, profiles, stocks, now, previous=None):
    """Fetch compact Google News RSS snapshots for configured watchlist stocks."""
    result = dict(previous or {})
    unique_codes = list(dict.fromkeys(codes))[:50]

    def fetch_one(code):
        profile = profiles.get(code) or {}
        stock = stocks.get(code) or {}
        name = str(stock.get('name') or profile.get('name') or code).strip()
        try:
            query = f'"{name}" {code} 股票 when:3d'
            url = GOOGLE_NEWS + '?' + urllib.parse.urlencode({
                'q': query, 'hl': 'zh-TW', 'gl': 'TW', 'ceid': 'TW:zh-Hant'
            })
            request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 TWSE-Flow/2.4.3'})
            with urllib.request.urlopen(request, timeout=15) as response:
                root = ET.fromstring(response.read())
            items, seen = [], set()
            for item in root.findall('./channel/item'):
                title = (item.findtext('title') or '').strip()
                link = (item.findtext('link') or '').strip()
                if not title or title in seen:
                    continue
                seen.add(title)
                items.append({'title': title, 'url': link, 'published': item.findtext('pubDate') or ''})
                if len(items) >= 5:
                    break
            return code, {'updated_at': now.isoformat(timespec='seconds'), 'items': items}, None
        except Exception as exc:
            return code, None, f'{code} {name} news: {exc}'

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for code, snapshot, error in pool.map(fetch_one, unique_codes):
            if snapshot is not None:
                result[code] = snapshot
            elif error:
                print(error)
    return result


def is_recent_timestamp(value, now, minutes=60):
    try:
        stamp = dt.datetime.fromisoformat(str(value))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=TAIPEI)
        return dt.timedelta(0) <= now - stamp < dt.timedelta(minutes=minutes)
    except (TypeError, ValueError):
        return False


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
    try:
        profiles = company_profiles(http_json(COMPANY_INFO))
        changed = True
    except Exception as exc:
        print(f'Company profiles unavailable: {exc}')
        profiles = old.get('company_profiles', {})
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
    try:
        night_futures = fetch_taifex_night(now)
        changed = True
    except Exception as exc:
        print(f'TAIFEX night quote unavailable: {exc}')
        night_futures = old.get('night_futures', {})
    try:
        global_context = fetch_global_context(now)
        changed = True
    except Exception as exc:
        print(f'Global context unavailable: {exc}')
        global_context = old.get('global_context', {})
    stock_news = old.get('stock_news', {})
    stock_news_updated_at = old.get('stock_news_updated_at')
    if not stock_news or not is_recent_timestamp(stock_news_updated_at, now):
        news_codes = [code for page in watchlist_pages for code in page.get('codes', [])]
        try:
            stock_news = fetch_stock_news(news_codes, profiles, days.get(latest, {}), now, stock_news)
            stock_news_updated_at = now.isoformat(timespec='seconds')
            changed = True
        except Exception as exc:
            print(f'Stock news unavailable: {exc}')
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
        'version': '2.4.3',
        'days': {key: days[key] for key in sorted(days)[-100:]},
        'price_history': histories,
        'all_price_sessions': sorted(price_sessions)[-80:],
        'watchlist_pages': watchlist_pages,
        'company_profiles': profiles,
        'night_futures': night_futures,
        'global_context': global_context,
        'stock_news': stock_news,
        'stock_news_updated_at': stock_news_updated_at,
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
