'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const appPath = path.join(__dirname, 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');
const browserStartup = appSource.indexOf("document.addEventListener('click'");
if (browserStartup < 0) throw new Error('Could not find browser-only app startup boundary');
const sandbox = {
  localStorage: { getItem: () => null, setItem: () => {} },
  console,
};
vm.runInNewContext(`${appSource.slice(0, browserStartup)}\nglobalThis.renderDetailStats = detailStatsPanel;`, sandbox, { filename: appPath });
const render = sandbox.renderDetailStats;
const stat = (name, displayValue, label) => ({ name, displayValue, label });
const summary = (homeStats, awayStats) => ({
  boxscore: {
    teams: [
      { homeAway: 'away', team: { displayName: 'Away United' }, statistics: awayStats },
      { homeAway: 'home', team: { displayName: 'Home City' }, statistics: homeStats },
    ],
  },
});

test('shows all returned match-level stats including possession and formats source ratios', () => {
  const html = render(summary(
    [
      stat('possessionPct', '45.2', 'Possession'),
      stat('totalShots', '8', 'SHOTS'),
      stat('shotsOnTarget', '3', 'ON GOAL'),
      stat('passPct', '0.75', 'Pass Completion %'),
      stat('shotPct', 'N/A', 'On Target %'),
      stat('goalDifference', '4', 'Goal Difference'),
    ],
    [
      stat('possessionPct', '54.8', 'Possession'),
      stat('totalShots', '12', 'SHOTS'),
      stat('shotsOnTarget', '6', 'ON GOAL'),
      stat('passPct', '0.81', 'Pass Completion %'),
      stat('totalGoals', '10', 'Total Goals'),
    ],
  ));
  assert.match(html, /45\.2%/);
  assert.match(html, /54\.8%/);
  assert.match(html, /Total shots/);
  assert.match(html, /Shots on target/);
  assert.match(html, /75%/);
  assert.match(html, /81%/);
  assert.match(html, /N\/A/);
  assert.doesNotMatch(html, /N\/A%/);
  assert.doesNotMatch(html, /Goal Difference|Total Goals|Goal Assists|Goals Against/);
});

test('does not present aggregate-only ESPN fields as match statistics', () => {
  const aggregates = [
    stat('goalDifference', '4', 'Goal Difference'),
    stat('totalGoals', '10', 'Total Goals'),
    stat('goalAssists', '7', 'Assists'),
    stat('goalsConceded', '6', 'Goals Against'),
  ];
  const html = render(summary(aggregates, aggregates));
  assert.match(html, /match-specific statistics/);
  assert.match(html, /Team or season totals are intentionally excluded/);
  assert.doesNotMatch(html, /Goal Difference|Total Goals|Assists|Goals Against/);
});

test('does not infer a missing opponent value', () => {
  const html = render(summary([stat('possessionPct', '54.8', 'Possession')], []));
  assert.match(html, /54\.8%/);
  assert.match(html, /<strong>—<\/strong>/);
});
