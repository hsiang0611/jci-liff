/**
 * api.js — 與 LINE（LIFF SDK）和 Apps Script 後端溝通
 *
 * Apps Script 不處理 CORS 預檢（OPTIONS），所以 POST 一律用 text/plain 送 JSON 字串，
 * 讓瀏覽器把它當「簡單請求」直接送出。
 */
window.Api = (function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var LIFF_SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
  var RELOGIN_KEY = 'jci_relogin_at';
  var mode = 'live';

  /**
   * 後端網址：API_URL 可以是 Apps Script，也可以是前面加了加速層（Cloudflare Worker）的網址。
   * 有另外填 GAS_URL 時，加速層連不上就自動改走 Apps Script（這次打開期間都走直連）。
   */
  var base = CFG.API_URL || '';
  var fallbackActive = false;

  /** 最近幾次呼叫的耗時（管理員的「連線狀況」會顯示） */
  var stats = [];
  var edgeSeen = false;
  function record(entry) {
    stats.push(entry);
    if (stats.length > 40) stats.shift();
  }
  function switchToFallback(why) {
    if (!CFG.GAS_URL || base === CFG.GAS_URL) return false;
    base = CFG.GAS_URL;
    fallbackActive = true;
    record({ action: '（改走直連）', ms: 0, edge: '', note: why, at: Date.now() });
    return true;
  }

  function apiError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(apiError('SDK_LOAD', '無法載入 LINE 元件，請檢查網路後重新開啟')); };
      document.head.appendChild(s);
    });
  }

  function isDemo() {
    return !!CFG.DEMO || !CFG.LIFF_ID || !CFG.API_URL;
  }

  /** 重新登入以取得新的 ID Token（避免無限迴圈：30 秒內只做一次） */
  function relogin() {
    var last = 0;
    try { last = Number(sessionStorage.getItem(RELOGIN_KEY)) || 0; } catch (e) { /* ignore */ }
    if (Date.now() - last < 30000) {
      throw apiError('TOKEN_EXPIRED', '登入狀態失效，請關閉後從 LINE 重新開啟');
    }
    try { sessionStorage.setItem(RELOGIN_KEY, String(Date.now())); } catch (e) { /* ignore */ }
    liff.logout();
    if (liff.isInClient()) location.reload();
    else liff.login({ redirectUri: location.href });
    return new Promise(function () {}); // 頁面即將跳轉
  }

  /** 啟動：回傳 { demo, deepLink } */
  function init() {
    if (!window.APP_CONFIG) {
      return Promise.reject(apiError('CONFIG', 'js/config.js 讀取失敗：檔案不存在，或內容打錯字（例如用了全形引號「’」、少了逗號）'));
    }
    if (isDemo()) {
      mode = 'demo';
      return Promise.resolve({ demo: true, deepLink: new URLSearchParams(location.search).get('to') || '' });
    }
    mode = 'live';
    return loadScript(LIFF_SDK).then(function () {
      return liff.init({ liffId: CFG.LIFF_ID });
    }).then(function () {
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return new Promise(function () {});
      }
      // liff.init() 完成後才能讀到 LIFF 網址帶的參數
      return { demo: false, deepLink: new URLSearchParams(location.search).get('to') || '' };
    });
  }

  function currentIdToken() {
    var decoded = liff.getDecodedIDToken && liff.getDecodedIDToken();
    if (decoded && decoded.exp && decoded.exp * 1000 < Date.now() + 30000) return null;
    return liff.getIDToken();
  }

  function callOnce(action, data) {
    if (mode === 'demo') return window.Mock.call(action, data);
    var idToken = currentIdToken();
    if (!idToken) return relogin();
    var t0 = Date.now(), entry = { action: action, ms: 0, edge: '', up: null, at: t0 };
    return fetch(base, {
      method: 'POST',
      body: JSON.stringify({ action: action, idToken: idToken, data: data || {} })
    }).catch(function () {
      entry.ms = Date.now() - t0; entry.err = 'NETWORK'; record(entry);
      switchToFallback('連不上加速層');
      throw apiError('NETWORK', '連不上伺服器，請檢查網路後再試一次');
    }).then(function (res) {
      var edge = res.headers.get('X-Edge') || '';
      entry.edge = edge;
      entry.up = Number(res.headers.get('X-Edge-Upstream-Ms')) || null;
      if (edge) edgeSeen = true;
      if (!res.ok) {
        entry.ms = Date.now() - t0; entry.err = String(res.status); record(entry);
        if (!edge && res.status >= 500) switchToFallback('加速層回應 ' + res.status);
        throw apiError(res.status === 429 || res.status >= 500 ? 'OVERLOAD' : 'NETWORK', '伺服器回應異常（' + res.status + '）');
      }
      // Apps Script 同時執行過多時會回傳 HTML 錯誤頁，不是 JSON
      return res.text().then(function (t) {
        entry.ms = Date.now() - t0;
        entry.bytes = t.length;
        try { var j = JSON.parse(t); record(entry); return j; } catch (e) { entry.err = 'OVERLOAD'; record(entry); throw apiError('OVERLOAD', '伺服器忙碌中，請稍後再試'); }
      });
    }).then(function (j) {
      if (j.ok) {
        try { sessionStorage.removeItem(RELOGIN_KEY); } catch (e) { /* ignore */ }
        return j.data;
      }
      if (j.error && j.error.code === 'TOKEN_EXPIRED') return relogin();
      throw apiError(j.error ? j.error.code : 'UNKNOWN', j.error ? j.error.message : '未知錯誤');
    });
  }

  /**
   * 重送規則（例會報到尖峰、同時太多人用時）：
   *   BUSY / OVERLOAD：伺服器還沒做事就拒絕了，任何動作都可以安全重送
   *   NETWORK：不確定伺服器有沒有做完，只重送「重複做也不會出錯」的動作
   */
  var SAFE_TO_REPEAT = {
    init: 1, event: 1, directory: 1, checkin: 1, register: 1, cancelRegistration: 1, setAttendance: 1, vote: 1, poll: 1,
    officers: 1, prospects: 1, members: 1, requests: 1, pushLog: 1, scheduledPushes: 1, attendanceStats: 1, pushPreview: 1,
    dues: 1, setDues: 1, auditLog: 1, updateMe: 1, phoneConsent: 1, updateShop: 1, setPollStatus: 1, checkinQr: 1
  };
  var RETRY_WAIT = [700, 1600, 3200];
  var onRetry = null;

  function call(action, data) {
    var attempt = 0;
    function run() {
      return callOnce(action, data).catch(function (e) {
        var transient = e && (e.code === 'BUSY' || e.code === 'OVERLOAD' || (e.code === 'NETWORK' && SAFE_TO_REPEAT[action]));
        if (!transient || attempt >= RETRY_WAIT.length || (action === 'checkinQr' && data && data.renew)) throw e;
        var wait = RETRY_WAIT[attempt++] + Math.floor(Math.random() * 500);
        if (onRetry) onRetry(action, attempt);
        return new Promise(function (r) { setTimeout(r, wait); }).then(run);
      });
    }
    return run();
  }

  /** 這支手機目前登入的人（暫存首頁資料用，避免換帳號看到別人的） */
  function userKey() {
    if (mode === 'demo') return 'demo-' + (window.Mock ? window.Mock.getRole() : '');
    try {
      var d = liff.getDecodedIDToken && liff.getDecodedIDToken();
      return d && d.sub ? d.sub : '';
    } catch (e) {
      return '';
    }
  }

  function loadScriptOnce(src, test) {
    if (test()) return Promise.resolve();
    return loadScript(src).catch(function () {
      throw apiError('LOAD', '元件載入失敗，請檢查網路後再試一次');
    });
  }

  /** 是否已加入官方帳號好友（null = 無法判斷） */
  function friendship() {
    if (mode === 'demo') return Promise.resolve(window.Mock.isFriend());
    if (!CFG.OA_BASIC_ID) return Promise.resolve(null); // 還沒有官方帳號：不提示加好友
    return liff.getFriendship().then(function (r) { return r.friendFlag; }).catch(function () { return null; });
  }

  function profileFallback() {
    if (mode === 'demo') return Promise.resolve(null);
    return liff.getProfile().catch(function () { return null; });
  }

  function canShare() {
    return mode === 'live' && liff.isApiAvailable && liff.isApiAvailable('shareTargetPicker');
  }

  function share(messages) {
    if (!canShare()) return Promise.reject(apiError('UNSUPPORTED', '這個環境不支援分享'));
    return liff.shareTargetPicker(messages, { isMultiple: true });
  }

  function liffUrl(to) {
    if (mode === 'demo') return location.origin + location.pathname + (to ? '#/' + to : '');
    return 'https://liff.line.me/' + CFG.LIFF_ID + (to ? '?to=' + encodeURIComponent(to) : '');
  }

  function openExternal(url) {
    if (mode === 'live' && liff.isInClient()) liff.openWindow({ url: url, external: true });
    else window.open(url, '_blank', 'noopener');
  }

  function addFriendUrl() {
    return CFG.OA_BASIC_ID ? 'https://line.me/R/ti/p/' + encodeURIComponent(CFG.OA_BASIC_ID) : '';
  }

  function isInClient() {
    return mode === 'live' && liff.isInClient();
  }

  function closeApp() {
    if (isInClient()) liff.closeWindow();
  }

  function logout() {
    if (mode === 'live' && !liff.isInClient()) {
      liff.logout();
      location.reload();
    }
  }

  return {
    init: init, call: call, friendship: friendship, profileFallback: profileFallback, userKey: userKey,
    loadScriptOnce: loadScriptOnce, set onRetry(fn) { onRetry = fn; },
    canShare: canShare, share: share, liffUrl: liffUrl, openExternal: openExternal,
    addFriendUrl: addFriendUrl, isInClient: isInClient, closeApp: closeApp, logout: logout,
    get mode() { return mode; },
    get stats() { return stats.slice(); },
    get edgeSeen() { return edgeSeen; },
    get fallbackActive() { return fallbackActive; },
    get baseUrl() { return base; }
  };
})();
