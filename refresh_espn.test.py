#!/usr/bin/env python3
"""Unit tests for the public ESPN snapshot refresh logic."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("refresh_espn.py")
spec = importlib.util.spec_from_file_location("matchday_refresh_espn", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class SeasonFallbackTests(unittest.TestCase):
    def test_uses_source_standings_metadata_when_season_catalogue_fails(self):
        current_standings = {
            "season": {"year": 2026, "displayName": "2026-27 Belgian Pro League"},
            "seasons": [
                {"year": 2026, "displayName": "2026-27 Belgian Pro League"},
                {"year": 2025, "displayName": "2025-26 Belgian Pro League"},
            ],
            "children": [{"standings": {"entries": [{"team": {"displayName": "Source Club"}}]}}],
        }
        requested = []
        original = module.get_url

        def fake_get_url(url):
            requested.append(url)
            if '/seasons?' in url:
                raise RuntimeError('ESPN season catalogue returned HTTP 500')
            if url.endswith('/bel.1/standings?region=us&lang=en'):
                return current_standings
            raise AssertionError(f'Unexpected URL: {url}')

        module.get_url = fake_get_url
        try:
            code, result = module.current_league_data('bel.1', None)
        finally:
            module.get_url = original

        self.assertEqual(code, 'bel.1')
        self.assertEqual(result['currentSeasonYear'], 2026)
        self.assertEqual(result['seasons'], [
            {'year': 2026, 'displayName': '2026-27 Belgian Pro League'},
            {'year': 2025, 'displayName': '2025-26 Belgian Pro League'},
        ])
        self.assertEqual(result['standings'], current_standings)
        self.assertTrue(result.get('standingsFetchedAt'))
        self.assertEqual(len(requested), 2)

    def test_competition_catalogue_includes_saudi_and_belgian_sources(self):
        self.assertIn('bel.1', module.LEAGUES)
        self.assertIn('ksa.1', module.LEAGUES)


if __name__ == '__main__':
    unittest.main()
