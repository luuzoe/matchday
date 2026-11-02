#!/usr/bin/env python3
"""Build an openly licensed OpenLigaDB snapshot for the Matchday Pages UI.

The scheduled job is the single API client. It centrally caches source-listed
fixtures, reported scores, goal records and standings; it does not infer missing
match data or fetch unlicensed third-party badges.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "matches.json"
API = "https://api.openligadb.de"
USER_AGENT = "MatchdayLive/2.0 (+https://github.com/luuzoe/moksobo-1752-web-test/issues)"

SPECS = [
    ("Premier League", "pl", lambda n, s, y: "premier league" in n.lower() and s.lower() == "pl"),
    ("LaLiga", "la1", lambda n, s, y: "laliga" in n.lower() and s.lower() == "la1"),
    ("Bundesliga", "bl1", lambda n, s, y: "bundesliga" in n.lower() and n.lstrip().startswith("1.") and s.lower() == "bl1"),
    ("Champions League", "ucl", lambda n, s, y: "champions league" in n.lower() and s.lower() in {"ucl", f"ucl{y}"}),
    ("Europa League", "uel", lambda n, s, y: "europa league" in n.lower() and s.lower() in {"uel", f"uel{y}"}),
    ("Conference League", "uecl", lambda n, s, y: "conference league" in n.lower() and s.lower() in {"uecl", f"uecl{y}"}),
]
PAST_PUBLISH_DAYS = 7
FUTURE_PUBLISH_DAYS = 14
MONITOR_PAST_DAYS = 4
MONITOR_FUTURE_DAYS = 4
FULL_SYNC_INTERVAL = timedelta(minutes=10)
RETRYABLE = {429, 500, 502, 503, 504}


def utc_iso(value: datetime | None = None) -> str:
    value = value or datetime.now(timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def api_get(path: str):
    for attempt in range(4):
        request = Request(f"{API}/{path.lstrip('/')}", headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urlopen(request, timeout=35) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code not in RETRYABLE or attempt == 3:
                raise RuntimeError(f"OpenLigaDB returned HTTP {exc.code} for {path}") from exc
            delay = min(2 ** attempt, 16)
            print(f"OpenLigaDB HTTP {exc.code}; retrying in {delay}s", file=sys.stderr)
            time.sleep(delay)
        except (TimeoutError, URLError) as exc:
            if attempt == 3:
                raise RuntimeError(f"OpenLigaDB request failed for {path}: {exc}") from exc
            delay = min(2 ** attempt, 16)
            print(f"OpenLigaDB request issue; retrying in {delay}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(f"OpenLigaDB request failed for {path}")


def current_season_year(now: datetime) -> int:
    return now.year if now.month >= 7 else now.year - 1


def select_competitions(year: int) -> list[dict]:
    available = api_get(f"getavailableleagues/{year}")
    selected = []
    for display_name, preferred_shortcut, matches_spec in SPECS:
        choices = [league for league in available if str(league.get("leagueSeason", "")) == str(year) and matches_spec(str(league.get("leagueName", "")), str(league.get("leagueShortcut", "")), year)]
        choices.sort(key=lambda item: (str(item.get("leagueShortcut", "")).lower() != preferred_shortcut, str(item.get("leagueShortcut", "")).lower() not in {preferred_shortcut, f"{preferred_shortcut}{year}"}, int(item.get("leagueId", 0))))
        if not choices:
            continue
        league = choices[0]
        selected.append({"id": int(league["leagueId"]), "name": display_name, "sourceName": str(league.get("leagueName", display_name)), "shortcut": str(league["leagueShortcut"]), "season": int(league.get("leagueSeason", year))})
    return selected


def score_from_results(results: list[dict], finished: bool):
    usable = [result for result in (results or []) if result.get("pointsTeam1") is not None and result.get("pointsTeam2") is not None]
    if not usable:
        return None
    final_kinds = {"After90Minutes", "AfterExtraTime", "AfterPenalties"}
    finals = [result for result in usable if result.get("resultTypeKind") in final_kinds]
    if finished:
        if not finals:
            return None
        result = max(finals, key=lambda item: int(item.get("resultOrderID", 0) or 0))
    else:
        result = max(usable, key=lambda item: int(item.get("resultOrderID", 0) or 0))
    return {"home": int(result["pointsTeam1"]), "away": int(result["pointsTeam2"]), "kind": result.get("resultTypeKind") or result.get("resultName") or "reported"}


def normalize_goal(goal: dict) -> dict:
    return {
        "id": goal.get("goalID"),
        "scoreHome": goal.get("scoreTeam1"),
        "scoreAway": goal.get("scoreTeam2"),
        "minute": goal.get("matchMinute"),
        "scorer": goal.get("goalGetterName") or None,
        "scoringTeamId": goal.get("scoringTeamId"),
        "penalty": bool(goal.get("isPenalty")),
        "ownGoal": bool(goal.get("isOwnGoal")),
        "overtime": bool(goal.get("isOvertime")),
        "comment": goal.get("comment") or None,
    }


def normalize_match(match: dict, comp: dict) -> dict | None:
    kickoff = match.get("matchDateTimeUTC")
    if not kickoff:
        return None
    finished = bool(match.get("matchIsFinished"))
    group = match.get("group") or {}
    home = match.get("team1") or {}
    away = match.get("team2") or {}
    raw_goals = match.get("goals") or []
    goals = [normalize_goal(goal) for goal in raw_goals if isinstance(goal, dict)] if isinstance(raw_goals, list) else []
    return {
        "id": int(match.get("matchID", 0)),
        "competitionId": comp["id"],
        "competition": comp["name"],
        "sourceCompetition": comp["sourceName"],
        "shortcut": comp["shortcut"],
        "season": comp["season"],
        "round": str(group.get("groupName") or ""),
        "groupOrderId": group.get("groupOrderID"),
        "kickoffUtc": str(kickoff),
        "home": str(home.get("teamName") or "Unknown team"),
        "away": str(away.get("teamName") or "Unknown team"),
        "homeTeamId": home.get("teamId"),
        "awayTeamId": away.get("teamId"),
        "finished": finished,
        "score": score_from_results(match.get("matchResults") or [], finished),
        "goals": goals,
        "sourceUpdatedAt": match.get("lastUpdateDateTime"),
    }


def normalize_standings(rows: list[dict]) -> list[dict]:
    normalized = []
    for position, row in enumerate(rows, 1):
        if not isinstance(row, dict) or not row.get("teamName"):
            continue
        logo_url = str(row.get("teamIconUrl") or "").strip()
        if logo_url.startswith("http://"):
            logo_url = "https://" + logo_url[7:]
        normalized.append({
            "position": position,
            "team": str(row.get("teamName")),
            "shortName": str(row.get("shortName") or ""),
            "logoUrl": logo_url,
            "played": row.get("matches"),
            "won": row.get("won"),
            "drawn": row.get("draw"),
            "lost": row.get("lost"),
            "goalsFor": row.get("goals"),
            "goalsAgainst": row.get("opponentGoals"),
            "goalDifference": row.get("goalDiff"),
            "points": row.get("points"),
        })
    return normalized


def fetch_standings(comp: dict, old: dict | None = None) -> dict:
    path = f"getbltable/{quote(comp['shortcut'], safe='')}/{comp['season']}"
    try:
        payload = api_get(path)
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected standings response for {path}")
        rows = normalize_standings(payload)
        return {"standings": rows, "standingsUpdatedAt": utc_iso(), "standingsStatus": "available" if rows else "empty"}
    except Exception as exc:
        print(f"  Standings unavailable for {comp['name']}: {exc}", file=sys.stderr)
        if old and old.get("standings"):
            return {"standings": old["standings"], "standingsUpdatedAt": old.get("standingsUpdatedAt"), "standingsStatus": "stale"}
        return {"standings": [], "standingsUpdatedAt": None, "standingsStatus": "unavailable"}


def in_publish_window(match: dict, now: datetime) -> bool:
    try:
        kickoff = datetime.fromisoformat(match["kickoffUtc"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return False
    return now - timedelta(days=PAST_PUBLISH_DAYS) <= kickoff <= now + timedelta(days=FUTURE_PUBLISH_DAYS)


def source_matches(path: str, comp: dict) -> list[dict]:
    raw = api_get(path)
    if not isinstance(raw, list):
        raise RuntimeError(f"Unexpected match response for {path}")
    normalized = [normalize_match(match, comp) for match in raw]
    return [match for match in normalized if match and in_publish_window(match, datetime.now(timezone.utc))]


def player_scorer_stats(raw_matches: list[dict]) -> dict:
    """Count only named, non-own-goal records present in the source response."""
    players: dict[str, dict] = {}
    total_goal_events = 0
    named_goal_events = 0
    for match in raw_matches:
        if not isinstance(match, dict):
            continue
        raw_goals = match.get("goals") or []
        if not isinstance(raw_goals, list):
            continue
        teams = {}
        for side in ("team1", "team2"):
            team = match.get(side) or {}
            if team.get("teamId") is not None and team.get("teamName"):
                teams[str(team["teamId"])] = str(team["teamName"])
        for goal in raw_goals:
            if not isinstance(goal, dict):
                continue
            total_goal_events += 1
            name = str(goal.get("goalGetterName") or "").strip()
            if not name or bool(goal.get("isOwnGoal")):
                continue
            named_goal_events += 1
            player_id = goal.get("goalGetterID")
            key = f"id:{player_id}" if player_id not in (None, "") else f"name:{name.casefold()}"
            player = players.setdefault(key, {"name": name, "goals": 0, "teams": set()})
            player["goals"] += 1
            team_name = teams.get(str(goal.get("scoringTeamId")))
            if team_name:
                player["teams"].add(team_name)
    rows = [
        {"name": row["name"], "goals": row["goals"], "teams": sorted(row["teams"])}
        for row in players.values()
    ]
    rows.sort(key=lambda row: (-row["goals"], row["name"].casefold()))
    return {
        "provider": "OpenLigaDB",
        "license": "ODbL-1.0",
        "category": "named non-own-goal records",
        "coverage": {
            "matchesInSourceResponse": sum(1 for match in raw_matches if isinstance(match, dict)),
            "goalEventsInSourceResponse": total_goal_events,
            "namedGoalEventsCounted": named_goal_events,
            "goalEventsNotCounted": total_goal_events - named_goal_events,
        },
        "players": rows,
    }


def read_existing() -> dict | None:
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def full_sync_due(previous: dict | None, current_ids: list[tuple], year: int, now: datetime) -> bool:
    if not previous or previous.get("schemaVersion", 0) < 2 or previous.get("season") != year:
        return True
    previous_comps = previous.get("competitions", [])
    previous_ids = [(c.get("id"), c.get("shortcut"), c.get("season")) for c in previous_comps]
    if previous_ids != current_ids:
        return True
    if any(not isinstance(c.get("playerStats"), dict) or not c.get("playerStatsUpdatedAt") for c in previous_comps):
        return True
    last_sync = previous.get("fullSyncAt")
    if not last_sync:
        return True
    try:
        last_sync_at = datetime.fromisoformat(str(last_sync).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return True
    if last_sync_at.tzinfo is None:
        last_sync_at = last_sync_at.replace(tzinfo=timezone.utc)
    return now - last_sync_at >= FULL_SYNC_INTERVAL


def write_snapshot(snapshot: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(DATA_FILE)


def main() -> int:
    now = datetime.now(timezone.utc)
    year = current_season_year(now)
    today = now.date().isoformat()
    competitions = select_competitions(year)
    if not competitions:
        raise RuntimeError(f"OpenLigaDB listed no supported football competitions for season {year}")

    previous = read_existing()
    previous_comps = previous.get("competitions", []) if previous else []
    current_ids = [(c["id"], c["shortcut"], c["season"]) for c in competitions]
    full_refresh = full_sync_due(previous, current_ids, year, now)

    markers = dict(previous.get("changeMarkers", {})) if previous else {}
    old_by_id = {int(c["id"]): c for c in previous_comps}
    if full_refresh:
        print(f"Refreshing {len(competitions)} current-season competitions ({year})")
        updated_comps = []
        for comp in competitions:
            match_path = f"getmatchdata/{quote(comp['shortcut'], safe='')}/{comp['season']}"
            raw_matches = api_get(match_path)
            if not isinstance(raw_matches, list):
                raise RuntimeError(f"Unexpected match response for {match_path}")
            normalized = [normalize_match(match, comp) for match in raw_matches]
            matches = [match for match in normalized if match and in_publish_window(match, now)]
            player_stats = player_scorer_stats(raw_matches)
            old = old_by_id.get(comp["id"])
            standings = fetch_standings(comp, old)
            updated_comps.append({**comp, "matches": matches, **standings, "playerStats": player_stats, "playerStatsUpdatedAt": utc_iso(now), "playerStatsStatus": "available" if player_stats["players"] else "empty"})
            print(f"  {comp['name']}: {len(matches)} published-window matches; {len(standings['standings'])} table rows; {len(player_stats['players'])} named scorers")
        competitions_data = updated_comps
        changed = True
        full_sync_date = today
        full_sync_at = utc_iso(now)
    else:
        competitions_data = []
        changed = False
        monitor_start = now - timedelta(days=MONITOR_PAST_DAYS)
        monitor_end = now + timedelta(days=MONITOR_FUTURE_DAYS)
        for comp in competitions:
            old = old_by_id.get(comp["id"], {})
            matches = list(old.get("matches", []))
            groups = set()
            for match in matches:
                group_id = match.get("groupOrderId")
                try:
                    kickoff = datetime.fromisoformat(match["kickoffUtc"].replace("Z", "+00:00"))
                except (KeyError, TypeError, ValueError):
                    continue
                if group_id is not None and monitor_start <= kickoff <= monitor_end:
                    groups.add(int(group_id))
            for group_id in sorted(groups):
                marker_key = f"{comp['shortcut']}:{comp['season']}:{group_id}"
                marker = api_get(f"getlastchangedate/{quote(comp['shortcut'], safe='')}/{comp['season']}/{group_id}")
                if marker is None:
                    continue
                marker = str(marker)
                if markers.get(marker_key) == marker:
                    continue
                print(f"  Changed group: {comp['name']} · {group_id}")
                round_matches = source_matches(f"getmatchdata/{quote(comp['shortcut'], safe='')}/{comp['season']}/{group_id}", comp)
                matches = [m for m in matches if int(m.get("groupOrderId") or -1) != group_id]
                matches.extend(round_matches)
                markers[marker_key] = marker
                changed = True
            matches = [m for m in matches if in_publish_window(m, now)]
            competitions_data.append({**comp, "matches": matches, "standings": old.get("standings", []), "standingsUpdatedAt": old.get("standingsUpdatedAt"), "standingsStatus": old.get("standingsStatus", "unavailable"), "playerStats": old.get("playerStats", {"provider": "OpenLigaDB", "license": "ODbL-1.0", "category": "named non-own-goal records", "coverage": {}, "players": []}), "playerStatsUpdatedAt": old.get("playerStatsUpdatedAt"), "playerStatsStatus": old.get("playerStatsStatus", "unavailable")})
        full_sync_date = previous.get("fullSyncDate", today)
        full_sync_at = previous.get("fullSyncAt")

    if not changed:
        print("No source changes; leaving the public snapshot untouched.")
        return 0

    snapshot = {
        "schemaVersion": 2,
        "provider": "OpenLigaDB",
        "license": "ODbL-1.0",
        "attribution": "Football data from OpenLigaDB (www.openligadb.de), licensed under ODbL 1.0.",
        "season": year,
        "snapshotUpdatedAt": utc_iso(now),
        "fullSyncDate": full_sync_date,
        "fullSyncAt": full_sync_at,
        "refreshTargetMinutes": 5,
        "coverageNote": "Community-maintained coverage; scores and event records may be delayed, incomplete, or absent.",
        "competitions": competitions_data,
        "changeMarkers": markers,
    }
    write_snapshot(snapshot)
    print(f"Wrote {DATA_FILE} ({DATA_FILE.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"OpenLigaDB sync failed: {exc}", file=sys.stderr)
        raise
