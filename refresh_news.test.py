#!/usr/bin/env python3
"""Offline tests for the two-source Matchday RSS refresher."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

MODULE_PATH = Path(__file__).with_name("refresh_news.py")
spec = importlib.util.spec_from_file_location("matchday_refresh_news", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

BBC_XML = b'''<rss><channel><item>
<title>BBC headline</title><link>https://www.bbc.co.uk/sport/football/articles/bbc-1?tracking=1</link>
<description><![CDATA[The BBC summary.]]></description><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">BBC Author</dc:creator>
<pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><guid>bbc-guid</guid>
<media:thumbnail xmlns:media="http://search.yahoo.com/mrss/" url="https://ichef.bbci.co.uk/image.jpg" />
</item></channel></rss>'''
SKY_XML = b'''<rss><channel><item>
<title>Sky headline</title><link>https://www.skysports.com/football/news/sky-1</link>
<description>Sky summary</description><author>Sky Author</author>
<pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><guid>sky-guid</guid>
<enclosure url="https://img.skysports.com/image.jpg" />
</item></channel></rss>'''


class ParsingTests(unittest.TestCase):
    def test_parses_bbc_source_fields(self):
        articles = module.make_articles(ET.fromstring(BBC_XML), "BBC Sport")
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["title"], "BBC headline")
        self.assertEqual(articles[0]["description"], "The BBC summary.")
        self.assertEqual(articles[0]["author"], "BBC Author")
        self.assertEqual(articles[0]["publishedAt"], "2026-11-02T10:00:00Z")
        self.assertEqual(articles[0]["imageUrl"], "https://ichef.bbci.co.uk/image.jpg")

    def test_parses_sky_source_fields_and_keeps_original_url(self):
        articles = module.make_articles(ET.fromstring(SKY_XML), "Sky Sports")
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["url"], "https://www.skysports.com/football/news/sky-1")
        self.assertEqual(articles[0]["description"], "Sky summary")
        self.assertEqual(articles[0]["author"], "Sky Author")
        self.assertEqual(articles[0]["imageUrl"], "https://img.skysports.com/image.jpg")


class FailureRetentionTests(unittest.TestCase):
    def test_sky_failure_retains_previous_items_and_fetched_at(self):
        with tempfile.TemporaryDirectory() as directory:
            data_file = Path(directory) / "news.json"
            previous = {
                "provider": "Football news feeds",
                "feeds": [
                    {"title": "BBC Sport", "feedUrl": module.FEEDS[0][1], "fetchedAt": "2026-11-02T09:00:00Z", "articles": []},
                    {"title": "Sky Sports", "feedUrl": module.FEEDS[1][1], "fetchedAt": "2026-11-02T09:01:00Z", "articles": [{"url": "https://www.skysports.com/football/news/old", "title": "Old Sky"}]},
                ],
            }
            data_file.write_text(json.dumps(previous), encoding="utf-8")
            responses = {module.FEEDS[0][1]: ET.fromstring(BBC_XML), module.FEEDS[1][1]: RuntimeError("offline")}

            def fake_fetch(url):
                value = responses[url]
                if isinstance(value, Exception):
                    raise value
                return value

            with patch.object(module, "DATA_FILE", data_file), patch.object(module, "fetch_feed", side_effect=fake_fetch), patch.object(sys, "argv", ["refresh_news.py", "--force"]):
                self.assertEqual(module.main(), 1)

            result = json.loads(data_file.read_text(encoding="utf-8"))
            sky = next(feed for feed in result["feeds"] if feed["feedUrl"] == module.FEEDS[1][1])
            self.assertTrue(sky["stale"])
            self.assertIn("RuntimeError: offline", sky["error"])
            self.assertEqual(sky["fetchedAt"], "2026-11-02T09:01:00Z")
            self.assertEqual(sky["articles"][0]["url"], "https://www.skysports.com/football/news/old")
            bbc = next(feed for feed in result["feeds"] if feed["feedUrl"] == module.FEEDS[0][1])
            self.assertEqual(bbc["articles"][0]["title"], "BBC headline")


if __name__ == "__main__":
    unittest.main()
