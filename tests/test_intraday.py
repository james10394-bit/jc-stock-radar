import datetime as dt
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import intraday


class QuoteTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,10,29,9,5,20,tzinfo=intraday.TZ)
        self.row={'c':'2330','n':'台積電','ex':'tse','d':'20261029','t':'09:05:10','z':'12','o':'11.8','y':'11.9','h':'12.1','l':'11.7','v':'1200'}

    def test_volume_lots_are_converted_to_shares(self):
        self.assertEqual(intraday.parse_quote(self.row,self.now)['volume'],1200000)

    def test_bid_does_not_replace_missing_execution(self):
        self.row.update(z='-',b='12_11.9_')
        self.assertIsNone(intraday.parse_quote(self.row,self.now))

    def test_previous_day_quote_is_not_today(self):
        self.row['d']='20261028'
        self.assertIsNone(intraday.parse_quote(self.row,self.now))

    def test_observation_is_timestamped_and_frozen(self):
        q=intraday.parse_quote(self.row,self.now)
        intraday.capture_opening(q,None,self.now)
        self.assertTrue(q['opening_complete'])
        newer={**q,'volume':5000000,'low':11,'opening_complete':False}
        intraday.capture_opening(newer,q,self.now.replace(hour=10))
        self.assertEqual(newer['opening_volume'],1200000)
        self.assertEqual(newer['opening_low'],11.7)

    def test_late_start_does_not_recreate_opening_volume(self):
        self.row['t']='09:30:00'
        q=intraday.parse_quote(self.row,self.now)
        intraday.capture_opening(q,None,self.now.replace(minute=30))
        self.assertFalse(q['opening_complete'])

    def test_closed_session_makes_no_network_requests(self):
        def fail(_):
            raise AssertionError('must not fetch')
        s=intraday.collect({},now=self.now.replace(hour=14),fetch=fail)
        self.assertEqual(s['phase'],'closed')
        self.assertEqual(s['quotes'],{})


if __name__=='__main__':
    unittest.main()
