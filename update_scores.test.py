#!/usr/bin/env python3
"""Unit tests for source-derived OpenLigaDB scorer totals."""
from __future__ import annotations

import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("update_scores.py")
spec = importlib.util.spec_from_file_location("matchday_update_scores", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class PlayerScorerStatsTests(unittest.TestCase):
    def test_counts_named_non_own_goal_records_and_reports_gaps(self):
        matches = [{
            "team1": {"teamId": 11, "teamName": "Alpha FC"},
            "team2": {"teamId": 22, "teamName": "Beta FC"},
            "goals": [
                {"goalGetterID": 501, "goalGetterName": "Alex Example", "scoringTeamId": 11, "isOwnGoal": False},
                {"goalGetterID": 501, "goalGetterName": "Alex Example", "scoringTeamId": 11, "isOwnGoal": False},
                {"goalGetterName": "  ", "scoringTeamId": 22, "isOwnGoal": False},
                {"goalGetterID": 777, "goalGetterName": "Own-goal player", "scoringTeamId": 22, "isOwnGoal": True},
            ],
        }]
        result = module.player_scorer_stats(matches)
        self.assertEqual(result["provider"], "OpenLigaDB")
        self.assertEqual(result["license"], "ODbL-1.0")
        self.assertEqual(result["coverage"]["goalEventsInSourceResponse"], 4)
        self.assertEqual(result["coverage"]["namedGoalEventsCounted"], 2)
        self.assertEqual(result["coverage"]["goalEventsNotCounted"], 2)
        self.assertEqual(result["players"], [{"name": "Alex Example", "goals": 2, "teams": ["Alpha FC"]}])

    def test_does_not_create_players_from_empty_or_unattributed_records(self):
        result = module.player_scorer_stats([{"goals": [{"goalGetterName": None}, {}]}])
        self.assertEqual(result["players"], [])
        self.assertEqual(result["coverage"]["goalEventsInSourceResponse"], 2)
        self.assertEqual(result["coverage"]["goalEventsNotCounted"], 2)


class FullSyncTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 2, 11, 0, tzinfo=timezone.utc)
        self.comp = {"id": 1, "shortcut": "pl", "season": 2026, "playerStats": {"players": []}, "playerStatsUpdatedAt": "2026-11-02T11:00:00Z"}
        self.previous = {
            "schemaVersion": 2,
            "season": 2026,
            "competitions": [self.comp],
            "fullSyncAt": "2026-11-02T11:00:00Z",
        }
        self.current_ids = [(1, "pl", 2026)]

    def test_full_sync_becomes_due_after_ten_minutes(self):
        self.assertFalse(module.full_sync_due(self.previous, self.current_ids, 2026, self.now + timedelta(minutes=9)))
        self.assertTrue(module.full_sync_due(self.previous, self.current_ids, 2026, self.now + timedelta(minutes=10)))

    def test_missing_sync_timestamp_forces_full_refresh(self):
        self.previous.pop("fullSyncAt")
        self.assertTrue(module.full_sync_due(self.previous, self.current_ids, 2026, self.now))

    def test_competition_or_season_change_forces_full_refresh(self):
        self.assertTrue(module.full_sync_due(self.previous, [(2, "la1", 2026)], 2026, self.now))
        self.assertTrue(module.full_sync_due(self.previous, self.current_ids, 2027, self.now))


if __name__ == "__main__":
    unittest.main()
