'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { label, baseMinute } = require('./clock.js');

const fetchedAt = 1_000_000;
const live = (extra = {}) => ({ clockState: 'live', displayClock: "40'", fetchedAt, ...extra });

test('estimates local seconds from the ESPN minute anchor', () => {
  assert.equal(label(live(), fetchedAt + 35_000), '~40:35 EST.');
});

test('caps extrapolation at 59 seconds between refreshes', () => {
  assert.equal(label(live(), fetchedAt + 125_000), '~40:59 EST.');
});

test('ignores seconds if they happen to appear in the source clock', () => {
  assert.equal(baseMinute({ displayClock: '40:58' }), 40);
  assert.equal(label(live({ displayClock: '40:58' }), fetchedAt + 12_000), '~40:12 EST.');
});

test('includes stoppage minutes while keeping seconds locally estimated', () => {
  assert.equal(label(live({ displayClock: "45+2'" }), fetchedAt + 12_000), '~47:12 EST.');
});

test('freezes the standard half-time clock at the ESPN minute', () => {
  const halftime = { clockState: 'halftime', displayClock: "45'", period: 1, fetchedAt };
  assert.equal(label(halftime, fetchedAt + 59_000), 'HT · ~45:00 EST.');
  assert.equal(label(halftime, fetchedAt + 180_000), 'HT · ~45:00 EST.');
});

test('uses a 105-minute fallback for an extra-time interval', () => {
  assert.equal(label({ clockState: 'halftime', period: 3 }, fetchedAt + 5_000), 'HT · ~105:00 EST.');
});

test('freezes the full-time clock and does not add elapsed seconds', () => {
  const finished = { clockState: 'finished', displayClock: '90:44', fetchedAt };
  assert.equal(label(finished, fetchedAt + 58_000), 'FT · ~90:00 EST.');
  assert.equal(label({ clockState: 'finished', displayClock: '0:00' }, fetchedAt), 'FT · ESPN');
});
