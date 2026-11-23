"""Market news from public RSS feeds and NSE's corporate announcements feed, for the News page.

Each feed is fetched at most once every few minutes per server process and the last good copy is kept when a source fails,
so opening the page never waits on more than one refresh. Headlines link back to the publisher; only the title, the short
summary the feed itself carries and its picture are shown here.
"""
import datetime as dt
import html
import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime

import requests
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET

from .board_universe import FLAG_FNO, FLAG_N50, FLAG_N500, FLAG_SENSEX, universe
from .logger import log
from .market_contracts import MARKET_TZ
from .views import protected

# (key, publisher, url). Two Economic Times feeds overlap; duplicates are dropped by link and title.
NEWS_FEEDS = (
    ("et-markets", "Economic Times", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
    ("et-stocks", "Economic Times", "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms"),
    ("hbl", "The Hindu BusinessLine", "https://www.thehindubusinessline.com/markets/feeder/default.rss"),
    ("mint", "Mint", "https://www.livemint.com/rss/markets"),
    ("bs", "Business Standard", "https://www.business-standard.com/rss/markets-106.rss"),
)
NSE_FEED = ("nse", "NSE", "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml")
REFRESH_SECONDS = 180
TIMEOUT_SECONDS = 8
MAX_BYTES = 4_000_000
MAX_NEWS = 150
MAX_ANNOUNCEMENTS = 400
SUMMARY_CHARS = 320
MAX_TAGS = 5
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; UtradersNews/1.0)", "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5"}
MEDIA = "{http://search.yahoo.com/mrss/}"
# Uppercase words in headlines that name an exchange or index far more often than the listed company with that symbol.
SYMBOL_STOPWORDS = {"BSE", "MCX", "NSE", "CDSL", "LIC"}
NAME_SUFFIX = re.compile(r"\b(limited|ltd)\b\.?$")
# Everyday short names of large stocks, matched as written (case matters): "SBI", "RIL", "Infy", "Hindalco".
ALIASES = (
    (r"SBI(?!\s+(?:Life|Card|Cards|Mutual|MF|General|Funds|Securities))", "SBIN"), (r"SBI Life", "SBILIFE"), (r"SBI Cards?", "SBICARD"),
    (r"RIL", "RELIANCE"), (r"HUL", "HINDUNILVR"),
    (r"L&T", "LT"), (r"Infy", "INFY"), (r"Hindalco", "HINDALCO"), (r"Sun Pharma", "SUNPHARMA"), (r"Dr\.? Reddy'?s", "DRREDDY"),
    (r"Airtel", "BHARTIARTL"), (r"Maruti", "MARUTI"), (r"Nestle", "NESTLEIND"), (r"Eicher", "EICHERMOT"), (r"IndiGo", "INDIGO"),
    (r"Power Grid", "POWERGRID"), (r"HCL ?Tech", "HCLTECH"), (r"Kotak(?: Mahindra)? Bank", "KOTAKBANK"), (r"Bajaj Finance", "BAJFINANCE"),
    (r"Adani Ports", "ADANIPORTS"), (r"UltraTech", "ULTRACEMCO"), (r"Titan", "TITAN"), (r"Zomato|Eternal", "ETERNAL"),
    (r"Jio Financial", "JIOFIN"), (r"Hind(?:ustan)? Zinc", "HINDZINC"), (r"Ambuja", "AMBUJACEM"), (r"Bharat Electronics", "BEL"),
)
# Announcement subjects grouped for colour and filtering; the first matching group wins. Legal comes before orders so a
# tax or court order is never shown as a business order.
GROUPS = (
    ("results", ("financial result", "audited", "unaudited", "quarterly result", "outcome of board meeting")),
    ("action", ("dividend", "record date", "bonus", "split", "buy back", "buy-back", "buyback", "rights issue", "corporate action")),
    ("legal", ("litigation", "dispute", "regulatory", "penalty", "insolvency", "tax authorit", "show cause")),
    ("orders", ("bagging", "receiving of order", "awarding of order", "order win", "order inflow")),
    ("deals", ("acquisition", "amalgamation", "merger", "arrangement", "agreement", "mou", "open offer", "takeover", "allotment",
               "fund raising", "capital", "stake")),
    ("meetings", ("analyst", "investor meet", "investor presentation", "con. call", "transcript", "shareholders meeting",
                  "postal ballot", "board meeting", "agm", "egm", "presentation")),
    ("people", ("director", "kmp", "auditor", "resignation", "appointment")),
    ("rating", ("credit rating", "rating")),
    ("press", ("press release", "media release", "update")),
)
INFORMED = re.compile(r"^.*?has (?:informed|intimated) the exchange(?: for .*?)?\s+(?:about|regarding|that)\s+", re.IGNORECASE)

_state = {"feeds": {}, "matcher": None}
_lock = threading.Lock()


def clean_text(value, limit=None):
    """Feed text without HTML tags or entities, on one line, cut at a word boundary when longer than limit."""
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value or ""))).strip()
    if limit and len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip(",;:-") + "…"
    return text


def rss_time(value):
    """An RSS date ("Mon, 23 Nov 2026 12:46:54 +0530") as an aware datetime in India time, or None."""
    try:
        moment = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    return moment.astimezone(MARKET_TZ)


def nse_time(value):
    """NSE's announcement time ("23-Nov-2026 14:25:18", India time) as an aware datetime, or None."""
    try:
        return dt.datetime.strptime((value or "").strip(), "%d-%b-%Y %H:%M:%S").replace(tzinfo=MARKET_TZ)
    except ValueError:
        return None


def item_image(item):
    enclosure = item.find("enclosure")
    if enclosure is not None and (enclosure.get("type") or "").startswith("image") and enclosure.get("url"):
        return enclosure.get("url")
    for tag in ("content", "thumbnail"):
        media = item.find(MEDIA + tag)
        if media is not None and media.get("url") and media.get("medium", "image") == "image":
            return media.get("url")
    return ""


def parse_news(xml_bytes, key, publisher):
    """News items from one RSS feed, newest first: title, summary, url, image, source, section and time."""
    items = []
    for item in ET.fromstring(xml_bytes).iter("item"):
        title, url = clean_text(item.findtext("title")), (item.findtext("link") or "").strip()
        published = rss_time(item.findtext("pubDate"))
        if not title or not url.startswith("https://") or published is None:
            continue
        image = item_image(item)
        items.append({"id": url, "title": title, "summary": clean_text(item.findtext("description"), SUMMARY_CHARS), "url": url,
                      "image": image if image.startswith("https://") else "", "source": publisher, "feed": key,
                      "section": clean_text(item.findtext("category")), "published": published.isoformat()})
    return items


def first_group(text, groups=GROUPS):
    lowered = text.lower()
    return next((group for group, words in groups if any(word in lowered for word in words)), None)


def announcement_group(subject, text=""):
    """The group of a filing. A board meeting outcome takes the group of what was decided (a buy-back, a deal), else results."""
    group = first_group(subject) or "other"
    if group == "results" and "outcome of board meeting" in subject.lower():
        decided = first_group(text, [entry for entry in GROUPS if entry[0] in ("action", "deals", "people")])
        return decided or "results"
    return group


def parse_announcements(xml_bytes):
    """NSE filings, newest first. Mutual fund NAV notices are left out: they are most of the feed and never move a stock."""
    rows = []
    for item in ET.fromstring(xml_bytes).iter("item"):
        company = clean_text(item.findtext("title"))
        description = clean_text(item.findtext("description"))
        published = nse_time(item.findtext("pubDate"))
        url = (item.findtext("link") or "").strip()
        if not company or published is None:
            continue
        text, _, subject = description.partition("|SUBJECT:")
        subject = re.sub(r",(?=\S)", ", ", re.sub(r"\s*-\s*XBRL$", "", subject.strip(), flags=re.IGNORECASE))
        text = text.strip()
        if "net asset value" in description.lower() or subject.lower().startswith("declaration of nav"):
            continue
        # "Welspun Corp Limited has informed the Exchange about Investor Presentation" -> "Investor Presentation"
        text = re.sub(r"^['\"](.*)['\"](\.?)$", r"\1\2", INFORMED.sub("", text).strip())
        text = text[:1].upper() + text[1:]
        if text.rstrip(".").lower() == subject.lower():
            text = ""
        rows.append({"id": f"{url}#{published.isoformat()}#{len(rows)}", "company": company, "subject": subject or "Announcement",
                     "group": announcement_group(subject, text), "text": clean_text(text, SUMMARY_CHARS),
                     "url": url if url.startswith("https://") else "", "published": published.isoformat()})
    return rows


def normalise_name(name):
    """"Tata Steel Ltd." and "Tata Steel Limited" both become "tata steel"."""
    text = re.sub(r"[^a-z0-9& ]+", " ", (name or "").lower().replace("&amp;", "&"))
    return NAME_SUFFIX.sub("", re.sub(r"\s+", " ", text).strip()).strip()


class StockMatcher:
    """Finds the NIFTY 500 and F&O stocks a headline or filing is about, by company name or by the symbol in capitals."""

    def __init__(self, stocks):
        self.by_name, self.info = {}, {}
        names, symbols = [], []
        for stock in stocks:
            flags = stock.get("flags", 0)
            self.info[stock["symbol"]] = {"symbol": stock["symbol"], "company": stock.get("company") or stock["symbol"],
                                          "fno": bool(flags & FLAG_FNO), "n50": bool(flags & FLAG_N50),
                                          "sensex": bool(flags & FLAG_SENSEX), "n500": bool(flags & FLAG_N500)}
            name = normalise_name(stock.get("company"))
            # Headlines drop a trailing "India": "Maruti Suzuki India" is written "Maruti Suzuki". One word left is too vague.
            short = re.sub(r"\s+(of\s+)?india$", "", name)
            for alias in (name, short) if short != name and len(short.split()) >= 2 else (name,):
                if len(alias) >= 4:
                    self.by_name.setdefault(alias, stock["symbol"])
                    names.append(alias)
            if len(stock["symbol"]) >= 3 and stock["symbol"] not in SYMBOL_STOPWORDS:
                symbols.append(stock["symbol"])
        longest_first = lambda values: sorted(set(values), key=len, reverse=True)
        spaced = lambda alias: r"\s+".join(map(re.escape, alias.split()))
        self.name_pattern = re.compile(r"(?<![a-z0-9])(" + "|".join(map(spaced, longest_first(names))) + r")(?![a-z0-9])") if names else None
        self.symbol_pattern = re.compile(r"(?<![A-Za-z0-9])(" + "|".join(map(re.escape, longest_first(symbols))) + r")(?![A-Za-z0-9])") if symbols else None
        self.aliases = [(re.compile(r"(?<![A-Za-z0-9])(?:" + pattern + r")(?![A-Za-z0-9])"), symbol)
                        for pattern, symbol in ALIASES if symbol in self.info]

    def company(self, name):
        """The symbol of a filing's company, matched on its full name."""
        return self.by_name.get(normalise_name(name))

    def mentions(self, text):
        """Stocks named in a headline, in the order they appear."""
        text, found = text or "", []
        if self.name_pattern:
            # One space per character keeps positions, so every kind of match can be put back in headline order.
            lowered = re.sub(r"[^a-z0-9& ]", " ", text.lower())
            found += [(match.start(), self.by_name[re.sub(r"\s+", " ", match.group(1))]) for match in self.name_pattern.finditer(lowered)]
        if self.symbol_pattern:
            found += [(match.start(), match.group(1)) for match in self.symbol_pattern.finditer(text)]
        found += [(match.start(), symbol) for pattern, symbol in self.aliases for match in pattern.finditer(text)]
        return list(dict.fromkeys(symbol for _, symbol in sorted(found, key=lambda pair: pair[0])))[:MAX_TAGS]


def current_matcher():
    """A matcher over the board's stock list, rebuilt when that list changes. No list (no contract file yet) means no tags."""
    try:
        stocks, _ = universe()
    except Exception as exc:
        log(f"News: stock list unavailable for tagging: {exc}", "info", log_in_file=False)
        stocks = []
    cached = _state["matcher"]
    if cached and cached[0] is stocks:
        return cached[1]
    matcher = StockMatcher(stocks)
    _state["matcher"] = (stocks, matcher)
    return matcher


def fetch(url):
    with requests.get(url, headers=HEADERS, timeout=TIMEOUT_SECONDS, stream=True) as response:
        response.raise_for_status()
        body = response.raw.read(MAX_BYTES + 1, decode_content=True)
    if len(body) > MAX_BYTES:
        raise ValueError("feed is larger than expected")
    return body


def refresh_feed(feed, now):
    key, publisher, url = feed
    previous = _state["feeds"].get(key, {})
    try:
        body = fetch(url)
        items = parse_announcements(body) if key == NSE_FEED[0] else parse_news(body, key, publisher)
        return key, {"at": now, "ok": True, "items": items, "error": ""}
    except Exception as exc:
        log(f"News: {publisher} feed failed: {exc}", "error")
        # Keep the last good items; try again sooner than a full refresh.
        return key, {"at": now - REFRESH_SECONDS / 2, "ok": False, "items": previous.get("items", []), "error": str(exc)[:200]}


def feeds(now=None):
    """{key: {"at", "ok", "items", "error"}} for every feed, refreshing the stale ones in parallel."""
    now = now if now is not None else time.time()
    all_feeds = NEWS_FEEDS + (NSE_FEED,)
    with _lock:
        stale = [feed for feed in all_feeds if now - _state["feeds"].get(feed[0], {}).get("at", -1e9) >= REFRESH_SECONDS]
        if stale:
            with ThreadPoolExecutor(max_workers=len(stale)) as pool:
                _state["feeds"].update(pool.map(lambda feed: refresh_feed(feed, now), stale))
        return dict(_state["feeds"])


def clear_cache():
    with _lock:
        _state.update(feeds={}, matcher=None)


def build_payload(feed_state, matcher):
    seen_urls, seen_titles, news = set(), set(), []
    for key, _, _ in NEWS_FEEDS:
        for item in feed_state.get(key, {}).get("items", []):
            title_key = re.sub(r"[^a-z0-9]", "", item["title"].lower())
            if item["url"] in seen_urls or title_key in seen_titles:
                continue
            seen_urls.add(item["url"])
            seen_titles.add(title_key)
            news.append({**item, "symbols": matcher.mentions(item["title"])})
    news.sort(key=lambda item: item["published"], reverse=True)
    announcements = []
    for row in feed_state.get(NSE_FEED[0], {}).get("items", []):
        symbol = matcher.company(row["company"])
        announcements.append({**row, "symbol": symbol})
    announcements.sort(key=lambda row: row["published"], reverse=True)
    news, announcements = news[:MAX_NEWS], announcements[:MAX_ANNOUNCEMENTS]
    used = {symbol for item in news for symbol in item["symbols"]} | {row["symbol"] for row in announcements if row["symbol"]}
    sources = [{"key": key, "name": name, "ok": feed_state.get(key, {}).get("ok", False), "error": feed_state.get(key, {}).get("error", ""),
                "count": len(feed_state.get(key, {}).get("items", []))} for key, name, _ in NEWS_FEEDS + (NSE_FEED,)]
    return {"news": news, "announcements": announcements, "stocks": {symbol: matcher.info[symbol] for symbol in sorted(used)},
            "sources": sources}


@gzip_page
@never_cache
@require_GET
def market_news(request):
    auth = protected(request)
    if isinstance(auth, JsonResponse):
        return auth
    payload = build_payload(feeds(), current_matcher())
    if not payload["news"] and not payload["announcements"]:
        return JsonResponse({"type": "success", **payload, "updated": dt.datetime.now(MARKET_TZ).isoformat(),
                             "message": "News sources are not responding right now. The page will try again shortly."})
    return JsonResponse({"type": "success", **payload, "updated": dt.datetime.now(MARKET_TZ).isoformat(), "message": ""})
