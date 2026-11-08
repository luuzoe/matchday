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

const fullPayload = () => ({
  provider: 'ESPN',
  fetchedAt: new Date().toISOString(),
  windowStart: '2026-11-01T12:00:00Z',
  windowEnd: '2026-11-08T12:00:00Z',
  matchesConsidered: 273,
  formation: '4-3-3',
  method: 'Selected from completed matches in the last 7 days: most goal involvements by position; defenders ranked by clean sheets, then goal involvements. Own goals excluded.',
  missingSlots: [],
  players: [
    { slot: 'GK', athleteId: '1', name: 'David Raya', team: 'Arsenal', league: 'eng.1', goals: 0, assists: 0, cleanSheets: 2 },
    { slot: 'DF1', athleteId: '2', name: 'William Saliba', team: 'Arsenal', league: 'eng.1', goals: 1, assists: 0, cleanSheets: 2 },
    { slot: 'DF2', athleteId: '3', name: 'Gabriel Magalhães', team: 'Arsenal', league: 'eng.1', goals: 0, assists: 1, cleanSheets: 2 },
    { slot: 'DF3', athleteId: '4', name: 'Virgil van Dijk', team: 'Liverpool', league: 'eng.1', goals: 0, assists: 0, cleanSheets: 1 },
    { slot: 'DF4', athleteId: '5', name: 'Alessandro Bastoni', team: 'Inter', league: 'ita.1', goals: 0, assists: 0, cleanSheets: 1 },
    { slot: 'MF1', athleteId: '6', name: 'Martin Ødegaard', team: 'Arsenal', league: 'eng.1', goals: 1, assists: 2, cleanSheets: 2 },
    { slot: 'MF2', athleteId: '7', name: 'Jude Bellingham', team: 'Real Madrid', league: 'esp.1', goals: 0, assists: 1, cleanSheets: 0 },
    { slot: 'MF3', athleteId: '8', name: 'Pedri', team: 'Barcelona', league: 'esp.1', goals: 0, assists: 0, cleanSheets: 0 },
    { slot: 'FW1', athleteId: '9', name: 'Bukayo Saka', team: 'Arsenal', league: 'eng.1', goals: 2, assists: 0, cleanSheets: 2 },
    { slot: 'FW2', athleteId: '10', name: 'Kylian Mbappé', team: 'Real Madrid', league: 'esp.1', goals: 1, assists: 0, cleanSheets: 0 },
    { slot: 'FW3', athleteId: '11', name: 'Lamine Yamal', team: 'Barcelona', league: 'esp.1', goals: 1, assists: 1, cleanSheets: 0 },
  ],
});

test('renders a full 4-3-3 Team of the Week with formation rows, teams and stats', () => {
  const html = league.teamOfTheWeekCard(fullPayload());
  assert.ok(html.includes('Team of the Week'));
  assert.ok(html.includes('David Raya'));
  assert.ok(html.includes('Bukayo Saka'));
  assert.ok(html.includes('Kylian Mbappé'));
  assert.ok(html.includes('Arsenal'));
  assert.ok(html.includes('Premier League'));
  assert.ok(html.includes('LaLiga'));
  assert.ok(html.includes('2 CS'));
  assert.ok(html.includes('2G'));
  assert.ok(html.includes('2A'));
  assert.ok(html.includes('Own goals excluded'));
  assert.ok(html.includes('273 completed matches considered'));
  assert.ok(html.indexOf('>GK<') < html.indexOf('>DF<'));
  assert.ok(html.indexOf('>DF<') < html.indexOf('>MF<'));
  assert.ok(html.indexOf('>MF<') < html.indexOf('>FW<'));
});

test('shows the unavailable state when the snapshot is missing, empty or stale', () => {
  for (const payload of [null, { error: true }, { players: [] }, fullPayload()]) {
    const candidate = payload && payload.players ? { ...payload, fetchedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() } : payload;
    const html = league.teamOfTheWeekCard(candidate);
    assert.ok(html.includes('Team of the Week unavailable'));
    assert.ok(html.includes('no completed-match data for this week yet'));
    assert.ok(!html.includes('Bukayo Saka'));
  }
});

test('notes missing slots instead of inventing a player', () => {
  const payload = fullPayload();
  payload.players = payload.players.filter(player => player.slot !== 'FW3');
  payload.missingSlots = ['FW: 2 of 3 filled'];
  const html = league.teamOfTheWeekCard(payload);
  assert.ok(html.includes('Incomplete XI'));
  assert.ok(html.includes('FW: 2 of 3 filled'));
  assert.ok(!html.includes('Lamine Yamal'));
});

test('loadTeamOfTheWeek reports an error instead of inventing a team when the snapshot is unavailable', async () => {
  const result = await league.loadTeamOfTheWeek();
  assert.equal(result.error, true);
});
