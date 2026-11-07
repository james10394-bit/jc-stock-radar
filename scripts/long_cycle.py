"""TAIEX 1990+ research. Standard library only; no trade signals from long waves."""
import calendar
import datetime as dt
import json
import math
import statistics
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE = 'https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date='
SOURCE_PAGE = 'https://www.twse.com.tw/zh/trading/historical/fmtqik.html'
PERIODS = (40, 50, 60)  # predeclared sensitivity cases, never optimized
ROOT = Path(__file__).resolve().parents[1]


def parse_month(payload, year, month, today):
    if payload.get('stat') != 'OK':
        raise ValueError('Official monthly report unavailable')
    fields = payload.get('fields', [])
    ci = fields.index('發行量加權股價指數')
    di = fields.index('日期')
    rows = []
    for row in payload.get('data', []):
        y, m, d = map(int, row[di].strip().split('/'))
        date = dt.date(y + 1911 if y < 1911 else y, m, d)
        close = float(str(row[ci]).replace(',', ''))
        if (date.year, date.month) != (year, month) or date > today:
            raise ValueError('Unexpected or future report date')
        if not math.isfinite(close) or close <= 0:
            raise ValueError('Invalid close')
        rows.append({'date': date.isoformat(), 'close': close})
    if not rows or len({r['date'] for r in rows}) != len(rows):
        raise ValueError('Empty or duplicate monthly report')
    return sorted(rows, key=lambda r: r['date'])


def years(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days / 365.2425


def monthly_rows(daily, today):
    # Only finished calendar months. Never silently use a partial month as month-end.
    out = {}
    for r in daily:
        if r['date'][:7] < today.strftime('%Y-%m'):
            out[r['date'][:7]] = r
    return [out[k] for k in sorted(out)]


def drawdown(rows):
    peak = rows[0]
    worst = {'pct': 0., 'peak_date': peak['date'], 'trough_date': peak['date'], 'peak_close': peak['close'], 'recovery_date': None}
    for r in rows:
        if r['close'] > peak['close']:
            peak = r
        loss = 100 * (r['close'] / peak['close'] - 1)
        if loss < worst['pct']:
            worst = {'pct': loss, 'peak_date': peak['date'], 'trough_date': r['date'], 'peak_close': peak['close'], 'recovery_date': None}
    worst['recovery_date'] = next((r['date'] for r in rows if r['date'] > worst['trough_date'] and r['close'] >= worst['peak_close']), None)
    return worst


def fit(rows, period=None):
    """OLS log(P)=a+b*t+c*sin(2pi*t/T)+d*cos(...), QR via MGS."""
    origin = rows[0]['date']
    ts = [years(origin, r['date']) for r in rows]
    ys = [math.log(r['close']) for r in rows]
    def features(t):
        return [1., t] + ([math.sin(2*math.pi*t/period), math.cos(2*math.pi*t/period)] if period else [])
    cols = list(map(list, zip(*(features(t) for t in ts))))
    n = len(cols)
    q, upper = [], [[0.]*n for _ in range(n)]
    for j, col in enumerate(cols):
        v = col[:]
        for i in range(j):
            upper[i][j] = sum(a*b for a, b in zip(q[i], v))
            v = [a-upper[i][j]*b for a, b in zip(v, q[i])]
        norm = math.sqrt(sum(a*a for a in v))
        if norm < 1e-9:
            raise ValueError('Unidentified regression')
        upper[j][j] = norm
        q.append([a/norm for a in v])
    rhs = [sum(a*b for a,b in zip(col,ys)) for col in q]
    beta = [0.]*n
    for i in reversed(range(n)):
        beta[i] = (rhs[i]-sum(upper[i][j]*beta[j] for j in range(i+1,n)))/upper[i][i]
    def predict(date):
        return sum(a*b for a,b in zip(beta, features(years(origin,date))))
    residual = sum((y-predict(r['date']))**2 for y,r in zip(ys,rows))
    mean_y = statistics.mean(ys)
    total = sum((y-mean_y)**2 for y in ys)
    t = ts[-1]
    slope = (2*math.pi/period)*(beta[2]*math.cos(2*math.pi*t/period)-beta[3]*math.sin(2*math.pi*t/period)) if period else None
    return {'predict': predict, 'r2': 1-residual/total if total else None, 'wave_slope': slope}


def backtest(rows, horizon):
    # Non-overlapping outcomes per horizon; each origin refits only prior data.
    results = {str(p): [] for p in PERIODS}
    results.update({'trend': [], 'last': []})
    for end in range(180, len(rows)-horizon+1, horizon):
        train, actual = rows[:end], rows[end+horizon-1]
        target = math.log(actual['close'])
        results['last'].append(abs(math.log(train[-1]['close'])-target)*100)
        results['trend'].append(abs(fit(train)['predict'](actual['date'])-target)*100)
        for p in PERIODS:
            results[str(p)].append(abs(fit(train,p)['predict'](actual['date'])-target)*100)
    return {'horizon_months': horizon, 'origins': len(results['last']), 'first_training_months': 180,
            'metric': 'mean_absolute_log_error_times_100',
            'mae': {k: statistics.mean(v) if v else None for k,v in results.items()}}


def percentile(values, q):
    ordered = sorted(values)
    at = (len(ordered)-1)*q
    lo, hi = math.floor(at), math.ceil(at)
    return ordered[lo] + (ordered[hi]-ordered[lo])*(at-lo)


def analyze(daily, today):
    daily = sorted(daily, key=lambda r:r['date'])
    if len({r['date'] for r in daily}) != len(daily):
        raise ValueError('Duplicate date')
    if any(r['date'] > today.isoformat() or not math.isfinite(r['close']) or r['close'] <= 0 for r in daily):
        raise ValueError('Invalid input')
    monthly = monthly_rows(daily,today)
    expected = [(y,m) for y in range(1990,today.year+1) for m in range(1,13) if (y,m)<(today.year,today.month)]
    observed = {tuple(map(int,r['date'][:7].split('-'))) for r in monthly}
    missing = [f'{y}-{m:02d}' for y,m in expected if (y,m) not in observed]
    coverage = {'expected_complete_months': len(expected), 'complete_months': len(observed), 'missing_months':missing,
                'daily_rows':len(daily), 'start':daily[0]['date'] if daily else None, 'end':daily[-1]['date'] if daily else None}
    if not daily or missing or len(monthly)<180:
        return {'coverage':coverage, 'status':'incomplete', 'conclusion':'歷史月份不完整，暫停康波與長期推估；缺漏不插值。'}
    span = years(daily[0]['date'],daily[-1]['date'])
    completed_span = years(monthly[0]['date'], monthly[-1]['date'])
    close = monthly[-1]['close']
    ma24 = statistics.mean(r['close'] for r in monthly[-24:])
    ma60 = statistics.mean(r['close'] for r in monthly[-60:])
    old24 = statistics.mean(r['close'] for r in monthly[-30:-6])
    if close>ma24 and close>ma60 and ma24>old24:
        regime, conclusion = 'expansion', '已完成月線仍偏多；長期趨勢向上，但未證實是康波上升期，需注意回撤與估值。'
    elif close<ma24 and close<ma60 and ma24<old24:
        regime, conclusion = 'contraction', '已完成月線偏弱；中長期價格趨勢轉弱，尚不能用康波認定已到長期底部。'
    else:
        regime, conclusion = 'transition', '長短期月線未一致，屬轉折觀察；無法從康波單獨判定下一波多空。'
    current_change = 100*(daily[-1]['close']/close-1)
    if current_change <= -10:
        conclusion += f' 最新收盤較前月底已跌{abs(current_change):.2f}%，本月回撤警戒，不能沿用上月底偏多訊號作為買進依據。'
    elif current_change >= 10:
        conclusion += f' 最新收盤較前月底已漲{current_change:.2f}%，短期急漲與追價風險另行觀察。'
    hypotheses = []
    for p in PERIODS:
        full = fit(monthly,p)
        sensitive = []
        for start in (1990,1995,2000):
            sub = [r for r in monthly if int(r['date'][:4]) >= start]
            model = fit(sub,p)
            sensitive.append({'start_year':start,'wave_slope':model['wave_slope'], 'direction':'上行' if model['wave_slope']>0 else '下行'})
        hypotheses.append({'period_years':p,'observed_cycles':completed_span/p,'r2_in_sample':full['r2'],
                           'endpoint_sensitivity':sensitive, 'identified':False})
    windows=[]
    for horizon in (12,36,60):
        returns=[(monthly[i]['close']/monthly[i-horizon]['close']-1)*100 for i in range(horizon,len(monthly))]
        windows.append({'months':horizon,'overlapping_windows':len(returns),'p10':percentile(returns,.1),'median':statistics.median(returns),
                        'p90':percentile(returns,.9),'negative_frequency_pct':100*sum(r<0 for r in returns)/len(returns)})
    decades=[]
    for start,end in ((1990,1999),(2000,2009),(2010,2019),(2020,today.year)):
        sample=[r for r in daily if start<=int(r['date'][:4])<=end]
        baseline=next((r for r in reversed(daily) if int(r['date'][:4])<start),sample[0])
        decades.append({'label':f'{start}–{end}', 'start':baseline['date'],'end':sample[-1]['date'],
                        'price_change_pct':100*(sample[-1]['close']/baseline['close']-1), 'drawdown':drawdown(sample)})
    return {'status':'research_only','coverage':coverage,'years':span,'complete_month_end':monthly[-1]['date'],
            'price_cagr_pct':100*((daily[-1]['close']/daily[0]['close'])**(1/span)-1),
            'max_drawdown':drawdown(daily), 'regime':regime,'conclusion':conclusion,
            'latest':daily[-1], 'trend':{'close':close,'ma24':ma24,'ma60':ma60,'ma24_slope_6m_pct':100*(ma24/old24-1),'current_month_change_pct':current_change},
            'hypotheses':hypotheses,'walk_forward':[backtest(monthly,h) for h in (12,36)],
            'historical_return_windows':windows, 'decades':decades,
            'identification':'insufficient_complete_long_cycles', 'macro_inputs_included':[],
            'forecast_price_target':None,'forecast_probability':None,
            'limitations':['1990年至今未涵蓋一個完整40–60年長波，無法識別康波期別。',
                          '價格指數不含股息再投入、通膨、交易成本；不是實質總報酬。',
                          '尚未納入長期GDP、CPI、利率、信貸、企業獲利與估值；不能稱為已驗證的總體康波模型。',
                          '固定週期擬合與起點敏感度只做假說診斷，樣本內R²不是預測能力；未最佳化週期。',
                          '歷史來源混用證交所與Yahoo Finance，重疊資料核對後優先保留證交所；仍可能有供應商差異與修訂。',
                          '月資料不插值；本月尚未完成，從週期擬合與月線判斷排除。官方日資料是否漏日須另對交易日曆核對。',
                          '滾動報酬窗彼此重疊，不是獨立樣本，也不是未來機率。']}


def build(daily, now, errors=None):
    return {'schema_version':1,'method_version':'2.7.0','generated_at':now.isoformat(timespec='seconds'),
            'source':SOURCE_PAGE, 'sources':[{'name':'TWSE','url':SOURCE_PAGE},{'name':'Yahoo Finance','url':'https://finance.yahoo.com/quote/%5ETWII/history/'}],
            'source_counts':{name:sum(r.get('source')==name for r in daily) for name in ('TWSE','Yahoo Finance')},'source_endpoint':SOURCE+'YYYYMM01', 'instrument':'TAIEX price index',
            'fetch_errors':errors or [],'daily':daily,'analysis':analyze(daily,now.date())}


def refresh(existing=None, now=None, seed_path=None):
    now = now or dt.datetime.now(ZoneInfo('Asia/Taipei'))
    seed_path = seed_path or ROOT/'data'/'longterm.json'
    candidates = [d for d in (existing,) if d and d.get('daily')]
    if seed_path.exists():
        seed=json.loads(seed_path.read_text(encoding='utf-8'))
        if seed.get('daily'):candidates.append(seed)
    if not candidates:
        raise ValueError('Missing official 1990+ seed; run bootstrap separately')
    base=max(candidates,key=lambda d:(len(d['daily']),d['daily'][-1]['date']))
    merged = {r['date']:r for r in base['daily'] if r['date']<=now.date().isoformat()}
    errors=[]
    last_month=now.date().replace(day=1)-dt.timedelta(days=1)
    for year,month in ((last_month.year,last_month.month),(now.year,now.month)):
        try:
            with urllib.request.urlopen(SOURCE+f'{year}{month:02d}01',timeout=15) as response:
                payload=json.load(response)
            rows=parse_month(payload,year,month,now.date())
            for row in rows:row['source']='TWSE'
            # Replace the authoritative month as a whole, preserving all other months.
            for key in list(merged):
                if key.startswith(f'{year}-{month:02d}'):del merged[key]
            merged.update({r['date']:r for r in rows})
        except Exception as exc:
            errors.append(f'{year}-{month:02d}: {type(exc).__name__}: {exc}')
    result=build([merged[k] for k in sorted(merged)],now,errors)
    result['source_overlap_verification']=base.get('source_overlap_verification',{})
    return result


if __name__ == '__main__':
    data=refresh()
    path=ROOT/'data'/'longterm.json'
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(data['analysis']['coverage'], data['analysis']['status'])
