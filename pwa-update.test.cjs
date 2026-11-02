'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const workerSource = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const pwaSource = fs.readFileSync(path.join(__dirname, 'pwa.js'), 'utf8');

test('refresh-shell message updates cached app assets and acknowledges completion', async () => {
  const handlers = {};
  const cached = new Map();
  const replies = [];
  let fetchCount = 0;
  const cache = {
    async put(url, response) { cached.set(url, response); },
    async match(url) { return cached.get(url); },
  };
  const self = {
    location: { href: 'https://luuzoe.github.io/moksobo-1752-web-test/fotmob-demo/sw.js' },
    addEventListener(type, listener) { handlers[type] = listener; },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(workerSource, {
    self,
    URL,
    Promise,
    Response,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async url => {
      fetchCount += 1;
      return { ok: true, type: 'basic', url, clone() { return { url }; } };
    },
  }, { filename: 'sw.js' });

  let refreshFinished;
  handlers.message({
    data: { type: 'REFRESH_SHELL' },
    ports: [{ postMessage(message) { replies.push(message); } }],
    waitUntil(promise) { refreshFinished = promise; },
  });
  await refreshFinished;

  assert.ok(fetchCount >= 15, 'refreshes the full app shell, including match data');
  assert.equal(cached.size, fetchCount);
  assert.deepEqual(replies.map(reply => reply.type), ['SHELL_REFRESHED']);
  assert.ok([...cached.keys()].some(url => url.endsWith('/data/matches.json')));
});

test('refresh-shell keeps the old cache and reports failure when a required asset is missing', async () => {
  const handlers = {};
  const cached = new Map([['https://luuzoe.github.io/moksobo-1752-web-test/fotmob-demo/app.js', { version: 'old' }]]);
  const replies = [];
  const cache = {
    async put(url, response) { cached.set(url, response); },
    async match(url) { return cached.get(url); },
  };
  const self = {
    location: { href: 'https://luuzoe.github.io/moksobo-1752-web-test/fotmob-demo/sw.js' },
    addEventListener(type, listener) { handlers[type] = listener; },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(workerSource, {
    self,
    URL,
    Promise,
    Response,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async url => ({
      ok: !url.endsWith('/app.js'),
      type: 'basic',
      url,
      clone() { return { url, version: 'new' }; },
    }),
  }, { filename: 'sw.js' });

  let refreshFinished;
  handlers.message({
    data: { type: 'REFRESH_SHELL' },
    ports: [{ postMessage(message) { replies.push(message); } }],
    waitUntil(promise) { refreshFinished = promise; },
  });
  await refreshFinished;

  assert.deepEqual(replies.map(reply => reply.type), ['SHELL_REFRESH_FAILED']);
  assert.deepEqual(cached.get('https://luuzoe.github.io/moksobo-1752-web-test/fotmob-demo/app.js'), { version: 'old' });
  assert.equal(cached.size, 1, 'does not partially replace the current shell');
});

test('installed PWA checks for app and site updates every five minutes', async () => {
  const storage = new Map();
  const clock = { now: 1_000_000 };
  const intervals = [];
  let fetchCount = 0;
  const requestedURLs = [];
  const registration = {
    waiting: null,
    installing: null,
    async update() {},
    addEventListener() {},
  };
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { hidden: true, addEventListener() {}, focus() {} });
      return elements.get(id);
    },
    addEventListener() {},
    visibilityState: 'hidden',
  };
  const window = {
    location: { reload() {} },
    matchMedia() { return { matches: true, addEventListener() {} }; },
    addEventListener() {},
    setInterval(callback, milliseconds) { intervals.push({ callback, milliseconds }); },
    setTimeout() {},
  };
  const navigator = {
    userAgent: 'Test browser',
    platform: 'Linux',
    maxTouchPoints: 0,
    onLine: true,
    serviceWorker: {
      controller: {},
      addEventListener() {},
      async register() { return registration; },
    },
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
  };
  class TestDate extends Date {
    static now() { return clock.now; }
  }

  vm.runInNewContext(pwaSource, {
    document,
    window,
    navigator,
    localStorage,
    location: { protocol: 'https:', hostname: 'luuzoe.github.io' },
    fetch: async url => {
      requestedURLs.push(String(url));
      fetchCount += 1;
      return { ok: true, async json() { return [{ sha: 'version-1' }]; } };
    },
    Date: TestDate,
    console: { warn() {} },
  }, { filename: 'pwa.js' });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].milliseconds, 5 * 60 * 1000);
  assert.equal(fetchCount, 1);
  assert.equal(requestedURLs[0], 'https://api.github.com/repos/luuzoe/matchday/commits?per_page=1');

  clock.now += 5 * 60 * 1000 - 1;
  await intervals[0].callback();
  assert.equal(fetchCount, 1, 'does not fetch the site version before five minutes');

  clock.now += 1;
  await intervals[0].callback();
  assert.equal(fetchCount, 2, 'fetches the site version once five minutes have elapsed');
});

test('does not reload after a failed shell refresh and offers a retry', async () => {
  const storage = new Map([['matchday-site-version', 'version-old']]);
  const listeners = new Map();
  const elements = new Map();
  let reloadCount = 0;
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        hidden: true,
        disabled: false,
        textContent: '',
        addEventListener(type, callback) { listeners.set(id, callback); },
        focus() {},
      });
    }
    return elements.get(id);
  };
  const activeWorker = {
    postMessage(message, ports) {
      assert.equal(message.type, 'REFRESH_SHELL');
      ports[0].postMessage({ type: 'SHELL_REFRESH_FAILED' });
    },
  };
  const registration = { waiting: null, installing: null, async update() {}, addEventListener() {} };
  const document = {
    getElementById: element,
    addEventListener() {},
    visibilityState: 'hidden',
  };
  const window = {
    location: { reload() { reloadCount += 1; } },
    matchMedia() { return { matches: true, addEventListener() {} }; },
    addEventListener() {},
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  const navigator = {
    userAgent: 'Test browser',
    platform: 'Linux',
    maxTouchPoints: 0,
    onLine: true,
    serviceWorker: {
      controller: activeWorker,
      addEventListener() {},
      async register() { return registration; },
    },
  };
  class TestMessageChannel {
    constructor() {
      this.port1 = { onmessage: null, close() {} };
      this.port2 = {
        postMessage: data => this.port1.onmessage && this.port1.onmessage({ data }),
        close() {},
      };
    }
  }

  vm.runInNewContext(pwaSource, {
    document,
    window,
    navigator,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    location: { protocol: 'https:', hostname: 'luuzoe.github.io' },
    fetch: async () => ({ ok: true, async json() { return [{ sha: 'version-new' }]; } }),
    MessageChannel: TestMessageChannel,
    console: { warn() {} },
  }, { filename: 'pwa.js' });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('pwa-update-banner').hidden, false, 'shows the available update');
  listeners.get('pwa-update-action')();

  assert.equal(reloadCount, 0, 'keeps the currently loaded app open');
  assert.equal(element('pwa-update-action').disabled, false);
  assert.equal(element('pwa-update-action').textContent, 'Try again');
  assert.equal(storage.get('matchday-site-version'), 'version-old', 'does not mark a failed update as installed');
});

test('keeps the boot splash visible for at least five seconds and waits for the football run', () => {
  let now = 1000;
  const registered = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const bootSplash = {
    hidden: false,
    classList: { classes: new Set(), add(name) { this.classes.add(name); } },
  };
  const bootRun = {
    addEventListener(type, listener) { registered.set(type, listener); },
    removeEventListener(type, listener) { if (registered.get(type) === listener) registered.delete(type); },
  };
  const elements = new Map([['boot-splash', bootSplash], ['boot-run', bootRun]]);
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: true, addEventListener() {}, focus() {} });
    return elements.get(id);
  };
  const document = { getElementById: element, addEventListener() {} };
  const window = {
    matchMedia(query) { return { matches: query === '(display-mode: standalone)' }; },
    addEventListener() {},
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const navigator = { userAgent: 'Test browser', platform: 'Linux', maxTouchPoints: 0 };
  const FakeDate = class extends Date { static now() { return now; } };

  vm.runInNewContext(pwaSource, { document, window, navigator, Date: FakeDate, console: { warn() {} } }, { filename: 'pwa.js' });

  assert.equal(bootSplash.hidden, false, 'does not dismiss the splash immediately on DOM ready');
  assert.equal(bootSplash.classList.classes.has('is-hiding'), false);
  assert.ok([...timers.values()].some(timer => timer.milliseconds === 5000), 'sets a five-second minimum-time fallback');
  registered.get('animationend')({ target: bootRun, animationName: 'boot-player-bob' });
  assert.equal(registered.has('animationend'), true, 'keeps listening after bubbled child animations');
  assert.equal(bootSplash.classList.classes.has('is-hiding'), false, 'ignores unrelated SVG animations');

  now = 3500;
  registered.get('animationend')({ target: bootRun, animationName: 'boot-run-enter' });
  assert.equal(bootSplash.classList.classes.has('is-hiding'), false, 'does not dismiss early when the run finishes');
  assert.equal(registered.has('animationend'), false, 'removes the handler after the main animation ends');
  const minimumWait = [...timers.values()].find(timer => timer.milliseconds === 2500);
  assert.ok(minimumWait, 'waits out the remaining time until five seconds have elapsed');
  now = 6000;
  minimumWait.callback();
  assert.equal(bootSplash.classList.classes.has('is-hiding'), true, 'starts the splash fade after the five-second minimum');
  assert.equal(bootSplash.hidden, false, 'keeps the splash during its fade');
  const fade = [...timers.values()].find(timer => timer.milliseconds === 300);
  assert.ok(fade, 'schedules the final hide after the fade transition');
  fade.callback();
  assert.equal(bootSplash.hidden, true);
});

test('recognizes fullscreen display mode as installed and suppresses install prompts', () => {
  const windowListeners = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: true, addEventListener() {}, focus() {} });
    return elements.get(id);
  };
  const window = {
    matchMedia(query) { return { matches: query === '(display-mode: fullscreen)', addEventListener() {}, removeEventListener() {} }; },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() {},
    location: { reload() {} },
  };
  const document = { getElementById: element, addEventListener() {}, visibilityState: 'hidden' };
  const navigator = { userAgent: 'Chrome Android', platform: 'Linux', maxTouchPoints: 5, onLine: false };

  vm.runInNewContext(pwaSource, {
    document,
    window,
    navigator,
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { protocol: 'https:', hostname: 'example.test' },
    console: { warn() {} },
  }, { filename: 'pwa.js' });

  const installButton = element('install-cta');
  const banner = element('pwa-install-banner');
  assert.equal(installButton.hidden, true);
  assert.equal(banner.hidden, true);
  windowListeners.get('beforeinstallprompt')({ preventDefault() {} });
  assert.equal(installButton.hidden, true, 'does not offer installation for an already fullscreen app');
  assert.equal(banner.hidden, true, 'does not show a banner over the fullscreen app');
});
