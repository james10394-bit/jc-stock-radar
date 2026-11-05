import datetime as dt
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from intraday import TZ, parse_volume_quote, collect, compact_history

class VolumeObservationTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,5,9,5,tzinfo=TZ)
        self.row={'c':'2330','n':'台積電','ex':'tse','d':'20261105','t':'09:05:00','z':'-','v':'2500'}
        self.market={'company_profiles':{'2330':{'market':'上市'}}}
    def test_missing_trade_price_does_not_discard_volume(self):
        q=parse_volume_quote(self.row,self.now)
        self.assertEqual(q['volume'],2500000);self.assertIsNone(q['price']);self.assertFalse(q['price_available'])
    def test_prior_day_volume_not_current(self):
        self.row['d']='20261104'
        self.assertIsNone(parse_volume_quote(self.row,self.now))
    def test_invalid_volume_is_not_zero(self):
        self.row['v']='-'
        self.assertIsNone(parse_volume_quote(self.row,self.now))
    def test_closed_checks_keep_actual_last_fetch_time(self):
        old={'date':'2026-11-05','generated_at':'2026-11-05T09:05:10+08:00','opening_observations':{'2330':{'opening_complete':True}},'volume_quotes':{'2330':{'volume':2500000}},'quotes':{}}
        result=collect(self.market,old,now=self.now.replace(hour=15,minute=10))
        self.assertEqual(result['generated_at'],old['generated_at'])
        self.assertIn('2330',result['opening_observations'])
        self.assertNotEqual(result['checked_at'],result['generated_at'])
    def test_volume_and_executed_price_counts_are_separate(self):
        result=collect(self.market,now=self.now,fetch=lambda batch:{'msgArray':[self.row]})
        self.assertEqual(result['coverage']['volume_received'],1)
        self.assertEqual(result['coverage']['received'],0)
    def test_new_day_archives_old_day_without_relabelling_quotes(self):
        old={'date':'2026-11-04','generated_at':'2026-11-04T09:05:10+08:00','quotes':{'2330':{'code':'2330','date':'2026-11-04','volume':10000}},'opening_observations':{'2330':{'opening_complete':True}}}
        result=collect(self.market,old,now=self.now.replace(hour=8,minute=30))
        self.assertFalse(result['quotes']);self.assertFalse(result['opening_observations'])
        self.assertIn('2026-11-04',result['history'])
    def test_archive_is_bounded_to_top_100_volumes(self):
        x={'date':'2026-11-04','volume_quotes':{str(i):{'volume':i} for i in range(200)}}
        a=compact_history(x)
        self.assertEqual(len(a['volume_quotes']),100)
        self.assertEqual(next(iter(a['volume_quotes'])),'199')
    def test_unknown_closed_day_has_no_fake_success_timestamp(self):
        r=collect(self.market,now=self.now.replace(hour=15))
        self.assertIsNone(r['generated_at'])

if __name__=='__main__':unittest.main()
