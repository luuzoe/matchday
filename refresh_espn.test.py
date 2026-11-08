#!/usr/bin/env python3
"""Unit tests for the public ESPN snapshot refresh logic."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
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


class LeagueCacheFreshnessTests(unittest.TestCase):
    def test_failed_league_remains_stale_even_when_another_league_is_fresh(self):
        now = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
        stale = {
            'seasonsFetchedAt': (now - timedelta(minutes=20)).isoformat().replace('+00:00', 'Z'),
            'standingsFetchedAt': (now - timedelta(minutes=20)).isoformat().replace('+00:00', 'Z'),
            'standings': {'preserved': True},
        }
        fresh = {
            'seasonsFetchedAt': now.isoformat().replace('+00:00', 'Z'),
            'standingsFetchedAt': now.isoformat().replace('+00:00', 'Z'),
            'standings': {'fresh': True},
        }
        self.assertTrue(module.league_data_needs_refresh(stale, now))
        self.assertFalse(module.league_data_needs_refresh(fresh, now))

    def test_failed_refresh_keeps_old_entry_and_success_updates_only_its_league(self):
        old_league = {
            'seasonsFetchedAt': '2026-11-02T11:00:00Z',
            'standingsFetchedAt': '2026-11-02T11:00:00Z',
            'standings': {'preserved': True},
        }
        competitions = {'bel.1': dict(old_league)}
        self.assertFalse(module.merge_league_refresh(competitions, 'bel.1', dict(old_league)))
        self.assertEqual(competitions['bel.1'], old_league)

        fresh = {
            'seasonsFetchedAt': '2026-11-02T12:00:00Z',
            'standingsFetchedAt': '2026-11-02T12:00:00Z',
            'standings': {'fresh': True},
        }
        self.assertTrue(module.merge_league_refresh(competitions, 'eng.1', fresh))
        self.assertEqual(competitions['bel.1'], old_league)
        self.assertEqual(competitions['eng.1'], fresh)




def _totw_player(athlete_id, name, abbr):
    return {'athlete': {'id': athlete_id, 'displayName': name}, 'position': {'abbreviation': abbr}, 'starter': True}


def _totw_side(home_away, team, roster):
    return {'homeAway': home_away, 'team': {'displayName': team}, 'roster': roster}


def _totw_goal(text, scorer, assister=None):
    participants = [{'athlete': {'displayName': scorer}}]
    if assister:
        participants.append({'athlete': {'displayName': assister}})
    return {'scoringPlay': True, 'type': {'text': text}, 'participants': participants}


def _totw_event(date, home_team, home_score, away_team, away_score, state='post'):
    completed = state == 'post'
    return {
        'date': date,
        'status': {'type': {'state': state, 'completed': completed}},
        'competitions': [{'competitors': [
            {'homeAway': 'home', 'team': {'displayName': home_team}, 'score': str(home_score)},
            {'homeAway': 'away', 'team': {'displayName': away_team}, 'score': str(away_score)},
        ]}],
    }


def _totw_summary(home_team, away_team, home_roster, away_roster, key_events):
    return {
        'provider': 'ESPN',
        'fetchedAt': '2026-11-07T12:00:00Z',
        'league': 'eng.1',
        'data': {
            'rosters': [
                _totw_side('home', home_team, home_roster),
                _totw_side('away', away_team, away_roster),
            ],
            'keyEvents': key_events,
        },
    }


class TeamOfTheWeekTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.now = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.tmp.cleanup()

    def _write_summary(self, event_id, summary):
        (self.dir / f'{event_id}.json').write_text(json.dumps(summary), encoding='utf-8')

    def _arsenal_chelsea(self):
        arsenal = [
            _totw_player(1, 'David Raya', 'G'),
            _totw_player(2, 'Riccardo Calafiori', 'LB'),
            _totw_player(3, 'Gabriel Magalhães', 'CD-L'),
            _totw_player(4, 'William Saliba', 'CD'),
            _totw_player(5, 'Jurriën Timber', 'RB'),
            _totw_player(6, 'Declan Rice', 'DM'),
            _totw_player(7, 'Martin Ødegaard', 'AM'),
            _totw_player(8, 'Mikel Merino', 'CM'),
            _totw_player(9, 'Gabriel Martinelli', 'LF'),
            _totw_player(10, 'Bukayo Saka', 'RF'),
            _totw_player(11, 'Viktor Gyökeres', 'CF-L'),
        ]
        chelsea = [
            _totw_player(12, 'Robert Sánchez', 'G'),
            _totw_player(13, 'Marc Cucurella', 'LB'),
            _totw_player(14, 'Levi Colwill', 'CD'),
            _totw_player(15, 'Wesley Fofana', 'CD-R'),
            _totw_player(16, 'Reece James', 'RB'),
            _totw_player(17, 'Moisés Caicedo', 'DM'),
            _totw_player(18, 'Enzo Fernández', 'CM'),
            _totw_player(19, 'Cole Palmer', 'AM'),
            _totw_player(20, 'Pedro Neto', 'RF'),
            _totw_player(21, 'Nicolas Jackson', 'F'),
            _totw_player(22, 'Jamie Gittens', 'LF'),
        ]
        events = [
            _totw_goal('Goal', 'Bukayo Saka', 'Martin Ødegaard'),
            _totw_goal('Goal', 'Bukayo Saka', 'Martin Ødegaard'),
            _totw_goal('Goal - Header', 'Viktor Gyökeres', 'Gabriel Martinelli'),
            _totw_goal('Own Goal', 'Levi Colwill'),
        ]
        return arsenal, chelsea, events

    def test_counts_scorers_assists_and_clean_sheets_and_fills_formation(self):
        arsenal, chelsea, key_events = self._arsenal_chelsea()
        self._write_summary('1001', _totw_summary('Arsenal', 'Chelsea', arsenal, chelsea, key_events))
        madrid = [
            _totw_player(31, 'Thibaut Courtois', 'G'),
            _totw_player(32, 'Álvaro Carreras', 'LB'),
            _totw_player(33, 'Dean Huijsen', 'CD'),
            _totw_player(34, 'Éder Militão', 'CD-R'),
            _totw_player(35, 'Trent Alexander-Arnold', 'RB'),
            _totw_player(36, 'Aurélien Tchouaméni', 'DM'),
            _totw_player(37, 'Federico Valverde', 'CM'),
            _totw_player(38, 'Jude Bellingham', 'AM'),
            _totw_player(39, 'Vinícius Júnior', 'LF'),
            _totw_player(40, 'Kylian Mbappé', 'F'),
            _totw_player(41, 'Rodrygo', 'RF'),
        ]
        barca = [
            _totw_player(42, 'Marc-André ter Stegen', 'G'),
            _totw_player(43, 'Alejandro Balde', 'LB'),
            _totw_player(44, 'Pau Cubarsí', 'CD'),
            _totw_player(45, 'Ronald Araújo', 'CD-R'),
            _totw_player(46, 'Jules Koundé', 'RB'),
            _totw_player(47, 'Frenkie de Jong', 'DM'),
            _totw_player(48, 'Pedri', 'CM'),
            _totw_player(49, 'Dani Olmo', 'AM'),
            _totw_player(50, 'Lamine Yamal', 'RF'),
            _totw_player(51, 'Robert Lewandowski', 'F'),
            _totw_player(52, 'Raphinha', 'LF'),
        ]
        self._write_summary('1002', _totw_summary('Real Madrid', 'Barcelona', madrid, barca, [
            _totw_goal('Goal', 'Kylian Mbappé', 'Jude Bellingham'),
            _totw_goal('Penalty - Scored', 'Lamine Yamal'),
        ]))
        # A live match with a hat-trick must not count: only completed matches do.
        self._write_summary('1003', _totw_summary('Manchester City', 'Liverpool', [
            _totw_player(61, 'Erling Haaland', 'F'),
        ], [
            _totw_player(62, 'Alisson Becker', 'G'),
        ], [
            _totw_goal('Goal', 'Erling Haaland'),
            _totw_goal('Goal', 'Erling Haaland'),
            _totw_goal('Goal', 'Erling Haaland'),
        ]))
        # A completed match 8 days ago is outside the 7-day window.
        self._write_summary('1004', _totw_summary('Manchester City', 'Liverpool', [
            _totw_player(61, 'Erling Haaland', 'F'),
        ], [
            _totw_player(62, 'Alisson Becker', 'G'),
        ], [
            _totw_goal('Goal', 'Erling Haaland'),
        ]))
        events = {
            '1001': ('eng.1', _totw_event('2026-11-07T16:30:00Z', 'Arsenal', 2, 'Chelsea', 0)),
            '1002': ('esp.1', _totw_event('2026-11-05T20:00:00Z', 'Real Madrid', 1, 'Barcelona', 1)),
            '1003': ('eng.1', _totw_event('2026-11-08T11:00:00Z', 'Manchester City', 3, 'Liverpool', 0, state='in')),
            '1004': ('eng.1', _totw_event('2026-10-31T15:00:00Z', 'Manchester City', 1, 'Liverpool', 0)),
            # 1005 is completed and in-window but has no summary file, so it is not counted.
            '1005': ('eng.1', _totw_event('2026-11-06T19:45:00Z', 'Tottenham Hotspur', 2, 'Newcastle United', 1)),
        }
        result = module.build_team_of_the_week(events, self.now, summaries_dir=self.dir)

        self.assertEqual(result['provider'], 'ESPN')
        self.assertEqual(result['formation'], '4-3-3')
        self.assertEqual(result['matchesConsidered'], 2)
        self.assertIn('Own goals excluded', result['method'])
        by_slot = {player['slot']: player for player in result['players']}
        self.assertEqual(list(by_slot), ['GK', 'DF1', 'DF2', 'DF3', 'DF4', 'MF1', 'MF2', 'MF3', 'FW1', 'FW2', 'FW3'])
        # Goalkeeper: the only clean sheet in the window, with 0 conceded.
        self.assertEqual(by_slot['GK']['name'], 'David Raya')
        self.assertEqual(by_slot['GK']['cleanSheets'], 1)
        # Defenders: the four Arsenal starters all kept a clean sheet.
        self.assertEqual({by_slot[f'DF{i}']['name'] for i in range(1, 5)},
                         {'Riccardo Calafiori', 'Gabriel Magalhães', 'William Saliba', 'Jurriën Timber'})
        self.assertEqual(by_slot['DF1']['name'], 'Gabriel Magalhães')
        self.assertEqual(by_slot['DF1']['cleanSheets'], 1)
        # Midfield: Ødegaard assisted both Saka goals; Bellingham assisted Mbappé.
        self.assertEqual(by_slot['MF1']['name'], 'Martin Ødegaard')
        self.assertEqual(by_slot['MF1']['assists'], 2)
        self.assertEqual(by_slot['MF2']['name'], 'Jude Bellingham')
        self.assertEqual(by_slot['MF2']['assists'], 1)
        self.assertEqual(by_slot['MF3']['name'], 'Aurélien Tchouaméni')
        # Forwards: Saka scored twice; Mbappé and Yamal once each.
        self.assertEqual(by_slot['FW1']['name'], 'Bukayo Saka')
        self.assertEqual(by_slot['FW1']['goals'], 2)
        self.assertEqual(by_slot['FW2']['name'], 'Kylian Mbappé')
        self.assertEqual(by_slot['FW3']['name'], 'Lamine Yamal')
        # The own goal never counted, and the live/old matches never counted.
        self.assertNotIn('Levi Colwill', [player['name'] for player in result['players']])
        self.assertNotIn('Erling Haaland', [player['name'] for player in result['players']])
        self.assertEqual(result['missingSlots'], [])

    def test_own_goal_never_counts_as_a_goal(self):
        arsenal, chelsea, _ = self._arsenal_chelsea()
        self._write_summary('2001', _totw_summary('Arsenal', 'Chelsea', arsenal, chelsea, [
            _totw_goal('Own Goal', 'Nicolas Jackson'),
        ]))
        events = {
            '2001': ('eng.1', _totw_event('2026-11-07T16:30:00Z', 'Arsenal', 1, 'Chelsea', 0)),
        }
        result = module.build_team_of_the_week(events, self.now, summaries_dir=self.dir)
        by_slot = {player['slot']: player for player in result['players']}
        # If the own goal counted, Jackson would lead the forwards with 1 goal.
        self.assertEqual(by_slot['FW1']['name'], 'Bukayo Saka')
        self.assertEqual(by_slot['FW1']['goals'], 0)
        self.assertEqual(by_slot['FW3']['name'], 'Jamie Gittens')
        self.assertEqual(by_slot['FW3']['goals'], 0)
        self.assertTrue(all(player['goals'] == 0 for player in result['players']))

    def test_returns_none_when_no_completed_match_qualifies(self):
        self.assertIsNone(module.build_team_of_the_week({}, self.now, summaries_dir=self.dir))
        events = {
            '3001': ('eng.1', _totw_event('2026-11-08T11:00:00Z', 'Arsenal', 0, 'Chelsea', 0, state='in')),
        }
        self.assertIsNone(module.build_team_of_the_week(events, self.now, summaries_dir=self.dir))

    def test_position_abbreviations_map_to_lines(self):
        self.assertEqual(module.TOTW_POSITION_LINES['G'], 'GK')
        self.assertEqual(module.TOTW_POSITION_LINES['CD-L'], 'DF')
        self.assertEqual(module.TOTW_POSITION_LINES['RB'], 'DF')
        self.assertEqual(module.TOTW_POSITION_LINES['SW'], 'DF')
        self.assertEqual(module.TOTW_POSITION_LINES['DM'], 'MF')
        self.assertEqual(module.TOTW_POSITION_LINES['AM-R'], 'MF')
        self.assertEqual(module.TOTW_POSITION_LINES['CF-R'], 'FW')
        self.assertEqual(module.TOTW_POSITION_LINES['RCF'], 'FW')
        self.assertNotIn('SUB', module.TOTW_POSITION_LINES)


if __name__ == '__main__':
    unittest.main()
