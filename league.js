'use strict';

(function () {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
  const ESPN_WEB = 'https://site.web.api.espn.com/apis/v2/sports/soccer';
  const ESPN_COMMON = 'https://site.web.api.espn.com/apis/common/v3/sports/soccer';
  const WORKER_BASE = 'https://matchday-espn-live.mongla-drive.workers.dev';
  const OPENLIGA_SHORTCUTS = { 'eng.1': 'pl', 'esp.1': 'la1', 'ger.1': 'bl1', 'uefa.champions': 'ucl', 'uefa.europa': 'uel', 'uefa.europa.conf': 'uecl' };
  const ALERT_KEY = 'matchday_league_score_alerts_v1';
  const DATA_MAX_AGE = 3 * 60 * 1000;
  const FIXTURE_MAX_AGE = 3 * 60 * 1000;
  const NEWS_MAX_AGE = 10 * 60 * 1000;
  const NOTIFY_DELAY = 0;
  const models = new Map();
  let renderQueued = false;
  let alertIds = readAlertIds();

  const COMPETITIONS = {
    'eng.1': { name: 'Premier League', country: 'England', mark: 'PL' },
    'eng.2': { name: 'Championship', country: 'England', mark: 'CH' },
    'eng.3': { name: 'League One', country: 'England', mark: 'L1' },
    'eng.4': { name: 'League Two', country: 'England', mark: 'L2' },
    'eng.fa': { name: 'FA Cup', country: 'England', mark: 'FA' },
    'eng.league_cup': { name: 'Carabao Cup', country: 'England', mark: 'EFL' },
    'esp.1': { name: 'LaLiga', country: 'Spain', mark: 'LL' },
    'esp.2': { name: 'LaLiga 2', country: 'Spain', mark: 'L2' },
    'esp.copa_del_rey': { name: 'Copa del Rey', country: 'Spain', mark: 'CDR' },
    'ger.1': { name: 'Bundesliga', country: 'Germany', mark: 'BL' },
    'ger.2': { name: '2. Bundesliga', country: 'Germany', mark: 'B2' },
    'ger.dfb_pokal': { name: 'DFB-Pokal', country: 'Germany', mark: 'DFB' },
    'ita.1': { name: 'Serie A', country: 'Italy', mark: 'SA' },
    'ita.2': { name: 'Serie B', country: 'Italy', mark: 'SB' },
    'ita.coppa_italia': { name: 'Coppa Italia', country: 'Italy', mark: 'CI' },
    'fra.1': { name: 'Ligue 1', country: 'France', mark: 'L1' },
    'fra.2': { name: 'Ligue 2', country: 'France', mark: 'L2' },
    'ned.1': { name: 'Eredivisie', country: 'Netherlands', mark: 'ERE' },
    'por.1': { name: 'Primeira Liga', country: 'Portugal', mark: 'PL' },
    'bel.1': { name: 'Belgian Pro League', country: 'Belgium', mark: 'BPL' },
    'ksa.1': { name: 'Saudi Pro League', country: 'Saudi Arabia', mark: 'SPL' },
    'sco.1': { name: 'Scottish Premiership', country: 'Scotland', mark: 'SP' },
    'usa.1': { name: 'MLS', country: 'United States', mark: 'MLS' },
    'mex.1': { name: 'Liga MX', country: 'Mexico', mark: 'MX' },
    'uefa.champions': { name: 'UEFA Champions League', country: 'Europe', mark: 'UCL' },
    'uefa.europa': { name: 'UEFA Europa League', country: 'Europe', mark: 'UEL' },
    'uefa.europa.conf': { name: 'UEFA Conference League', country: 'Europe', mark: 'UECL' }
  };

  const TABS = [
    ['Table', 'Table'], ['Fixtures', 'Fixtures'], ['News', 'News'],
    ['Player Stats', 'Player stats'], ['Team Stats', 'Team stats'],
    ['Transfers', 'Transfers'], ['TOTW', 'TOTW'], ['Seasons', 'Seasons']
  ];

  function readAlertIds() {
    try {
      const values = JSON.parse(localStorage.getItem(ALERT_KEY) || '[]');
      return new Set(Array.isArray(values) ? values.map(String) : []);
    } catch (_) { return new Set(); }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function notify() {
    if (renderQueued) return;
    renderQueued = true;
    window.setTimeout(() => {
      renderQueued = false;
      window.dispatchEvent(new Event('matchday-league-updated'));
    }, 0);
  }

  function safeLogo(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'https:' ? value : '';
    } catch (_) { return ''; }
  }

  function safeStoryURL(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) { return ''; }
  }

  function espnWorkerProxyURL(value) {
    try {
      const url = new URL(value, location.href);
      const host = url.hostname.toLowerCase();
      if (host !== 'espn.com' && !host.endsWith('.espn.com')) return '';
      const match = url.pathname.match(/\/apis\/(?:site\/v2|v2|common\/v3)\/sports\/soccer\/([^/]+)\/([^/]+)$/);
      if (!match) return '';
      return `${WORKER_BASE}/api/proxy/espn/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}${url.search}`;
    } catch (_) { return ''; }
  }

  async function fetchJSON(url, timeoutMs = 20000) {
    const proxy = espnWorkerProxyURL(url);
    const targets = proxy ? [url, proxy] : [url];
    let lastError = null;
    for (const target of targets) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch(target, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          ...(controller ? { signal: controller.signal } : {})
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      } finally {
        if (timer) window.clearTimeout(timer);
      }
    }
    throw lastError || new Error('JSON source unavailable');
  }

  function modelFor(id, comp) {
    let model = models.get(id);
    if (!model) {
      model = {
        id,
        comp: comp || null,
        tab: 'Table',
        selectedYear: Number(comp?.season) || new Date().getFullYear(),
        userPickedSeason: false,
        standingsMode: 'full',
        fixtureDate: '',
        fixtureRound: '',
        fixtureTeam: '',
        showAllPlayers: false,
        seasons: [],
        seasonsLoaded: false,
        seasonsLoading: false,
        seasonsError: false,
        standingsGroups: [],
        standings: [],
        dataLoadedFor: null,
        dataLoading: false,
        dataError: false,
        dataSource: 'ESPN',
        updatedAt: 0,
        matches: [],
        teamForms: {},
        calendar: [],
        calendarSeasonYear: null,
        fixturesLoadedFor: null,
        fixturesLoading: false,
        fixturesError: false,
        fixturesUpdatedAt: 0,
        stats: null,
        statsSource: 'ESPN',
        statsLoading: false,
        statsLoadedFor: null,
        statsError: false,
        news: [],
        newsSource: 'ESPN',
        newsFetchedAt: '',
        newsLoading: false,
        newsLoaded: false,
        newsError: false,
        newsUpdatedAt: 0,
        transactions: [],
        transactionsSource: 'ESPN',
        transactionsLoading: false,
        transactionsLoadedFor: null,
        transactionsError: false,
        transactionsFetchedAt: '',
        openLigaCompetition: null,
        notice: ''
      };
      models.set(id, model);
    }
    if (comp) model.comp = comp;
    return model;
  }

  function openLigaFor(id, snapshot) {
    const shortcut = OPENLIGA_SHORTCUTS[String(id)];
    if (!shortcut || !Array.isArray(snapshot?.competitions)) return null;
    return snapshot.competitions.find(item => String(item.shortcut || '').toLowerCase() === shortcut) || null;
  }

  function openLigaStandingsPayload(competition, year) {
    if (!competition || Number(competition.season) !== Number(year) || !Array.isArray(competition.standings) || !competition.standings.length) return null;
    const entries = competition.standings.map(row => ({
      team: { displayName: row.team, shortDisplayName: row.shortName || '', logo: row.logoUrl || '' },
      stats: [
        ['rank', row.position], ['gamesPlayed', row.played], ['wins', row.won], ['ties', row.drawn],
        ['losses', row.lost], ['pointsFor', row.goalsFor], ['pointsAgainst', row.goalsAgainst],
        ['pointDifferential', row.goalDifference], ['points', row.points]
      ].map(([name, value]) => ({ name, displayValue: value === null || value === undefined ? null : String(value) }))
    }));
    return { season: { year: Number(year) }, children: [{ name: competition.sourceName || competition.name || `${year} season`, standings: { entries } }] };
  }

  function openLigaPlayerStats(model, year) {
    const competition = model.openLigaCompetition;
    const source = competition?.playerStats;
    if (!competition || Number(competition.season) !== Number(year) || !Array.isArray(source?.players) || !source.players.length) return null;
    return {
      season: { year: Number(year), displayName: competition.sourceName || competition.name || `${year} season` },
      stats: [{
        name: 'recordedGoals', displayName: 'Recorded goals',
        leaders: source.players.map(player => ({
          athlete: { displayName: String(player.name || '') },
          team: { displayName: Array.isArray(player.teams) ? player.teams.join(' / ') : '' },
          value: Number(player.goals) || 0,
          displayValue: `${Number(player.goals) || 0} goals`
        }))
      }],
      sourceCoverage: source.coverage || {}
    };
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function preferredTeamLogo(team) {
    const logos = Array.isArray(team?.logos) ? team.logos : [];
    const preferred = logos.find(item => Array.isArray(item.rel) && item.rel.includes('default')) || logos[0];
    return safeLogo(team?.logo || preferred?.href || '');
  }

  function statDisplay(entry, name) {
    const stat = (Array.isArray(entry?.stats) ? entry.stats : []).find(item => item.name === name);
    return stat?.displayValue ?? stat?.value ?? null;
  }

  function normalizeStandings(payload) {
    const groups = (Array.isArray(payload?.children) ? payload.children : []).map((section, groupIndex) => {
      const standings = section?.standings || {};
      const rows = (Array.isArray(standings.entries) ? standings.entries : []).map((entry, index) => {
        const team = entry.team || {};
        const rawForm = String(entry.form || team.form || statDisplay(entry, 'form') || '').toUpperCase();
        return {
          position: numberOrNull(statDisplay(entry, 'rank')) ?? index + 1,
          team: String(team.displayName || team.name || team.shortDisplayName || 'Team'),
          shortName: String(team.shortDisplayName || team.abbreviation || ''),
          logoUrl: preferredTeamLogo(team),
          played: numberOrNull(statDisplay(entry, 'gamesPlayed')),
          won: numberOrNull(statDisplay(entry, 'wins')),
          drawn: numberOrNull(statDisplay(entry, 'ties')),
          lost: numberOrNull(statDisplay(entry, 'losses')),
          goalsFor: numberOrNull(statDisplay(entry, 'pointsFor')),
          goalsAgainst: numberOrNull(statDisplay(entry, 'pointsAgainst')),
          goalDifference: statDisplay(entry, 'pointDifferential'),
          points: numberOrNull(statDisplay(entry, 'points')),
          form: rawForm.match(/[WDL]/g) || [],
          group: String(section.name || standings.name || `Group ${groupIndex + 1}`)
        };
      });
      return { name: String(section.name || standings.displayName || standings.name || ''), rows };
    }).filter(group => group.rows.length);
    return groups;
  }

  async function loadSeasons(model) {
    if (model.seasonsLoading || model.seasonsLoaded) return;
    model.seasonsLoading = true;
    notify();
    try {
      let payload;
      try {
        payload = await fetchJSON(`${ESPN_COMMON}/${encodeURIComponent(model.id)}/seasons?region=us&lang=en`);
        if (!Array.isArray(payload.seasons) || !payload.seasons.length) throw new Error('ESPN returned no seasons');
        model.seasonsSource = 'ESPN';
        model.catalogFetchedAt = null;
      } catch (liveError) {
        const cached = await cachedLeagueData(model.id);
        if (!Array.isArray(cached.data.seasons) || !cached.data.seasons.length) throw liveError;
        payload = { seasons: cached.data.seasons };
        model.seasonsSource = 'ESPN snapshot';
        model.catalogFetchedAt = cached.data.fetchedAt || cached.snapshot.fetchedAt;
      }
      model.seasons = (Array.isArray(payload.seasons) ? payload.seasons : [])
        .filter(item => Number(item.year) && (item.displayName || item.leagueName))
        .map(item => ({ year: Number(item.year), leagueName: String(item.displayName || item.leagueName), provider: 'ESPN' }))
        .sort((a, b) => b.year - a.year);
      if (!model.seasons.length) throw new Error('ESPN returned no seasons');
      model.seasonsError = false;
      if (!model.userPickedSeason && !model.seasons.some(item => item.year === Number(model.selectedYear))) {
        model.selectedYear = model.seasons[0].year;
      }
    } catch (error) {
      model.seasonsError = true;
      model.seasons = [];
      console.warn(`ESPN season list unavailable for ${model.id}:`, error);
    } finally {
      model.seasonsLoading = false;
      model.seasonsLoaded = true;
      notify();
    }
  }

  async function cachedLeagueData(id) {
    const snapshot = await fetchJSON(`./data/espn/league-data.json?v=${Math.floor(Date.now() / 300000)}`);
    const data = snapshot.competitions?.[id];
    if (!data) throw new Error(`No same-origin ESPN cache for ${id}`);
    return { snapshot, data };
  }

  async function cachedLeagueNews(id) {
    const snapshot = await fetchJSON(`./data/espn/news.json?v=${Math.floor(Date.now() / 300000)}`);
    const data = snapshot.competitions?.[id];
    if (!data || !Array.isArray(data.articles)) throw new Error(`No same-origin ESPN news cache for ${id}`);
    return { ...data, fetchedAt: data.fetchedAt || snapshot.fetchedAt || '', provider: 'ESPN snapshot' };
  }

  async function cachedPlayerStats(id, year) {
    const snapshot = await fetchJSON(`./data/espn/player-stats.json?v=${Math.floor(Date.now() / 600000)}`);
    const data = snapshot.competitions?.[id];
    if (!data || Number(data.seasonYear) !== Number(year)) throw new Error(`No same-season ESPN player stats cache for ${id}`);
    const groups = (Array.isArray(data.stats) ? data.stats : []).filter(group => Array.isArray(group.leaders) && group.leaders.length);
    if (!groups.length) throw new Error(`No ESPN player stats cache for ${id}`);
    return { season: data.season || { year: Number(year) }, stats: data.stats };
  }

  const TOTW_STALE_MS = 8 * 24 * 60 * 60 * 1000;
  let totwCache = null;
  let totwLoading = null;

  async function loadTeamOfTheWeek() {
    if (totwCache) return totwCache;
    if (totwLoading) return totwLoading;
    totwLoading = (async () => {
      try {
        const payload = await fetchJSON(`./data/espn/team-of-the-week.json?v=${Math.floor(Date.now() / 600000)}`);
        if (!payload || !Array.isArray(payload.players)) throw new Error('Invalid Team of the Week snapshot');
        totwCache = payload;
      } catch (error) {
        totwCache = { error: true };
      }
      return totwCache;
    })();
    return totwLoading;
  }

  function totwPlayerStat(player) {
    const parts = [];
    if (Number(player.goals) > 0) parts.push(`${player.goals}G`);
    if (Number(player.assists) > 0) parts.push(`${player.assists}A`);
    if (Number(player.cleanSheets) > 0) parts.push(`${player.cleanSheets} CS`);
    return parts.join(' · ') || '—';
  }

  function teamOfTheWeekCard(payload) {
    const heading = '<div class="league-card-heading"><div><h2>Team of the Week</h2><p>Selected from completed matches in the last 7 days</p></div><span class="league-source-chip">ESPN</span></div>';
    const stale = (() => {
      try { return !payload?.fetchedAt || Date.now() - new Date(payload.fetchedAt).getTime() > TOTW_STALE_MS; } catch (_) { return true; }
    })();
    if (!payload || payload.error || !Array.isArray(payload.players) || !payload.players.length || stale) {
      return `<section class="league-data-card totw-card">${heading}${unavailable('Team of the Week unavailable', 'Team of the Week is unavailable — no completed-match data for this week yet.')}</section>`;
    }
    const rows = ['GK', 'DF', 'MF', 'FW'].map(line => {
      const players = payload.players.filter(player => String(player.slot || '').startsWith(line));
      if (!players.length) return '';
      return `<div class="totw-row"><span class="totw-line">${esc(line)}</span><div class="totw-players">${players.map(player => {
        const leagueName = COMPETITIONS[player.league]?.name || player.league || '';
        return `<div class="totw-player"><strong>${esc(player.name || 'Player name unavailable')}</strong><small>${esc(player.team || '')}${leagueName ? ` · ${esc(leagueName)}` : ''}</small><span>${esc(totwPlayerStat(player))}</span></div>`;
      }).join('')}</div></div>`;
    }).join('');
    const updated = (() => {
      try { return new Date(payload.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (_) { return ''; }
    })();
    const missing = Array.isArray(payload.missingSlots) && payload.missingSlots.length
      ? `<p class="totw-note">Incomplete XI — missing slots: ${esc(payload.missingSlots.join(', '))}.</p>`
      : '';
    const method = payload.method || 'Selected from completed matches in the last 7 days: most goal involvements by position; defenders ranked by clean sheets, then goal involvements. Own goals excluded.';
    return `<section class="league-data-card totw-card">${heading}<div class="totw-formation">${rows}</div><p class="totw-method">${esc(method)}</p>${missing}<p class="league-data-note">ESPN · ${esc(payload.matchesConsidered ?? '')} completed matches considered${updated ? ` · Updated ${esc(updated)}` : ''}</p></section>`;
  }

  function fillTeamOfTheWeek() {
    if (typeof document === 'undefined') return;
    const slot = document.getElementById('totw-slot');
    if (!slot) return;
    if (totwCache) {
      slot.innerHTML = teamOfTheWeekCard(totwCache);
      if (window.MatchdayI18n) window.MatchdayI18n.translate(slot);
      return;
    }
    slot.innerHTML = `<section class="league-data-card totw-card"><div class="league-card-heading"><div><h2>Team of the Week</h2><p>Selected from completed matches in the last 7 days</p></div><span class="league-source-chip">ESPN</span></div>${loadingCard('Checking…')}</section>`;
    loadTeamOfTheWeek().then(payload => {
      const current = document.getElementById('totw-slot');
      if (!current) return;
      current.innerHTML = teamOfTheWeekCard(payload);
      if (window.MatchdayI18n) window.MatchdayI18n.translate(current);
    });
  }

  function seasonFor(model) {
    return model.seasons.find(item => Number(item.year) === Number(model.selectedYear)) || {
      year: Number(model.selectedYear), leagueName: String(model.selectedYear), provider: 'ESPN'
    };
  }

  async function loadSeasonData(model, force = false) {
    const year = Number(model.selectedYear);
    if (!year || model.dataLoading) return;
    if (!force && model.dataLoadedFor === year && Date.now() - model.updatedAt < DATA_MAX_AGE) return;
    model.dataLoading = true;
    model.dataLoadedFor = null;
    model.standingsGroups = [];
    model.standings = [];
    model.dataError = false;
    notify();
    try {
      let payload;
      let source = 'ESPN';
      let fetchedAt = null;
      try {
        payload = await fetchJSON(`${ESPN_WEB}/${encodeURIComponent(model.id)}/standings?region=us&lang=en&season=${year}`);
        const returnedYear = Number(payload.season?.year || payload.children?.[0]?.standings?.season);
        if (returnedYear && returnedYear !== year) throw new Error(`ESPN returned season ${returnedYear}, not ${year}`);
      } catch (liveError) {
        try {
          const cached = await cachedLeagueData(model.id);
          if (Number(cached.data.currentSeasonYear) !== year || !cached.data.standings) throw liveError;
          payload = cached.data.standings;
          const returnedYear = Number(payload.season?.year || payload.children?.[0]?.standings?.season);
          if (returnedYear && returnedYear !== year) throw liveError;
          source = 'ESPN snapshot';
          fetchedAt = cached.data.standingsFetchedAt || cached.snapshot.fetchedAt;
        } catch (snapshotError) {
          const fallback = openLigaStandingsPayload(model.openLigaCompetition, year);
          if (!fallback) throw liveError;
          payload = fallback;
          source = 'OpenLigaDB (ODbL 1.0)';
          fetchedAt = model.openLigaCompetition.standingsUpdatedAt || null;
        }
      }
      if (Number(model.selectedYear) !== year) return;
      model.standingsGroups = normalizeStandings(payload);
      model.standings = model.standingsGroups.flatMap(group => group.rows);
      model.dataSource = source;
      model.dataFetchedAt = fetchedAt;
    } catch (error) {
      if (Number(model.selectedYear) === year) {
        model.dataError = true;
        model.standingsGroups = [];
        model.standings = [];
      }
      console.warn(`ESPN standings unavailable for ${model.id}/${year}:`, error);
    } finally {
      model.dataLoading = false;
      if (Number(model.selectedYear) === year) {
        model.dataLoadedFor = year;
        model.updatedAt = Date.now();
      }
      notify();
    }
  }

  function myanmarDateKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(value).filter(part => part.type !== 'literal');
    const result = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${result.year}-${result.month}-${result.day}`;
  }

  function utcDateCode(value = new Date()) {
    return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`;
  }

  function mmtDateCode(key) {
    return Date.parse(`${key}T00:00:00+06:30`);
  }

  function fixtureLocalDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? myanmarDateKey(date) : '';
  }

  function scoreFromCompetitors(home, away, state) {
    if (state === 'pre') return null;
    const h = numberOrNull(home?.score);
    const a = numberOrNull(away?.score);
    return h !== null && a !== null ? { home: h, away: a } : null;
  }

  function normalizeESPNFixture(event) {
    const competition = event?.competitions?.[0] || {};
    const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
    const home = competitors.find(item => item.homeAway === 'home') || {};
    const away = competitors.find(item => item.homeAway === 'away') || {};
    const status = event?.status || competition.status || {};
    const statusType = status.type || {};
    const state = String(statusType.state || '').toLowerCase();
    const homeTeam = home.team || {};
    const awayTeam = away.team || {};
    const week = event?.week || competition?.week || {};
    return {
      id: String(event?.id || ''),
      kickoffUtc: String(event?.date || competition?.date || ''),
      dateKey: fixtureLocalDate(event?.date || competition?.date),
      round: String(week.text || week.displayName || week.number || ''),
      home: String(homeTeam.displayName || homeTeam.shortDisplayName || 'Home team'),
      away: String(awayTeam.displayName || awayTeam.shortDisplayName || 'Away team'),
      homeAbbr: String(homeTeam.abbreviation || ''),
      awayAbbr: String(awayTeam.abbreviation || ''),
      homeLogo: preferredTeamLogo(homeTeam),
      awayLogo: preferredTeamLogo(awayTeam),
      homeForm: String(home.form || homeTeam.form || ''),
      awayForm: String(away.form || awayTeam.form || ''),
      finished: Boolean(statusType.completed),
      state,
      status: String(statusType.name || 'STATUS_UNKNOWN'),
      score: scoreFromCompetitors(home, away, state)
    };
  }

  function scheduleDateCodes(calendar, now = new Date()) {
    const today = myanmarDateKey(now);
    const start = mmtDateCode(today) - 12 * 60 * 60 * 1000;
    const end = mmtDateCode(today) + 8 * 24 * 60 * 60 * 1000;
    return [...new Set((Array.isArray(calendar) ? calendar : []).map(value => {
      const time = Date.parse(value);
      if (!Number.isFinite(time) || time < start || time >= end) return '';
      const date = new Date(time);
      return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
    }).filter(Boolean))].sort();
  }

  async function cachedScoreboard(id, code) {
    const snapshot = await fetchJSON(`./data/espn/scoreboards/${code}.json?v=${Math.floor(Date.now() / 300000)}`);
    const board = snapshot.leagues?.[id];
    if (!board) throw new Error(`No cached ESPN board for ${id}/${code}`);
    return { events: Array.isArray(board.events) ? board.events : [], fetchedAt: snapshot.fetchedAt || '' };
  }

  async function loadFixtures(model, props = {}, force = false) {
    const year = Number(model.selectedYear);
    if (!year || model.fixturesLoading) return;
    if (!force && model.fixturesLoadedFor === year && Date.now() - model.fixturesUpdatedAt < FIXTURE_MAX_AGE) return;
    model.fixturesLoading = true;
    model.fixturesError = false;
    model.matches = [];
    model.teamForms = {};
    model.fixturesSource = 'ESPN';
    model.fixturesFetchedAt = null;
    notify();
    try {
      let calendar = Array.isArray(props.calendar) ? props.calendar : model.calendar;
      let currentYear = Number(props.calendarSeasonYear || model.calendarSeasonYear) || null;
      if (!calendar.length || !currentYear) {
        try {
          const todayBoard = await fetchJSON(`${ESPN}/${encodeURIComponent(model.id)}/scoreboard?dates=${utcDateCode()}`);
          const league = (Array.isArray(todayBoard.leagues) ? todayBoard.leagues : []).find(item => item.slug === model.id) || todayBoard.leagues?.[0] || {};
          calendar = Array.isArray(league.calendar) ? league.calendar : [];
          currentYear = Number(league.season?.year || todayBoard.season?.year) || null;
        } catch (liveError) {
          const cached = await cachedScoreboard(model.id, utcDateCode());
          const calendarSnapshot = await fetchJSON(`./data/espn/scoreboards/${utcDateCode()}.json?v=${Math.floor(Date.now() / 300000)}`);
          const league = calendarSnapshot.leagues?.[model.id] || {};
          calendar = Array.isArray(league.calendar) ? league.calendar : [];
          currentYear = Number(league.seasonYear) || null;
          model.fixturesSource = 'ESPN snapshot';
          model.fixturesFetchedAt = cached.fetchedAt;
        }
      }
      model.calendar = calendar;
      model.calendarSeasonYear = currentYear;
      if (currentYear && currentYear !== year) {
        model.matches = [];
        model.fixturesLoadedFor = year;
        model.fixturesUpdatedAt = Date.now();
        model.fixturesError = false;
        return;
      }
      const codes = scheduleDateCodes(calendar);
      const results = await Promise.allSettled(codes.map(async code => {
        const board = await fetchJSON(`${ESPN}/${encodeURIComponent(model.id)}/scoreboard?dates=${code}`);
        return { events: Array.isArray(board.events) ? board.events : [], fetchedAt: '' };
      }));
      let sourceLive = false;
      let sourceSnapshot = model.fixturesSource === 'ESPN snapshot';
      const rawEvents = [];
      const snapshotTimes = model.fixturesFetchedAt ? [Date.parse(model.fixturesFetchedAt)].filter(Number.isFinite) : [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status === 'fulfilled') {
          sourceLive = true;
          rawEvents.push(...result.value.events);
          continue;
        }
        try {
          const cached = await cachedScoreboard(model.id, codes[index]);
          rawEvents.push(...cached.events);
          sourceSnapshot = true;
          const fetched = Date.parse(cached.fetchedAt);
          if (Number.isFinite(fetched)) snapshotTimes.push(fetched);
        } catch (_) {}
      }
      if (codes.length && !sourceLive && !sourceSnapshot) throw new Error('No live or cached ESPN fixture dates could be loaded');
      const today = myanmarDateKey();
      const end = mmtDateCode(today) + 8 * 24 * 60 * 60 * 1000;
      const seen = new Map();
      for (const event of rawEvents) {
        const match = normalizeESPNFixture(event);
        const time = Date.parse(match.kickoffUtc);
        if (!match.id || !Number.isFinite(time) || mmtDateCode(match.dateKey) < mmtDateCode(today) || mmtDateCode(match.dateKey) >= end) continue;
        seen.set(match.id, match);
      }
      model.matches = [...seen.values()].sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));
      model.teamForms = {};
      for (const match of model.matches) {
        if (match.homeForm) model.teamForms[normalizedTeam(match.home)] = match.homeForm;
        if (match.awayForm) model.teamForms[normalizedTeam(match.away)] = match.awayForm;
      }
      model.fixturesSource = sourceLive && sourceSnapshot ? 'ESPN + snapshot' : sourceSnapshot ? 'ESPN snapshot' : 'ESPN';
      model.fixturesFetchedAt = snapshotTimes.length ? new Date(Math.min(...snapshotTimes)).toISOString() : null;
    } catch (error) {
      model.fixturesError = true;
      model.matches = [];
      console.warn(`ESPN fixtures unavailable for ${model.id}/${year}:`, error);
    } finally {
      model.fixturesLoading = false;
      if (Number(model.selectedYear) === year) {
        model.fixturesLoadedFor = year;
        model.fixturesUpdatedAt = Date.now();
      }
      notify();
    }
  }

  async function loadPlayerStats(model, force = false) {
    const year = Number(model.selectedYear);
    if (!year || model.statsLoading) return;
    if (!force && model.statsLoadedFor === year) return;
    model.statsLoading = true;
    model.statsError = false;
    notify();
    try {
      let payload;
      try {
        payload = await fetchJSON(`${ESPN}/${encodeURIComponent(model.id)}/statistics?season=${year}`);
        const groups = (Array.isArray(payload.stats) ? payload.stats : []).filter(group => Array.isArray(group.leaders) && group.leaders.length);
        if (Number(payload.season?.year) !== year || !groups.length) throw new Error('ESPN returned no player leader categories');
        model.statsSource = 'ESPN';
      } catch (liveError) {
        try {
          payload = await cachedPlayerStats(model.id, year);
          model.statsSource = 'ESPN snapshot';
        } catch (cacheError) {
          payload = openLigaPlayerStats(model, year);
          if (!payload) throw liveError;
          model.statsSource = 'OpenLigaDB (ODbL 1.0)';
        }
      }
      if (Number(model.selectedYear) !== year) return;
      model.stats = payload;
      model.statsLoadedFor = year;
    } catch (error) {
      if (Number(model.selectedYear) === year) {
        model.statsError = true;
        model.stats = null;
        model.statsLoadedFor = year;
      }
      console.warn(`Player statistics unavailable for ${model.id}/${year}:`, error);
    } finally {
      model.statsLoading = false;
      notify();
    }
  }

  async function loadNews(model, force = false) {
    if (model.newsLoading) return;
    if (!force && model.newsLoaded && Date.now() - model.newsUpdatedAt < NEWS_MAX_AGE) return;
    model.newsLoading = true;
    model.newsError = false;
    notify();
    try {
      let payload;
      try {
        payload = await fetchJSON(`${ESPN}/${encodeURIComponent(model.id)}/news?limit=25`);
        if (!Array.isArray(payload.articles)) throw new Error('ESPN did not return an articles list');
        if (!payload.articles.length) {
          try {
            const cached = await cachedLeagueNews(model.id);
            if (cached.articles.length) {
              payload = cached;
              model.newsSource = 'ESPN snapshot';
              model.newsFetchedAt = cached.fetchedAt;
            } else model.newsSource = 'ESPN';
          } catch (_) { model.newsSource = 'ESPN'; }
        } else {
          model.newsSource = 'ESPN';
          model.newsFetchedAt = '';
        }
      } catch (liveError) {
        payload = await cachedLeagueNews(model.id);
        model.newsSource = 'ESPN snapshot';
        model.newsFetchedAt = payload.fetchedAt;
      }
      // Keep every original ESPN field; display-only values are derived in newsTab.
      model.news = (Array.isArray(payload.articles) ? payload.articles : []).filter(article => article && typeof article === 'object');
    } catch (error) {
      model.news = [];
      model.newsError = true;
      console.warn(`ESPN news unavailable for ${model.id}:`, error);
    } finally {
      model.newsLoading = false;
      model.newsLoaded = true;
      model.newsUpdatedAt = Date.now();
      notify();
    }
  }

  async function loadTransfers(model, force = false) {
    const year = Number(model.selectedYear);
    if (!year || model.transfersLoading) return;
    if (!force && model.transactionsLoadedFor === year) return;
    model.transfersLoading = true;
    model.transactionsError = false;
    notify();
    try {
      const payload = await fetchJSON(`${ESPN}/${encodeURIComponent(model.id)}/transactions?season=${year}`);
      if (!Array.isArray(payload.transactions)) throw new Error('ESPN did not return a transaction list');
      if (Number(model.selectedYear) !== year) return;
      model.transactions = payload.transactions.filter(item => item && typeof item === 'object');
      model.transactionsSource = 'ESPN';
      model.transactionsFetchedAt = String(payload.timestamp || '');
    } catch (error) {
      if (Number(model.selectedYear) === year) {
        model.transactions = [];
        model.transactionsError = true;
        model.transactionsSource = 'ESPN';
      }
      console.warn(`ESPN transfers unavailable for ${model.id}/${year}:`, error);
    } finally {
      model.transfersLoading = false;
      if (Number(model.selectedYear) === year) model.transactionsLoadedFor = year;
      notify();
    }
  }

  function transactionText(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object') return '';
    return String(value.displayName || value.name || value.shortName || value.abbreviation || value.type?.displayName || value.type?.name || '');
  }

  function formattedDate(value, options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date not supplied';
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'Asia/Yangon' }).format(date);
  }

  function dateLabel(key) {
    const today = myanmarDateKey();
    const tomorrowDate = new Date(`${today}T00:00:00+06:30`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = myanmarDateKey(tomorrowDate);
    if (key === today) return 'Today';
    if (key === tomorrow) return 'Tomorrow';
    return formattedDate(`${key}T12:00:00+06:30`, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function timeLabel(value) {
    return formattedDate(value, { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
  }

  function normalizedTeam(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/\b(?:fc|cf|afc|ac|sc|cd|club|football|futbol|deportivo)\b/g, ' ')
      .replace(/[^a-z0-9]/g, '');
  }

  function teamButton(name, id, logo, abbr, props, size = 'table') {
    const team = { name, leagueCode: id, logo: safeLogo(logo || ''), abbr: abbr || '' };
    if (typeof props.teamControl === 'function') return props.teamControl(team, size);
    return `<span>${esc(name)}</span>`;
  }

  function loadingCard(label) {
    return `<div class="league-loading"><span class="league-loader-dot"></span><span>${esc(label)}</span></div>`;
  }

  function unavailable(title, description, source = 'ESPN has not supplied this data') {
    return `<div class="league-empty"><span class="league-empty-icon">–</span><strong>${esc(title)}</strong><p>${esc(description)}</p><small>${esc(source)}</small></div>`;
  }

  function controlButtons(labels, current, attr, id) {
    return `<div class="league-segmented" role="group">${labels.map(([value, label]) => `<button type="button" class="league-segment ${current === value ? 'active' : ''}" data-${attr}="${esc(value)}" data-league-id="${esc(id)}" aria-pressed="${current === value}">${esc(label)}</button>`).join('')}</div>`;
  }

  function formatClub(row, props) {
    return teamButton(row.team, props.id, row.logoUrl || props.teamLogoFor?.(row.team, props.id) || '', row.shortName, props);
  }

  function groupTable(group, model, props) {
    const rows = group.rows || [];
    if (!rows.length) return '';
    const mode = model.standingsMode;
    const headers = mode === 'short'
      ? '<th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th>'
      : mode === 'form'
        ? '<th>#</th><th>Team</th><th>Last 5</th><th>Pts</th>'
        : '<th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF–GA</th><th>GD</th><th>Pts</th>';
    const body = rows.map((row, index) => {
      const position = row.position ?? index + 1;
      const formValue = row.form.length ? row.form : String(model.teamForms[normalizedTeam(row.team)] || '').match(/[WDL]/g) || [];
      const form = formValue.length
        ? `<span class="league-form-list">${formValue.slice(-5).map(value => `<span class="league-form-chip ${value.toLowerCase()}">${esc(value)}</span>`).join('')}</span>`
        : '<span class="league-no-form">—</span>';
      const team = `<span class="standing-club"><span class="position">${esc(position)}</span>${formatClub(row, props)}</span>`;
      if (mode === 'short') return `<tr><td>${esc(position)}</td><td>${formatClub(row, props)}</td><td>${esc(row.played ?? '–')}</td><td>${esc(row.goalDifference ?? '–')}</td><td><strong>${esc(row.points ?? '–')}</strong></td></tr>`;
      if (mode === 'form') return `<tr><td>${esc(position)}</td><td>${formatClub(row, props)}</td><td>${form}</td><td><strong>${esc(row.points ?? '–')}</strong></td></tr>`;
      return `<tr><td>${esc(position)}</td><td>${formatClub(row, props)}</td><td>${esc(row.played ?? '–')}</td><td>${esc(row.won ?? '–')}</td><td>${esc(row.drawn ?? '–')}</td><td>${esc(row.lost ?? '–')}</td><td>${esc(row.goalsFor ?? '–')}–${esc(row.goalsAgainst ?? '–')}</td><td>${esc(row.goalDifference ?? '–')}</td><td><strong>${esc(row.points ?? '–')}</strong></td></tr>`;
    }).join('');
    return `${model.standingsGroups.length > 1 ? `<h3 class="league-group-name">${esc(group.name)}</h3>` : ''}<div class="standings-wrap"><table class="standings league-standings"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function tableTab(model, props) {
    if (model.dataLoading && !model.standings.length) return `<div class="league-tab-content">${loadingCard(`Loading ${model.selectedYear} table…`)}</div>`;
    if (!model.standings.length) {
      const name = seasonFor(model).leagueName;
      return `<div class="league-tab-content">${unavailable('Table unavailable', `ESPN returned no standings table for ${name}. Cup competitions and some seasons do not have a league table.`)}</div>`;
    }
    const groups = model.standingsGroups.map(group => groupTable(group, model, props)).join('');
    const formNote = model.standingsMode === 'form'
      ? '<p class="league-data-note">Recent form is displayed only when supplied by the selected source; missing form is left blank.</p>'
      : '';
    const tableNote = model.dataSource === 'ESPN snapshot'
      ? `Cached ESPN standings${model.dataFetchedAt ? ` · updated ${formattedDate(model.dataFetchedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} MMT` : ''} · may be delayed.`
      : model.dataSource === 'OpenLigaDB (ODbL 1.0)'
        ? `Standings reproduced from OpenLigaDB under ODbL 1.0${model.dataFetchedAt ? ` · updated ${formattedDate(model.dataFetchedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} MMT` : ''}.`
        : 'Standings returned by ESPN for the selected season. Missing values are not calculated.';
    return `<div class="league-tab-content"><div class="league-table-tools">${controlButtons([['short', 'Short'], ['full', 'Full'], ['form', 'Form']], model.standingsMode, 'league-mode', props.id)}<span class="league-overall-chip">Overall</span></div><section class="league-data-card"><div class="league-card-heading"><div><h2>Table</h2><p>${esc(seasonFor(model).leagueName)}</p></div><span class="league-source-chip">${esc(model.dataSource || 'ESPN')}</span></div>${groups}<p class="league-data-note">${tableNote}</p>${formNote}</section></div>`;
  }

  function fixtureFilters(model, props, matches) {
    const dates = [...new Set(matches.map(match => match.dateKey))].sort();
    const teams = [...new Set(matches.flatMap(match => [match.home, match.away]))].sort((a, b) => a.localeCompare(b));
    const rounds = [...new Set(matches.map(match => match.round).filter(Boolean))];
    const dateOptions = `<option value="">Date</option>${dates.map(date => `<option value="${esc(date)}" ${model.fixtureDate === date ? 'selected' : ''}>${esc(dateLabel(date))}</option>`).join('')}`;
    const teamOptions = `<option value="">Team</option>${teams.map(team => `<option value="${esc(team)}" ${model.fixtureTeam === team ? 'selected' : ''}>${esc(team)}</option>`).join('')}`;
    const roundSelect = rounds.length
      ? `<label class="league-fixture-select"><span class="sr-only">Round</span><select data-league-round data-league-id="${esc(props.id)}"><option value="">Round</option>${rounds.map(round => `<option value="${esc(round)}" ${model.fixtureRound === round ? 'selected' : ''}>${esc(round)}</option>`).join('')}</select></label>`
      : '';
    return `<div class="league-fixture-filters"><label class="league-fixture-select"><span class="sr-only">Date</span><select data-league-date data-league-id="${esc(props.id)}">${dateOptions}</select></label>${roundSelect}<label class="league-fixture-select"><span class="sr-only">Team</span><select data-league-team data-league-id="${esc(props.id)}">${teamOptions}</select></label></div>`;
  }

  function fixtureCard(match, props) {
    const live = match.state === 'in' || /IN_PROGRESS|FIRST_HALF|SECOND_HALF|EXTRA_TIME/i.test(match.status);
    const center = match.score
      ? `<strong>${esc(match.score.home)}–${esc(match.score.away)}</strong><small>${live ? 'LIVE' : 'FT'}</small>`
      : `<strong>${esc(timeLabel(match.kickoffUtc))}</strong><small>MMT</small>`;
    return `<article class="league-fixture-card"><div class="league-fixture-pair"><div class="league-fixture-side home">${teamButton(match.home, props.id, match.homeLogo, match.homeAbbr, props)} </div><div class="league-fixture-kickoff">${center}</div><div class="league-fixture-side away">${teamButton(match.away, props.id, match.awayLogo, match.awayAbbr, props)} </div></div></article>`;
  }

  function fixturesTab(model, props) {
    if (model.fixturesLoading && !model.matches.length) return `<div class="league-tab-content">${loadingCard('Loading ESPN fixtures…')}</div>`;
    if (model.fixturesError) return `<div class="league-tab-content">${unavailable('Fixtures unavailable', 'ESPN could not return live or cached fixtures for this competition.')}</div>`;
    if (model.calendarSeasonYear && Number(model.calendarSeasonYear) !== Number(model.selectedYear)) {
      return `<div class="league-tab-content">${unavailable('Upcoming fixtures unavailable for this season', `The current ESPN calendar is for ${model.calendarSeasonYear}; future fixtures are not shown as if they belonged to ${model.selectedYear}.`)}</div>`;
    }
    const upcoming = model.matches.filter(match => !match.finished);
    if (!upcoming.length) {
      return `<div class="league-tab-content">${unavailable('No upcoming fixtures returned', `ESPN lists no fixtures for ${seasonFor(model).leagueName} in the next seven days.`)}</div>`;
    }
    const filtered = upcoming.filter(match => (!model.fixtureDate || match.dateKey === model.fixtureDate) && (!model.fixtureRound || match.round === model.fixtureRound) && (!model.fixtureTeam || match.home === model.fixtureTeam || match.away === model.fixtureTeam));
    const groups = [...new Set(filtered.map(match => match.dateKey))].sort().map(date => `<section class="league-fixture-day"><h2>${esc(dateLabel(date))}</h2>${filtered.filter(match => match.dateKey === date).map(match => fixtureCard(match, props)).join('')}</section>`).join('');
    const cached = String(model.fixturesSource || '').includes('snapshot');
    const sourceNote = cached
      ? `ESPN snapshot${model.fixturesFetchedAt ? ` · updated ${formattedDate(model.fixturesFetchedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} MMT` : ''} · may be delayed.`
      : 'Upcoming schedule returned by ESPN.';
    return `<div class="league-tab-content">${fixtureFilters(model, props, upcoming)}<section class="league-fixture-list">${groups || '<div class="league-inline-empty">No fixtures in this filter.</div>'}</section><p class="league-data-note">${sourceNote} Kick-off times are in Myanmar Time (MMT).</p></div>`;
  }

  function newsTab(model) {
    if (model.newsLoading && !model.news.length) return `<div class="league-tab-content">${loadingCard('Loading ESPN news…')}</div>`;
    if (model.newsError) return `<div class="league-tab-content">${unavailable('News unavailable', 'ESPN could not return articles for this competition and no same-origin snapshot is available.')}</div>`;
    if (!model.news.length) return `<div class="league-tab-content">${unavailable('No news returned', 'ESPN has not supplied news stories for this competition.')}</div>`;
    const rows = model.news.map(article => {
      const headline = String(article.headline || article.title || '');
      const description = String(article.description || article.summary || '');
      const published = article.published || article.lastModified || '';
      const articleUrl = safeStoryURL(article.links?.web?.href || article.links?.mobile?.href || article.href || '');
      const date = published ? formattedDate(published, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const content = `<div class="league-news-meta"><span>ESPN</span>${date ? `<time>${esc(date)}</time>` : ''}</div><strong>${esc(headline)}</strong>${description ? `<p>${esc(description)}</p>` : ''}${articleUrl ? '<small class="league-news-open">Read article ↗</small>' : ''}`;
      return articleUrl ? `<a class="league-news-card" href="${esc(articleUrl)}" target="_blank" rel="noopener noreferrer">${content}</a>` : `<article class="league-news-card">${content}</article>`;
    }).join('');
    const cached = model.newsSource === 'ESPN snapshot';
    const note = cached ? `Cached ESPN news${model.newsFetchedAt ? ` · updated ${formattedDate(model.newsFetchedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} MMT` : ''} · may be delayed.` : 'Current ESPN headlines for this competition; they are not historical news for an older selected season.';
    return `<div class="league-tab-content"><section class="league-news-list">${rows}</section><p class="league-data-note">${note}</p></div>`;
  }

  function playerStatsTab(model) {
    if (model.statsLoading && model.statsLoadedFor !== Number(model.selectedYear)) return `<div class="league-tab-content">${loadingCard('Loading ESPN player statistics…')}</div>`;
    const data = model.statsLoadedFor === Number(model.selectedYear) ? model.stats : null;
    const returnedYear = Number(data?.season?.year);
    if (!data || returnedYear !== Number(model.selectedYear)) {
      const detail = data?.season?.displayName || (returnedYear ? String(returnedYear) : `${model.selectedYear}`);
      return `<div class="league-tab-content">${unavailable('Player statistics unavailable', `ESPN and the connected OpenLigaDB snapshot returned no usable player-goal records for the selected ${detail} season.`)}</div>`;
    }
    const groups = (Array.isArray(data.stats) ? data.stats : []).filter(group => Array.isArray(group.leaders) && group.leaders.length);
    if (!groups.length) return `<div class="league-tab-content">${unavailable('Player statistics unavailable', `ESPN returned no player leader categories for ${data.season.displayName || model.selectedYear}.`)}</div>`;
    const html = groups.map(group => {
      const all = group.leaders;
      const leaders = model.showAllPlayers ? all : all.slice(0, 20);
      const rows = leaders.map((leader, index) => {
        const athlete = leader.athlete || {};
        const team = leader.team?.displayName || leader.team?.name || athlete.team?.displayName || '';
        const value = leader.value ?? leader.displayValue ?? leader.shortDisplayValue ?? '–';
        return `<div class="league-player-stat-row"><span class="league-player-rank">${index + 1}</span><div class="league-player-detail"><strong>${esc(athlete.displayName || athlete.fullName || 'Player name unavailable')}</strong>${team ? `<small>${esc(team)}</small>` : ''}${leader.displayValue ? `<small>${esc(leader.displayValue)}</small>` : ''}</div><strong class="league-player-value">${esc(value)}</strong></div>`;
      }).join('');
      return `<section class="league-data-card"><div class="league-card-heading"><div><h2>${esc(group.displayName || group.name || 'Player stats')}</h2><p>${esc(data.season.displayName || `${model.selectedYear} season`)}</p></div><span class="league-source-chip">${esc(model.statsSource || 'ESPN')}</span></div><div class="league-player-list">${rows}</div>${all.length > 20 ? `<button class="league-load-more" data-league-action="players-more" data-league-id="${esc(model.id)}">${model.showAllPlayers ? 'Show top 20' : `Show all ${all.length}`}</button>` : ''}</section>`;
    }).join('');
    const sourceCoverage = data.sourceCoverage || {};
    const coverage = model.statsSource === 'OpenLigaDB (ODbL 1.0)'
      ? `OpenLigaDB named scorer records only: ${Number(sourceCoverage.namedGoalEventsCounted) || 0} of ${Number(sourceCoverage.goalEventsInSourceResponse) || 0} source goal records counted; missing names are not inferred. Data licensed under ODbL 1.0.`
      : 'Only player categories returned by ESPN for the selected season are shown.';
    return `<div class="league-tab-content">${html}<p class="league-data-note">${coverage}</p></div>`;
  }

  function teamStatsTab(model, props) {
    if (model.dataLoading && !model.standings.length) return `<div class="league-tab-content">${loadingCard('Loading ESPN team statistics…')}</div>`;
    if (!model.standings.length) return `<div class="league-tab-content">${unavailable('Team statistics unavailable', `ESPN returned no team table statistics for ${seasonFor(model).leagueName}.`)}</div>`;
    const groups = model.standingsGroups.map(group => {
      const body = group.rows.map(row => `<tr><td>${formatClub(row, props)}</td><td>${esc(row.played ?? '–')}</td><td>${esc(row.won ?? '–')}</td><td>${esc(row.drawn ?? '–')}</td><td>${esc(row.lost ?? '–')}</td><td>${esc(row.goalsFor ?? '–')}</td><td>${esc(row.goalsAgainst ?? '–')}</td><td>${esc(row.goalDifference ?? '–')}</td><td><strong>${esc(row.points ?? '–')}</strong></td></tr>`).join('');
      return `${model.standingsGroups.length > 1 ? `<h3 class="league-group-name">${esc(group.name)}</h3>` : ''}<div class="standings-wrap"><table class="standings league-team-stats"><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>${body}</tbody></table></div>`;
    }).join('');
    const sourceNote = model.dataSource === 'ESPN snapshot'
      ? `Cached ESPN team standings${model.dataFetchedAt ? ` · updated ${formattedDate(model.dataFetchedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} MMT` : ''} · may be delayed.`
      : model.dataSource === 'OpenLigaDB (ODbL 1.0)'
        ? 'Team totals reproduced from OpenLigaDB under ODbL 1.0; no missing values or rates are inferred.'
        : 'Team totals returned by ESPN standings; no rates or totals are calculated from stale fixtures.';
    return `<div class="league-tab-content"><section class="league-data-card"><div class="league-card-heading"><div><h2>Team stats</h2><p>${esc(seasonFor(model).leagueName)}</p></div><span class="league-source-chip">${esc(model.dataSource || 'ESPN')}</span></div>${groups}<p class="league-data-note">${sourceNote}</p></section></div>`;
  }

  function transfersTab(model) {
    if (model.transfersLoading && model.transactionsLoadedFor !== Number(model.selectedYear)) return `<div class="league-tab-content">${loadingCard('Loading ESPN transfers…')}</div>`;
    if (model.transactionsError) return `<div class="league-tab-content">${unavailable('Transfers unavailable', `ESPN could not return transfer records for ${seasonFor(model).leagueName}.`)}</div>`;
    if (!model.transactions.length) return `<div class="league-tab-content">${unavailable('No transfer records returned', `ESPN’s transactions feed returned no records for ${seasonFor(model).leagueName}. This empty feed is not treated as proof that no transfers occurred.`, 'ESPN transactions feed · no records returned') }<p class="league-data-note">Source: ESPN · ${esc(seasonFor(model).leagueName)}.</p></div>`;
    const rows = model.transactions.map(item => {
      const athlete = item.athlete || {};
      const name = athlete.displayName || athlete.fullName || athlete.name || 'Player name unavailable';
      const from = transactionText(item.from);
      const to = transactionText(item.to);
      const type = transactionText(item.type);
      const amount = item.displayAmount || '';
      const when = item.date ? formattedDate(item.date, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date not supplied';
      const link = safeStoryURL((Array.isArray(athlete.links) ? athlete.links : []).find(value => (value.rel || []).includes('playercard') && value.href)?.href || '');
      const route = from || to ? `${from || '—'} → ${to || '—'}` : '';
      const body = `<div class="league-transfer-meta"><time>${esc(when)}</time><span>ESPN</span></div><strong>${esc(name)}</strong>${route ? `<p>${esc(route)}</p>` : ''}<small>${[type, amount].filter(Boolean).map(esc).join(' · ') || 'Transfer details not supplied'}</small>`;
      return link ? `<a class="league-transfer-row" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${body}</a>` : `<article class="league-transfer-row">${body}</article>`;
    }).join('');
    return `<div class="league-tab-content"><section class="league-transfer-list">${rows}</section><p class="league-data-note">Transactions returned by ESPN for ${esc(seasonFor(model).leagueName)}. A successful empty response is shown separately from an unavailable feed.</p></div>`;
  }

  function unavailableTab(category, description) {
    return `<div class="league-tab-content">${unavailable(`${category} unavailable`, description)}</div>`;
  }

  function seasonsTab(model, props) {
    if (model.seasonsLoading && !model.seasons.length) return `<div class="league-tab-content">${loadingCard('Loading ESPN seasons…')}</div>`;
    if (!model.seasons.length) return `<div class="league-tab-content">${unavailable('Season list unavailable', 'ESPN did not return a season list for this competition.')}</div>`;
    const selected = seasonFor(model);
    const status = model.dataLoadedFor === Number(model.selectedYear)
      ? (model.standings.length ? 'Table available' : 'No table returned for this season')
      : 'Select to view this season';
    const rows = model.seasons.map(season => `<button type="button" class="league-season-row ${Number(season.year) === Number(model.selectedYear) ? 'active' : ''}" data-league-season-option="${esc(season.year)}" data-league-id="${esc(props.id)}" aria-pressed="${Number(season.year) === Number(model.selectedYear)}"><span class="league-season-year">${esc(season.year)}</span><span class="league-season-info"><strong>${esc(season.leagueName)}</strong><small>ESPN</small></span><span class="league-season-arrow">${Number(season.year) === Number(model.selectedYear) ? 'Selected' : 'Open'}</span></button>`).join('');
    return `<div class="league-tab-content"><section class="league-data-card"><div class="league-card-heading"><div><h2>Seasons</h2><p>${model.seasons.length} seasons returned by ESPN</p></div><span class="league-source-chip">ESPN</span></div><div class="league-season-list">${rows}</div><div class="league-season-selected"><strong>${esc(selected.leagueName)}</strong><span>${esc(status)}</span></div></section></div>`;
  }

  function selectedTab(model, props) {
    switch (model.tab) {
      case 'Table': return tableTab(model, props);
      case 'Fixtures': return fixturesTab(model, props);
      case 'News': return newsTab(model);
      case 'Player Stats': return playerStatsTab(model);
      case 'Team Stats': return teamStatsTab(model, props);
      case 'Transfers': return transfersTab(model);
      case 'TOTW': return unavailableTab('Team of the Week', 'No verified, reusable team-of-the-week source is connected for this competition. No lineup is inferred from match results.');
      case 'Seasons': return seasonsTab(model, props);
      default: return tableTab(model, props);
    }
  }

  function alertLabel(id) {
    if (typeof Notification === 'undefined') return { text: 'Alerts unavailable', disabled: true, active: false };
    if (Notification.permission === 'denied') return { text: 'Alerts blocked', disabled: true, active: false };
    const active = alertIds.has(String(id));
    return { text: active ? 'Alerts on' : 'Alerts', disabled: false, active };
  }

  function render(props) {
    const id = String(props?.id || '');
    const config = COMPETITIONS[id] || { name: props?.name || 'Competition', country: 'Football', mark: 'FC' };
    const model = modelFor(id, props?.comp);
    model.openLigaCompetition = openLigaFor(id, props?.openLigaSnapshot);
    model.calendar = Array.isArray(props?.calendar) ? props.calendar : model.calendar;
    model.calendarSeasonYear = Number(props?.calendarSeasonYear || model.calendarSeasonYear) || null;
    if (!model.seasonsLoaded && !model.seasonsLoading) void loadSeasons(model);
    const hasOpenLigaTable = Number(model.openLigaCompetition?.season) === Number(model.selectedYear) && Array.isArray(model.openLigaCompetition?.standings) && model.openLigaCompetition.standings.length > 0;
    const hasOpenLigaPlayers = Number(model.openLigaCompetition?.season) === Number(model.selectedYear) && Array.isArray(model.openLigaCompetition?.playerStats?.players) && model.openLigaCompetition.playerStats.players.length > 0;
    if ((model.tab === 'Table' || model.tab === 'Team Stats' || model.tab === 'Seasons') && (model.dataLoadedFor !== Number(model.selectedYear) || (model.dataError && hasOpenLigaTable)) && !model.dataLoading) void loadSeasonData(model, model.dataError && hasOpenLigaTable);
    if (model.tab === 'Fixtures' && model.fixturesLoadedFor !== Number(model.selectedYear) && !model.fixturesLoading) void loadFixtures(model, props);
    if (model.tab === 'Table' && model.standingsMode === 'form' && model.fixturesLoadedFor !== Number(model.selectedYear) && !model.fixturesLoading) void loadFixtures(model, props);
    if (model.tab === 'Player Stats' && (model.statsLoadedFor !== Number(model.selectedYear) || (model.statsError && hasOpenLigaPlayers)) && !model.statsLoading) void loadPlayerStats(model, model.statsError && hasOpenLigaPlayers);
    if (model.tab === 'News' && !model.newsLoaded && !model.newsLoading) void loadNews(model);
    if (model.tab === 'Transfers' && model.transactionsLoadedFor !== Number(model.selectedYear) && !model.transfersLoading) void loadTransfers(model);

    const badge = safeLogo(props?.logo || '');
    const alert = alertLabel(id);
    const options = model.seasons.length
      ? model.seasons.map(season => `<option value="${esc(season.year)}" ${Number(season.year) === Number(model.selectedYear) ? 'selected' : ''}>${esc(season.leagueName)}</option>`).join('')
      : `<option value="${esc(model.selectedYear)}">${esc(model.selectedYear)}${model.seasonsLoading ? ' · loading' : ''}</option>`;
    const title = props?.name || config.name;
    const tabButtons = TABS.map(([key, label]) => `<button type="button" role="tab" aria-selected="${model.tab === key}" class="league-tab ${model.tab === key ? 'active' : ''}" data-league-tab="${esc(key)}" data-league-id="${esc(id)}">${esc(label)}</button>`).join('');
    const alertButton = `<button type="button" class="league-alert-button ${alert.active ? 'active' : ''}" data-league-action="notifications" data-league-id="${esc(id)}" ${alert.disabled ? 'disabled' : ''} aria-label="${esc(alert.active ? 'Disable score alerts' : 'Enable score alerts')}" aria-pressed="${alert.active}"><span aria-hidden="true">♧</span></button>`;
    return `<section class="league-experience" aria-label="${esc(title)} league details">
      <header class="league-hero"><div class="league-back-row"><button type="button" data-action="back-leagues" aria-label="Back to leagues">‹</button><label class="league-season-picker"><span class="sr-only">Season</span><select data-league-season data-league-id="${esc(id)}" aria-label="Choose ${esc(title)} season">${options}</select></label>${alertButton}<button type="button" class="follow ${props.following ? 'following' : ''}" data-action="follow-league" data-id="${esc(id)}">${props.following ? 'Following' : 'Follow +'}</button></div>
        <div class="league-identity"><span class="league-emblem">${badge ? `<img src="${esc(badge)}" alt="${esc(title)} logo" loading="lazy" decoding="async" onerror="this.remove()">` : `<b>${esc(config.mark)}</b>`}</span><div class="league-identity-copy"><h1>${esc(title)}</h1><p>${esc(config.country)}${model.selectedYear ? ` · ${esc(seasonFor(model).leagueName)}` : ''}</p></div></div>${model.notice ? `<p class="league-alert-note">${esc(model.notice)}</p>` : ''}${props.feedError ? `<p class="league-feed-warning">Score feed delayed for this competition; standings and fixtures use only available ESPN data.</p>` : ''}
      </header>
      <nav class="league-section-nav" role="tablist" aria-label="${esc(title)} sections">${tabButtons}</nav>
      ${selectedTab(model, { ...props, id, name: title })}
      <footer class="league-source-footer">Season list, fixtures, news and transfers: <a href="https://www.espn.com/soccer/" target="_blank" rel="noopener noreferrer">ESPN</a>. Tables and named goal records may use <a href="https://www.openligadb.de/lizenz" target="_blank" rel="noopener noreferrer">OpenLigaDB (ODbL 1.0)</a>. Only source-returned data is shown.</footer>
    </section>`;
  }

  function focusFixturesForTeam(id, team) {
    const code = String(id || '');
    const model = modelFor(code, COMPETITIONS[code]);
    model.tab = 'Fixtures';
    model.fixtureDate = '';
    model.fixtureRound = '';
    model.fixtureTeam = String(team || '');
    notify();
  }

  function selectSeason(model, year) {
    const next = Number(year);
    if (!next || next === Number(model.selectedYear) || !model.seasons.some(item => Number(item.year) === next)) return;
    model.selectedYear = next;
    model.userPickedSeason = true;
    model.dataLoadedFor = null;
    model.updatedAt = 0;
    model.standingsGroups = [];
    model.standings = [];
    model.fixturesLoadedFor = null;
    model.fixturesUpdatedAt = 0;
    model.matches = [];
    model.teamForms = {};
    model.statsLoadedFor = null;
    model.stats = null;
    model.statsSource = 'ESPN';
    model.transactionsLoadedFor = null;
    model.transactions = [];
    model.transactionsError = false;
    model.fixtureDate = '';
    model.fixtureRound = '';
    model.fixtureTeam = '';
    notify();
  }

  async function enableAlerts(model) {
    if (typeof Notification === 'undefined') {
      model.notice = 'This browser does not support notifications.';
      notify();
      return;
    }
    if (Notification.permission === 'denied') {
      model.notice = 'Notifications are blocked in this browser for this site.';
      notify();
      return;
    }
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') {
        model.notice = 'Notification permission was not granted.';
        notify();
        return;
      }
      const id = String(model.id);
      if (alertIds.has(id)) {
        alertIds.delete(id);
        model.notice = 'Score alerts disabled for this competition.';
      } else {
        alertIds.add(id);
        model.notice = 'Score alerts enabled while Matchday is open.';
      }
      try { localStorage.setItem(ALERT_KEY, JSON.stringify([...alertIds])); } catch (_) {}
    } catch (error) {
      model.notice = 'Could not enable browser notifications.';
      console.warn('League notifications unavailable:', error);
    }
    notify();
  }

  function eventScore(event) {
    if (!event?.score) return '';
    return `${event.score.home}-${event.score.away}`;
  }

  function onScoresUpdated(previousEvents, nextEvents) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !alertIds.size) return;
    const previous = new Map((Array.isArray(previousEvents) ? previousEvents : []).map(event => [String(event.id), event]));
    for (const event of Array.isArray(nextEvents) ? nextEvents : []) {
      if (!alertIds.has(String(event.competitionId))) continue;
      const old = previous.get(String(event.id));
      if (!old) continue;
      const oldScore = eventScore(old);
      const newScore = eventScore(event);
      if (!newScore || oldScore === newScore) continue;
      const title = `${event.home} ${event.score.home}–${event.score.away} ${event.away}`;
      const body = `${event.competition} · ${event.statusText || 'Score updated'} · ESPN`;
      window.setTimeout(() => {
        try { new Notification(title, { body, tag: `matchday-${event.id}` }); } catch (_) {}
      }, NOTIFY_DELAY);
    }
  }

  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-league-tab]');
    if (tab) {
      const model = models.get(String(tab.dataset.leagueId));
      if (!model) return;
      model.tab = tab.dataset.leagueTab;
      notify();
      return;
    }
    const mode = event.target.closest('[data-league-mode]');
    if (mode) {
      const model = models.get(String(mode.dataset.leagueId));
      if (model) { model.standingsMode = mode.dataset.leagueMode; notify(); }
      return;
    }
    const seasonOption = event.target.closest('[data-league-season-option]');
    if (seasonOption) {
      const model = models.get(String(seasonOption.dataset.leagueId));
      if (model) selectSeason(model, seasonOption.dataset.leagueSeasonOption);
      return;
    }
    const action = event.target.closest('[data-league-action]');
    if (!action) return;
    const model = models.get(String(action.dataset.leagueId));
    if (!model) return;
    const name = action.dataset.leagueAction;
    if (name === 'notifications') void enableAlerts(model);
    else if (name === 'players-more') { model.showAllPlayers = !model.showAllPlayers; notify(); }
  });

  document.addEventListener('change', event => {
    const season = event.target.closest('[data-league-season]');
    if (season) {
      const model = models.get(String(season.dataset.leagueId));
      if (model) selectSeason(model, season.value);
      return;
    }
    const date = event.target.closest('[data-league-date]');
    if (date) {
      const model = models.get(String(date.dataset.leagueId));
      if (model) { model.fixtureDate = date.value; notify(); }
      return;
    }
    const round = event.target.closest('[data-league-round]');
    if (round) {
      const model = models.get(String(round.dataset.leagueId));
      if (model) { model.fixtureRound = round.value; notify(); }
      return;
    }
    const team = event.target.closest('[data-league-team]');
    if (team) {
      const model = models.get(String(team.dataset.leagueId));
      if (model) { model.fixtureTeam = team.value; notify(); }
    }
  });

  window.MatchdayLeague = {
    render,
    focusFixturesForTeam,
    onScoresUpdated,
    normalizeStandings,
    normalizeESPNFixture,
    scheduleDateCodes,
    loadTeamOfTheWeek,
    teamOfTheWeekCard,
    fillTeamOfTheWeek,
    competitions: Object.keys(COMPETITIONS),
    tabs: TABS.map(([key]) => key)
  };
})();
