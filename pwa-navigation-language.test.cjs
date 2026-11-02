'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const app = read('app.js');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const serviceWorker = read('sw.js');
const i18n = read('i18n.js');
const news = read('news.js');

test('saves and restores app navigation through browser history and reloads', () => {
  assert.match(app, /const initialRoute=readAppRoute\(\)/);
  assert.match(app, /history\.pushState/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /addEventListener\('popstate'/);
  assert.match(app, /HISTORY_PUSH_ACTIONS/);
  assert.match(app, /HISTORY_BACK_ACTIONS/);
  assert.match(app, /function restoreAppRoute\(route\)/);
  assert.match(app, /matchdayBackInApp/);
  assert.match(app, /bottomnav\.querySelectorAll\('\.navitem'\)/);
  assert.doesNotMatch(app, /getElementById\('bottomnav'\)\.innerHTML/);
});

test('offers a persisted Burmese/English selector and preserves source article copy', () => {
  assert.match(html, /i18n\.js\?v=/);
  assert.match(app, /id="language-select"/);
  assert.match(app, /MatchdayI18n\?\.setLocale\(event\.target\.value\)/);
  assert.match(i18n, /matchday_language_v1/);
  assert.match(i18n, /EN_BY_MY/);
  assert.match(i18n, /new MutationObserver/);
  assert.match(news, /<h2 data-i18n-preserve>/);
  assert.match(news, /<p data-i18n-preserve>/);
  assert.match(news, /const TRANSLATIONS_URL = '\.\/data\/news-my\.json'/);
  assert.match(news, /const titleText = typeof translation\?\.title === 'string' \? translation\.title : article\.title/);
  assert.match(news, /const descriptionText = typeof translation\?\.description === 'string' \? translation\.description : article\.description/);
  assert.match(serviceWorker, /'\.\/data\/news-my\.json'/);
  assert.doesNotMatch(i18n, /[А-Яа-яЁё]/);
});

test('requests fullscreen display with a neutral top-bar theme and caches localization offline', () => {
  assert.equal(manifest.display, 'fullscreen');
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone', 'minimal-ui']);
  assert.equal(manifest.theme_color, '#f5f6f7');
  assert.match(html, /name="theme-color" content="#f5f6f7"/);
  assert.match(serviceWorker, /matchday-root-shell-v2/);
  assert.match(serviceWorker, /'\.\/i18n\.js'/);
  assert.match(app, /themeColor\.content=state\.theme==='dark'\?'#101214':'#f5f6f7'/);
});
