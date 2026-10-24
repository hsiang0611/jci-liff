/**
 * config.js — 部署時只需要改這個檔案
 *
 * LIFF_ID 或 API_URL 任一個留空，App 會自動進入「示範模式」：
 * 不連 LINE、不連後端，用假資料展示畫面，可在上方切換角色看權限差異。
 */
window.APP_CONFIG = {
  // LINE Developers → LINE Login channel → LIFF 分頁的 LIFF ID，例如 '2001234567-AbCdEfGh'
  LIFF_ID: '2012134116-hfQ9YMRC',

  // 後端網址：Apps Script 部署後的網頁應用程式網址（結尾 /exec）；
  // 有建加速層（Cloudflare Worker，見 README）就改填 Worker 網址，例如 'https://jci-api.你的帳號.workers.dev'
  API_URL: 'https://jci-api.hsiang-13f.workers.dev',

  // 選填：有用加速層時，這裡填原本的 Apps Script 網址，加速層連不上時 App 會自動改走這裡
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwJaJCbMiSCPv3l3LWd4nu1r0BnySWO1AldvyORgtetXvJxuLhgm7qs2Gq1bsEZJhcf/exec',

  // 官方帳號的 Basic ID（含 @），用於「加入好友」按鈕，例如 '@123abcde'
  OA_BASIC_ID: '@183svval',

  ORG_NAME: '龍井國際青年商會',
  ORG_SHORT: '龍井青商',

  // 「認識我們」頁與招募用的介紹文字（選填，留空會用預設文字）
  ORG_INTRO: '',

  // 設為 true 可強制示範模式（例如給理監事看畫面）
  DEMO: false
};
