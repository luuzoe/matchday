'use strict';
(() => {
  const STORAGE_KEY = 'matchday_language_v1';
  const MY = {
    'Matches': 'ပွဲစဉ်များ',
    'News': 'သတင်း',
    'Leagues': 'လိဂ်များ',
    'Following': 'လိုက်ကြည့်ထားသည်',
    'More': 'နောက်ထပ်',
    'Football, grounded': 'ယုံကြည်ရသော ဘောလုံးအချက်အလက်',
    'Main navigation': 'အဓိက လမ်းညွှန်မီနူး',
    'Search teams and competitions': 'အသင်းနှင့် ပြိုင်ပွဲများ ရှာရန်',
    'Refresh published data': 'ဒေတာကို ပြန်လည်စစ်ဆေးရန်',
    'Install Matchday': 'Matchday ကို ထည့်သွင်းရန်',
    'Dismiss install message': 'ထည့်သွင်းရန် သတိပေးချက်ကို ပိတ်ရန်',
    'Matchday update available': 'Matchday အပ်ဒိတ် ရနိုင်ပါပြီ',
    'Dismiss update message': 'အပ်ဒိတ်သတိပေးချက်ကို ပိတ်ရန်',
    'Close install instructions': 'ထည့်သွင်းနည်းကို ပိတ်ရန်',
    'Add Matchday to your Home Screen': 'Matchday ကို ပင်မမျက်နှာပြင်တွင် ထည့်ရန်',
    'In Safari, tap Share, then choose Add to Home Screen.': 'Safari တွင် Share ကိုနှိပ်ပြီး Add to Home Screen ကိုရွေးပါ။',
    'Tap the Share button.': 'Share ခလုတ်ကို နှိပ်ပါ။',
    'Choose': 'ရွေးပါ',
    'Add': 'ထည့်ရန်',
    'to finish.': 'ပြီးဆုံးရန်။',
    'Once added, open Matchday from its new icon like an app.': 'ထည့်ပြီးပါက အက်ပ်တစ်ခုကဲ့သို့ Matchday အိုင်ကွန်မှ ဖွင့်ပါ။',
    'Ready for kickoff?': 'ပွဲစဖို့ အဆင်သင့်ဖြစ်ပြီလား။',
    'Getting your scores and stories ready.': 'ရလဒ်များနှင့် သတင်းများကို ပြင်ဆင်နေသည်။',
    'Footballer striking a ball': 'ဘောလုံးကန်နေသော ကစားသမား',
    'LIVE SCORES': 'တိုက်ရိုက်ရလဒ်များ',
    'All': 'အားလုံး',
    'Favorites': 'အကြိုက်ဆုံးများ',
    'Scored': 'ဂိုးရလဒ်ရှိ',
    'Finished': 'ပြီးဆုံး',
    'Upcoming': 'လာမည့်ပွဲများ',
    'Table': 'အမှတ်ဇယား',
    'Today': 'ယနေ့',
    'Yesterday': 'မနေ့က',
    'Tomorrow': 'မနက်ဖြန်',
    'Reload': 'ပြန်လည်တင်ရန်',
    '↻ Reload': '↻ ပြန်တင်ရန်',
    'Checking…': 'စစ်ဆေးနေသည်…',
    'LIVE': 'တိုက်ရိုက်',
    'HALF-TIME': 'ပထမပိုင်းပြီး',
    'HT': 'ပထမပိုင်း',
    'FT': 'ပြီးဆုံး',
    'Final': 'ပြီးဆုံး',
    'Scheduled': 'စီစဉ်ထားသည်',
    'Postponed': 'ရွှေ့ဆိုင်းထားသည်',
    'Cancelled': 'ဖျက်သိမ်းထားသည်',
    'Canceled': 'ဖျက်သိမ်းထားသည်',
    'not available': 'မရရှိနိုင်ပါ',
    'Standings unavailable': 'အမှတ်ဇယား မရရှိနိုင်ပါ',
    'No standings table is currently available for this competition. Tables are never inferred from match scores.': 'ဤပြိုင်ပွဲအတွက် အမှတ်ဇယားကို လောလောဆယ် မရရှိနိုင်ပါ။ ပွဲရလဒ်များမှ အမှတ်ဇယားကို ခန့်မှန်းမပြုလုပ်ပါ။',
    'Loading match scores…': 'ပွဲရလဒ်များကို ဖွင့်နေသည်…',
    'Loading matches': 'ပွဲစဉ်များကို ဖွင့်နေသည်',
    'Checking the selected date…': 'ရွေးထားသောရက်စွဲကို စစ်ဆေးနေသည်…',
    'No matches for this date': 'ဤရက်စွဲတွင် ပွဲမရှိပါ',
    'Only returned fixtures are shown. Try another day or competition.': 'ရရှိထားသော ပွဲစဉ်များကိုသာ ပြထားသည်။ အခြားရက်စွဲ သို့မဟုတ် ပြိုင်ပွဲကို ရွေးကြည့်ပါ။',
    'Favorites first': 'အကြိုက်ဆုံးများကို အရင်ပြရန်',
    'No fixture on this date': 'ဤရက်စွဲတွင် ပွဲမရှိပါ',
    'Choose another date from Matches to see this team’s returned fixtures.': 'ဤအသင်း၏ ပွဲစဉ်များကို ကြည့်ရန် ပွဲစဉ်များမှ အခြားရက်စွဲကို ရွေးပါ။',
    'League position': 'လိဂ်အဆင့်',
    'Follow team +': 'အသင်းကို လိုက်ကြည့်ရန် +',
    'Following ✓': 'လိုက်ကြည့်ထားသည် ✓',
    'Follow +': 'လိုက်ကြည့်ရန် +',
    'Unfollow': 'မလိုက်ကြည့်တော့ရန်',
    'Back to matches': 'ပွဲစဉ်များသို့ ပြန်သွားရန်',
    'Back from team': 'အသင်းစာမျက်နှာမှ ပြန်သွားရန်',
    'Your teams and competitions': 'သင်လိုက်ကြည့်ထားသော အသင်းများနှင့် ပြိုင်ပွဲများ',
    'Your teams': 'သင့်အသင်းများ',
    'Competitions': 'ပြိုင်ပွဲများ',
    'Teams': 'အသင်းများ',
    'Follow your first team': 'ပထမဆုံးအသင်းကို လိုက်ကြည့်ပါ',
    'Open a match, tap its team name or crest, then choose Follow team. Your teams stay saved in this browser.': 'ပွဲတစ်ပွဲကိုဖွင့်ပြီး အသင်းအမည် သို့မဟုတ် လိုဂိုကိုနှိပ်ကာ အသင်းကို လိုက်ကြည့်ရန်ကို ရွေးပါ။ သင့်အသင်းများကို ဤ browser တွင် သိမ်းထားမည်။',
    'Follow competitions from the Leagues tab.': 'လိဂ်များ tab မှ ပြိုင်ပွဲများကို လိုက်ကြည့်ပါ။',
    'Leagues and cups with ESPN score feeds': 'ESPN ရလဒ်ဒေတာရှိသော လိဂ်များနှင့် ဖလားပြိုင်ပွဲများ',
    'News feed is still loading.': 'သတင်းများကို ဖွင့်နေဆဲဖြစ်သည်။',
    'No verified transfer provider is connected.': 'အတည်ပြုထားသော အပြောင်းအရွှေ့သတင်းရင်းမြစ် မချိတ်ဆက်ရသေးပါ။',
    'League details unavailable': 'လိဂ်အသေးစိတ် မရရှိနိုင်ပါ',
    'The ESPN league screen is still loading.': 'ESPN လိဂ်စာမျက်နှာကို ဖွင့်နေဆဲဖြစ်သည်။',
    'View': 'ကြည့်ရန်',
    'Open': 'ဖွင့်ရန်',
    'Follow': 'လိုက်ကြည့်ရန်',
    'Team': 'အသင်း',
    'Competition': 'ပြိုင်ပွဲ',
    'League': 'လိဂ်',
    'Cup': 'ဖလားပြိုင်ပွဲ',
    'Player list': 'ကစားသမားစာရင်း',
    'Lineups & players': 'ပွဲထွက်စာရင်းနှင့် ကစားသမားများ',
    'Overview': 'အကျဉ်းချုပ်',
    'Events': 'ဖြစ်ရပ်များ',
    'Stats': 'စာရင်းအင်း',
    'Lineups': 'ပွဲထွက်စာရင်း',
    'Search teams or competitions': 'အသင်း သို့မဟုတ် ပြိုင်ပွဲ ရှာရန်',
    'Cancel': 'မလုပ်တော့ပါ',
    'No results for this date': 'ဤရက်စွဲအတွက် ရလဒ်မရှိပါ',
    'Try another team or competition.': 'အခြားအသင်း သို့မဟုတ် ပြိုင်ပွဲကို ရှာကြည့်ပါ။',
    'More': 'နောက်ထပ်',
    'Sources, limitations and local preferences': 'ဒေတာရင်းမြစ်၊ ကန့်သတ်ချက်များနှင့် ဆက်တင်များ',
    'On this device': 'ဤစက်တွင်',
    'Favorites and follows stay in this browser': 'အကြိုက်ဆုံးများနှင့် လိုက်ကြည့်မှုများကို ဤ browser တွင် သိမ်းထားသည်',
    'Your Matchday': 'သင့် Matchday',
    'Favorite matches': 'အကြိုက်ဆုံးပွဲများ',
    'Matches saved on this device': 'ဤစက်တွင် သိမ်းထားသော ပွဲများ',
    'Followed competitions': 'လိုက်ကြည့်ထားသော ပြိုင်ပွဲများ',
    'Saved locally': 'ဤစက်တွင် သိမ်းထားသည်',
    'App preferences': 'အက်ပ်ဆက်တင်များ',
    'Data and coverage': 'ဒေတာနှင့် လွှမ်းခြုံမှု',
    'Language': 'ဘာသာစကား',
    'Change app language': 'အက်ပ်ဘာသာစကားကို ရွေးပါ',
    'English': 'English',
    'Burmese': 'မြန်မာ',
    'New update available': 'အပ်ဒိတ်အသစ် ရပါပြီ',
    'A new Matchday version is ready. Update now to load the latest version.': 'Matchday ဗားရှင်းအသစ် အသင့်ဖြစ်ပါပြီ။ နောက်ဆုံးဗားရှင်းကို ရယူရန် ယခုအပ်ဒိတ်လုပ်ပါ။',
    'Update now': 'ယခုအပ်ဒိတ်လုပ်ရန်',
    'Install': 'ထည့်သွင်းရန်',
    'Keep football scores and news one tap away.': 'ဘောလုံးရလဒ်နှင့် သတင်းများကို တစ်ချက်နှိပ်ရုံဖြင့် ကြည့်ပါ။',
    'Add Matchday to your Home Screen': 'Matchday ကို ပင်မမျက်နှာပြင်တွင် ထည့်ရန်',
    'Could not refresh the latest stories just now; showing the most recently saved feed items.': 'နောက်ဆုံးသတင်းများကို ယခုအချိန်တွင် မရယူနိုင်ပါ။ နောက်ဆုံးသိမ်းထားသော သတင်းများကို ပြထားသည်။',
    'News could not be loaded': 'သတင်းများကို ဖွင့်၍မရပါ',
    'The saved football news feed data is temporarily unavailable. Try again shortly.': 'သိမ်းထားသော ဘောလုံးသတင်းဒေတာကို ယာယီမရနိုင်ပါ။ ခဏနေပြီး ပြန်စမ်းပါ။',
    'No recent stories are available': 'လတ်တလောသတင်း မရှိသေးပါ',
    'No verified football RSS stories are present in the published feed data yet.': 'ထုတ်ပြန်ထားသော feed တွင် အတည်ပြုထားသော ဘောလုံး RSS သတင်း မရှိသေးပါ။',
    'Loading football news…': 'ဘောလုံးသတင်းများကို ဖွင့်နေသည်…',
    'Checking the latest configured football RSS feeds.': 'နောက်ဆုံးသတ်မှတ်ထားသော ဘောလုံး RSS feeds များကို စစ်ဆေးနေသည်။',
    'Latest football news': 'နောက်ဆုံးရ ဘောလုံးသတင်းများ',
    'Publication time unavailable': 'ထုတ်ဝေချိန် မရရှိနိုင်ပါ',
    'Football news': 'ဘောလုံးသတင်း',
    'Only verified data is shown in Matchday': 'အတည်ပြုထားသော ဒေတာကိုသာ Matchday တွင် ပြထားသည်',
    'Not supplied by connected sources': 'ချိတ်ဆက်ထားသော ရင်းမြစ်များမှ မရရှိပါ',
    'Standings snapshot · OpenLigaDB': 'အမှတ်ဇယား snapshot · OpenLigaDB',
    'No fixture on this date': 'ဤရက်စွဲတွင် ပွဲမရှိပါ',
    'Match no longer present': 'ဤပွဲစဉ်ကို ရှာမတွေ့တော့ပါ',
    'It was not returned by the current score feed.': 'လက်ရှိရလဒ်ဒေတာတွင် ဤပွဲစဉ် မပါဝင်ပါ။'
  };
  const EN_BY_MY = new Map(Object.entries(MY).map(([english, burmese]) => [burmese, english]));
  const PREFIX_MY = new Map([
    ['By ', 'ရေးသားသူ: '],
    ['Photo: ', 'ဓာတ်ပုံ: '],
    ['Published ', 'ထုတ်ဝေချိန်: '],
    ['Latest story published ', 'နောက်ဆုံးသတင်း ထုတ်ဝေချိန်: ']
  ]);
  const PREFIX_EN = new Map([...PREFIX_MY].map(([english, burmese]) => [burmese, english]));
  const PRESERVE = '[data-i18n-preserve], .team-name, .identity-name, .league-name, .league-list-name, .followed-league-name, .competition-mark, .club-logo, .standing-club, .team-hero h1, .team-hero p';
  function readLocale() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'my' || saved === 'en') return saved;
    } catch {}
    return /^my(?:-|$)/i.test(navigator.language || '') ? 'my' : 'en';
  }
  let locale = readLocale();
  function translateText(value) {
    const leading = value.match(/^\s*/)?.[0] || '';
    const trailing = value.match(/\s*$/)?.[0] || '';
    const core = value.slice(leading.length, value.length - trailing.length || value.length);
    if (!core) return value;
    if (locale === 'my') {
      if (Object.prototype.hasOwnProperty.call(MY, core)) return `${leading}${MY[core]}${trailing}`;
      for (const [prefix, translated] of PREFIX_MY) {
        if (core.startsWith(prefix)) return `${leading}${translated}${core.slice(prefix.length)}${trailing}`;
      }
      const count = core.match(/^(\d+)\s+matches?(?=\s|$|[·])/i);
      if (count) return `${leading}${count[1]} ပွဲ${core.slice(count[0].length)}${trailing}`;
      const eyebrow = core.match(/^FOOTBALL NEWS\s+·\s+(\d+)\s+SOURCES?$/i);
      if (eyebrow) return `${leading}ဘောလုံးသတင်း · ${eyebrow[1]} ရင်းမြစ်${trailing}`;
      return value;
    }
    if (EN_BY_MY.has(core)) return `${leading}${EN_BY_MY.get(core)}${trailing}`;
    for (const [prefix, translated] of PREFIX_EN) {
      if (core.startsWith(prefix)) return `${leading}${translated}${core.slice(prefix.length)}${trailing}`;
    }
    const count = core.match(/^(\d+)\s+ပွဲ(?=\s|$|[·])/);
    if (count) return `${leading}${count[1]} ${count[1] === '1' ? 'match' : 'matches'}${core.slice(count[0].length)}${trailing}`;
    const eyebrow = core.match(/^ဘောလုံးသတင်း\s+·\s+(\d+)\s+ရင်းမြစ်$/);
    if (eyebrow) return `${leading}FOOTBALL NEWS · ${eyebrow[1]} SOURCE${eyebrow[1] === '1' ? '' : 'S'}${trailing}`;
    return value;
  }
  function translateAttributes(element) {
    for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
      if (element.hasAttribute?.(attribute)) {
        const value = element.getAttribute(attribute);
        const next = translateText(value);
        if (next !== value) element.setAttribute(attribute, next);
      }
    }
  }
  function visit(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement?.closest(PRESERVE)) return;
      node.nodeValue = translateText(node.nodeValue || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches(PRESERVE)) return;
      translateAttributes(node);
    }
    for (const child of node.childNodes) visit(child);
  }
  function translate(root = document) {
    if (root === document || root === document.documentElement) document.documentElement.lang = locale;
    visit(root);
  }
  function setLocale(next) {
    if (next !== 'my' && next !== 'en') return;
    if (locale === next) return;
    locale = next;
    try { localStorage.setItem(STORAGE_KEY, locale); } catch {}
    document.documentElement.lang = locale;
    translate(document);
    window.dispatchEvent(new CustomEvent('matchday-language-change', { detail: { locale } }));
  }
  window.MatchdayI18n = {
    t(key) { return locale === 'my' ? (MY[key] || key) : key; },
    translate,
    setLocale,
    get locale() { return locale; }
  };
  document.documentElement.lang = locale;
  translate(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) visit(node);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
