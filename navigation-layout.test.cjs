'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appRule = css.match(/\.app\{([^}]*)\}/)?.[1] || '';
const mainRule = css.match(/(?:^|})main\{([^}]*)\}/)?.[1] || '';
const navRule = css.match(/\.bottomnav\{([^}]*)\}/)?.[1] || '';
const mobileNavRule = [...css.matchAll(/\.bottomnav\{([^}]*)\}/g)].at(-1)?.[1] || '';

test('keeps the app shell within short mobile viewports', () => {
  assert.match(appRule, /height:100dvh/);
  assert.match(appRule, /min-height:0/);
});

test('pins the bottom navigation to the app bottom independently of flex sizing', () => {
  assert.match(navRule, /position:absolute/);
  assert.match(navRule, /left:0/);
  assert.match(navRule, /right:0/);
  assert.match(navRule, /bottom:0/);
  assert.match(navRule, /height:calc\(68px \+ var\(--safe-bottom\)\)/);
});

test('pins mobile navigation to the viewport and reserves space for safe areas and overlays', () => {
  assert.match(mobileNavRule, /position:fixed/);
  assert.match(mobileNavRule, /left:0/);
  assert.match(mobileNavRule, /right:0/);
  assert.match(mobileNavRule, /bottom:0/);
  assert.match(mobileNavRule, /max\(env\(safe-area-inset-bottom,0px\),16px\)/);
  assert.match(css, /\.search-overlay\{bottom:calc\(68px \+ max\(/);
  assert.match(css, /\.pwa-install-banner\{bottom:calc\(72px \+ max\(/);
});

test('leaves enough scroll padding for the fixed bottom navigation', () => {
  assert.match(mainRule, /overflow:auto/);
  assert.match(mainRule, /padding-bottom:calc\(14px \+ 68px \+ var\(--safe-bottom\)\)/);
});

test('renders the bottom navigation before app scripts initialize', () => {
  const navMarkup = html.match(/<nav class="bottomnav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
  for (const page of ['Matches', 'News', 'Leagues', 'Following', 'More']) {
    assert.match(navMarkup, new RegExp(`data-page="${page}"`));
  }
});

test('includes a branded startup screen with a footballer illustration and progress track', () => {
  assert.match(html, /id="boot-splash"/);
  assert.match(html, /class="boot-brand-orb"/);
  assert.match(html, /aria-label="Footballer striking a ball"/);
  assert.match(html, /class="boot-player"/);
  assert.match(html, /class="boot-ball"/);
  assert.match(html, /<g class="boot-run" id="boot-run">/);
  assert.match(html, /class="boot-progress" role="progressbar"/);
  assert.match(css, /\.boot-brand-orb\{[^}]*border-radius:50%/);
  assert.match(css, /\.boot-brand-orb img\{[^}]*clip-path:circle\(50%/);
  assert.match(css, /@keyframes boot-run-enter/);
  assert.match(css, /@keyframes boot-player-bob/);
  assert.match(css, /@keyframes boot-ball-roll/);
});

test('fits league hero controls inside narrow phone viewports', () => {
  const backRowRules = [...css.matchAll(/\.league-back-row\{([^}]*)\}/g)];
  const pickerRules = [...css.matchAll(/\.league-season-picker\{([^}]*)\}/g)];
  const selectRules = [...css.matchAll(/\.league-season-picker select\{([^}]*)\}/g)];
  const mobileBackRow = backRowRules.find(match => match[1].includes('display:grid'))?.[1] || '';
  const mobilePicker = pickerRules.at(-1)?.[1] || '';
  const mobileSelect = selectRules.at(-1)?.[1] || '';
  assert.match(mobileBackRow, /display:grid/);
  assert.match(mobileBackRow, /minmax\(0,1fr\)/);
  assert.match(mobileBackRow, /width:100%/);
  assert.match(mobilePicker, /max-width:none/);
  assert.match(mobileSelect, /width:100%/);
  assert.match(mobileSelect, /text-overflow:ellipsis/);
});

test('reserves room for league hero action buttons', () => {
  assert.match(css, /grid-template-columns:34px minmax\(0,1fr\) 34px minmax\(72px,max-content\)/);
  assert.match(css, /\.league-alert-button\{width:34px;min-width:34px/);
  assert.match(css, /\.league-hero \.follow\{width:100%;min-width:72px/);
});
