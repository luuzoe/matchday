'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'news.js'), 'utf8');

function makeHarness(payload, { locale = 'en', translations = {} } = {}) {
  const storage = new Map();
  const requests = [];
  const window = { dispatchEvent() {}, setInterval() {}, MatchdayI18n: { locale } };
  const document = { visibilityState: 'visible', addEventListener() {} };
  const sandbox = {
    window,
    document,
    location: { href: 'https://matchday.example/fotmob-demo/' },
    URL,
    Event: class Event { constructor(type) { this.type = type; } },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); }
    },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('news-my.json')) return { ok: true, json: async () => translations };
      return { ok: true, json: async () => payload };
    },
    console: { warn() {} }
  };
  vm.runInNewContext(source, sandbox, { filename: 'news.js' });
  return { window, requests, storage };
}

async function loadNews(harness) {
  harness.window.MatchdayNews.render();
  await new Promise(resolve => setImmediate(resolve));
  return harness.window.MatchdayNews.render();
}

test('renders BBC and Sky feed stories with their source credits and original feed thumbnails', async () => {
  const bbcImage = 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/example.jpg?edition=uk';
  const skyImage = 'https://e1.365dm.com/26/11/1920x1080/example.jpg?20261101231038';
  const harness = makeHarness({
    provider: 'Football news feeds',
    fetchedAt: '2026-11-02T08:00:00Z',
    feeds: [
      {
        title: 'BBC Sport',
        articles: [{
          guid: 'bbc-1',
          title: 'Arsenal & Liverpool: supplied headline',
          link: 'https://www.bbc.co.uk/sport/football/articles/example?campaign=rss',
          description: 'Summary supplied by BBC Sport.',
          publishedAt: '2026-11-02T07:00:00Z',
          imageUrl: bbcImage
        }]
      },
      {
        title: 'SkySports | News',
        feedUrl: 'https://www.skysports.com/rss/11095',
        articles: [{
          guid: 'sky-1',
          title: 'Sky supplied match report',
          link: 'https://www.skysports.com/football/news/11095/example-story',
          description: 'Summary supplied by Sky Sports.',
          publishedAt: '2026-11-02T06:00:00Z',
          imageUrl: skyImage
        }]
      }
    ]
  });

  const html = await loadNews(harness);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].options.cache, 'no-store');
  assert.match(html, /FOOTBALL NEWS · 2 SOURCES/);
  assert.match(html, /BBC Sport and SkySports \| News/);
  assert.match(html, /class="news-source">BBC Sport<\/span>/);
  assert.match(html, /<a class="news-source" href="https:\/\/www\.skysports\.com\/football" target="_blank" rel="noopener noreferrer">SkySports \| News<\/a>/);
  assert.match(html, /Arsenal &amp; Liverpool: supplied headline/);
  assert.match(html, /src="https:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/240\/cpsprodpb\/example\.jpg\?edition=uk"/);
  assert.match(html, /src="https:\/\/e1\.365dm\.com\/26\/11\/1920x1080\/example\.jpg\?20261101231038"/);
  assert.match(html, /<a class="news-article-link" href="https:\/\/www\.bbc\.co\.uk\/sport\/football\/articles\/example\?campaign=rss" target="_blank" rel="noopener noreferrer">Arsenal &amp; Liverpool: supplied headline<\/a>/);
  assert.equal((html.match(/href=/g) || []).length, 2);
  assert.doesNotMatch(html, /example-story/);
});

test('shows the separate Burmese translation layer only in Burmese mode without changing RSS source fields', async () => {
  const url = 'https://www.bbc.co.uk/sport/football/story?campaign=rss';
  const original = {
    title: 'A supplied headline',
    url,
    description: 'A supplied summary.',
    publishedAt: '2026-11-02T07:00:00Z'
  };
  const harness = makeHarness({ provider: 'BBC Sport', articles: [original] }, {
    locale: 'my',
    translations: {
      'https://www.bbc.co.uk/sport/football/story': {
        title: 'မြန်မာလို ခေါင်းစဉ်',
        description: 'မြန်မာလို အကျဉ်းချုပ်။'
      }
    }
  });

  let html = await loadNews(harness);
  assert.match(html, /မြန်မာလို ခေါင်းစဉ်/);
  assert.match(html, /မြန်မာလို အကျဉ်းချုပ်။/);
  assert.doesNotMatch(html, /A supplied headline|A supplied summary\./);
  assert.equal(harness.requests.filter(request => request.url.includes('news-my.json')).length, 1);

  const cachedArticle = JSON.parse(harness.storage.get('matchday_football_news_v3')).articles[0];
  assert.equal(cachedArticle.title, original.title);
  assert.equal(cachedArticle.description, original.description);

  harness.window.MatchdayI18n.locale = 'en';
  html = harness.window.MatchdayNews.render();
  assert.match(html, /A supplied headline/);
  assert.match(html, /A supplied summary\./);
  assert.doesNotMatch(html, /မြန်မာလို/);
});

test('rejects non-HTTPS story and image URLs without altering accepted source data', async () => {
  const harness = makeHarness({
    provider: 'BBC Sport',
    articles: [
      {
        title: 'Verified HTTPS story',
        url: 'https://www.bbc.co.uk/sport/football/story',
        imageUrl: 'https://images.example.test/football.jpg?original=1',
        summary: 'Original summary text.'
      },
      { title: 'Insecure story', url: 'http://example.test/story', imageUrl: 'http://example.test/image.jpg' }
    ]
  });
  const html = await loadNews(harness);
  assert.match(html, /Verified HTTPS story/);
  assert.match(html, /Original summary text\./);
  assert.match(html, /src="https:\/\/images\.example\.test\/football\.jpg\?original=1"/);
  assert.match(html, /href="https:\/\/www\.bbc\.co\.uk\/sport\/football\/story"/);
  assert.doesNotMatch(html, /Insecure story/);
  assert.doesNotMatch(html, /http:\/\/example\.test/);
});
