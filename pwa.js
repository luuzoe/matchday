(function () {
  'use strict';

  const installButton = document.getElementById('install-cta');
  const banner = document.getElementById('pwa-install-banner');
  const bannerAction = document.getElementById('pwa-install-action');
  const bannerDismiss = document.getElementById('pwa-install-dismiss');
  const title = document.getElementById('pwa-install-title');
  const subtitle = document.getElementById('pwa-install-subtitle');
  const help = document.getElementById('pwa-install-help');
  const helpClose = document.getElementById('pwa-help-close');
  const helpCopy = document.getElementById('pwa-help-copy');
  const helpSteps = document.getElementById('pwa-help-steps');
  const updateBanner = document.getElementById('pwa-update-banner');
  const updateAction = document.getElementById('pwa-update-action');
  const updateDismiss = document.getElementById('pwa-update-dismiss');
  let deferredPrompt = null;
  let installMode = null;
  let swRegistration = null;
  let reloadAfterUpdate = false;
  let siteUpdateVersion = null;
  const siteVersionKey = 'matchday-site-version';
  const siteVersionCheckKey = 'matchday-site-version-checked';
  const siteVersionURL = 'https://api.github.com/repos/luuzoe/matchday/commits?per_page=1';
  const updateCheckIntervalMs = 5 * 60 * 1000;
  const bootSplash = document.getElementById('boot-splash');
  const bootRun = document.getElementById('boot-run');
  const bootSplashMinDurationMs = 5000;
  const bootSplashStartedAt = Date.now();
  let bootSplashTimeout = null;

  function dismissBootSplash() {
    if (!bootSplash || bootSplash.hidden) return;
    const remaining = bootSplashMinDurationMs - (Date.now() - bootSplashStartedAt);
    if (remaining > 0) {
      if (bootSplashTimeout !== null) window.clearTimeout(bootSplashTimeout);
      bootSplashTimeout = window.setTimeout(dismissBootSplash, remaining);
      return;
    }
    if (bootSplashTimeout !== null) window.clearTimeout(bootSplashTimeout);
    bootSplashTimeout = null;
    bootSplash.classList.add('is-hiding');
    window.setTimeout(() => { bootSplash.hidden = true; }, 300);
  }

  if (bootSplash && !bootSplash.hidden) {
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (bootRun && !prefersReducedMotion) {
      const finishBootOnAnimationEnd = event => {
        if (event.target !== bootRun || event.animationName !== 'boot-run-enter') return;
        bootRun.removeEventListener('animationend', finishBootOnAnimationEnd);
        dismissBootSplash();
      };
      bootRun.addEventListener('animationend', finishBootOnAnimationEnd);
    }
    bootSplashTimeout = window.setTimeout(dismissBootSplash, bootSplashMinDurationMs);
  }

  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /safari/i.test(ua) && !/(crios|fxios|edgios|opios|chrome|chromium|android)/i.test(ua);
  const standaloneQuery = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  const fullscreenQuery = window.matchMedia ? window.matchMedia('(display-mode: fullscreen)') : null;

  function isInstalled() {
    return Boolean((standaloneQuery && standaloneQuery.matches) || (fullscreenQuery && fullscreenQuery.matches) || navigator.standalone === true);
  }

  function sessionFlag(key) {
    try { return sessionStorage.getItem(key) === '1'; } catch (_) { return false; }
  }

  function setSessionFlag(key) {
    try { sessionStorage.setItem(key, '1'); } catch (_) { /* Storage may be unavailable in private mode. */ }
  }

  function hideInstallUI() {
    if (installButton) installButton.hidden = true;
    if (banner) banner.hidden = true;
    if (help) help.hidden = true;
  }

  function showInstallUI(mode) {
    if (!installButton || !banner || isInstalled() || sessionFlag('matchday-pwa-prompt-dismissed')) {
      hideInstallUI();
      return;
    }

    installMode = mode;
    const isIOSGuide = mode === 'ios';
    if (title) title.textContent = 'Install Matchday';
    if (subtitle) {
      subtitle.textContent = isIOSGuide
        ? (isSafari ? 'Add Matchday to your Home Screen for one-tap access.' : 'Open this page in Safari to add Matchday to your Home Screen.')
        : 'Keep football scores and news one tap away.';
    }
    if (bannerAction) bannerAction.textContent = isIOSGuide ? 'How to install' : 'Install';
    installButton.hidden = false;
    banner.hidden = sessionFlag('matchday-pwa-banner-dismissed');
  }

  function openIOSGuide() {
    if (!help) return;
    if (helpCopy) {
      helpCopy.textContent = isSafari
        ? 'In Safari, tap Share, then choose Add to Home Screen.'
        : 'For iPhone installation, open this Matchday page in Safari, then use its Share menu.';
    }
    if (helpSteps) {
      helpSteps.innerHTML = isSafari
        ? '<li>Tap the <strong>Share</strong> button.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong> to finish.</li>'
        : '<li>Open this page in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong> to finish.</li>';
    }
    help.hidden = false;
    if (helpClose) helpClose.focus();
  }

  function closeIOSGuide() {
    if (help) help.hidden = true;
    if (installButton) installButton.focus();
  }

  function dismissBanner() {
    if (banner) banner.hidden = true;
    setSessionFlag('matchday-pwa-banner-dismissed');
  }

  function dismissPromptForSession() {
    deferredPrompt = null;
    setSessionFlag('matchday-pwa-prompt-dismissed');
    hideInstallUI();
  }

  function showUpdateAvailable() {
    if (!updateBanner || !swRegistration || (!swRegistration.waiting && !siteUpdateVersion) || !navigator.serviceWorker.controller) return;
    if (sessionFlag('matchday-pwa-update-dismissed')) return;
    if (banner) banner.hidden = true;
    updateBanner.hidden = false;
  }

  function watchInstallingWorker(worker) {
    if (!worker) return;
    const checkReady = () => {
      if (worker.state === 'installed') showUpdateAvailable();
    };
    worker.addEventListener('statechange', checkReady);
    checkReady();
  }

  async function checkForUpdate() {
    if (!swRegistration || !navigator.onLine) return;
    try {
      await swRegistration.update();
    } catch (_) {
      // A network failure should not interrupt the current app session.
    }
    if (swRegistration.waiting) showUpdateAvailable();
    await checkSiteVersion();
  }

  async function checkSiteVersion() {
    if (!navigator.onLine) return;
    const now = Date.now();
    try {
      const lastCheck = Number(localStorage.getItem(siteVersionCheckKey) || 0);
      if (now - lastCheck < updateCheckIntervalMs) return;
      localStorage.setItem(siteVersionCheckKey, String(now));
    } catch (_) {
      // Continue checking when browser storage is unavailable.
    }
    try {
      const response = await fetch(siteVersionURL, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!response.ok) return;
      const commits = await response.json();
      const latestVersion = Array.isArray(commits) && commits[0] && commits[0].sha;
      if (!latestVersion) return;
      const installedVersion = localStorage.getItem(siteVersionKey);
      if (!installedVersion) {
        localStorage.setItem(siteVersionKey, latestVersion);
      } else if (installedVersion !== latestVersion) {
        siteUpdateVersion = latestVersion;
        showUpdateAvailable();
      }
    } catch (_) {
      // GitHub may be offline or rate-limited; the app remains usable as-is.
    }
  }

  function applyUpdate() {
    const waitingWorker = swRegistration && swRegistration.waiting;
    if (!waitingWorker) {
      const activeWorker = navigator.serviceWorker.controller;
      if (!activeWorker || typeof MessageChannel === 'undefined') {
        window.location.reload();
        return;
      }
      if (updateAction) {
        updateAction.disabled = true;
        updateAction.textContent = 'Updating…';
      }
      const channel = new MessageChannel();
      const refreshTimeout = window.setTimeout(() => {
        channel.port1.close();
        if (updateAction) {
          updateAction.disabled = false;
          updateAction.textContent = 'Try again';
        }
      }, 20000);
      channel.port1.onmessage = event => {
        if (!event.data) return;
        window.clearTimeout(refreshTimeout);
        if (event.data.type === 'SHELL_REFRESH_FAILED') {
          channel.port1.close();
          if (updateAction) {
            updateAction.disabled = false;
            updateAction.textContent = 'Try again';
          }
          return;
        }
        if (event.data.type !== 'SHELL_REFRESHED') return;
        channel.port1.close();
        if (siteUpdateVersion) {
          try { localStorage.setItem(siteVersionKey, siteUpdateVersion); } catch (_) { /* Storage may be unavailable. */ }
        }
        window.location.reload();
      };
      activeWorker.postMessage({ type: 'REFRESH_SHELL' }, [channel.port2]);
      return;
    }
    reloadAfterUpdate = true;
    if (siteUpdateVersion) {
      try { localStorage.setItem(siteVersionKey, siteUpdateVersion); } catch (_) { /* Storage may be unavailable. */ }
    }
    if (updateAction) {
      updateAction.disabled = true;
      updateAction.textContent = 'Updating…';
    }
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }

  async function requestInstall() {
    if (isInstalled()) {
      hideInstallUI();
      return;
    }
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      try {
        await promptEvent.prompt();
        const result = await promptEvent.userChoice;
        if (result && result.outcome === 'accepted') {
          hideInstallUI();
        } else {
          dismissPromptForSession();
        }
      } catch (error) {
        console.warn('Matchday install prompt could not be opened:', error);
        dismissPromptForSession();
      }
      return;
    }
    if (installMode === 'ios') openIOSGuide();
  }

  if (installButton) installButton.addEventListener('click', requestInstall);
  if (bannerAction) bannerAction.addEventListener('click', requestInstall);
  if (bannerDismiss) bannerDismiss.addEventListener('click', dismissBanner);
  if (updateAction) updateAction.addEventListener('click', applyUpdate);
  if (updateDismiss) updateDismiss.addEventListener('click', () => {
    if (updateBanner) updateBanner.hidden = true;
    setSessionFlag('matchday-pwa-update-dismissed');
  });
  if (helpClose) helpClose.addEventListener('click', closeIOSGuide);
  if (help) help.addEventListener('click', event => { if (event.target === help) closeIOSGuide(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && help && !help.hidden) closeIOSGuide();
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallUI('native');
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallUI();
  });

  function syncInstalledState() {
    if (isInstalled()) hideInstallUI();
  }

  if (standaloneQuery) {
    if (standaloneQuery.addEventListener) standaloneQuery.addEventListener('change', syncInstalledState);
    else if (standaloneQuery.addListener) standaloneQuery.addListener(syncInstalledState);
  }
  if (fullscreenQuery) {
    if (fullscreenQuery.addEventListener) fullscreenQuery.addEventListener('change', syncInstalledState);
    else if (fullscreenQuery.addListener) fullscreenQuery.addListener(syncInstalledState);
  }

  if (isInstalled()) {
    hideInstallUI();
  } else if (isIOS) {
    showInstallUI('ios');
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadAfterUpdate) window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(registration => {
      swRegistration = registration;
      if (registration.waiting) showUpdateAvailable();
      if (registration.installing) watchInstallingWorker(registration.installing);
      registration.addEventListener('updatefound', () => watchInstallingWorker(registration.installing));
      checkForUpdate();
      window.setInterval(checkForUpdate, updateCheckIntervalMs);
      window.addEventListener('focus', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    }).catch(error => {
      console.warn('Matchday offline support could not be enabled:', error);
    });
  }
})();
