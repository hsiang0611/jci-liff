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

  function call(action, data) {
    if (mode === 'demo') return window.Mock.call(action, data);
    var idToken = currentIdToken();
    if (!idToken) return relogin();
    return fetch(CFG.API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: action, idToken: idToken, data: data || {} })
    }).catch(function () {
      throw apiError('NETWORK', '連不上伺服器，請檢查網路後再試一次');
    }).then(function (res) {
      if (!res.ok) throw apiError('NETWORK', '伺服器回應異常（' + res.status + '）');
      return res.json();
    }).then(function (j) {
      if (j.ok) {
        try { sessionStorage.removeItem(RELOGIN_KEY); } catch (e) { /* ignore */ }
        return j.data;
      }
      if (j.error && j.error.code === 'TOKEN_EXPIRED') return relogin();
      throw apiError(j.error ? j.error.code : 'UNKNOWN', j.error ? j.error.message : '未知錯誤');
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
    init: init, call: call, friendship: friendship, profileFallback: profileFallback,
    canShare: canShare, share: share, liffUrl: liffUrl, openExternal: openExternal,
    addFriendUrl: addFriendUrl, isInClient: isInClient, closeApp: closeApp, logout: logout,
    get mode() { return mode; }
  };
})();
