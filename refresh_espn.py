#!/usr/bin/env python3
"""Cache owner-approved ESPN public feed responses for the static website.

No scores, players, events or statistics are inferred. The browser retains the
source fetch time and labels this fallback as a snapshot. The existing GitHub
refresh workflow owns recurring execution; this script is finite.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent / 'data' / 'espn'
BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
COMMON_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/soccer'
WEB_BASE = 'https://site.web.api.espn.com/apis/v2/sports/soccer'
LEAGUES = [
    'eng.1', 'eng.2', 'eng.3', 'eng.4', 'eng.fa', 'eng.league_cup',
    'esp.1', 'esp.2', 'esp.copa_del_rey', 'ger.1', 'ger.2', 'ger.dfb_pokal',
    'ita.1', 'ita.2', 'ita.coppa_italia', 'fra.1', 'fra.2', 'ned.1', 'por.1',
    'bel.1', 'ksa.1', 'sco.1', 'usa.1', 'mex.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf'
]
WORKERS = 6
LEAGUE_DATA_REFRESH_SECONDS = 240


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def read(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(path)


def get_url(url):
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'MatchdayStaticFeed/1.0'})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def get(path):
    return get_url(f'{BASE}/{path}')


def current_league_data(code, previous):
    result = dict(previous or {})
    previous_year = int(result.get('currentSeasonYear') or 0)
    result['provider'] = 'ESPN'
    try:
        payload = get_url(f'{COMMON_BASE}/{code}/seasons?region=us&lang=en')
    except Exception as catalogue_error:
        # Some ESPN competitions fail on /seasons even though standings include
        # an authoritative current season and the complete season list.
        try:
            standings = get_url(f'{WEB_BASE}/{code}/standings?region=us&lang=en')
            season = standings.get('season') or {}
            year = int(season.get('year') or 0)
            if not year or not season.get('displayName'):
                raise ValueError('Current ESPN standings omitted authoritative season metadata')
            seasons = [
                {'year': int(item['year']), 'displayName': str(item['displayName'])}
                for item in (standings.get('seasons') or [])
                if item.get('year') and item.get('displayName')
            ]
            if not any(item['year'] == year for item in seasons):
                seasons.append({'year': year, 'displayName': str(season['displayName'])})
            refreshed_at = stamp()
            result.update({'seasons': seasons, 'currentSeasonYear': year, 'seasonsFetchedAt': refreshed_at, 'standings': standings, 'standingsFetchedAt': refreshed_at})
            result.pop('standingsError', None)
            print(f'League {code}: cached current-season standings and season list after catalogue {type(catalogue_error).__name__}', flush=True)
            return code, result
        except Exception as standings_error:
            print(f'League data {code}: season catalogue and fallback standings failed ({type(standings_error).__name__})', flush=True)
            return code, previous
    try:
        seasons = [
            {'year': int(item['year']), 'displayName': str(item['displayName'])}
            for item in payload.get('seasons', [])
            if item.get('year') and item.get('displayName')
        ]
        if not seasons:
            raise ValueError('No season list returned')
        year = max(item['year'] for item in seasons)
        result.update({'seasons': seasons, 'currentSeasonYear': year, 'seasonsFetchedAt': stamp()})
        try:
            standings = get_url(f'{WEB_BASE}/{code}/standings?region=us&lang=en&season={year}')
            returned_year = int((standings.get('season') or {}).get('year') or year)
            if returned_year != year:
                raise ValueError(f'ESPN returned standings for {returned_year}, expected {year}')
            result.update({'standings': standings, 'standingsFetchedAt': stamp()})
            result.pop('standingsError', None)
        except Exception as exc:
            result['standingsError'] = type(exc).__name__
            if previous_year != year:
                result.pop('standings', None)
                result.pop('standingsFetchedAt', None)
        return code, result
    except Exception as exc:
        print(f'League data {code}: preserving previous response ({type(exc).__name__})', flush=True)
        return code, previous


def age(payload):
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(payload['fetchedAt'].replace('Z', '+00:00'))).total_seconds()
    except (KeyError, TypeError, ValueError):
        return float('inf')


def timestamp_age(value, now=None):
    try:
        refreshed_at = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if refreshed_at.tzinfo is None:
            refreshed_at = refreshed_at.replace(tzinfo=timezone.utc)
        return ((now or datetime.now(timezone.utc)) - refreshed_at).total_seconds()
    except (TypeError, ValueError):
        return float('inf')


def league_data_needs_refresh(payload, now=None):
    if not isinstance(payload, dict):
        return True
    return any(
        timestamp_age(payload.get(field), now) > LEAGUE_DATA_REFRESH_SECONDS
        for field in ('seasonsFetchedAt', 'standingsFetchedAt')
    )


def merge_league_refresh(competitions, code, payload):
    previous = competitions.get(code)
    if not isinstance(payload, dict):
        return False
    refreshed = any(
        payload.get(field) and payload.get(field) != (previous or {}).get(field)
        for field in ('seasonsFetchedAt', 'standingsFetchedAt')
    )
    if not refreshed:
        return False
    competitions[code] = payload
    return True


TOTW_SCORING_TYPES = {'Goal', 'Penalty - Scored', 'Goal - Header', 'Goal - Volley', 'Goal - Free-kick'}
TOTW_POSITION_LINES = {
    'G': 'GK',
    'CD': 'DF', 'CD-L': 'DF', 'CD-R': 'DF', 'LB': 'DF', 'RB': 'DF', 'D': 'DF', 'SW': 'DF',
    'CM': 'MF', 'CM-L': 'MF', 'CM-R': 'MF', 'LM': 'MF', 'RM': 'MF', 'AM': 'MF',
    'AM-L': 'MF', 'AM-R': 'MF', 'DM': 'MF', 'M': 'MF',
    'F': 'FW', 'CF-L': 'FW', 'CF-R': 'FW', 'LF': 'FW', 'RF': 'FW', 'RCF': 'FW',
}
TOTW_FORMATION = {'GK': 1, 'DF': 4, 'MF': 3, 'FW': 3}
TOTW_METHOD = 'Selected from completed matches in the last 7 days: most goal involvements by position; defenders ranked by clean sheets, then goal involvements. Own goals excluded.'


def _totw_event_completed(event):
    status = (event.get('status') or {}).get('type') or {}
    return status.get('state') == 'post' or bool(status.get('completed'))


def _totw_event_date(event):
    try:
        parsed = datetime.fromisoformat(str(event.get('date', '')).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _totw_competitor_scores(event):
    scores = {}
    try:
        competitors = (event.get('competitions') or [{}])[0].get('competitors') or []
        for competitor in competitors:
            side = competitor.get('homeAway')
            if side:
                scores[side] = int(competitor.get('score') or 0)
    except (TypeError, ValueError):
        return {}
    return scores


def build_team_of_the_week(events, now, summaries_dir=None):
    """Build the Team of the Week from completed matches in the last 7 days.

    events is {event_id: (league_code, event)} from cached scoreboards.
    Only data actually returned by ESPN is used: goals and assists from
    match summaries, positions from starting lineups, clean sheets from
    final scores. Substitutes are never used (their position is SUB).
    Returns None when no completed match qualifies, so the caller can
    preserve the previous file instead of publishing an empty team.
    """
    summaries_dir = summaries_dir or (ROOT / 'summaries')
    window_start = now - timedelta(days=7)
    players = {}
    matches_considered = 0

    def record(athlete_id, name, team, league, line):
        key = (str(athlete_id) if athlete_id is not None else '', name, team)
        entry = players.get(key)
        if entry is None:
            entry = {
                'athleteId': str(athlete_id) if athlete_id is not None else None,
                'name': name, 'team': team, 'league': league, 'line': line,
                'goals': 0, 'assists': 0, 'cleanSheets': 0, 'conceded': 0,
            }
            players[key] = entry
        return entry

    for event_id, (code, event) in events.items():
        if not _totw_event_completed(event):
            continue
        event_date = _totw_event_date(event)
        if event_date is None or event_date < window_start or event_date > now:
            continue
        summary = read(summaries_dir / f'{event_id}.json')
        data = (summary or {}).get('data') or {}
        if not data:
            continue
        matches_considered += 1
        scores = _totw_competitor_scores(event)
        starters_by_name = {}
        for side in data.get('rosters') or []:
            team_name = ((side.get('team') or {}).get('displayName') or '')
            home_away = side.get('homeAway')
            conceded = scores.get('away' if home_away == 'home' else 'home')
            for entry in side.get('roster') or []:
                if entry.get('starter') is not True:
                    continue
                athlete = entry.get('athlete') or {}
                name = athlete.get('displayName') or athlete.get('fullName') or ''
                line = TOTW_POSITION_LINES.get((entry.get('position') or {}).get('abbreviation'))
                if not name or line is None:
                    continue
                player = record(athlete.get('id'), name, team_name, code, line)
                starters_by_name.setdefault(name, player)
                if conceded is not None:
                    if conceded == 0:
                        player['cleanSheets'] += 1
                    if line == 'GK':
                        player['conceded'] += conceded
        for key_event in data.get('keyEvents') or []:
            if not key_event.get('scoringPlay'):
                continue
            event_type = ((key_event.get('type') or {}).get('text') or '')
            # 'Own Goal' is not a scoring type and is excluded entirely.
            if event_type not in TOTW_SCORING_TYPES:
                continue
            participants = key_event.get('participants') or []
            if not participants:
                continue
            scorer = (participants[0].get('athlete') or {}).get('displayName') or ''
            if scorer in starters_by_name:
                starters_by_name[scorer]['goals'] += 1
            if len(participants) > 1:
                assister = (participants[1].get('athlete') or {}).get('displayName') or ''
                if assister in starters_by_name:
                    starters_by_name[assister]['assists'] += 1
    if not matches_considered:
        return None

    def involvement(entry):
        return entry['goals'] * 2 + entry['assists']

    ranked = {}
    for line in ('GK', 'DF', 'MF', 'FW'):
        line_players = [entry for entry in players.values() if entry['line'] == line]
        if line == 'GK':
            line_players.sort(key=lambda entry: (-entry['cleanSheets'], entry['conceded'], entry['name']))
        elif line == 'DF':
            line_players.sort(key=lambda entry: (-(entry['cleanSheets'] * 3 + involvement(entry)), -entry['cleanSheets'], -entry['goals'], entry['name']))
        else:
            line_players.sort(key=lambda entry: (-involvement(entry), -entry['goals'], -entry['assists'], entry['name']))
        ranked[line] = line_players

    selected = []
    missing_slots = []
    for line in ('GK', 'DF', 'MF', 'FW'):
        count = TOTW_FORMATION[line]
        picked = ranked[line][:count]
        for index, entry in enumerate(picked, start=1):
            selected.append({
                'slot': 'GK' if line == 'GK' else f'{line}{index}',
                'athleteId': entry['athleteId'], 'name': entry['name'],
                'team': entry['team'], 'league': entry['league'],
                'goals': entry['goals'], 'assists': entry['assists'],
                'cleanSheets': entry['cleanSheets'],
            })
        if len(picked) < count:
            missing_slots.append(f'{line}: {len(picked)} of {count} filled')
    return {
        'provider': 'ESPN',
        'fetchedAt': stamp(),
        'windowStart': window_start.isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'windowEnd': now.isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'matchesConsidered': matches_considered,
        'formation': '4-3-3',
        'method': TOTW_METHOD,
        'missingSlots': missing_slots,
        'players': selected,
    }


def main():
    now = datetime.now(timezone.utc)
    team_file = ROOT / 'teams.json'
    previous = read(team_file)
    previous_directories = dict((previous or {}).get('leagues', {}))
    missing_directories = set(LEAGUES) - set(previous_directories)
    if not previous or age(previous) > 86400 or missing_directories:
        directories = previous_directories
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            jobs = {pool.submit(get, f'{code}/teams?limit=500'): code for code in LEAGUES}
            for job in as_completed(jobs):
                code = jobs[job]
                try:
                    directories[code] = job.result()
                except Exception as exc:
                    print(f'Directory {code}: preserving previous response ({type(exc).__name__})', flush=True)
        if directories:
            write(team_file, {'provider': 'ESPN', 'fetchedAt': stamp(), 'leagues': directories})
        print(f'Team directories cached: {len(directories)}', flush=True)
    league_data_path = ROOT / 'league-data.json'
    previous_league_data = read(league_data_path)
    previous_competitions = dict((previous_league_data or {}).get('competitions', {}))
    refresh_competitions = [code for code in LEAGUES if league_data_needs_refresh(previous_competitions.get(code), now)]
    if refresh_competitions:
        competitions = previous_competitions
        updated_count = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            jobs = {pool.submit(current_league_data, code, competitions.get(code)): code for code in refresh_competitions}
            for job in as_completed(jobs):
                code = jobs[job]
                try:
                    result_code, payload = job.result()
                    updated_count += int(merge_league_refresh(competitions, result_code, payload))
                except Exception as exc:
                    print(f'League data {code}: preserving previous response ({type(exc).__name__})', flush=True)
        if updated_count:
            write(league_data_path, {'provider': 'ESPN', 'fetchedAt': stamp(), 'competitions': competitions})
        stale_count = sum(1 for code in refresh_competitions if league_data_needs_refresh(competitions.get(code)))
        print(f'League catalogues and current tables cached: {len(competitions)}; still stale/unavailable: {stale_count}', flush=True)
    news_path = ROOT / 'news.json'
    previous_news = read(news_path)
    if not previous_news or age(previous_news) > 600:
        news = dict((previous_news or {}).get('competitions', {}))
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            jobs = {pool.submit(get, f'{code}/news?limit=25'): code for code in LEAGUES}
            for job in as_completed(jobs):
                code = jobs[job]
                try:
                    payload = job.result()
                    articles = payload.get('articles')
                    if not isinstance(articles, list):
                        raise ValueError('ESPN did not return an articles list')
                    # Retain each provider article and header object verbatim; no translation or field rewriting here.
                    news[code] = {'fetchedAt': stamp(), 'header': payload.get('header'), 'articles': articles}
                except Exception as exc:
                    print(f'League news {code}: preserving previous response ({type(exc).__name__})', flush=True)
        if news:
            write(news_path, {'provider': 'ESPN', 'fetchedAt': stamp(), 'competitions': news})
        print(f'League news snapshots cached: {len(news)}', flush=True)
    stats_path = ROOT / 'player-stats.json'
    previous_stats = read(stats_path)
    if not previous_stats or age(previous_stats) > 600:
        stats = dict((previous_stats or {}).get('competitions', {}))
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            jobs = {}
            for code in LEAGUES:
                year = int((previous_competitions.get(code) or {}).get('currentSeasonYear') or 0)
                if year:
                    jobs[pool.submit(get, f'{code}/statistics?season={year}')] = (code, year)
            for job in as_completed(jobs):
                code, year = jobs[job]
                try:
                    payload = job.result()
                    groups = [group for group in (payload.get('stats') or []) if isinstance(group, dict) and group.get('leaders')]
                    if int((payload.get('season') or {}).get('year') or year) != year or not groups:
                        raise ValueError('ESPN did not return player leader categories')
                    trimmed = []
                    for group in groups:
                        leaders = []
                        for leader in group.get('leaders', [])[:20]:
                            athlete = leader.get('athlete') or {}
                            team = leader.get('team') or {}
                            leaders.append({'athlete': {'displayName': athlete.get('displayName') or athlete.get('fullName') or '', 'team': {'displayName': ((athlete.get('team') or {}).get('displayName') or '')}}, 'team': {'displayName': team.get('displayName') or team.get('name') or ''}, 'value': leader.get('value'), 'displayValue': leader.get('displayValue')})
                        trimmed.append({'name': group.get('name'), 'displayName': group.get('displayName'), 'leaders': leaders})
                    stats[code] = {'fetchedAt': stamp(), 'seasonYear': year, 'stats': trimmed, 'season': payload.get('season')}
                except Exception as exc:
                    print(f'League player stats {code}: preserving previous response ({type(exc).__name__})', flush=True)
        if stats:
            write(stats_path, {'provider': 'ESPN', 'fetchedAt': stamp(), 'competitions': stats})
        print(f'League player stats snapshots cached: {len(stats)}', flush=True)
    dates = [(now + timedelta(days=offset)).strftime('%Y%m%d') for offset in range(-7, 8)]
    scoreboards = {day: {'provider': 'ESPN', 'fetchedAt': stamp(), 'leagues': {}} for day in dates}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        jobs = {pool.submit(get, f'{code}/scoreboard?dates={day}'): (day, code) for day in dates for code in LEAGUES}
        for job in as_completed(jobs):
            day, code = jobs[job]
            try:
                payload = job.result()
                leagues = payload.get('leagues') or []
                league = next((item for item in leagues if item.get('slug') == code), leagues[0] if leagues else {})
                logos = league.get('logos') or []
                logo = next((item.get('href') for item in logos if 'default' in item.get('rel', [])), None)
                if not logo and logos:
                    logo = logos[0].get('href')
                scoreboards[day]['leagues'][code] = {
                    'events': payload.get('events', []),
                    'logo': logo,
                    'calendar': league.get('calendar', []),
                    'seasonYear': (league.get('season') or {}).get('year')
                }
            except Exception as exc:
                print(f'Scoreboard {day}/{code}: unavailable ({type(exc).__name__})', flush=True)
    events = {}
    for day, payload in scoreboards.items():
        # Keep current ESPN responses for every successful competition. A single
        # failed feed must not hide valid current scores from the rest.
        if payload['leagues']:
            write(ROOT / 'scoreboards' / f'{day}.json', payload)
        else:
            payload = read(ROOT / 'scoreboards' / f'{day}.json') or payload
        for code, board in payload.get('leagues', {}).items():
            for event in board.get('events', []):
                if event.get('id'):
                    events[str(event['id'])] = (code, event)
    print(f'Cached selected-date scoreboards; returned fixtures: {len(events)}', flush=True)
    wanted = []
    for event_id, (code, event) in events.items():
        old = read(ROOT / 'summaries' / f'{event_id}.json')
        status = (event.get('status') or {}).get('type') or {}
        try:
            event_time = datetime.fromisoformat(str(event.get('date', '')).replace('Z', '+00:00'))
        except (TypeError, ValueError):
            event_time = None
        if status.get('state') == 'pre' and event_time and (event_time < now - timedelta(hours=6) or event_time > now + timedelta(hours=24)):
            continue
        if status.get('completed') and event_time and event_time < now - timedelta(days=2):
            continue
        ttl = 86400 if status.get('completed') else 1800 if status.get('state') == 'pre' else 240
        if old and age(old) < ttl:
            continue
        wanted.append((event_id, code))
    completed = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        jobs = {pool.submit(get, f'{code}/summary?event={event_id}'): (event_id, code) for event_id, code in wanted}
        for job in as_completed(jobs):
            event_id, code = jobs[job]
            try:
                raw = job.result()
                # Keep only fields that the UI displays, verbatim from the feed.
                data = {key: raw[key] for key in ['gameInfo', 'keyEvents', 'rosters', 'boxscore'] if key in raw}
                if raw.get('commentary'):
                    data['commentary'] = raw['commentary'][:100]
                write(ROOT / 'summaries' / f'{event_id}.json', {'provider': 'ESPN', 'fetchedAt': stamp(), 'league': code, 'data': data})
                completed += 1
                if completed % 10 == 0:
                    print(f'Match summaries refreshed: {completed}/{len(wanted)}', flush=True)
            except Exception as exc:
                print(f'Summary {event_id}: preserving previous response ({type(exc).__name__})', flush=True)
    print(f'ESPN same-origin fallback ready: {completed} summaries refreshed.', flush=True)
    try:
        totw = build_team_of_the_week(events, now)
        if totw:
            write(ROOT / 'team-of-the-week.json', totw)
            print(f"Team of the Week cached: {len(totw['players'])} players from {totw['matchesConsidered']} completed matches.", flush=True)
        else:
            print('Team of the Week: no completed matches qualified; preserving previous file.', flush=True)
    except Exception as exc:
        print(f'Team of the Week: preserving previous file ({type(exc).__name__})', flush=True)
    if not team_file.exists() or not any((ROOT / 'scoreboards').glob('*.json')):
        raise RuntimeError('No usable ESPN fallback responses were obtained')
    stale_leagues = [code for code in LEAGUES if league_data_needs_refresh(previous_competitions.get(code))]
    if stale_leagues:
        print(f'ESPN league data remains stale or unavailable for {len(stale_leagues)} competitions: {", ".join(stale_leagues)}', flush=True)
    # Retain recent detail caches for date navigation; remove only very old files.
    cutoff = time.time() - 30 * 86400
    for folder in ['scoreboards', 'summaries']:
        for path in (ROOT / folder).glob('*.json'):
            if path.stat().st_mtime < cutoff:
                path.unlink()
    return 1 if stale_leagues else 0


if __name__ == '__main__':
    raise SystemExit(main())
