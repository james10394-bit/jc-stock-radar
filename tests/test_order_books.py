import datetime as dt
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from intraday import TZ, parse_order_book, parse_quote, capture_early_book, add_interval

class OrderBookTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,4,9,3,tzinfo=TZ)
        self.row={'c':'2330','n':'台積電','ex':'tse','d':'20261104','t':'09:03:00','z':'-','v':'1000','o':'100','y':'100','h':'109','l':'100','u':'110','a':'109_','f':'100_','b':'108_107_','g':'800_100_'}
    def test_book_without_executed_price_is_not_fabricated_trade(self):
        self.assertIsNone(parse_quote(self.row,self.now))
        self.assertIsNotNone(parse_order_book(self.row,self.now))
    def test_bid_and_ask_lots_convert_to_shares(self):
        b=parse_order_book(self.row,self.now)
        self.assertEqual(b['bid_shares'],900000)
        self.assertEqual(b['ask_shares'],100000)
        self.assertEqual(b['buy_share'],.9)
        self.assertEqual(b['investor_identity'],'unknown')
    def test_before_905_observation_can_be_captured(self):
        self.assertTrue(capture_early_book(parse_order_book(self.row,self.now),self.now))
    def test_late_start_cannot_backfill_early_record(self):
        self.assertFalse(capture_early_book(parse_order_book(self.row,self.now),self.now+dt.timedelta(minutes=10)))
    def test_after_905_is_not_early_observation(self):
        self.row['t']='09:05:01'
        now=self.now.replace(minute=5,second=1)
        self.assertFalse(capture_early_book(parse_order_book(self.row,now),now))
    def test_previous_day_book_is_rejected(self):
        self.row['d']='20261103'
        self.assertIsNone(parse_order_book(self.row,self.now))
    def test_empty_missing_book_does_not_mean_no_ask_orders(self):
        del self.row['f']
        self.assertIsNone(parse_order_book(self.row,self.now))
    def test_missing_ask_quantity_does_not_make_buy_share_one(self):
        self.row['f']='-_'
        self.assertIsNone(parse_order_book(self.row,self.now))
    def test_interval_requires_same_day_and_short_time_gap(self):
        old={'date':'2026-11-04','price':100,'volume':100000,'timestamp':'2026-11-04T09:02:00+08:00'}
        q={'date':'2026-11-04','price':101,'volume':700000,'timestamp':'2026-11-04T09:03:00+08:00'}
        add_interval(q,old)
        self.assertEqual(q['interval_volume'],600000)
        q2={'date':'2026-11-04','price':101,'volume':700000,'timestamp':'2026-11-04T09:07:00+08:00'}
        add_interval(q2,old)
        self.assertNotIn('interval_volume',q2)

if __name__=='__main__': unittest.main()
