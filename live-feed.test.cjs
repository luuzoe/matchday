'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const browserStartup = appSource.indexOf("document.addEventListener('click'");
const helperStart = appSource.indexOf('function liveEventFingerprint');
const helperEnd = appSource.indexOf('function installLiveScoreBackend', helperStart);
if (browserStartup < 0 || helperStart < 0 || helperEnd < 0) throw new Error('Could not find score-feed integration boundaries');

function makeHarness() {
  let phase = 0;
  const calls = [];
  const window = { MatchdayLeague: { updates: 0, onScoresUpdated() { this.updates += 1; } } };
  const sandbox = {
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { visibilityState: 'visible' },
    window,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      const homeScore = phase ? '2' : '1';
      const status = phase ? 'STATUS_IN_PROGRESS' : 'STATUS_IN_PROGRESS';
      const shortDetail = phase ? "23'" : "22'";
      const event = {
        id: 'test-live-1',
        date: sandbox.fixtureKickoff,
        status: { type: { name: status, state: 'in', shortDetail, detail: 'First half' }, displayClock: phase ? '23:00' : '22:00', period: 1 },
        competitions: [{ competitors: [
          { homeAway: 'home', score: homeScore, team: { displayName: 'Alpha FC', abbreviation: 'ALP' } },
          { homeAway: 'away', score: '0', team: { displayName: 'Beta FC', abbreviation: 'BET' } }
        ] }]
      };
      const timestamp = new Date(Date.now() + phase * 1_000).toISOString();
      const dates = Object.fromEntries(sandbox.fixtureDates.map(dateCode => [dateCode, {
        dateCode,
        updatedAt: timestamp,
        failedLeagues: [],
        leagues: Object.fromEntries(sandbox.leagueCodes.map(code => [code, {
          events: code === 'eng.1' && dateCode === sandbox.fixtureDateCode ? [event] : [],
          fetchedAt: timestamp,
          logo: '',
          calendar: [],
          seasonYear: null
        }]))
      }]));
      phase += 1;
      return new Response(JSON.stringify({ provider: 'ESPN', fetchedAt: timestamp, partial: false, dates }), { status: 200 });
    },
    console,
    URL,
    Response,
    AbortController,
    setTimeout,
    clearTimeout
  };
  const prefix = appSource.slice(0, browserStartup);
  const helpers = appSource.slice(helperStart, helperEnd);
  vm.runInNewContext(`${prefix}\n${helpers}\nrender=()=>{globalThis.renderCount=(globalThis.renderCount||0)+1};\nconst fixtureDate=selectedDate();fixtureDate.setUTCHours(5,0,0,0);\nglobalThis.fixtureKickoff=fixtureDate.toISOString();\nglobalThis.fixtureDateCode=fixtureKickoff.slice(0,10).replaceAll('-','');\nglobalThis.fixtureDates=scoreboardDates(selectedDate());\nglobalThis.leagueCodes=LEAGUES.map(([code])=>code);\nglobalThis.feedHarness={poll:pollLiveBackend,state,dates:fixtureDates,leagueCodes,renderCount:0};`, sandbox, { filename: 'app.js' });
  return { sandbox, calls, window };
}

test('live Worker feed reads both dates, normalizes a score change, and renders only changes', async () => {
  const { sandbox, calls, window } = makeHarness();
  const harness = sandbox.feedHarness;
  assert.equal(await harness.poll(), true);
  assert.equal(calls.length, 1);
  const request = new URL(calls[0].url);
  assert.equal(request.origin, 'https://matchday-espn-live.mongla-drive.workers.dev');
  assert.equal(request.pathname, '/api/live');
  assert.equal(request.searchParams.get('dates'), harness.dates.join(','));
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(harness.state.eventsDate, sandbox.localDateKey(sandbox.selectedDate()));
  assert.equal(harness.state.events.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.state.events[0].score)), { home: 1, away: 0 });
  assert.equal(harness.state.feedMode, 'live');
  assert.equal(harness.state.liveBackendActive, true);
  assert.equal(await harness.poll(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.state.events[0].score)), { home: 2, away: 0 });
  assert.equal(window.MatchdayLeague.updates, 2);
  assert.ok(sandbox.renderCount >= 2);
});

test('live Worker polling is skipped for hidden pages and non-today dates', async () => {
  const { sandbox, calls } = makeHarness();
  const harness = sandbox.feedHarness;
  sandbox.document.visibilityState = 'hidden';
  assert.equal(await harness.poll(), false);
  assert.equal(calls.length, 0);
  sandbox.document.visibilityState = 'visible';
  harness.state.dateOffset = 1;
  assert.equal(await harness.poll(), false);
  assert.equal(calls.length, 0);
});
