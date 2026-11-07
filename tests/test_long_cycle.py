import datetime as dt
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import long_cycle as L

def series():
 return [{'date':f'{y}-{m:02d}-06','close':100*math.exp(.003*((y-1990)*12+m-1)+.2*math.sin(((y-1990)*12+m-1)/12))} for y in range(1990,2027) for m in range(1,13) if (y,m)<=(2026,11)]

class LongCycleTests(unittest.TestCase):
 def test_official_dates_and_column(self):
  p={'stat':'OK','fields':['日期','發行量加權股價指數'],'data':[[' 79/01/04','9,853.15']]}
  self.assertEqual(L.parse_month(p,1990,1,dt.date(2026,11,7)),[{'date':'1990-01-04','close':9853.15}])
  with self.assertRaises(ValueError):L.parse_month(p,1991,1,dt.date(2026,11,7))
 def test_invalid_rejected(self):
  for rows in ([{'date':'2027-01-01','close':100}],[{'date':'2020-01-01','close':0}],series()+series()):
   with self.assertRaises(ValueError):L.analyze(rows,dt.date(2026,11,7))
 def test_missing_suspends(self):
  a=L.analyze([r for r in series() if not r['date'].startswith('2008-10')],dt.date(2026,11,7))
  self.assertEqual(a['status'],'incomplete');self.assertIn('2008-10',a['coverage']['missing_months']);self.assertNotIn('hypotheses',a)
 def test_partial_excluded(self):
  a=L.analyze(series(),dt.date(2026,11,7));self.assertEqual(a['complete_month_end'],'2026-10-06');self.assertEqual(a['coverage']['complete_months'],442)
 def test_cagr_drawdown(self):
  r=series();a=L.analyze(r,dt.date(2026,11,7));self.assertAlmostEqual(a['price_cagr_pct'],100*((r[-1]['close']/r[0]['close'])**(1/L.years(r[0]['date'],r[-1]['date']))-1))
  d=L.drawdown([{'date':f'2020-01-0{i+1}','close':v} for i,v in enumerate([100,200,50,100,200])]);self.assertAlmostEqual(d['pct'],-75);self.assertEqual(d['recovery_date'],'2020-01-05')
 def test_no_fabricated_forecast(self):
  a=L.analyze(series(),dt.date(2026,11,7));self.assertIsNone(a['forecast_price_target']);self.assertIsNone(a['forecast_probability']);self.assertEqual([h['period_years'] for h in a['hypotheses']],[40,50,60]);self.assertTrue(all(not h['identified'] and h['observed_cycles']<1 for h in a['hypotheses']))
 def test_qr_recovers_linear(self):
  rows=[{'date':r['date'],'close':math.exp(5+.02*L.years('1990-01-06',r['date']))} for r in series()]
  for period in (None,40,50,60):self.assertAlmostEqual(L.fit(rows[:240],period)['predict'](rows[-1]['date']),math.log(rows[-1]['close']),places=8)
 def test_backtest_no_future(self):
  rows=series()[:300];original=L.fit;seen=[]
  def wrapped(train,period=None):seen.append(train[-1]['date']);return original(train,period)
  with patch.object(L,'fit',side_effect=wrapped):b=L.backtest(rows,36)
  self.assertEqual(b['origins'],3);self.assertEqual(set(seen),{rows[i-1]['date'] for i in (180,216,252)})
 def test_failed_refresh_preserves(self):
  now=dt.datetime(2026,11,7,tzinfo=dt.timezone.utc);base=L.build(series(),now)
  with tempfile.TemporaryDirectory() as temp:
   with patch.object(L.urllib.request,'urlopen',side_effect=TimeoutError('offline')):new=L.refresh(base,now,Path(temp)/'absent.json')
  self.assertEqual(new['daily'],base['daily']);self.assertEqual(len(new['fetch_errors']),2)
 def test_current_extreme_not_in_fit(self):
  one=series();two=[dict(r) for r in one];two[-1]['close']*=100;a=L.analyze(one,dt.date(2026,11,7));b=L.analyze(two,dt.date(2026,11,7))
  for k in ('hypotheses','walk_forward'):self.assertEqual(a[k],b[k])

if __name__=='__main__':unittest.main()
