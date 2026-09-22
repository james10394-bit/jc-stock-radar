import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import update


class TestTWSE(unittest.TestCase):
    def test_dates_and_numeric_formats(self):
        self.assertEqual(update.date_string('1150731'), '2026-07-31')
        self.assertEqual(update.date_string('20260915'), '2026-09-15')
        self.assertEqual(update.number('<span>1,250</span>'), 1250)
        self.assertIsNone(update.number('--'))

    def test_institution_fields_and_no_double_count(self):
        fields = ['證券代號','證券名稱','外陸資買進股數(不含外資自營商)','外陸資賣出股數(不含外資自營商)','外陸資買賣超股數(不含外資自營商)','外資自營商買賣超股數','投信買進股數','投信賣出股數','投信買賣超股數','自營商買賣超股數(自行買賣)','自營商買賣超股數(避險)','自營商買賣超股數','三大法人買賣超股數']
        row = ['2330','台積電','10,000','4,000','6,000','100','2,000','1,000','1,000','-3,000','500','-2,500','4,500']
        data = update.institutions({'stat':'OK','fields':fields,'data':[row]},'2026-09-15')['2330']
        self.assertEqual(data['foreign'], {'buy':10000,'sell':4000,'net':6000})
        self.assertEqual(data['dealer']['net'],-2500)
        self.assertEqual(sum(data[x]['net'] for x in ('foreign','trust','dealer')),4500)

    def test_refuse_changed_schema(self):
        with self.assertRaises(ValueError):
            update.institutions({'stat':'OK','fields':['證券代號','證券名稱'],'data':[['2330','台積電']]},'2026-09-15')

    def test_stock_day_history_rows(self):
        payload = {
            'stat': 'OK',
            'fields': ['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],
            'data': [['115/09/17','1,250,000','0','120.0','125.0','118.5','124.5']]
        }
        self.assertEqual(update.price_rows(payload), [{
            'date': '2026-09-17', 'volume': 1250000, 'open': 120,
            'high': 125, 'low': 118.5, 'close': 124.5
        }])

    def test_all_market_rows(self):
        payload = {'stat': 'OK', 'tables': [{'fields': [
            '證券代號', '證券名稱', '成交股數', '開盤價', '最高價', '最低價', '收盤價'
        ], 'data': [['2615', '萬海', '1,250,000', '120', '125', '118.5', '124.5']]}]}
        self.assertEqual(update.all_market_rows(payload, '2026-09-17')['2615'], {
            'date': '2026-09-17', 'volume': 1250000, 'open': 120,
            'high': 125, 'low': 118.5, 'close': 124.5
        })

    def test_five_watchlist_pages(self):
        pages = update.load_watchlist()
        self.assertEqual(len(pages), 5)
        self.assertTrue(all(len(page['codes']) <= 10 for page in pages))

    def test_company_profiles(self):
        rows = [{'公司代號': '2330', '公司名稱': '台灣積體電路製造股份有限公司', '公司簡稱': '台積電', '產業別': '24',
                 '董事長': '魏哲家', '上市日期': '19940905', '實收資本額': '259323700670', '網址': 'https://www.tsmc.com'},
                {'公司代號': '1101', '公司簡稱': '台泥', '產業別': '01'}]
        profiles = update.company_profiles(rows)
        self.assertEqual(profiles['2330']['industry'], '半導體業')
        self.assertIn('晶圓代工', profiles['2330']['business'])
        self.assertEqual(profiles['2330']['listed'], '1994-09-05')
        self.assertEqual(profiles['2330']['chairman'], '魏哲家')
        self.assertIn('水泥', profiles['1101']['business'])

    def test_news_keyword_scoring(self):
        self.assertLess(update.news_score('War attack triggers market crisis'), 0)
        self.assertGreater(update.news_score('Rate cut fuels market rally and growth'), 0)
        self.assertEqual(update.news_score('Company holds annual meeting'), 0)

    def test_us_holidays_and_risk_blocks(self):
        holidays = update.us_holidays(2026)
        self.assertIn(update.dt.date(2026, 7, 3), holidays)
        self.assertTrue(holidays[update.dt.date(2026, 7, 3)][1])
        news = [{'category': '台海風險', 'title': '台海軍演與飛彈封鎖風險升高'}]
        risk = update.risk_block(news, '台海風險', update.STRAIT_WORDS + update.WAR_WORDS)
        self.assertGreater(risk['points'], 0)

    def test_parse_taifex_night_quote(self):
        payload = {'RtData': {'QuoteList': [{
            'SymbolID': 'TXFJ6-M', 'DispCName': '臺股期貨 202604',
            'CLastPrice': '23450', 'CRefPrice': '23300', 'CDiff': '150',
            'CDiffRate': '0.64', 'COpenPrice': '23320', 'CHighPrice': '23500',
            'CLowPrice': '23280', 'CTotalVolume': '21499',
            'CDate': '20260922', 'CTime': '235959'
        }]}}
        now = update.dt.datetime(2026, 9, 22, 23, 0, tzinfo=update.TAIPEI)
        quote = update.parse_taifex_night(payload, now)
        self.assertEqual(quote['symbol'], 'TXFJ6-M')
        self.assertEqual(quote['change_pct'], 0.64)
        self.assertEqual(quote['quote_time'], '23:59:59')
        self.assertEqual(quote['session'], '夜盤交易中')


if __name__ == '__main__':
    unittest.main()
