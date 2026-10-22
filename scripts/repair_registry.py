"""Repair security coverage without rerunning unrelated news/financial jobs."""
import concurrent.futures
import json
import os
import update


def main():
    path = update.OUT
    data = json.loads(path.read_text(encoding='utf-8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        registry_job = pool.submit(update.fetch_security_registry, data.get('security_registry'))
        profiles_job = pool.submit(update.fetch_otc_profiles, data.get('company_profiles'))
        registry, profiles = registry_job.result(), profiles_job.result()
    for code, row in registry.items():
        profiles.setdefault(code, row)
    data['security_registry'] = registry
    data['company_profiles'] = profiles
    day = data['latest_session']
    params = {'date': day.replace('-', '/'), 'response': 'json'}
    try:
        flow_url = update.TPEX_INSTI+'?'+update.urllib.parse.urlencode({**params, 'type': 'Daily', 'sect': 'EW'})
        flows = update.tpex_institutions(json.loads(update.official_bytes(flow_url)), day)
        data['days'][day].update(flows)
        print('OTC flow rows:', len(flows))
    except Exception as exc:
        print('OTC flow unavailable:', exc)
    try:
        quote_url = update.TPEX_DAILY+'?'+update.urllib.parse.urlencode({**params, 'id': ''})
        quotes = update.tpex_daily_rows(json.loads(update.official_bytes(quote_url)), day)
        for code, row in quotes.items():
            history = {r['date']: r for r in data['price_history'].get(code, [])}
            history[day] = row
            data['price_history'][code] = [history[k] for k in sorted(history)[-80:]]
            if code in data['days'][day]:
                data['days'][day][code]['quote'] = row
        print('OTC quote rows:', len(quotes))
    except Exception as exc:
        print('OTC quote unavailable:', exc)
    data['version'] = '2.5.3'
    temp = path.with_suffix('.repair.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    os.replace(temp, path)
    print('Registry:', len(registry), '4768:', profiles.get('4768', {}).get('name'))


if __name__ == '__main__':
    main()
