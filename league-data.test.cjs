'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, 'league.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = {
  localStorage: { getItem: () => null, setItem: () => {} },
  location: { href: 'https://matchday.example/' },
  URL,
  Event,
  Intl,
  Date,
  console,
  fetch: async () => { throw new Error('Unexpected network request in unit test'); },
  document: { addEventListener: () => {} },
  window: {
    setTimeout: callback => setTimeout(callback, 0),
    clearTimeout,
    dispatchEvent: () => {}
  }
};
vm.runInNewContext(source, sandbox, { filename: sourcePath });
const league = sandbox.window.MatchdayLeague;

const stat = (name, displayValue) => ({ name, displayValue });

test('offers only the eight requested competition sections', () => {
  assert.deepEqual(Array.from(league.tabs), [
    'Table', 'Fixtures', 'News', 'Player Stats', 'Team Stats', 'Transfers', 'TOTW', 'Seasons'
  ]);
});

test('includes the verified FA Cup, Carabao Cup and broad ESPN competition set', () => {
  assert.equal(league.competitions.length, 27);
  assert.ok(league.competitions.includes('eng.fa'));
  assert.ok(league.competitions.includes('eng.league_cup'));
  assert.ok(league.competitions.includes('esp.copa_del_rey'));
  assert.ok(league.competitions.includes('ger.dfb_pokal'));
  assert.ok(league.competitions.includes('uefa.europa.conf'));
  assert.ok(league.competitions.includes('bel.1'));
  assert.ok(league.competitions.includes('ksa.1'));
});

test('normalizes only standings values returned by ESPN and leaves missing values blank', () => {
  const groups = league.normalizeStandings({
    children: [{
      name: '2026-27 English Premier League',
      standings: { entries: [{
        team: { displayName: 'Arsenal', shortDisplayName: 'Arsenal', abbreviation: 'ARS', logos: [{ rel: ['default'], href: 'https://cdn.example/arsenal.png' }] },
        stats: [
          stat('rank', '1'), stat('gamesPlayed', '9'), stat('wins', '8'), stat('ties', '0'),
          stat('losses', '1'), stat('pointsFor', '14'), stat('pointsAgainst', '5'),
          stat('pointDifferential', '+9'), stat('points', '24')
        ]
      }, {
        team: { displayName: 'New Club' },
        stats: [stat('rank', '2'), stat('gamesPlayed', '0')]
      }] }
    }]
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows[0].team, 'Arsenal');
  assert.equal(groups[0].rows[0].played, 9);
  assert.equal(groups[0].rows[0].goalDifference, '+9');
  assert.equal(groups[0].rows[0].logoUrl, 'https://cdn.example/arsenal.png');
  assert.equal(groups[0].rows[1].won, null);
  assert.equal(groups[0].rows[1].points, null);
  assert.equal(groups[0].rows[1].goalDifference, null);
});

test('normalizes genuine future fixtures and does not turn scheduled zeroes into scores', () => {
  const fixture = league.normalizeESPNFixture({
    id: 'match-1', date: '2026-11-07T18:00:00Z', week: { text: 'Matchday 11' },
    status: { type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false } },
    competitions: [{ competitors: [
      { homeAway: 'home', form: 'DDDLD', score: '0', team: { displayName: 'Home City', abbreviation: 'HOM' } },
      { homeAway: 'away', form: 'WLWDL', score: '0', team: { displayName: 'Away United', abbreviation: 'AWY' } }
    ] }]
  });
  assert.equal(fixture.dateKey, '2026-11-08');
  assert.equal(fixture.round, 'Matchday 11');
  assert.equal(fixture.homeForm, 'DDDLD');
  assert.equal(fixture.score, null);
  assert.equal(fixture.finished, false);
});

test('normalizes ESPN full-time scores without changing returned values', () => {
  const fixture = league.normalizeESPNFixture({
    id: 'match-2', date: '2026-11-07T18:00:00Z',
    status: { type: { state: 'post', name: 'STATUS_FINAL', completed: true } },
    competitions: [{ competitors: [
      { homeAway: 'home', score: '2', team: { displayName: 'Home City' } },
      { homeAway: 'away', score: '1', team: { displayName: 'Away United' } }
    ] }]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.score)), { home: 2, away: 1 });
  assert.equal(fixture.finished, true);
});

test('limits fixture requests to ESPN calendar dates around the current Myanmar date', () => {
  const calendar = [
    '2026-11-02T08:00:00Z', '2026-11-07T08:00:00Z', '2026-11-14T08:00:00Z',
    '2026-12-20T08:00:00Z', 'not-a-date'
  ];
  const codes = league.scheduleDateCodes(calendar, new Date('2026-11-02T12:00:00Z'));
  assert.ok(codes.includes('20261107'));
  assert.ok(!codes.includes('20261114'));
  assert.ok(!codes.includes('20261220'));
  assert.ok(!codes.includes('not-a-date'));
});

test('uses the timestamped same-origin ESPN snapshot when browser API access fails', async () => {
  const standings = {
    season: { year: 2026 },
    children: [{ name: '2026-27 English Premier League', standings: { entries: [{
      team: { displayName: 'Arsenal', shortDisplayName: 'Arsenal' },
      stats: [stat('rank', '1'), stat('gamesPlayed', '9'), stat('wins', '8'), stat('ties', '0'),
        stat('losses', '1'), stat('pointsFor', '14'), stat('pointsAgainst', '5'),
        stat('pointDifferential', '+9'), stat('points', '24')]
    }] } }]
  };
  const snapshot = { fetchedAt: '2026-11-02T02:00:00Z', competitions: { 'eng.1': {
    seasons: [{ year: 2026, displayName: '2026-27 English Premier League' }],
    currentSeasonYear: 2026,
    standings,
    standingsFetchedAt: '2026-11-02T01:59:00Z'
  } } };
  const integrationSandbox = {
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: 'https://matchday.example/' }, URL, Event, Intl, Date, console, AbortController,
    fetch: async url => {
      if (String(url).includes('league-data.json')) return { ok: true, status: 200, json: async () => snapshot };
      throw new Error('Cross-origin ESPN fetch blocked');
    },
    document: { addEventListener: () => {} },
    window: { setTimeout: callback => setTimeout(callback, 0), clearTimeout, dispatchEvent: () => {} }
  };
  vm.runInNewContext(source, integrationSandbox, { filename: sourcePath });
  const page = integrationSandbox.window.MatchdayLeague;
  page.render({ id: 'eng.1', name: 'Premier League', teamControl: team => `<span>${team.name}</span>` });
  await new Promise(resolve => setTimeout(resolve, 15));
  const html = page.render({ id: 'eng.1', name: 'Premier League', teamControl: team => `<span>${team.name}</span>` });
  assert.match(html, /ESPN snapshot/);
  assert.match(html, /Cached ESPN standings/);
  assert.match(html, /Arsenal/);
  assert.match(html, /\+9/);
  assert.doesNotMatch(html, /Standings unavailable/);
});

test('renders real upcoming fixtures from same-origin ESPN scoreboards when live fetches fail', async () => {
  const kickoff = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  kickoff.setUTCHours(18, 0, 0, 0);
  const date = kickoff.toISOString();
  const dateCode = `${kickoff.getUTCFullYear()}${String(kickoff.getUTCMonth() + 1).padStart(2, '0')}${String(kickoff.getUTCDate()).padStart(2, '0')}`;
  const event = {
    id: 'upcoming-match-1', date, week: { text: 'Matchday 11' },
    status: { type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false } },
    competitions: [{ competitors: [
      { homeAway: 'home', form: 'WLDDD', score: '0', team: { displayName: 'Newcastle United', abbreviation: 'NEW' } },
      { homeAway: 'away', form: 'DDWWL', score: '0', team: { displayName: 'Everton', abbreviation: 'EVE' } }
    ] }]
  };
  const standings = { season: { year: 2026 }, children: [] };
  const leagueSnapshot = { fetchedAt: new Date().toISOString(), competitions: { 'eng.1': {
    seasons: [{ year: 2026, displayName: '2026-27 English Premier League' }],
    currentSeasonYear: 2026, standings, standingsFetchedAt: new Date().toISOString()
  } } };
  const boardSnapshot = { fetchedAt: new Date().toISOString(), leagues: { 'eng.1': {
    events: [event], calendar: [date], seasonYear: 2026
  } } };
  const listeners = {};
  const integrationSandbox = {
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: 'https://matchday.example/' }, URL, Event, Intl, Date, console, AbortController,
    fetch: async url => {
      const address = String(url);
      if (address.includes('league-data.json')) return { ok: true, status: 200, json: async () => leagueSnapshot };
      if (address.includes(`scoreboards/${dateCode}.json`)) return { ok: true, status: 200, json: async () => boardSnapshot };
      throw new Error('Cross-origin ESPN fetch blocked');
    },
    document: { addEventListener: (name, handler) => { listeners[name] = handler; } },
    window: { setTimeout: callback => setTimeout(callback, 0), clearTimeout, dispatchEvent: () => {} }
  };
  vm.runInNewContext(source, integrationSandbox, { filename: sourcePath });
  const page = integrationSandbox.window.MatchdayLeague;
  const props = { id: 'eng.1', name: 'Premier League', calendar: [date], calendarSeasonYear: 2026,
    teamControl: team => `<span>${team.name}</span>` };
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 15));
  listeners.click({ target: { closest: selector => selector === '[data-league-tab]'
    ? { dataset: { leagueId: 'eng.1', leagueTab: 'Fixtures' } } : null } });
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 30));
  const html = page.render(props);
  assert.match(html, /Newcastle United/);
  assert.match(html, /Everton/);
  assert.match(html, /MMT/);
  assert.match(html, /ESPN snapshot/);
  assert.doesNotMatch(html, /Fixtures unavailable/);
});

test('renders ESPN standings without the stale provider or removed overview/team sections', async () => {
  const currentStandings = {
    season: { year: 2026 },
    children: [{ name: '2026-27 English Premier League', standings: { entries: [{
      team: { displayName: 'Arsenal', shortDisplayName: 'Arsenal' },
      stats: [stat('rank', '1'), stat('gamesPlayed', '9'), stat('wins', '8'), stat('ties', '0'),
        stat('losses', '1'), stat('pointsFor', '14'), stat('pointsAgainst', '5'),
        stat('pointDifferential', '+9'), stat('points', '24')]
    }] } }]
  };
  const integrationSandbox = {
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: 'https://matchday.example/' }, URL, Event, Intl, Date, console,
    AbortController,
    fetch: async url => ({ ok: true, status: 200, json: async () => String(url).includes('/seasons?')
      ? { seasons: [{ year: 2026, displayName: '2026-27 English Premier League' }] }
      : currentStandings }),
    document: { addEventListener: () => {} },
    window: { setTimeout: callback => setTimeout(callback, 0), clearTimeout, dispatchEvent: () => {} }
  };
  vm.runInNewContext(source, integrationSandbox, { filename: sourcePath });
  const page = integrationSandbox.window.MatchdayLeague;
  page.render({ id: 'eng.1', name: 'Premier League', teamControl: team => `<span>${team.name}</span>` });
  await new Promise(resolve => setTimeout(resolve, 15));
  const html = page.render({ id: 'eng.1', name: 'Premier League', teamControl: team => `<span>${team.name}</span>` });
  assert.match(html, /2026-27 English Premier League/);
  assert.match(html, /Arsenal/);
  assert.match(html, /\+9/);
  assert.match(html, /data-league-tab="Table"/);
  assert.match(html, /OpenLigaDB \(ODbL 1\.0\)/);
  assert.doesNotMatch(html, /Overview|data-league-tab="Teams"/);
});


test('uses only same-season OpenLigaDB named scorer records when ESPN player stats are unavailable', async () => {
  const listeners = {};
  const snapshot = { competitions: [{
    shortcut: 'pl', season: 2026, sourceName: 'Premier League 2026/2027',
    playerStats: {
      provider: 'OpenLigaDB', license: 'ODbL-1.0',
      coverage: { namedGoalEventsCounted: 13, goalEventsInSourceResponse: 35 },
      players: [{ name: 'Source Name', goals: 3, teams: ['Source Club'] }]
    }
  }] };
  const sandbox = {
    localStorage: { getItem: () => null, setItem: () => {} }, location: { href: 'https://matchday.example/' },
    URL, Event, Intl, Date, console, AbortController,
    fetch: async url => {
      const address = String(url);
      if (address.includes('/seasons?')) return { ok: true, status: 200, json: async () => ({ seasons: [{ year: 2026, displayName: 'Premier League 2026/2027' }] }) };
      if (address.includes('league-data.json')) return { ok: true, status: 200, json: async () => ({ competitions: {} }) };
      throw new Error('Cross-origin ESPN and Worker requests blocked');
    },
    document: { addEventListener: (name, handler) => { listeners[name] = handler; } },
    window: { setTimeout: callback => setTimeout(callback, 0), clearTimeout, dispatchEvent: () => {} }
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  const page = sandbox.window.MatchdayLeague;
  const props = { id: 'eng.1', name: 'Premier League', openLigaSnapshot: snapshot, teamControl: team => `<span>${team.name}</span>` };
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 15));
  listeners.click({ target: { closest: selector => selector === '[data-league-tab]' ? { dataset: { leagueId: 'eng.1', leagueTab: 'Player Stats' } } : null } });
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 15));
  const html = page.render(props);
  assert.match(html, /OpenLigaDB \(ODbL 1\.0\)/);
  assert.match(html, /Source Name/);
  assert.match(html, /3 goals/);
  assert.match(html, /13 of 35 source goal records counted/);
  assert.doesNotMatch(html, /Player statistics unavailable/);
});

test('routes league tabs through the Worker proxy after direct ESPN access fails', async () => {
  const listeners = {};
  const rawArticle = { headline: 'Original provider title', customField: { preserved: true }, links: { web: { href: 'https://www.espn.com/soccer/story/1' } } };
  const requests = [];
  const sandbox = {
    localStorage: { getItem: () => null, setItem: () => {} }, location: { href: 'https://matchday.example/' },
    URL, Event, Intl, Date, console, AbortController,
    fetch: async url => {
      const address = String(url); requests.push(address);
      if (address.includes('/seasons?')) return { ok: true, status: 200, json: async () => ({ seasons: [{ year: 2026, displayName: 'Premier League 2026/2027' }] }) };
      if (address.includes('/api/proxy/espn/eng.1/news')) return { ok: true, status: 200, json: async () => ({ articles: [rawArticle] }) };
      throw new Error('Direct ESPN access blocked');
    },
    document: { addEventListener: (name, handler) => { listeners[name] = handler; } },
    window: { setTimeout: callback => setTimeout(callback, 0), clearTimeout, dispatchEvent: () => {} }
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  const page = sandbox.window.MatchdayLeague;
  const props = { id: 'eng.1', name: 'Premier League', teamControl: team => `<span>${team.name}</span>` };
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 10));
  listeners.click({ target: { closest: selector => selector === '[data-league-tab]' ? { dataset: { leagueId: 'eng.1', leagueTab: 'News' } } : null } });
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 15));
  const html = page.render(props);
  assert.ok(requests.some(url => url.includes('/api/proxy/espn/eng.1/news?limit=25')));
  assert.match(html, /Original provider title/);
  assert.match(html, /Read article/);
  assert.doesNotMatch(html, /News unavailable/);
});

test('renders ESPN transfer records and distinguishes an empty successful feed from unavailable data', async () => {
  const listeners = {};
  const requests = [];
  const sandbox = {
    localStorage: { getItem: () => null, setItem: () => {} }, location: { href: 'https://matchday.example/' },
    URL, Event, Intl, Date, console, AbortController,
    fetch: async url => {
      const address = String(url); requests.push(address);
      if (address.includes('/seasons?')) return { ok: true, status: 200, json: async () => ({ seasons: [{ year: 2026, displayName: 'Premier League 2026/2027' }] }) };
      if (address.includes('/transactions?season=2026')) return { ok: true, status: 200, json: async () => ({ count: 0, transactions: [] }) };
      throw new Error('Source unavailable');
    },
    document: { addEventListener: (name, handler) => { listeners[name] = handler; } },
    window: { setTimeout: callback => setTimeout(callback, 0), clearTimeout, dispatchEvent: () => {} }
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  const page = sandbox.window.MatchdayLeague;
  const props = { id: 'eng.1', name: 'Premier League' };
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 10));
  listeners.click({ target: { closest: selector => selector === '[data-league-tab]' ? { dataset: { leagueId: 'eng.1', leagueTab: 'Transfers' } } : null } });
  page.render(props);
  await new Promise(resolve => setTimeout(resolve, 15));
  const html = page.render(props);
  assert.ok(requests.some(url => url.includes('/transactions?season=2026')));
  assert.match(html, /No transfer records returned/);
  assert.doesNotMatch(html, /Transfers unavailable/);
});
