'use strict';

(function () {
  const DATA_URL = './data/news.json';
  const TRANSLATIONS_URL = './data/news-my.json';
  const CACHE_KEY = 'matchday_football_news_v3';
  const LEGACY_CACHE_KEYS = ['matchday_bbc_football_news_v2', 'matchday_bbc_football_news_v1'];
  const REFRESH_AFTER_MS = 5 * 60 * 1000;
  let snapshot = null;
  let loading = false;
  let hadError = false;
  let lastRequested = 0;
  let translations = {};
  let translationLoadPromise = null;

  function safeParse(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function fieldString(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (value && typeof value === 'object') {
      if (typeof value.href === 'string') return value.href.trim();
      if (typeof value.url === 'string') return value.url.trim();
      if (typeof value.value === 'string') return value.value.trim();
      if (typeof value['#text'] === 'string') return value['#text'].trim();
      if (value.$ && typeof value.$.url === 'string') return value.$.url.trim();
      if (Array.isArray(value) && value.length) return fieldString(value[0]);
    }
    return '';
  }

  function httpsUrl(value) {
    const original = fieldString(value);
    if (!original) return '';
    try {
      return new URL(original, location.href).protocol === 'https:' ? original : '';
    } catch (_) { return ''; }
  }

  function isBbcArticleUrl(value) {
    const original = httpsUrl(value);
    if (!original) return false;
    try {
      const host = new URL(original, location.href).hostname.toLowerCase();
      return host === 'bbc.co.uk' || host.endsWith('.bbc.co.uk') || host === 'bbc.com' || host.endsWith('.bbc.com') || host === 'bbci.co.uk' || host.endsWith('.bbci.co.uk');
    } catch (_) { return false; }
  }

  function publisherFromUrl(value) {
    const original = httpsUrl(value);
    if (!original) return '';
    try {
      const host = new URL(original, location.href).hostname.toLowerCase();
      if (host === 'bbc.co.uk' || host.endsWith('.bbc.co.uk') || host === 'bbc.com' || host.endsWith('.bbc.com') || host === 'bbci.co.uk' || host.endsWith('.bbci.co.uk')) return 'BBC Sport';
      if (host === 'skysports.com' || host.endsWith('.skysports.com')) return 'SkySports | News';
      return host.replace(/^www\./, '').split('.')[0].replace(/(^|[-_])([a-z])/g, (_, separator, letter) => `${separator}${letter.toUpperCase()}`);
    } catch (_) { return ''; }
  }

  function usablePublisher(value) {
    const publisher = fieldString(value);
    if (!publisher || /^https?:\/\//i.test(publisher) || /^(multiple|multi[- ]source|football news feeds?)$/i.test(publisher)) return '';
    return publisher;
  }

  function publisherFor(item, fallback, articleUrl) {
    const source = item.source && typeof item.source === 'object' ? item.source : {};
    const explicit = usablePublisher(
      item.publisher || item.publisherName || item.publisher_name || item.sourceName || item.source_name ||
      item.feedTitle || item.feed_title || item.sourceTitle || item.source_title ||
      source.title || source.name || source.publisher || item['feed:title']
    );
    if (explicit) return explicit;
    const fromUrl = publisherFromUrl(item.feedUrl || item.feed_url || item.sourceUrl || item.source_url || source.url || articleUrl);
    return fromUrl || usablePublisher(fallback) || 'Football news';
  }

  function dateIso(value) {
    if (value === null || value === undefined || value === '') return '';
    let input = value;
    if (typeof input === 'number' || (typeof input === 'string' && /^\d{10,13}$/.test(input.trim()))) {
      const number = Number(input);
      input = number < 100000000000 ? number * 1000 : number;
    }
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function canonicalLink(value) {
    const valid = httpsUrl(value);
    if (!valid) return '';
    try {
      const url = new URL(valid, location.href);
      url.search = '';
      url.hash = '';
      return url.href.toLowerCase().replace(/\/$/, '');
    } catch (_) { return valid.toLowerCase(); }
  }

  function imageFrom(item) {
    const values = [
      item.imageUrl, item.image_url, item.image, item.thumbnailUrl, item.thumbnail_url, item.thumbnail,
      item['media:thumbnail'], item.mediaThumbnail, item.media_thumbnail, item.enclosure,
      item.media?.thumbnail, item.media?.content, item.media_content
    ];
    for (const value of values) {
      const url = httpsUrl(value);
      if (url) return url;
    }
    return '';
  }

  function articleRows(document) {
    const source = safeParse(document);
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      for (const key of ['payload', 'data', 'result']) {
        const nested = safeParse(source[key]);
        if (nested && nested !== source && typeof nested === 'object') {
          const rows = articleRows(nested);
          if (rows.length) return rows;
        }
      }
      for (const key of ['articles', 'items', 'entries', 'stories']) {
        if (Array.isArray(source[key])) return source[key];
      }
      for (const key of ['feeds', 'sources']) {
        if (Array.isArray(source[key])) {
          return source[key].flatMap(feed => {
            const rows = articleRows(feed);
            const publisher = feed?.publisher || feed?.provider || feed?.feedTitle || feed?.title || feed?.name || '';
            return rows.map(item => ({ ...item, publisher: item.publisher || publisher }));
          });
        }
      }
      if (source.item && typeof source.item === 'object') return [source.item];
      if (source.title || source.guid || source.link || source.url) return [source];
    }
    return Array.isArray(source) ? source : [];
  }

  function normalizeArticle(item, fallbackPublisher) {
    if (!item || typeof item !== 'object') return null;
    const title = fieldString(item.title || item.headline);
    const url = httpsUrl(item.link || item.url || item.articleUrl || item.article_url || item.href);
    if (!title || !url) return null;
    const time = item.time ?? item.publishedAt ?? item.published_at ?? item.pubDate ?? item.published ?? item.date ?? item.updated;
    const author = fieldString(item.author || item.creator || item['dc:creator'] || item['author:name'] || (Array.isArray(item.authors) ? item.authors[0] : ''));
    const publisher = publisherFor(item, fallbackPublisher, url);
    return {
      guid: fieldString(item.guid || item.id || item.identifier),
      title,
      url,
      description: fieldString(item.summary || item.description || item.contentSnippet || item.content_snippet || item.subtitle),
      author,
      publishedAt: dateIso(time),
      publisher,
      imageUrl: imageFrom(item)
    };
  }

  function deduplicate(rows, fallbackPublisher) {
    const items = rows.map(item => normalizeArticle(item, fallbackPublisher)).filter(Boolean);
    items.sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0));
    const output = [];
    const guidIndex = new Set();
    const linkIndex = new Set();
    for (const item of items) {
      const guidKey = item.guid ? `${item.publisher.toLowerCase()}\u0000${item.guid.trim().toLowerCase()}` : '';
      const linkKey = canonicalLink(item.url);
      if ((guidKey && guidIndex.has(guidKey)) || (linkKey && linkIndex.has(linkKey))) continue;
      output.push(item);
      if (guidKey) guidIndex.add(guidKey);
      if (linkKey) linkIndex.add(linkKey);
    }
    return output;
  }

  function normalizedSnapshot(document) {
    const source = safeParse(document);
    const rows = articleRows(source);
    const provider = usablePublisher(source?.provider || source?.publisher || source?.title) || 'Football news feeds';
    const articles = deduplicate(rows, provider);
    const fetchedAt = dateIso(source?.fetchedAt || source?.updatedAt || source?.syncedAt || source?.lastUpdated || source?.time);
    return {
      provider,
      feedUrl: fieldString(source?.feedUrl || source?.sourceUrl) || '',
      fetchedAt,
      articles,
      recognized: rows.length > 0 || Array.isArray(source?.articles) || Array.isArray(source?.items) || Array.isArray(source?.entries) || Array.isArray(source?.feeds) || Array.isArray(source?.sources)
    };
  }

  try {
    const cached = normalizedSnapshot(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached.articles.length) snapshot = cached;
    else {
      for (const key of LEGACY_CACHE_KEYS) {
        const oldCache = safeParse(localStorage.getItem(key));
        if (oldCache && Array.isArray(oldCache.articles)) {
          snapshot = normalizedSnapshot(oldCache);
          if (snapshot.articles.length) break;
        }
      }
    }
  } catch (_) {}

  function formatDate(value) {
    if (!value) return 'Publication time unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Publication time unavailable';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function notifyUpdated() {
    window.dispatchEvent(new Event('matchday-news-updated'));
  }

  function loadTranslations() {
    if (translationLoadPromise) return translationLoadPromise;
    translationLoadPromise = (async () => {
      try {
        const response = await fetch(TRANSLATIONS_URL, { cache: 'no-store' });
        if (response.ok) {
          const result = await response.json();
          if (result && typeof result === 'object' && !Array.isArray(result)) translations = result;
        }
      } catch (_) {
        // If the translation layer is unavailable, keep the original source copy visible.
      } finally {
        notifyUpdated();
      }
    })();
    return translationLoadPromise;
  }

  async function load(force) {
    const now = Date.now();
    if (loading || (!force && now - lastRequested < REFRESH_AFTER_MS)) return;
    loading = true;
    lastRequested = now;
    hadError = false;
    notifyUpdated();
    try {
      const response = await fetch(`${DATA_URL}?v=${Math.floor(now / 60000)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`News data returned ${response.status}`);
      const result = normalizedSnapshot(await response.json());
      if (!result.recognized) throw new Error('News data did not contain RSS article items');
      snapshot = result;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch (_) {}
    } catch (error) {
      hadError = true;
      console.warn('Football news could not be refreshed:', error);
    } finally {
      loading = false;
      notifyUpdated();
    }
  }

  function publisherNames(articles) {
    return [...new Set(articles.map(article => article.publisher).filter(Boolean))];
  }

  function joinNames(names) {
    if (names.length < 2) return names[0] || '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }

  function render() {
    if (!lastRequested || Date.now() - lastRequested >= REFRESH_AFTER_MS) void load(false);
    const burmese = window.MatchdayI18n?.locale === 'my';
    if (burmese) void loadTranslations();
    const articles = snapshot?.articles || [];
    const publishers = publisherNames(articles);
    const latest = articles[0]?.publishedAt || '';
    const status = hadError && articles.length
      ? '<p class="news-status news-status-warning">Could not refresh the latest stories just now; showing the most recently saved feed items.</p>'
      : latest ? `<p class="news-status">Latest story published ${html(formatDate(latest))}</p>` : '';

    let content;
    if (articles.length) {
      content = `<div class="news-list">${articles.map(article => {
        const image = httpsUrl(article.imageUrl);
        const iso = dateIso(article.publishedAt);
        const publisher = article.publisher || 'Football news';
        const translation = burmese ? translations[canonicalLink(article.url)] : null;
        const titleText = typeof translation?.title === 'string' ? translation.title : article.title;
        const descriptionText = typeof translation?.description === 'string' ? translation.description : article.description;
        const storyUrl = isBbcArticleUrl(article.url) ? article.url : '';
        const title = storyUrl
          ? `<a class="news-article-link" href="${html(storyUrl)}" target="_blank" rel="noopener noreferrer">${html(titleText)}</a>`
          : html(titleText);
        const skySource = publisherFromUrl(article.url) === 'SkySports | News' || /sky\s*sports/i.test(publisher);
        const sourceLabel = skySource
          ? `<a class="news-source" href="https://www.skysports.com/football" target="_blank" rel="noopener noreferrer">${html(publisher)}</a>`
          : `<span class="news-source">${html(publisher)}</span>`;
        return `<article class="news-story">
          <div class="news-story-meta">${sourceLabel}${article.author ? `<span class="news-author">By ${html(article.author)}</span>` : ''}${image ? `<span class="news-image-credit">Photo: ${html(publisher)}</span>` : ''}${iso ? `<time datetime="${html(iso)}">Published ${html(formatDate(iso))}</time>` : '<span>Publication time unavailable</span>'}</div>
          <div class="news-story-layout"><div class="news-story-copy"><h2 data-i18n-preserve>${title}</h2>
            ${descriptionText ? `<p data-i18n-preserve>${html(descriptionText)}</p>` : ''}
          </div>${image ? `<img class="news-image" src="${html(image)}" alt="" loading="lazy" decoding="async">` : ''}</div>
        </article>`;
      }).join('')}</div>`;
    } else if (loading) {
      content = '<div class="news-empty"><strong>Loading football news…</strong><span>Checking the latest configured football RSS feeds.</span></div>';
    } else if (hadError) {
      content = '<div class="news-empty"><strong>News could not be loaded</strong><span>The saved football news feed data is temporarily unavailable. Try again shortly.</span></div>';
    } else {
      content = '<div class="news-empty"><strong>No recent stories are available</strong><span>No verified football RSS stories are present in the published feed data yet.</span></div>';
    }

    const sourceCount = publishers.length;
    const eyebrow = sourceCount ? `FOOTBALL NEWS · ${sourceCount} SOURCE${sourceCount === 1 ? '' : 'S'}` : 'FOOTBALL NEWS';
    const intro = publishers.length
      ? `Recent stories from ${html(joinNames(publishers))}; each item is credited to its feed.`
      : 'Recent football stories from configured RSS feeds.';

    return `<section class="news-feed" aria-label="Latest football news">
      <header class="news-heading"><div><p class="news-eyebrow">${html(eyebrow)}</p><h1>Latest news</h1><p class="news-intro">${intro}</p></div><button class="news-refresh" type="button" data-news-refresh ${loading ? 'disabled' : ''}>${loading ? 'Updating…' : 'Refresh'}</button></header>
      ${status}${content}
      <p class="news-attribution">Titles, summaries, dates and thumbnails are shown as supplied by their RSS feeds. Source credits appear with each story. Times use your device’s local time.</p>
    </section>`;
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-news-refresh]')) {
      event.preventDefault();
      void load(true);
    }
  });

  window.setInterval(() => {
    if (document.visibilityState === 'visible') void load(true);
  }, REFRESH_AFTER_MS);

  window.MatchdayNews = { render };
})();
