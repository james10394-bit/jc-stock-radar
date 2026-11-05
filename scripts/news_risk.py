"""RSS title/summary signals, not verified geopolitical facts or probabilities."""
import datetime as dt
import html
import re
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

TOPICS = [
    ('全球市場', '(台股 OR 美股 OR 半導體 OR 全球股市) when:1d'),
    ('川普政策', '(川普 OR Trump) (關稅 OR tariff OR 貿易 OR trade) when:2d'),
    ('全球戰爭', '(空襲 OR 突襲 OR 飛彈 OR 戰爭 OR 停火 OR airstrike) (伊朗 OR 以色列 OR 烏克蘭 OR 中東 OR Iran OR Ukraine) when:2d'),
    ('台海風險', '(台海 OR 臺海 OR 台灣海峽 OR 臺灣海峽 OR "Taiwan Strait" OR 共機 OR 繞台 OR 環台) when:2d'),
    ('美國選舉', '("美國期中選舉" OR "美國中期選舉" OR "美國選舉" OR "US midterm" OR "U.S. election") when:2d'),
]
GEO = ('伊朗','以色列','烏克蘭','俄羅斯','中東','荷莫茲','荷姆茲','紅海','美軍','iran','israel','ukraine','russia','middle east','hormuz')
STRAIT = ('台海','臺海','台灣海峽','臺灣海峽','taiwan strait','共機','繞台','環台','封鎖台灣','封鎖臺灣')
ACTION = ('空襲','突襲','軍事打擊','飛彈','導彈','入侵','開戰','戰事','戰爭','戰火','武裝衝突','開火','airstrike','missile','invasion','military strike','war')
SEVERE = ('空襲','突襲','軍事打擊','入侵','airstrike','invasion','military strike')
DRILL = ('解放軍','軍演','共機','繞台','環台','封鎖','飛彈','軍機','drill','missile','blockade')
EASING = ('停火','和談','和平協議','撤軍','ceasefire','peace talk','withdrawal')
DENIAL = ('否認','不實','假消息','謠言','闢謠','未證實','查無','denies','false claim','unverified')

def has(text, words):
    # English keywords match word boundaries, so "war" does not match "Taiwan".
    return [w for w in words if (bool(re.search(r'\b'+re.escape(w)+r'\b', text, re.I)) if w.isascii() else w in text)]

def clean(value):
    text = re.sub(r'<[^>]+>', ' ', str(value or ''))
    return re.sub(r'\s+', ' ', html.unescape(text)).strip()

def publication(value):
    try:
        stamp = parsedate_to_datetime(value)
        return stamp.replace(tzinfo=dt.timezone.utc) if stamp.tzinfo is None else stamp
    except (TypeError, ValueError, OverflowError):
        return None

def classify(item):
    title, summary = clean(item.get('title')), clean(item.get('summary'))
    text = (title+' '+summary).lower()
    tags = []
    if has(text,GEO) and (has(text,ACTION) or has(text,EASING)):
        tags.append('全球戰爭')
    if has(text,STRAIT):
        tags.append('台海風險')
    if has(text,('選舉','開票','計票','election','midterm')) and has(text,('美國','美國期中','美國中期','共和黨','民主黨','川普','trump','u.s.','us midterm','republican','democrat')):
        tags.append('美國選舉')
    return tags

def merge_items(items, now):
    """Deduplicate syndication and keep only dated observations up to 48h old."""
    merged = {}
    for source in items:
        item = dict(source)
        stamp = publication(item.get('published'))
        if not stamp:
            continue
        age = (now-stamp).total_seconds()
        if not -300 <= age <= 48*3600:
            continue
        item['title'] = clean(item.get('title'))[:500]
        if not item['title']:
            continue
        item['summary'] = clean(item.get('summary'))[:1500]
        key = re.sub(r'\s*-\s*[^-]+$', '', item['title']).casefold()
        previous = merged.get(key)
        categories = set(item.get('query_categories', [])) | {item.get('category','全球市場')}
        if previous:
            categories.update(previous.get('query_categories', []))
            if previous.get('cached') and not item.get('cached'):
                pass
            else:
                item = previous
        item['query_categories'] = sorted(categories)
        item['tags'] = classify(item)
        item['category'] = '／'.join(item['tags']) if item['tags'] else item.get('category','全球市場')
        item['published_at'] = stamp.isoformat()
        item['verification'] = '媒體報導／標題與RSS摘要，未獨立核實'
        merged[key] = item
    return sorted(merged.values(), key=lambda x:x.get('published_at',''), reverse=True)

def risk_block(news, category, fetch_status=None, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    selected = []
    for item in news:
        stamp = publication(item.get('published'))
        if not stamp or not -300 <= (now-stamp).total_seconds() <= 48*3600:
            continue
        if category in classify(item):
            selected.append(item)
    live = [item for item in selected if not item.get('cached')]
    feed = (fetch_status or {}).get(category, {})
    if not live:
        if selected:
            state, level, why = 'stale','資料待更新','僅有前次快取，不能當成本輪新資料'
        elif feed.get('status') == 'ok':
            state, level, why = 'unmatched','未檢出','本輪標題／摘要未檢出相關訊號，不代表風險低'
        else:
            state, level, why = 'unavailable','資料不足','專題新聞抓取失敗、為空或缺少有效發布日期'
        return {'status':state,'level':level,'points':None,'impact':None,'usable':False,
                'headlines':len(selected),'reason':why,'evidence':selected[:4]}
    evidence, maximum = [], 0
    for item in live:
        text = clean(item.get('title')).lower()+' '+clean(item.get('summary')).lower()
        action = has(text,ACTION if category=='全球戰爭' else DRILL+ACTION)
        severe = has(text,SEVERE)
        denial = has(text,DENIAL)
        points = 0 if category=='美國選舉' or denial else 4 if severe else 3 if action else 1 if has(text,EASING) else 0
        maximum = max(maximum,points)
        evidence.append({**item,'signal_points':points,'matched_words':list(dict.fromkeys(action+has(text,EASING))),
                         'evidence_status':'含否認或未證實語句，待人工查核' if denial else '僅媒體報導，待人工查核'})
    evidence.sort(key=lambda x:x['signal_points'], reverse=True)
    # Use maximum signal severity; repeated headlines do not multiply risk.
    impact = -min(15, maximum*3) if maximum>=3 else 0
    return {'status':'partial' if feed.get('status')!='ok' else 'observed',
            'level':'事件觀察' if category=='美國選舉' else '高' if maximum>=4 else '中' if maximum>=3 else '待查核',
            'points':maximum,'impact':impact,'usable':maximum>=3,'headlines':len(live),
            'reason':'標題／摘要訊號，非事件事實查核；停火標題不抵銷同時存在的攻擊訊號',
            'evidence':evidence[:4]}


def election_calendar(now):
    """Official scheduled dates only. No inferred winner, seat total or results."""
    local = now.astimezone(ZoneInfo('America/New_York'))
    events = []
    dates = [('2026-11-03','美國期中選舉','https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/'),
             ('2028-11-07','美國聯邦大選','https://www.fec.gov/help-candidates-and-committees/filing-reports/election-cycle-aggregation/')]
    for date, name, source in dates:
        gap = (dt.date.fromisoformat(date)-local.date()).days
        events.append({'name':name,'date':date,'timezone':'America/New_York','days_until':gap,
                       'phase':'選前觀察' if gap>0 else '投票日／計票觀察' if gap==0 else '選後結果待核實',
                       'risk_watch':-3<=gap<=7,'calendar_verified':True,'source':source,
                       'results_status':'本系統未核實勝方、席次與最終認證結果',
                       'note':'投票日期依美國當地，各州投票時間不同；台灣日期可能已是次日。'})
    relevant = [e for e in events if e['days_until']>=-7]
    return {'checked_at':now.isoformat(timespec='seconds'),'us_eastern_time':local.isoformat(timespec='seconds'),
            'events':relevant,'focus':relevant[0] if relevant else None,
            'policy_watch':['國會席次','關稅與對中政策','晶片補助','能源政策'],
            'analysis_limit':'只追蹤已確認日程及媒體報導，不以選舉日期猜測勝方或股票漲跌。'}
