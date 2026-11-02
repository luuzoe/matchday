'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const browserStartup = appSource.indexOf("document.addEventListener('click'");
if (browserStartup < 0) throw new Error('Could not find browser-only app startup boundary');
const sandbox = { localStorage: { getItem: () => null, setItem: () => {} }, console, MatchdayClock: { label: () => 'LIVE' } };
vm.runInNewContext(`${appSource.slice(0, browserStartup)}
teamBadge = () => '<span class="test-team"></span>';
globalThis.matchUi = { kickoffTime, matchRow, matchesPage, filteredMatches, relatedFixturesLinks, feedFreshness, state, localDateKey, selectedDate, scoreboardDates, eventsForMyanmarDate };`, sandbox, { filename: 'app.js' });
const ui = sandbox.matchUi;

test('groups after-midnight Myanmar fixtures under the local day and queries both overlapping UTC dates', () => {
  ui.state.dateOffset = 0;
  const selected = ui.selectedDate(new Date('2026-11-01T19:16:00Z'));
  assert.equal(ui.localDateKey(selected), '2026-11-02');
  assert.deepEqual(Array.from(ui.scoreboardDates(selected)), ['20261101', '20261102']);
  const fixtures = [
    { id: 'juventus-napoli', kickoffUtc: '2026-11-01T19:45:00Z' },
    { id: 'athletic-real-sociedad', kickoffUtc: '2026-11-01T20:00:00Z' },
    { id: 'previous-myanmar-day', kickoffUtc: '2026-11-01T17:15:00Z' },
  ];
  const visible = ui.eventsForMyanmarDate(fixtures, '2026-11-02');
  assert.deepEqual(Array.from(visible, match => match.id), ['juventus-napoli', 'athletic-real-sociedad']);
  assert.deepEqual(Array.from(visible, match => ui.kickoffTime(match.kickoffUtc)), ['02:15', '02:30']);
});

test('formats upcoming kickoff times in Myanmar Time regardless of host timezone', () => {
  assert.equal(ui.kickoffTime('2099-11-02T02:45:00Z'), '09:15');
});

test('shows kickoff and MMT on scheduled match cards instead of repeating Scheduled', () => {
  ui.state.favorites.clear();
  ui.state.stale = false;
  const html = ui.matchRow({
    id: 'fixture-1',
    home: 'Sassuolo',
    away: 'Fiorentina',
    homeLogo: '',
    awayLogo: '',
    kickoffUtc: '2099-11-02T02:45:00Z',
    status: 'STATUS_SCHEDULED',
    statusText: 'Scheduled',
    score: null,
  });
  assert.match(html, /09:15/);
  assert.match(html, /MMT/);
  assert.match(html, /SCHEDULED/);
  assert.doesNotMatch(html, />Scheduled</);
});

test('reports feed availability separately from match-in-progress status', () => {
  ui.state.dateOffset = 0;
  ui.state.eventsDate = ui.localDateKey(ui.selectedDate());
  ui.state.eventsFetchedAt = Date.now();
  ui.state.feedMode = 'live';
  ui.state.feedError = false;
  ui.state.loading = false;
  assert.equal(ui.feedFreshness(), 'FEED OK');
});

test('renders feed freshness without a misleading LIVE header badge', () => {
  ui.state.dateOffset = 0;
  ui.state.eventsDate = ui.localDateKey(ui.selectedDate());
  ui.state.eventsFetchedAt = Date.now();
  ui.state.feedMode = 'live';
  ui.state.feedError = false;
  ui.state.loading = false;
  ui.state.stale = false;
  ui.state.filter = 'All';
  ui.state.leagueFilter = null;
  ui.state.favorites.clear();
  ui.state.events = [{
    id: 'fixture-2', home: 'Sassuolo', away: 'Fiorentina', homeLogo: '', awayLogo: '',
    competitionId: 'ita.1', competition: 'Serie A', kickoffUtc: '2099-11-02T02:45:00Z',
    status: 'STATUS_SCHEDULED', statusText: 'Scheduled', score: null,
  }];
  const html = ui.matchesPage();
  assert.match(html, /feed-state-feed-ok/);
  assert.match(html, /FEED OK/);
  assert.doesNotMatch(html, /feed-state-live/);
});


test('Live filter includes only in-progress and half-time matches', () => {
  ui.state.dateOffset = 0;
  ui.state.eventsDate = ui.localDateKey(ui.selectedDate());
  ui.state.filter = 'Live';
  ui.state.leagueFilter = null;
  ui.state.favorites.clear();
  const kickoff = new Date().toISOString();
  ui.state.events = [
    { id: 'live', kickoffUtc: kickoff, status: 'STATUS_IN_PROGRESS' },
    { id: 'break', kickoffUtc: kickoff, status: 'STATUS_HALFTIME' },
    { id: 'scheduled', kickoffUtc: new Date(Date.now() + 60_000).toISOString(), status: 'STATUS_SCHEDULED' },
    { id: 'final', kickoffUtc: kickoff, status: 'STATUS_FINAL', score: { home: 1, away: 0 } },
  ];
  assert.deepEqual(Array.from(ui.filteredMatches(), match => match.id), ['live', 'break']);
  assert.match(ui.matchesPage(), /data-filter="Live"/);
  assert.match(ui.matchesPage(), /filter active live/);
  assert.match(appSource, /APP_ROUTE_FILTERS=new Set\(\[[^\]]*'Live'/);
});

test('match detail exposes source-backed team-filtered related-fixture actions', () => {
  const html = ui.relatedFixturesLinks({ competitionId: 'ksa.1', home: 'Al Hilal', away: 'Al Nassr' });
  assert.match(html, /data-action="open-related-fixtures"/);
  assert.match(html, /data-id="ksa.1"/);
  assert.match(html, /data-team="Al Hilal"/);
  assert.match(html, /data-team="Al Nassr"/);
  assert.match(appSource, /else if\(a==='open-related-fixtures'\)/);
});
