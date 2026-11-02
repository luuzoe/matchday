#!/usr/bin/env python3
"""Refresh Matchday's approved football RSS feeds without fetching article pages."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

FEEDS = (
    ("BBC Sport", "https://feeds.bbci.co.uk/sport/football/rss.xml?edition=int"),
    ("Sky Sports", "https://www.skysports.com/rss/11095"),
)
DATA_FILE = Path(__file__).resolve().parent / "data" / "news.json"
MIN_REFRESH_SECONDS = 15 * 60
MAX_ARTICLES = 25
DC_NS = "{http://purl.org/dc/elements/1.1/}"
USER_AGENT = "MatchdayNews/1.0 (+https://github.com/luuzoe/matchday)"


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError, OverflowError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def published_at(value: str) -> str:
    parsed = parse_timestamp(value)
    return parsed.isoformat(timespec="seconds").replace("+00:00", "Z") if parsed else ""


def canonical_link(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", "")).lower()
    except ValueError:
        return value.strip().lower()


def valid_article_url(value: str, source: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.scheme != "https" or not parsed.netloc:
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    if source == "BBC Sport":
        return host in {"bbc.co.uk", "bbc.com"} or host.endswith(".bbc.co.uk") or host.endswith(".bbc.com")
    return host == "skysports.com" or host.endswith(".skysports.com")


def item_text(item: ET.Element, names: tuple[str, ...]) -> str:
    for name in names:
        child = item.find(name)
        if child is not None:
            return "".join(child.itertext()).strip()
    return ""


def image_url(item: ET.Element) -> str:
    for element in item.iter():
        local_name = element.tag.rsplit("}", 1)[-1].lower() if isinstance(element.tag, str) else ""
        if local_name in {"thumbnail", "content", "enclosure"}:
            value = (element.attrib.get("url") or element.attrib.get("href") or "").strip()
            if value:
                return value
    return ""


def make_articles(root: ET.Element, source: str) -> list[dict[str, str]]:
    articles: list[dict[str, str]] = []
    for item in root.findall("./channel/item"):
        title = item_text(item, ("title",))
        link = item_text(item, ("link",))
        if not title or not valid_article_url(link, source):
            continue
        guid = item_text(item, ("guid", "id"))
        summary = item_text(item, ("description", "summary", "content"))
        author = item_text(item, (DC_NS + "creator", "author", "creator"))
        date = item_text(item, ("pubDate", "published", "updated", "date"))
        article = {
            "guid": guid,
            "title": title,
            "url": link,
            "description": summary,
            "author": author,
            "publishedAt": published_at(date),
            "publisher": source,
            "imageUrl": image_url(item),
        }
        articles.append(article)
    articles.sort(key=lambda row: row["publishedAt"], reverse=True)
    return articles[:MAX_ARTICLES]


def read_snapshot() -> dict:
    try:
        value = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def previous_feeds(snapshot: dict) -> dict[str, dict]:
    result: dict[str, dict] = {}
    feeds = snapshot.get("feeds")
    if isinstance(feeds, list):
        for feed in feeds:
            if isinstance(feed, dict) and isinstance(feed.get("feedUrl"), str):
                result[feed["feedUrl"]] = feed
    elif snapshot.get("feedUrl") == FEEDS[0][1]:
        # Migrate the existing BBC-only snapshot as stale-safe source data.
        result[FEEDS[0][1]] = {
            "title": snapshot.get("provider") or FEEDS[0][0],
            "feedUrl": FEEDS[0][1],
            "fetchedAt": snapshot.get("fetchedAt", ""),
            "articles": snapshot.get("articles", []) if isinstance(snapshot.get("articles"), list) else [],
        }
    return result


def snapshot_is_recent(now: datetime, snapshot: dict | None = None) -> bool:
    snapshot = read_snapshot() if snapshot is None else snapshot
    feeds = previous_feeds(snapshot)
    if len(feeds) != len(FEEDS):
        return False
    return all(
        not feed.get("error")
        and isinstance(feed.get("fetchedAt"), str)
        and (fetched := parse_timestamp(feed["fetchedAt"]))
        and (now - fetched).total_seconds() < MIN_REFRESH_SECONDS
        for _, url in FEEDS
        for feed in [feeds.get(url, {})]
    )


def fetch_feed(url: str) -> ET.Element:
    request = Request(url, headers={
        "Accept": "application/rss+xml, application/xml, text/xml",
        "User-Agent": USER_AGENT,
    })
    with urlopen(request, timeout=20) as response:
        return ET.fromstring(response.read())


def dedupe_feeds(feeds: list[dict]) -> list[dict]:
    seen: set[str] = set()
    output: list[dict] = []
    for feed in feeds:
        articles = []
        for article in feed.get("articles", []):
            key = canonical_link(str(article.get("url", "")))
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            articles.append(article)
        feed["articles"] = articles
        output.append(feed)
    return output


def write_snapshot(payload: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = DATA_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(DATA_FILE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Fetch RSS even when the saved feeds are under 15 minutes old.")
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    existing = read_snapshot()
    if not args.force and snapshot_is_recent(now, existing):
        print("Football news feeds are less than 15 minutes old; skipping RSS requests.")
        return 0

    old = previous_feeds(existing)
    refreshed: list[dict] = []
    failures = 0
    for title, url in FEEDS:
        previous = old.get(url, {})
        try:
            articles = make_articles(fetch_feed(url), title)
            if not articles:
                raise ValueError("RSS returned no verified football stories")
            refreshed.append({"title": title, "feedUrl": url, "fetchedAt": stamp(), "articles": articles})
        except Exception as exc:
            failures += 1
            stale = {
                "title": previous.get("title") or title,
                "feedUrl": url,
                "fetchedAt": previous.get("fetchedAt", ""),
                "articles": previous.get("articles", []) if isinstance(previous.get("articles"), list) else [],
                "stale": True,
                "error": f"{type(exc).__name__}: {exc}",
            }
            refreshed.append(stale)
            print(f"{title} RSS refresh failed; retaining its previous source items ({stale['error']}).", file=sys.stderr)

    feeds = dedupe_feeds(refreshed)
    if not any(feed.get("articles") for feed in feeds):
        print("All football RSS feeds failed and no previous source items were available; snapshot was not written.", file=sys.stderr)
        return 1
    write_snapshot({"provider": "Football news feeds", "feeds": feeds})
    total = sum(len(feed.get("articles", [])) for feed in feeds)
    print(f"Football news feeds refreshed: {total} articles across {len(FEEDS)} sources.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
