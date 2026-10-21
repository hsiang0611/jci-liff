/**
 * Util.gs — 共用小工具
 */

/** 丟出可回傳給前端的錯誤 */
function apiError_(code, message) {
  var err = new Error(message);
  err.apiCode = code;
  return err;
}

function prop_(key, def) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined || v === '') ? (def === undefined ? '' : def) : v;
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

function str_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function bool_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  return /^(true|是|y|yes|1|v|✓|✔)$/i.test(String(v).trim());
}

function num_(v, def) {
  if (v === '' || v === null || v === undefined) return def === undefined ? 0 : def;
  var n = Number(v);
  return isNaN(n) ? (def === undefined ? 0 : def) : n;
}

/** 試算表儲存格 → Date（無法解析回傳 null） */
function toDate_(v) {
  if (!v && v !== 0) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  if (!s) return null;
  // 「2026/10/25 19:00」或「2026-10-25 19:00」一律視為台灣時間
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) {
    var iso = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]) + 'T' + pad2_(m[4] || '0') + ':' + (m[5] || '00') + ':00+08:00';
    var d1 = new Date(iso);
    return isNaN(d1.getTime()) ? null : d1;
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toIso_(v) {
  var d = toDate_(v);
  return d ? d.toISOString() : '';
}

function pad2_(n) {
  n = String(n);
  return n.length < 2 ? '0' + n : n;
}

function fmtDate_(d, pattern) {
  return Utilities.formatDate(d, TZ, pattern);
}

/** 「10/25（六）19:00」這種給推播訊息用的格式 */
function fmtEventTime_(d) {
  if (!d) return '';
  var w = ['日', '一', '二', '三', '四', '五', '六'][Number(fmtDate_(d, 'u')) % 7];
  return fmtDate_(d, 'M/d') + '（' + w + '）' + fmtDate_(d, 'HH:mm');
}

/** 手機號碼正規化：只留數字，+886 / 886 開頭改回 0，試算表吃掉的開頭 0 補回 */
function normPhone_(v) {
  var s = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  if (s.indexOf('886') === 0 && s.length === 12) s = '0' + s.substring(3);
  if (s.length === 9 && s.charAt(0) === '9') s = '0' + s;
  return s;
}

/** 姓名正規化：去掉全形／半形空白 */
function normName_(v) {
  return str_(v).replace(/[\s　]+/g, '');
}

/**
 * 使用者輸入的文字寫進試算表前一律經過這裡：
 * 限制長度，並阻擋以 = + - @ 開頭被當成公式（試算表公式注入）。
 */
function safeText_(v, maxLen) {
  var s = str_(v);
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/** 手機寫入試算表時加上 ' 避免開頭的 0 被吃掉 */
function phoneCell_(v) {
  var p = normPhone_(v);
  return p ? "'" + p : '';
}

function newId_(prefix) {
  return prefix + fmtDate_(new Date(), 'yyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 4).toUpperCase();
}

function isHttpsUrl_(v) {
  return /^https:\/\/[^\s"'<>]+$/i.test(str_(v));
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
