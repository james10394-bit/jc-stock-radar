import datetime as dt
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import news_risk as n

NOW=dt.datetime(2026,11,4,4,28,tzinfo=dt.timezone.utc)
def item(title,category='全球市場',**extra):
    return {'title':title,'category':category,'published':'Tue, 03 Nov 2026 05:50:00 GMT','url':'https://example.org/news','source':'測試新聞',**extra}

class NewsRiskTests(unittest.TestCase):
    def test_no_news_is_not_low_risk(self):
        r=n.risk_block([], '全球戰爭', {}, NOW)
        self.assertEqual(r['level'],'資料不足');self.assertIsNone(r['impact']);self.assertFalse(r['usable'])
    def test_successful_feed_without_match_is_unmatched_not_low(self):
        r=n.risk_block([item('台股半導體上漲')],'全球戰爭',{'全球戰爭':{'status':'ok'}},NOW)
        self.assertEqual(r['level'],'未檢出')
    def test_attack_in_market_category_is_reclassified(self):
        x=item('美軍突襲伊朗引爆斷油恐慌 科技股壓力測試')
        r=n.risk_block([x],'全球戰爭',{'全球戰爭':{'status':'ok'}},NOW)
        self.assertEqual(r['level'],'高');self.assertLess(r['impact'],0)
    def test_summary_is_checked_without_claiming_full_article_access(self):
        x=item('台股重挫與市場事件',summary='<p>中東伊朗遭空襲，供應風險升高</p>')
        self.assertIn('全球戰爭',n.classify(x))
    def test_metaphorical_stock_attack_is_not_a_war(self):
        self.assertNotIn('全球戰爭',n.classify(item('台股空軍突襲，多頭慘遭轟炸')))
    def test_trade_war_without_military_context_is_not_hot_war(self):
        self.assertNotIn('全球戰爭',n.classify(item('美國貿易戰關稅攻防')))
    def test_english_war_does_not_match_taiwan(self):
        self.assertNotIn('全球戰爭',n.classify(item('Taiwan trade growth with Iran')))
    def test_duplicate_headlines_are_merged(self):
        items=n.merge_items([item('美軍空襲伊朗 - A'),item('美軍空襲伊朗 - B',category='全球戰爭')],NOW)
        self.assertEqual(len(items),1)
        self.assertIn('全球市場',items[0]['query_categories'])
    def test_multiple_reposts_do_not_multiply_severity(self):
        one=n.risk_block([item('美軍空襲伊朗')],'全球戰爭',{},NOW)
        many=n.risk_block([item('美軍空襲伊朗')]*10,'全球戰爭',{},NOW)
        self.assertEqual(one['points'],many['points']);self.assertEqual(one['impact'],many['impact'])
    def test_cached_items_are_not_new_evidence(self):
        r=n.risk_block([item('美軍空襲伊朗',cached=True)],'全球戰爭',{},NOW)
        self.assertEqual(r['level'],'資料待更新');self.assertIsNone(r['impact'])
    def test_old_or_future_news_is_rejected(self):
        self.assertEqual(n.merge_items([item('伊朗空襲',published='Sat, 31 Oct 2026 01:00:00 GMT'),item('伊朗空襲',published='Thu, 05 Nov 2026 01:00:00 GMT')],NOW),[])
    def test_missing_publication_is_not_live_evidence(self):
        r=n.risk_block([item('美軍空襲伊朗',published='')],'全球戰爭',{},NOW)
        self.assertFalse(r['usable'])
    def test_denial_is_not_confirmed_attack(self):
        r=n.risk_block([item('伊朗否認空襲，網路消息未證實')],'全球戰爭',{},NOW)
        self.assertEqual(r['level'],'待查核');self.assertFalse(r['usable'])
    def test_ceasefire_does_not_cancel_other_attack_headline(self):
        r=n.risk_block([item('美軍空襲伊朗'),item('伊朗停火談判')],'全球戰爭',{},NOW)
        self.assertEqual(r['level'],'高')
    def test_strait_is_reclassified_from_market_feed(self):
        self.assertIn('台海風險',n.classify(item('台海軍演與半導體供應風險')))
    def test_election_is_a_dedicated_topic(self):
        self.assertIn('美國選舉',[x[0] for x in n.TOPICS])
        self.assertIn('美國選舉',n.classify(item('美國期中選舉開票，共和黨與民主黨席次受關注')))
    def test_election_reporting_has_no_automatic_directional_score(self):
        r=n.risk_block([item('美國期中選舉開票，共和黨與民主黨席次受關注')],'美國選舉',{},NOW)
        self.assertEqual(r['level'],'事件觀察');self.assertEqual(r['impact'],0);self.assertFalse(r['usable'])
    def test_election_uses_us_local_date_not_taiwan_date(self):
        # 11/04 12:28 Taipei is 11/03 23:28 New York.
        focus=n.election_calendar(NOW)['focus']
        self.assertEqual(focus['date'],'2026-11-03');self.assertEqual(focus['days_until'],0)
        self.assertEqual(focus['phase'],'投票日／計票觀察')
    def test_election_result_is_not_guessed_next_day(self):
        focus=n.election_calendar(NOW+dt.timedelta(days=1))['focus']
        self.assertEqual(focus['phase'],'選後結果待核實');self.assertIn('未核實',focus['results_status'])
    def test_calendar_does_not_need_news_feed(self):
        self.assertTrue(n.election_calendar(NOW)['focus']['calendar_verified'])

if __name__=='__main__':unittest.main()
