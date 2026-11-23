import json
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from . import news
from .board_universe import FLAG_FNO, FLAG_N50, FLAG_N500
from .models import User

NEWS_XML = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>Tata Steel dips 7% as APL Apollo tumbles &amp; Hindalco slips</title>
<link>https://example.com/markets/tata-steel</link>
<description><![CDATA[<p>Shares of <b>Tata Steel</b> fell after the deal.</p>]]></description>
<enclosure type="image/jpeg" url="https://img.example.com/tata.jpg" length="0"/>
<category>Markets</category><pubDate>Mon, 23 Nov 2026 12:46:54 +0530</pubDate></item>
<item><title>Maruti Suzuki, TCS and BSE shares in focus</title><link>https://example.com/markets/focus</link>
<description>Of 4,509 stocks traded on the BSE, most fell.</description>
<media:content medium="image" url="https://img.example.com/focus.jpg"/>
<pubDate>Mon, 23 Nov 2026 07:30:00 GMT</pubDate></item>
<item><title>Not a secure link</title><link>http://example.com/plain</link><pubDate>Mon, 23 Nov 2026 10:00:00 +0530</pubDate></item>
<item><title>No date</title><link>https://example.com/no-date</link></item>
</channel></rss>"""

NSE_XML = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Welspun Corp Limited</title><link>https://nsearchives.nseindia.com/corporate/welspun.pdf</link>
<description>Welspun Corp Limited has informed the Exchange about Investor Presentation |SUBJECT: Investor Presentation</description>
<pubDate>23-Nov-2026 14:20:00</pubDate></item>
<item><title>UTI Nifty 50 ETF</title><link>https://nsearchives.nseindia.com/corporate/uti.pdf</link>
<description>UTI Asset Management Company Limited has informed the Exchange that the Net Asset Value (per unit) is Rs. 230.30. |SUBJECT: Declaration of NAV</description>
<pubDate>23-Nov-2026 14:10:00</pubDate></item>
<item><title>Tata Steel Limited</title><link>https://nsearchives.nseindia.com/corporate/tata.pdf</link>
<description>Tata Steel Limited has informed the Exchange regarding a press release dated November 23, 2026 |SUBJECT: Press Release</description>
<pubDate>23-Nov-2026 09:05:00</pubDate></item>
<item><title>Dalmia Bharat Limited</title><link>https://nsearchives.nseindia.com/corporate/dalmia.pdf</link>
<description>Outcome of Board Meeting held on 23-Nov-2026 for Buy-back |SUBJECT: Outcome of Board Meeting-XBRL</description>
<pubDate>23-Nov-2026 15:01:00</pubDate></item>
<item><title>Railtel Corporation Of India Limited</title><link>https://nsearchives.nseindia.com/corporate/railtel.pdf</link>
<description>Railtel Corporation Of India Limited has informed the Exchange about Bagging/Receiving of orders/contracts |SUBJECT: Bagging/Receiving of orders/contracts</description>
<pubDate>23-Nov-2026 11:00:00</pubDate></item>
<item><title>Some Company Limited</title><link>https://nsearchives.nseindia.com/corporate/some.pdf</link>
<description>Order received from tax authority |SUBJECT: Litigation / Dispute / Regulatory action</description>
<pubDate>23-Nov-2026 10:00:00</pubDate></item>
<item><title>APL Apollo Tubes Limited</title><link>https://nsearchives.nseindia.com/corporate/apl.pdf</link>
<description>APL Apollo Tubes Limited has informed the Exchange about 'Shareholder agreements'. |SUBJECT: Agreements,Contracts,Arrangements,MOU</description>
<pubDate>23-Nov-2026 08:00:00</pubDate></item>
</channel></rss>"""

STOCKS = [
    {"symbol": "TATASTEEL", "company": "Tata Steel Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "MARUTI", "company": "Maruti Suzuki India Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "TCS", "company": "Tata Consultancy Services Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "BSE", "company": "BSE Ltd.", "flags": FLAG_N500 | FLAG_FNO},
    {"symbol": "WELCORP", "company": "Welspun Corp Ltd.", "flags": FLAG_N500},
    {"symbol": "BANKINDIA", "company": "Bank of India", "flags": FLAG_N500 | FLAG_FNO},
    {"symbol": "SBIN", "company": "State Bank of India", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "SBILIFE", "company": "SBI Life Insurance Company Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "RELIANCE", "company": "Reliance Industries Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "HDFCBANK", "company": "HDFC Bank Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "AXISBANK", "company": "Axis Bank Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "HINDALCO", "company": "Hindalco Industries Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
    {"symbol": "DRREDDY", "company": "Dr. Reddy's Laboratories Ltd.", "flags": FLAG_N500 | FLAG_FNO | FLAG_N50},
]


class ParsingTests(SimpleTestCase):
    def test_news_items_keep_title_summary_picture_and_india_time(self):
        items = news.parse_news(NEWS_XML, "et", "Economic Times")
        self.assertEqual([item["url"] for item in items], ["https://example.com/markets/tata-steel", "https://example.com/markets/focus"])
        first, second = items
        self.assertEqual(first["title"], "Tata Steel dips 7% as APL Apollo tumbles & Hindalco slips")
        self.assertEqual(first["summary"], "Shares of Tata Steel fell after the deal.")
        self.assertEqual((first["image"], first["section"], first["source"]), ("https://img.example.com/tata.jpg", "Markets", "Economic Times"))
        self.assertEqual(first["published"], "2026-11-23T12:46:54+05:30")
        self.assertEqual((second["image"], second["published"]), ("https://img.example.com/focus.jpg", "2026-11-23T13:00:00+05:30"))

    def test_long_summaries_are_cut_at_a_word(self):
        text = news.clean_text("word " * 100, 30)
        self.assertTrue(text.endswith("…"))
        self.assertLessEqual(len(text), 31)

    def test_announcements_drop_fund_notices_and_read_subject_text_and_group(self):
        rows = news.parse_announcements(NSE_XML)
        self.assertEqual([row["company"] for row in rows], ["Welspun Corp Limited", "Tata Steel Limited", "Dalmia Bharat Limited",
                                                            "Railtel Corporation Of India Limited", "Some Company Limited",
                                                            "APL Apollo Tubes Limited"])
        welspun, tata, dalmia, railtel, legal, apl = rows
        self.assertEqual((welspun["subject"], welspun["text"], welspun["group"]), ("Investor Presentation", "", "meetings"))
        self.assertEqual((tata["text"], tata["group"]), ("A press release dated November 23, 2026", "press"))
        self.assertEqual((dalmia["subject"], dalmia["group"]), ("Outcome of Board Meeting", "action"))
        self.assertEqual(railtel["group"], "orders")
        self.assertEqual(legal["group"], "legal")
        # A shareholder agreement is a deal, not an order win; quotes around the text go.
        self.assertEqual((apl["subject"], apl["text"], apl["group"]), ("Agreements, Contracts, Arrangements, MOU", "Shareholder agreements.", "deals"))
        self.assertEqual((welspun["published"], welspun["url"]), ("2026-11-23T14:20:00+05:30", "https://nsearchives.nseindia.com/corporate/welspun.pdf"))


class MatcherTests(SimpleTestCase):
    def setUp(self):
        self.matcher = news.StockMatcher(STOCKS)

    def test_headlines_match_full_names_short_names_and_capital_symbols_but_not_exchange_words(self):
        self.assertEqual(self.matcher.mentions("Maruti Suzuki, TCS and BSE shares in focus"), ["MARUTI", "TCS"])
        self.assertEqual(self.matcher.mentions("Tata Steel's deal"), ["TATASTEEL"])
        self.assertEqual(self.matcher.mentions("Tata Steelworks and tcs"), [])
        self.assertEqual(self.matcher.mentions("Bank stocks fall"), [])

    def test_everyday_short_names_count_and_tags_follow_the_headline_order(self):
        headline = "Who is killing Nifty 50 rally? SBI, RIL, HDFC Bank, Axis Bank, Hindalco, Tata Steel among stocks in the red"
        self.assertEqual(self.matcher.mentions(headline), ["SBIN", "RELIANCE", "HDFCBANK", "AXISBANK", "HINDALCO"])
        self.assertEqual(self.matcher.mentions("SBI Life and SBI Card slip; Dr. Reddy's gains"), ["SBILIFE", "DRREDDY"])
        self.assertEqual(self.matcher.mentions("Dr. Reddy's Laboratories gains"), ["DRREDDY"])
        self.assertEqual(self.matcher.mentions("Infy and HUL rise"), [])  # no INFY or HINDUNILVR in this stock list

    def test_filings_match_on_the_company_name(self):
        self.assertEqual(self.matcher.company("Tata Steel Limited"), "TATASTEEL")
        self.assertEqual(self.matcher.company("Bank of India"), "BANKINDIA")
        self.assertIsNone(self.matcher.company("Some Company Limited"))
        self.assertEqual(self.matcher.info["MARUTI"], {"symbol": "MARUTI", "company": "Maruti Suzuki India Ltd.", "fno": True, "n50": True,
                                                       "sensex": False, "n500": True})


class FeedCacheTests(SimpleTestCase):
    def setUp(self):
        news.clear_cache()
        self.addCleanup(news.clear_cache)

    def test_feeds_refresh_once_per_window_and_keep_the_last_good_copy_when_a_source_fails(self):
        bodies = {url: (NSE_XML if key == "nse" else NEWS_XML) for key, _, url in news.NEWS_FEEDS + (news.NSE_FEED,)}
        with patch("backend.news.fetch", side_effect=lambda url: bodies[url]) as fetch:
            first = news.feeds(now=1000)
            self.assertEqual(fetch.call_count, 6)
            news.feeds(now=1000 + news.REFRESH_SECONDS - 1)
            self.assertEqual(fetch.call_count, 6)
        self.assertTrue(all(state["ok"] for state in first.values()))

        def fail_bs(url):
            if "business-standard" in url:
                raise TimeoutError("timed out")
            return bodies[url]
        with patch("backend.news.fetch", side_effect=fail_bs):
            second = news.feeds(now=1000 + news.REFRESH_SECONDS)
        self.assertEqual((second["bs"]["ok"], second["bs"]["error"], len(second["bs"]["items"])), (False, "timed out", 2))
        with patch("backend.news.fetch", side_effect=lambda url: bodies[url]) as fetch:
            news.feeds(now=1000 + news.REFRESH_SECONDS * 1.5)
            self.assertEqual([call.args[0] for call in fetch.call_args_list], [news.NEWS_FEEDS[4][2]])

    def test_payload_drops_repeated_stories_and_tags_stocks(self):
        state = {key: {"ok": True, "error": "", "items": news.parse_news(NEWS_XML, key, name)} for key, name, _ in news.NEWS_FEEDS}
        state["nse"] = {"ok": True, "error": "", "items": news.parse_announcements(NSE_XML)}
        payload = news.build_payload(state, news.StockMatcher(STOCKS))
        # Five feeds carry the same two stories; newest first.
        self.assertEqual([item["symbols"] for item in payload["news"]], [["MARUTI", "TCS"], ["TATASTEEL", "HINDALCO"]])
        self.assertEqual([row["symbol"] for row in payload["announcements"]], [None, "WELCORP", None, None, "TATASTEEL", None])
        self.assertEqual(sorted(payload["stocks"]), ["HINDALCO", "MARUTI", "TATASTEEL", "TCS", "WELCORP"])
        self.assertEqual([source["count"] for source in payload["sources"]], [2, 2, 2, 2, 2, 6])


class NewsViewTests(TestCase):
    def setUp(self):
        news.clear_cache()
        self.addCleanup(news.clear_cache)
        user = User(username="news-test")
        user.set_password("local-test-password")
        user.save()
        response = self.client.post("/api/login/", json.dumps({"username": user.username, "password": "local-test-password"}),
                                    content_type="application/json")
        self.headers = {"HTTP_AUTHORIZATION": "jwt-token " + response.json()["jwtToken"]}

    def test_news_needs_a_signed_in_user(self):
        self.assertEqual(self.client.get("/api/news/").status_code, 400)

    @patch("backend.news.universe", return_value=(STOCKS, []))
    def test_news_returns_stories_filings_and_the_stocks_they_mention(self, _universe):
        bodies = {url: (NSE_XML if key == "nse" else NEWS_XML) for key, _, url in news.NEWS_FEEDS + (news.NSE_FEED,)}
        with patch("backend.news.fetch", side_effect=lambda url: bodies[url]):
            data = self.client.get("/api/news/", **self.headers).json()
        self.assertEqual((data["type"], data["message"], len(data["news"]), len(data["announcements"])), ("success", "", 2, 6))
        self.assertEqual(data["stocks"]["TATASTEEL"]["fno"], True)

    @patch("backend.news.universe", side_effect=FileNotFoundError("no contract file"))
    def test_sources_down_and_no_stock_list_give_an_empty_page_with_a_message(self, _universe):
        with patch("backend.news.fetch", side_effect=TimeoutError("timed out")):
            data = self.client.get("/api/news/", **self.headers).json()
        self.assertEqual((data["news"], data["announcements"], data["stocks"]), ([], [], {}))
        self.assertIn("not responding", data["message"])
        self.assertEqual({source["ok"] for source in data["sources"]}, {False})
