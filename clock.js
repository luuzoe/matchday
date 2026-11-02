'use strict';
(function (root) {
  function baseMinute(match) {
    for (const candidate of [match.displayClock, match.statusText]) {
      if (typeof candidate !== 'string' || !candidate.trim() || /^(HT|FT|HALF[ -]?TIME)$/i.test(candidate.trim())) continue;
      const found = candidate.match(/(\d{1,3})(?:\s*:\s*(\d{1,2}))?(?:\s*\+\s*(\d{1,2}))?/);
      if (!found) continue;
      const minute = Number(found[1]) + Number(found[3] || 0);
      if (Number.isFinite(minute) && minute >= 0 && minute <= 150) return minute;
    }
    return null;
  }

  function formatClock(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function label(match, nowMs = Date.now()) {
    const state = match.clockState;
    const minute = baseMinute(match);
    if (state === 'finished') {
      return minute === null || minute === 0 ? 'FT · ESPN' : `FT · ~${formatClock(minute * 60)} EST.`;
    }
    if (state === 'halftime') {
      const pausedMinute = minute && minute > 0 ? minute : (Number(match.period) >= 3 ? 105 : 45);
      return `HT · ~${formatClock(pausedMinute * 60)} EST.`;
    }
    if (state !== 'live') return null;
    if (minute === null) return 'LIVE · clock unavailable';

    const anchor = Number(match.fetchedAt);
    const elapsed = Number.isFinite(anchor)
      ? Math.min(59, Math.max(0, Math.floor((nowMs - anchor) / 1000)))
      : 0;
    return `~${formatClock(minute * 60 + elapsed)} EST.`;
  }

  const api = { baseMinute, formatClock, label };
  root.MatchdayClock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
