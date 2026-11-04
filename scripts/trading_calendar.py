"""Completed official TWSE trading sessions, verified by benchmark daily reports."""
import concurrent.futures
import datetime as dt
import json
import subprocess
import urllib.parse


def roc_date(value):
    parts = str(value).replace('-', '/').split('/')
    if len(parts) != 3:
        return None
    try:
        y, m, d = map(int, parts)
        return dt.date(y+1911 if y<1911 else y, m, d).isoformat()
    except ValueError:
        return None


def fetch_calendar(target, previous=None):
    month = target.replace(day=1)
    months = []
    for _ in range(4):
        months.append(month)
        month = (month-dt.timedelta(days=1)).replace(day=1)
    def task(day):
        query = urllib.parse.urlencode({'response':'json', 'date':day.strftime('%Y%m%d'), 'stockNo':'2330'})
        url = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY?'+query
        try:
            raw = subprocess.run(['curl','--fail','--silent','--show-error','--location','--max-time','25',url],capture_output=True,check=True,timeout=30).stdout
            payload = json.loads(raw)
            if payload.get('stat') != 'OK':
                raise ValueError('Calendar report unavailable')
            dates = [roc_date(row[0]) for row in payload.get('data', [])]
            if not dates:
                raise ValueError('Empty calendar report')
            return dates, None
        except Exception as exc:
            return [], f'{day:%Y-%m}: {exc}'
    dates, errors = set(), []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for found, error in pool.map(task, months):
            dates.update(d for d in found if d and d<=target.isoformat())
            if error:
                errors.append(error)
    if errors:
        print('Trading calendar incomplete:', '; '.join(errors), flush=True)
        # A partial refresh must not be promoted as a complete calendar.
        return sorted(set((previous or {}).get('trading_sessions', [])) | dates), None
    return sorted(dates), dt.datetime.now(dt.timezone.utc).isoformat()
