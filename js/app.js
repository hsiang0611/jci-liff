/**
 * app.js — 龍井青商會員專區（LIFF 單頁應用）
 *
 * 結構：
 *   狀態 S → render() 依網址 #/路徑 選擇畫面 → 輸出 HTML
 *   點擊、送出表單用事件委派（data-act / data-form / data-go）
 *   所有顯示的文字都先經過 esc() 跳脫，避免 XSS
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var $app = document.getElementById('app');
  var $tabbar = document.getElementById('tabbar');
  var $toast = document.getElementById('toast');
  var $layer = document.getElementById('layer');

  var S = {
    ready: false, demo: false,
    me: null, roles: [], events: [], news: [], categories: { event: [], news: [] },
    pendingCount: 0, friend: null, docs: [], birthdays: [], industries: [],
    cache: {},
    dirIndustry: '', attYear: 0, checkinDone: {},
    evFilter: 'upcoming', newsCat: '', dirQuery: '', memQuery: '', memFilter: '',
    bindResult: null,
    push: null
  };
  var loading = {};
  var lastPath = null;
  var navDepth = 0;

  /* ═════════════ 小工具 ═════════════ */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 純文字 → 段落 HTML；網址自動變成連結 */
  function richText(s) {
    var html = esc(s).replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      return '<a href="' + u + '" data-ext>' + u + '</a>';
    });
    return html.split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  function excerpt(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** ISO → 台灣時間各欄位（台灣無日光節約，固定 +8） */
  function tp(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var t = new Date(d.getTime() + 8 * 3600000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay(),
      hm: pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()), ms: d.getTime(),
      day: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) };
  }
  function fmtMD(iso) { var t = tp(iso); return t ? t.m + '/' + t.d + '（' + WD[t.w] + '）' : ''; }
  function fmtDT(iso) { var t = tp(iso); return t ? fmtMD(iso) + t.hm : ''; }
  function fmtDate(iso) { var t = tp(iso); return t ? t.y + '/' + t.m + '/' + t.d : ''; }
  function fmtWhen(start, end) {
    var a = tp(start), b = tp(end);
    if (!a) return '時間另行通知';
    if (!b) return fmtDT(start);
    if (a.day === b.day) return fmtMD(start) + a.hm + '–' + b.hm;
    return fmtDT(start) + ' 至 ' + fmtDT(end);
  }
  function relDays(iso) {
    var t = tp(iso);
    if (!t) return '';
    var n = Math.round((t.day - tp(new Date().toISOString()).day) / 86400000);
    if (n === 0) return '今天';
    if (n === 1) return '明天';
    if (n === 2) return '後天';
    if (n > 0) return '還有 ' + n + ' 天';
    if (n === -1) return '昨天';
    return (-n) + ' 天前';
  }
  function toInput(iso) {
    var t = tp(iso);
    return t ? t.y + '-' + pad(t.m) + '-' + pad(t.d) + 'T' + t.hm : '';
  }
  function fromInput(v) {
    return v ? new Date(v + ':00+08:00').toISOString() : '';
  }
  function isPast(ev) {
    var end = Date.parse(ev.end || ev.start);
    return !isNaN(end) && end < Date.now();
  }

  var CAT_COLOR = {
    '例會': '#0567B1', '理監事會': '#4B4FA8', '訓練': '#1B8A5A', '公益服務': '#E8590C',
    '聯誼': '#C2407A', '國際交流': '#0E8C8C', '會務公告': '#0567B1', '活動花絮': '#E8590C',
    '會員動態': '#1B8A5A', '國際青商': '#0E8C8C'
  };
  function catTag(cat) {
    return '<span class="cat" style="--c:' + (CAT_COLOR[cat] || '#8A94A3') + '">' + esc(cat || '其他') + '</span>';
  }

  /** 姓名依筆畫排序（繁體中文排序規則：先比姓氏筆畫，同姓再比下一個字） */
  var nameCollator = window.Intl && Intl.Collator ? new Intl.Collator('zh-Hant-TW') : null;
  function byName(a, b) {
    var x = String(a.name || ''), y = String(b.name || '');
    return nameCollator ? nameCollator.compare(x, y) : x.localeCompare(y);
  }
  /** 先依角色等級（高到低），同等級再依姓名筆畫 */
  function byLevelThenName(a, b) {
    return ((b.level || 0) - (a.level || 0)) || byName(a, b);
  }

  function roleLevel(name) {
    for (var i = 0; i < S.roles.length; i++) if (S.roles[i].role === name) return S.roles[i].level;
    return 0;
  }
  function audienceLabel(role) {
    return roleLevel(role) === 0 ? '公開' : role + '以上';
  }
  function perm(k) { return !!(S.me && S.me.perms && S.me.perms[k]); }
  /** 有推播權限、且後端已連接 LINE 官方帳號 */
  function canPush() { return perm('push') && S.pushReady; }
  function anyAdmin() {
    return canPush() || perm('eventManage') || perm('newsManage') || perm('memberManage');
  }

  var ICONS = {
    home: 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    news: 'M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12',
    book: '<path d="M5.5 4h11a2 2 0 0 1 2 2v14h-11a2 2 0 0 1-2-2z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 16.5a3.5 3.5 0 0 1 7 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.4c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2 2.6.9 2.6 2.1-1.1 2-2.6 2c-1.1 0-2.1-.5-2.6-1.4M12 6.5V8M12 16v1.5"/>',
    flag: 'M5.5 21V4M5.5 4h11l-2 4 2 4h-11',
    users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    phone: 'M6 3.5h3l1.8 4.6-2.3 1.4a11 11 0 0 0 6 6l1.4-2.3 4.6 1.8v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4 5.5a2 2 0 0 1 2-2z',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
    back: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    send: '<path d="M21 3 3 10.5l7 3 3 7.5z"/><path d="M10 13.5 21 3"/>',
    check: 'M4.5 12.5l5 5L20 7',
    close: 'M6 6l12 12M18 6 6 18',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h3.5"/>',
    pinned: 'M9 3.5h6l-1 5.5 3 3H7l3-3zM12 12v8.5',
    refresh: 'M20 11.5A8 8 0 1 1 17.7 6M20 4.5v5h-5',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13',
    chat: 'M12 4.5c5 0 9 3 9 6.8s-4 6.8-9 6.8c-.8 0-1.6-.1-2.3-.2L5 20l.9-3.4C4.2 15.4 3 13.5 3 11.3 3 7.5 7 4.5 12 4.5z',
    inbox: '<path d="M3.5 13 6.5 5h11l3 8v6.5h-17z"/><path d="M3.5 13h5l1.5 2.5h4l1.5-2.5h5"/>',
    map: '<path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>',
    qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M13.5 13.5h3v3h-3zM18.5 13.5h2M20.5 16.5v4h-4M13.5 19.5v1"/>',
    doc: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h6"/>',
    cake: '<path d="M4 20.5h16M5 20.5v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6"/><path d="M5 16.5c1.5 1.4 2.5 1.4 4 0s2.5-1.4 4 0 2.5 1.4 4 0M12 12.5v-3M12 6.5c-.8-1-1.2-2-.2-3 1.1 1 .7 2 .2 3z"/>',
    camera: '<path d="M4 8.5h3.5l1.5-2.5h6l1.5 2.5H20v11H4z"/><circle cx="12" cy="14" r="3.5"/>',
    calplus: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M12 12.5v5M9.5 15h5"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M3.5 12.5h17"/>',
    leave: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    checkcircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>'
  };
  function icon(name, cls) {
    var p = ICONS[name] || '';
    var inner = p.charAt(0) === '<' ? p : '<path d="' + p + '"/>';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  /** 會徽：圖片讀不到時自動隱藏，不影響旁邊的文字 */
  function logo(cls) {
    return '<img class="' + cls + '" src="img/logo.png" alt="" onerror="this.hidden=true">';
  }

  function avatar(me, size) {
    size = size || 36;
    var name = me ? ((me.member && me.member.name) || me.lineName || '') : '';
    if (me && me.picture) {
      return '<img class="avatar" src="' + esc(me.picture) + '" alt="" width="' + size + '" height="' + size + '">';
    }
    return '<span class="avatar avatar-txt" style="width:' + size + 'px;height:' + size + 'px">' + esc(name.charAt(0) || '我') + '</span>';
  }

  /** 會員證上的等深線（台中港海圖意象） */
  function contours() {
    var paths = '';
    for (var i = 0; i < 7; i++) {
      var y = 18 + i * 22, a = 6 + (i % 3) * 4, o = i * 37;
      paths += '<path d="M-20 ' + y + ' C ' + (60 + o % 50) + ' ' + (y - a) + ', ' + (140 + o % 40) + ' ' + (y + a * 1.6) + ', 220 ' + (y + 2) +
        ' S ' + (330 - o % 30) + ' ' + (y - a) + ', 420 ' + (y + a * .5) + '"/>';
    }
    return '<svg class="mcard-contours" viewBox="0 0 400 180" preserveAspectRatio="none" aria-hidden="true">' + paths + '</svg>';
  }

  /* ═════════════ 路由 ═════════════ */

  var ROOTS = { home: 1, events: 1, news: 1, directory: 1, me: 1 };

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').map(function (x) { return decodeURIComponent(x || ''); });
    return { name: parts[0] || 'home', a: parts[1] || '', b: parts[2] || '', path: h };
  }
  function go(path, replace) {
    if (replace) {
      location.replace('#/' + path);
    } else {
      navDepth++;
      location.hash = '#/' + path;
    }
  }
  function back(parent) {
    if (navDepth > 0) {
      navDepth--;
      history.back();
    } else {
      go(parent || 'home', true);
    }
  }

  /* ═════════════ 資料 ═════════════ */

  function ensure(key, loader) {
    if (Object.prototype.hasOwnProperty.call(S.cache, key)) return S.cache[key];
    if (!loading[key]) {
      loading[key] = loader().then(function (d) { S.cache[key] = d; }, function (e) { S.cache[key] = { __error: e }; })
        .then(function () { delete loading[key]; render(); });
    }
    return undefined;
  }
  function invalidate(prefix) {
    Object.keys(S.cache).forEach(function (k) { if (k.indexOf(prefix) === 0) delete S.cache[k]; });
  }

  function applyInit(d) {
    S.me = d.me;
    S.roles = (d.roles || []).slice().sort(function (a, b) { return a.level - b.level; });
    S.events = d.events || [];
    S.news = d.news || [];
    S.categories = d.categories || S.categories;
    S.pendingCount = d.pendingCount || 0;
    S.pushReady = d.pushReady !== false;
    S.docs = d.docs || [];
    S.birthdays = d.birthdays || [];
    S.industries = d.industries || [];
    S.cache = {};
  }

  function reloadAll() {
    return Promise.all([Api.call('init'), Api.friendship()]).then(function (r) {
      applyInit(r[0]);
      S.friend = r[1];
      render();
    });
  }

  function upsertEvent(ev) {
    var lite = Object.assign({}, ev);
    delete lite.registrations;
    var i = S.events.findIndex(function (e) { return e.id === ev.id; });
    if (i >= 0) S.events[i] = lite; else S.events.push(lite);
    S.events.sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });
    S.cache['event:' + ev.id] = ev;
  }
  function upsertNews(n) {
    var i = S.news.findIndex(function (x) { return x.id === n.id; });
    if (i >= 0) S.news[i] = n; else S.news.unshift(n);
    S.news.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.publishedAt || '9999').localeCompare(a.publishedAt || '9999');
    });
  }

  /* ═════════════ 共用元件 ═════════════ */

  function demoBar() {
    if (!S.demo) return '';
    return '<div class="demobar"><span>示範模式</span><button type="button" class="demobar-btn" data-act="demoRole">以「' +
      esc(Mock.getRole()) + '」身分檢視<span aria-hidden="true">▾</span></button></div>';
  }

  function topbar(o) {
    o = o || {};
    if (o.back !== undefined) {
      return '<header class="topbar is-sub"><button type="button" class="iconbtn" data-act="back" data-parent="' + esc(o.back) + '" aria-label="返回">' +
        icon('back') + '</button><div class="topbar-title">' + esc(o.title || '') + '</div><div class="topbar-actions">' + (o.actions || '') + '</div></header>';
    }
    return '<header class="topbar"><div class="brand">' + logo('brand-logo') + '<span class="brand-name">' + esc(CFG.ORG_NAME || '會員專區') +
      '</span></div><div class="topbar-actions"><button type="button" class="iconbtn" data-act="refresh" aria-label="重新整理">' + icon('refresh') +
      '</button><button type="button" class="avatar-btn" data-tab="me" aria-label="我的">' + avatar(S.me, 32) + '</button></div></header>';
  }

  function empty(title, text, action) {
    return '<div class="empty"><p class="empty-title">' + esc(title) + '</p>' + (text ? '<p>' + esc(text) + '</p>' : '') + (action || '') + '</div>';
  }

  function skeleton(n) {
    var s = '';
    for (var i = 0; i < (n || 3); i++) s += '<div class="sk-row"><span class="sk sk-a"></span><span class="sk sk-b"></span><span class="sk sk-c"></span></div>';
    return '<div class="sk-wrap" aria-label="載入中">' + s + '</div>';
  }

  function errorBlock(e) {
    return empty('沒辦法載入', e && e.message ? e.message : '請稍後再試',
      '<button type="button" class="btn btn-ghost" data-act="retry">重新載入</button>');
  }

  function forbidden() {
    return topbar({ back: 'me', title: '' }) + '<main class="view">' + empty('你的角色沒有這項權限', '如需開通，請洽秘書處。') + '</main>';
  }

  function regState(ev) {
    if (ev.status === '取消') return { t: '已取消', c: 'is-danger' };
    if (ev.status === '草稿') return { t: '草稿，只有幹部看得到', c: 'is-muted' };
    if (ev.myReg && ev.myReg.status === '請假') return { t: '已請假', c: 'is-alert' };
    if (ev.myReg && ev.myReg.attended) return { t: '已報到', c: 'is-ok' };
    if (ev.myReg) return { t: '已報名 ' + ev.myReg.count + ' 人', c: 'is-ok' };
    if (isPast(ev)) return { t: '已結束', c: 'is-muted' };
    if (!ev.regOpen) return { t: ev.regClosedReason, c: 'is-muted' };
    if (ev.deadline) {
      var left = Date.parse(ev.deadline) - Date.now();
      if (left < 3 * 86400000) return { t: '報名至 ' + fmtDT(ev.deadline), c: 'is-alert' };
    }
    if (ev.capacity > 0) return { t: '剩 ' + Math.max(0, ev.capacity - ev.regCount) + ' 位', c: '' };
    return { t: '開放報名', c: '' };
  }
  function statePill(ev) {
    var s = regState(ev);
    return s.t ? '<span class="pill ' + s.c + '">' + esc(s.t) + '</span>' : '';
  }

  function eventRow(ev) {
    var t = tp(ev.start);
    var cls = 'erow' + (isPast(ev) ? ' is-past' : '') + (ev.status === '取消' ? ' is-cancelled' : '');
    return '<a class="' + cls + '" href="#/event/' + encodeURIComponent(ev.id) + '" data-nav>' +
      '<div class="erow-date"><b>' + (t ? t.d : '–') + '</b><span>週' + (t ? WD[t.w] : '') + '</span></div>' +
      '<div class="erow-body">' + catTag(ev.category) +
      '<div class="erow-title">' + esc(ev.title) + '</div>' +
      '<div class="erow-meta">' + (t ? t.hm : '') + (ev.location ? '　' + esc(ev.location) : '') + '</div>' +
      '<div class="erow-state">' + statePill(ev) + '</div></div></a>';
  }

  function eventList(list) {
    var out = '', month = '';
    list.forEach(function (ev) {
      var t = tp(ev.start);
      var m = t ? t.y + ' 年 ' + t.m + ' 月' : '未定日期';
      if (m !== month) {
        if (month) out += '</div>';
        out += '<h3 class="month">' + m + '</h3><div class="rows">';
        month = m;
      }
      out += eventRow(ev);
    });
    return out + (month ? '</div>' : '');
  }

  function newsRow(n) {
    return '<a class="nrow" href="#/news/' + encodeURIComponent(n.id) + '" data-nav>' +
      '<div class="nrow-top">' + (n.pinned ? '<span class="nrow-pin">' + icon('pinned') + '置頂</span>' : '') + catTag(n.category) +
      '<time>' + (n.publishedAt ? fmtDate(n.publishedAt) : '草稿') + '</time></div>' +
      '<div class="nrow-title">' + esc(n.title) + '</div>' +
      '<p class="nrow-excerpt">' + esc(excerpt(n.content, 70)) + '</p></a>';
  }

  /* ═════════════ 畫面：首頁 ═════════════ */

  function memberCard() {
    var me = S.me;
    var org = '<div class="mcard-top"><span class="mcard-org">會員證</span>' +
      '<span class="mcard-role">' + esc(me.role) + '</span></div>';
    if (me.member) {
      var m = me.member;
      return '<section class="mcard" aria-label="會員證">' + contours() + org +
        '<div class="mcard-name">' + esc(m.name) + '</div>' +
        '<div class="mcard-sub">' + esc([m.title, m.company].filter(Boolean).join('　')) + '</div>' +
        (m.joinYear ? '<dl class="mcard-meta"><div><dt>入會</dt><dd>' + esc(m.joinYear) + '</dd></div></dl>' : '') + '</section>';
    }
    var body;
    if (me.disabled) body = '<p class="mcard-note">這個 LINE 帳號對應的會員目前停用中，請洽秘書處。</p>';
    else if (me.pendingRequest) body = '<p class="mcard-note">綁定申請已送出，秘書處確認後就能使用會員功能。</p>';
    else body = '<p class="mcard-note">綁定會員身分後，就能報名會員活動、查看會員通訊錄。</p>' +
      '<button type="button" class="btn btn-onbrand" data-tab="me">綁定會員身分</button>';
    return '<section class="mcard is-guest" aria-label="會員證">' + contours() + org +
      '<div class="mcard-name">嗨，' + esc(me.lineName || 'LINE 使用者') + '</div>' + body + '</section>';
  }

  function friendNotice() {
    if (S.friend !== false) return '';
    var url = Api.addFriendUrl();
    return '<div class="notice"><div><b>加入官方帳號好友，才收得到活動通知</b><p>報名提醒、活動異動都會透過 LINE 傳給你。</p></div>' +
      (url || S.demo ? '<button type="button" class="btn btn-line" data-act="addFriend">' + icon('chat') + '加入好友</button>' : '') + '</div>';
  }

  function adminShortcuts() {
    if (!anyAdmin()) return '';
    var items = [];
    if (canPush()) items.push('<button type="button" class="chip-btn" data-go="admin/push">' + icon('send') + '發送通知</button>');
    if (perm('eventManage')) items.push('<button type="button" class="chip-btn" data-go="event-edit/new">' + icon('plus') + '新增活動</button>');
    if (perm('newsManage')) items.push('<button type="button" class="chip-btn" data-go="news-edit/new">' + icon('edit') + '發布消息</button>');
    if (perm('memberManage')) items.push('<button type="button" class="chip-btn" data-go="admin/requests">' + icon('inbox') + '綁定審核' +
      (S.pendingCount ? '<i class="count">' + S.pendingCount + '</i>' : '') + '</button>');
    return '<div class="shortcuts" role="group" aria-label="管理功能">' + items.join('') + '</div>';
  }

  function viewHome() {
    var upcoming = S.events.filter(function (e) { return !isPast(e) && e.status === '發布'; });
    var next = upcoming[0];
    var rest = upcoming.slice(1, 4);
    var html = topbar() + '<main class="view view-home">' + memberCard() + friendNotice() + adminShortcuts();

    html += '<section class="block"><div class="block-head"><h2>下一場活動</h2><a href="#/events" data-tab="events">全部活動</a></div>';
    if (next) {
      var t = tp(next.start);
      html += '<a class="next" href="#/event/' + encodeURIComponent(next.id) + '" data-nav>' +
        '<div class="next-date"><span class="next-m">' + t.m + ' 月</span><b class="next-d">' + t.d + '</b><span class="next-w">週' + WD[t.w] + '</span></div>' +
        '<div class="next-body">' + catTag(next.category) + '<h3>' + esc(next.title) + '</h3>' +
        '<p>' + icon('clock') + esc(fmtWhen(next.start, next.end).replace(/^.*?）/, '')) + '</p>' +
        (next.location ? '<p>' + icon('pin') + esc(next.location) + '</p>' : '') +
        '<div class="next-foot"><span class="next-count">' + esc(relDays(next.start)) + '</span>' + statePill(next) + '</div></div></a>';
      if (rest.length) html += '<div class="rows rows-compact">' + rest.map(eventRow).join('') + '</div>';
    } else {
      html += empty('近期沒有排定的活動', '有新活動時會在這裡出現。');
    }
    html += '</section>';

    var news = S.news.filter(function (n) { return n.status === '發布'; }).slice(0, 3);
    html += '<section class="block"><div class="block-head"><h2>最新消息</h2><a href="#/news" data-tab="news">全部消息</a></div>' +
      (news.length ? '<div class="rows">' + news.map(newsRow).join('') + '</div>' : empty('還沒有消息', '')) + '</section>';
    if (S.birthdays.length) {
      var mon = S.birthdays[0].month;
      html += '<section class="block"><div class="block-head"><h2>' + mon + ' 月壽星</h2></div><ul class="bdays">' + S.birthdays.map(function (b) {
        return '<li' + (b.today ? ' class="is-today"' : '') + '><span class="bday-d">' + b.month + '/' + b.day + '</span><b>' + esc(b.name) + '</b>' +
          (b.today ? '<span class="pill is-alert">' + icon('cake') + '今天</span>' : '') + '</li>';
      }).join('') + '</ul></section>';
    }
    if (S.docs.length) {
      html += '<section class="block"><div class="block-head"><h2>文件</h2><a href="#/docs" data-go="docs">全部文件</a></div><div class="rows">' +
        S.docs.slice(0, 3).map(docRow).join('') + '</div></section>';
    }
    return html + '</main>';
  }

  /* ═════════════ 畫面：活動 ═════════════ */

  function viewEvents() {
    var f = S.evFilter;
    var list = S.events.filter(function (e) {
      if (f === 'mine') return !!e.myReg;
      if (f === 'past') return isPast(e);
      return !isPast(e);
    });
    if (f === 'past') list = list.slice().reverse();
    var seg = [['upcoming', '即將舉行'], ['mine', '我報名的'], ['past', '已結束']].map(function (s) {
      return '<button type="button" role="tab" aria-selected="' + (f === s[0]) + '" data-act="evFilter" data-v="' + s[0] + '">' + s[1] + '</button>';
    }).join('');
    var add = perm('eventManage') ? '<button type="button" class="btn btn-small" data-go="event-edit/new">' + icon('plus') + '新增活動</button>' : '';
    var emptyText = { upcoming: ['近期沒有排定的活動', '有新活動時會在這裡出現。'], mine: ['你還沒有報名任何活動', '到「即將舉行」挑一場吧。'], past: ['近 4 個月沒有已結束的活動', ''] }[f];
    return topbar() + '<main class="view"><div class="page-head"><h1 class="page-title">活動</h1>' + add + '</div>' +
      '<div class="seg" role="tablist" aria-label="活動篩選">' + seg + '</div>' +
      (list.length ? eventList(list) : empty(emptyText[0], emptyText[1])) + '</main>';
  }

  function viewEvent(r) {
    var id = r.a;
    var detail = ensure('event:' + id, function () { return Api.call('event', { id: id }); });
    var ev = detail && !detail.__error ? detail : S.events.filter(function (e) { return e.id === id; })[0];
    if (!ev) {
      if (detail && detail.__error) return topbar({ back: 'events', title: '活動' }) + '<main class="view">' + errorBlock(detail.__error) + '</main>';
      return topbar({ back: 'events', title: '活動' }) + '<main class="view">' + skeleton(4) + '</main>';
    }
    var past = isPast(ev);
    var html = topbar({ back: 'events', title: ev.category || '活動',
      actions: '<button type="button" class="iconbtn" data-act="share" data-id="' + esc(ev.id) + '" aria-label="分享">' + icon('share') + '</button>' });
    html += '<main class="view view-detail">';
    if (ev.imageUrl) html += '<img class="hero" src="' + esc(ev.imageUrl) + '" alt="">';
    html += '<div class="detail-head">' + catTag(ev.category) + '<h1>' + esc(ev.title) + '</h1>';
    if (ev.status === '取消') html += '<div class="banner is-danger">這場活動已取消</div>';
    if (ev.status === '草稿') html += '<div class="banner is-muted">草稿：只有能管理活動的幹部看得到</div>';
    html += '</div>';

    var facts = [];
    facts.push(['clock', fmtWhen(ev.start, ev.end), past ? '已結束' : relDays(ev.start)]);
    if (ev.location) {
      facts.push(['pin', ev.location, ev.mapUrl ? '<a href="' + esc(ev.mapUrl) + '" data-ext>' + icon('map') + '開啟地圖</a>' : '', true]);
    }
    if (ev.fee) facts.push(['coin', ev.fee, '']);
    if (ev.deadline) facts.push(['flag', '報名截止 ' + fmtDT(ev.deadline), Date.parse(ev.deadline) < Date.now() ? '已截止' : '']);
    var capText = ev.capacity > 0 ? '已報名 ' + ev.regCount + ' 人，名額 ' + ev.capacity + ' 人' : '已報名 ' + ev.regCount + ' 人';
    var bar = ev.capacity > 0 ? '<span class="capbar"><i style="width:' + Math.min(100, Math.round(ev.regCount / ev.capacity * 100)) + '%"></i></span>' : '';
    if (perm('viewRegs') && ev.audienceLevel > 0 && ev.unreplied) {
      bar = '<span class="replies"><b>' + ev.regPeople + '</b> 出席　<b>' + ev.leaveCount + '</b> 請假　<b>' + ev.unreplied.length + '</b> 未回覆</span>' + bar;
    }
    facts.push(['users', capText, bar, true]);
    if ((ev.checkinOpen || past) && (perm('viewRegs') || ev.attendedCount)) {
      facts.push(['checkcircle', '已報到 ' + ev.attendedCount + ' 人', ev.checkinOpen && !past ? '報到進行中' : '']);
    }
    if (ev.albumUrl) facts.push(['camera', '活動相簿', '<a href="' + esc(ev.albumUrl) + '" data-ext>' + icon('camera') + '看花絮照片</a>', true]);
    if (perm('eventManage')) facts.push(['eye', '可見對象：' + audienceLabel(ev.audience), '']);
    html += '<ul class="facts">' + facts.map(function (f) {
      return '<li>' + icon(f[0]) + '<div><b>' + esc(f[1]) + '</b>' + (f[2] ? '<span>' + (f[3] ? f[2] : esc(f[2])) + '</span>' : '') + '</div></li>';
    }).join('') + '</ul>';

    if (ev.description) html += '<div class="prose">' + richText(ev.description) + '</div>';

    if (ev.myReg) {
      var mr = ev.myReg;
      var leaving = mr.status === '請假';
      var head = leaving ? '你已回覆請假' : mr.attended ? '已報到 ' + fmtDT(mr.attended).replace(/^.*?）/, '') : '你已報名 ' + mr.count + ' 人';
      var sub = mr.note ? (leaving ? '原因：' : '備註：') + esc(mr.note) : '';
      var canChange = !isPast(ev) && ev.status === '發布' && !mr.attended && Date.parse(ev.start) > Date.now();
      html += '<div class="myreg' + (leaving ? ' is-leave' : '') + '">' + icon(leaving ? 'leave' : 'check') + '<div><b>' + head + '</b>' +
        (sub ? '<span>' + sub + '</span>' : '') + '</div>' +
        (canChange ? '<button type="button" class="btn btn-ghost btn-small" data-act="cancelReg" data-id="' + esc(ev.id) + '">' + (leaving ? '取消請假' : '取消報名') + '</button>' : '') + '</div>';
    }

    if (perm('viewRegs')) html += regList(ev, detail);

    if (perm('viewRegs') || perm('eventManage')) {
      var acts = [];
      if (perm('viewRegs') && ev.status === '發布' && !past) {
        acts.push('<button type="button" class="btn btn-ghost" data-act="checkinQr" data-id="' + esc(ev.id) + '">' + icon('qr') + '報到 QR code</button>');
      }
      if (perm('eventManage')) acts.push('<button type="button" class="btn btn-ghost" data-go="event-edit/' + esc(ev.id) + '">' + icon('edit') + '編輯活動</button>');
      if (canPush() && ev.regPeople) acts.push('<button type="button" class="btn btn-ghost" data-act="pushFor" data-type="event" data-id="' + esc(ev.id) + '">' + icon('send') + '通知報名者</button>');
      if (canPush() && ev.unreplied && ev.unreplied.some(function (u) { return u.bound; })) {
        acts.push('<button type="button" class="btn btn-ghost" data-act="pushFor" data-type="unreplied" data-id="' + esc(ev.id) + '">' + icon('send') + '催未回覆者</button>');
      }
      if (perm('eventManage') && ev.status !== '取消' && !past) acts.push('<button type="button" class="btn btn-ghost is-danger" data-act="cancelEvent" data-id="' + esc(ev.id) + '">' + icon('close') + '取消活動</button>');
      html += '<section class="manage"><h2>管理這場活動</h2><div class="manage-actions">' + acts.join('') + '</div></section>';
    }
    html += '</main>';

    // 底部動作列
    var main, isMeeting = ev.category === '理監事會';
    var verb = isMeeting ? '回覆出席' : '報名';
    if (ev.myReg && (ev.regOpen || (ev.leaveOpen && ev.myReg.status === '請假'))) main = '<button type="button" class="btn btn-primary" data-act="openRegister" data-id="' + esc(ev.id) + '">修改回覆</button>';
    else if (ev.regOpen) main = '<button type="button" class="btn btn-primary" data-act="openRegister" data-id="' + esc(ev.id) + '">' + verb + '</button>';
    else if (ev.leaveOpen && !ev.myReg && S.me.member) main = '<button type="button" class="btn btn-primary" data-act="openRegister" data-id="' + esc(ev.id) + '" data-leaveonly="1">無法出席，請假</button>';
    else if (ev.myReg) main = '<button type="button" class="btn btn-primary" disabled>' + (ev.myReg.status === '請假' ? '已請假' : ev.myReg.attended ? '已報到' : '已報名') + '</button>';
    else main = '<button type="button" class="btn btn-primary" disabled>' + esc(past ? '活動已結束' : ev.regClosedReason || '無法報名') + '</button>';
    html += '<div class="actionbar">' +
      (ev.icsUrl && !past && ev.status === '發布' ? '<button type="button" class="iconbtn" data-act="calendar" data-id="' + esc(ev.id) + '" aria-label="加入行事曆">' + icon('calplus') + '</button>' : '') +
      '<button type="button" class="btn btn-ghost" data-act="share" data-id="' + esc(ev.id) + '">' + icon('share') + '分享</button>' + main + '</div>';
    return html;
  }

  function regList(ev, detail) {
    var head = '<section class="reglist"><div class="block-head"><h2>報名名單</h2>';
    if (!detail) return head + '</div>' + skeleton(2) + '</section>';
    if (detail.__error) return head + '</div>' + errorBlock(detail.__error) + '</section>';
    var regs = detail.registrations || [], leaves = detail.leaves || [], unreplied = detail.unreplied;
    var marking = ev.status === '發布' && Date.parse(ev.start) - Date.now() < 86400000; // 活動前一天起可以點名
    head += regs.length ? '<button type="button" class="linkbtn" data-act="copyRegs" data-id="' + esc(ev.id) + '">' + icon('copy') + '複製名單</button>' : '';
    head += '</div>';
    var html = head;
    if (!regs.length) html += '<p class="muted">還沒有人報名。</p>';
    else {
      var guests = regs.filter(function (r) { return r.guest; }).length;
      html += '<p class="muted">共 ' + regs.length + ' 筆、' + detail.regCount + ' 人' + (guests ? '（含非會員 ' + guests + ' 筆）' : '') +
        (marking ? '，已報到 ' + detail.attendedCount + ' 人。點名字前的方框可標記出席' : '') + '</p>' +
        '<ol class="regs' + (marking ? ' is-marking' : '') + '">' + regs.map(function (r) {
          var box = marking ? '<input type="checkbox" class="att" data-act="toggleAttend" data-event="' + esc(ev.id) + '" data-reg="' + esc(r.regId) + '"' + (r.attended ? ' checked' : '') + ' aria-label="' + esc(r.name) + ' 出席">' : '';
          return '<li' + (r.attended ? ' class="is-attended"' : '') + '>' + box + '<div><b>' + esc(r.name) + '</b>' + (r.guest ? '<span class="tag">非會員</span>' : '') +
            (r.count > 1 ? '<span class="regs-n">' + r.count + ' 人</span>' : '') +
            (r.attended ? '<span class="regs-n is-ok">' + esc(r.checkinBy || '已報到') + '</span>' : '') +
            (r.note ? '<span class="regs-note">' + esc(r.note) + '</span>' : '') + '</div>' +
            (r.phone ? '<a class="iconbtn" href="tel:' + esc(r.phone) + '" aria-label="打電話給' + esc(r.name) + '">' + icon('phone') + '</a>' : '') + '</li>';
        }).join('') + '</ol>';
    }
    if (marking) html += '<button type="button" class="btn btn-ghost btn-small" data-act="walkin" data-id="' + esc(ev.id) + '">' + icon('plus') + '現場加入沒報名的會員</button>';
    if (leaves.length) {
      html += '<h3 class="sub-head">請假 ' + leaves.length + ' 人</h3><ol class="regs is-leave">' + leaves.map(function (r) {
        return '<li><div><b>' + esc(r.name) + '</b>' + (r.note ? '<span class="regs-note">' + esc(r.note) + '</span>' : '') + '</div></li>';
      }).join('') + '</ol>';
    }
    if (unreplied && unreplied.length) {
      html += '<h3 class="sub-head">未回覆 ' + unreplied.length + ' 人</h3><p class="names">' + unreplied.map(function (u) {
        return '<span' + (u.bound ? '' : ' class="is-unbound" title="尚未綁定 LINE"') + '>' + esc(u.name) + '</span>';
      }).join('') + '</p>' + (unreplied.some(function (u) { return !u.bound; }) ? '<p class="hint">灰色的人還沒綁定 LINE，收不到推播，請另外聯絡。</p>' : '');
    }
    return html + '</section>';
  }

  /* ═════════════ 畫面：活動編輯 ═════════════ */

  function audienceOptions(selected) {
    var myLevel = S.me.level;
    return S.roles.filter(function (r) { return r.level <= myLevel; }).map(function (r) {
      var label = r.level === 0 ? '公開（所有人都看得到）' : r.role + '以上';
      return '<option value="' + esc(r.role) + '"' + (r.role === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }
  function catOptions(list, selected) {
    return list.map(function (c) { return '<option' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }
  function field(label, input, hint, id) {
    return '<div class="field"><label' + (id ? ' for="' + id + '"' : '') + '>' + label + '</label>' + input + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
  }

  function viewEventEdit(r) {
    if (!perm('eventManage')) return forbidden();
    var isNew = r.a === 'new';
    var ev = isNew ? { category: '例會', audience: '會員', status: '發布', capacity: 0 } :
      S.events.filter(function (e) { return e.id === r.a; })[0];
    if (!ev) return topbar({ back: 'events', title: '編輯活動' }) + '<main class="view">' + empty('找不到這個活動', '') + '</main>';
    var html = topbar({ back: isNew ? 'events' : 'event/' + ev.id, title: isNew ? '新增活動' : '編輯活動' });
    html += '<main class="view"><form class="form" data-form="event" novalidate>' +
      '<input type="hidden" name="id" value="' + esc(ev.id || '') + '">' +
      field('活動名稱', '<input id="f-title" name="title" required maxlength="80" value="' + esc(ev.title || '') + '" placeholder="例如：十二月份月例會">', '', 'f-title') +
      field('類別', '<select id="f-cat" name="category">' + catOptions(S.categories.event, ev.category) + '</select>', '', 'f-cat') +
      '<div class="field-row">' +
      field('開始', '<input id="f-start" type="datetime-local" name="start" required value="' + toInput(ev.start) + '">', '', 'f-start') +
      field('結束', '<input id="f-end" type="datetime-local" name="end" value="' + toInput(ev.end) + '">', '', 'f-end') + '</div>' +
      field('地點', '<input id="f-loc" name="location" maxlength="100" value="' + esc(ev.location || '') + '">', '', 'f-loc') +
      field('地圖連結', '<input id="f-map" name="mapUrl" type="url" inputmode="url" value="' + esc(ev.mapUrl || '') + '" placeholder="https://maps.app.goo.gl/…">', '在 Google 地圖按「分享」複製連結貼上', 'f-map') +
      field('誰看得到', '<select id="f-aud" name="audience">' + audienceOptions(ev.audience) + '</select>', '選「公開」時，未綁定的訪客也能看到並報名', 'f-aud') +
      '<div class="field-row">' +
      field('名額', '<input id="f-cap" name="capacity" type="number" min="0" inputmode="numeric" value="' + (ev.capacity || '') + '" placeholder="不限">', '含攜伴人數，留空為不限', 'f-cap') +
      field('報名截止', '<input id="f-dl" type="datetime-local" name="deadline" value="' + toInput(ev.deadline) + '">', '', 'f-dl') + '</div>' +
      field('費用', '<input id="f-fee" name="fee" maxlength="40" value="' + esc(ev.fee || '') + '" placeholder="例如：會員免費，眷屬 300 元">', '', 'f-fee') +
      field('活動說明', '<textarea id="f-desc" name="description" rows="6" maxlength="3000">' + esc(ev.description || '') + '</textarea>', '', 'f-desc') +
      field('封面圖片網址', '<input id="f-img" name="imageUrl" type="url" inputmode="url" value="' + esc(ev.imageUrl || '') + '" placeholder="https://…">', '選填。需為 https 開頭的圖片網址，推播訊息也會顯示', 'f-img') +
      field('活動相簿連結', '<input id="f-album" name="albumUrl" type="url" inputmode="url" value="' + esc(ev.albumUrl || '') + '" placeholder="https://photos.app.goo.gl/…">', '活動結束後補上 Google 相簿的分享連結，活動頁會顯示「看花絮照片」', 'f-album') +
      '<fieldset class="field"><legend>狀態</legend><div class="radios">' +
      '<label><input type="radio" name="status" value="發布"' + (ev.status !== '草稿' ? ' checked' : '') + '>發布</label>' +
      '<label><input type="radio" name="status" value="草稿"' + (ev.status === '草稿' ? ' checked' : '') + '>草稿（只有幹部看得到）</label></div></fieldset>' +
      (canPush() ? '<label class="check"><input type="checkbox" name="notify"><span>儲存後用 LINE 通知看得到這場活動的會員<small>每位收件人用掉 1 則訊息額度</small></span></label>' : '') +
      '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">' + (isNew ? '建立活動' : '儲存變更') + '</button></div>' +
      '</form></main>';
    return html;
  }

  /* ═════════════ 畫面：消息 ═════════════ */

  function viewNews() {
    var cats = [''].concat(S.categories.news.filter(function (c) { return S.news.some(function (n) { return n.category === c; }); }));
    var list = S.news.filter(function (n) { return !S.newsCat || n.category === S.newsCat; });
    var chips = cats.length > 2 ? '<div class="chips" role="tablist" aria-label="消息分類">' + cats.map(function (c) {
      return '<button type="button" role="tab" aria-selected="' + (S.newsCat === c) + '" data-act="newsCat" data-v="' + esc(c) + '">' + esc(c || '全部') + '</button>';
    }).join('') + '</div>' : '';
    var add = perm('newsManage') ? '<button type="button" class="btn btn-small" data-go="news-edit/new">' + icon('plus') + '發布消息</button>' : '';
    return topbar() + '<main class="view"><div class="page-head"><h1 class="page-title">消息</h1>' + add + '</div>' + chips +
      (list.length ? '<div class="rows">' + list.map(newsRow).join('') + '</div>' : empty('還沒有消息', '')) + '</main>';
  }

  function viewNewsItem(r) {
    var n = S.news.filter(function (x) { return x.id === r.a; })[0];
    if (!n) return topbar({ back: 'news', title: '消息' }) + '<main class="view">' + empty('找不到這則消息', '可能已被刪除，或你沒有權限查看。') + '</main>';
    var html = topbar({ back: 'news', title: n.category });
    html += '<main class="view view-detail">' + (n.imageUrl ? '<img class="hero" src="' + esc(n.imageUrl) + '" alt="">' : '') +
      '<div class="detail-head">' + catTag(n.category) + '<h1>' + esc(n.title) + '</h1>' +
      '<p class="byline">' + (n.publishedAt ? fmtDate(n.publishedAt) : '草稿') + (n.createdBy ? '　' + esc(n.createdBy) : '') +
      (perm('newsManage') ? '　' + esc(audienceLabel(n.audience)) : '') + '</p>' +
      (n.status === '草稿' ? '<div class="banner is-muted">草稿：只有能管理消息的幹部看得到</div>' : '') + '</div>' +
      '<div class="prose">' + richText(n.content) + '</div>';
    if (perm('newsManage')) {
      html += '<section class="manage"><h2>管理這則消息</h2><div class="manage-actions">' +
        '<button type="button" class="btn btn-ghost" data-go="news-edit/' + esc(n.id) + '">' + icon('edit') + '編輯</button>' +
        (canPush() && n.status === '發布' ? '<button type="button" class="btn btn-ghost" data-act="pushFor" data-type="news" data-id="' + esc(n.id) + '">' + icon('send') + '推播這則消息</button>' : '') +
        '<button type="button" class="btn btn-ghost is-danger" data-act="deleteNews" data-id="' + esc(n.id) + '">' + icon('trash') + '刪除</button></div></section>';
    }
    return html + '</main>';
  }

  function viewNewsEdit(r) {
    if (!perm('newsManage')) return forbidden();
    var isNew = r.a === 'new';
    var n = isNew ? { category: '會務公告', audience: '會員', status: '發布' } : S.news.filter(function (x) { return x.id === r.a; })[0];
    if (!n) return topbar({ back: 'news', title: '編輯消息' }) + '<main class="view">' + empty('找不到這則消息', '') + '</main>';
    return topbar({ back: isNew ? 'news' : 'news/' + n.id, title: isNew ? '發布消息' : '編輯消息' }) +
      '<main class="view"><form class="form" data-form="news" novalidate><input type="hidden" name="id" value="' + esc(n.id || '') + '">' +
      field('標題', '<input id="n-title" name="title" required maxlength="80" value="' + esc(n.title || '') + '">', '', 'n-title') +
      field('類別', '<select id="n-cat" name="category">' + catOptions(S.categories.news, n.category) + '</select>', '', 'n-cat') +
      field('內容', '<textarea id="n-content" name="content" rows="9" required maxlength="5000">' + esc(n.content || '') + '</textarea>', '空一行會分段，網址會自動變成連結', 'n-content') +
      field('誰看得到', '<select id="n-aud" name="audience">' + audienceOptions(n.audience) + '</select>', '', 'n-aud') +
      field('圖片網址', '<input id="n-img" name="imageUrl" type="url" inputmode="url" value="' + esc(n.imageUrl || '') + '" placeholder="https://…">', '選填', 'n-img') +
      '<label class="check"><input type="checkbox" name="pinned"' + (n.pinned ? ' checked' : '') + '><span>置頂</span></label>' +
      '<fieldset class="field"><legend>狀態</legend><div class="radios">' +
      '<label><input type="radio" name="status" value="發布"' + (n.status !== '草稿' ? ' checked' : '') + '>發布</label>' +
      '<label><input type="radio" name="status" value="草稿"' + (n.status === '草稿' ? ' checked' : '') + '>草稿</label></div></fieldset>' +
      (canPush() ? '<label class="check"><input type="checkbox" name="notify"><span>發布後用 LINE 通知看得到的會員<small>每位收件人用掉 1 則訊息額度</small></span></label>' : '') +
      '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">' + (isNew ? '發布' : '儲存變更') + '</button></div></form></main>';
  }

  /* ═════════════ 畫面：文件庫 ═════════════ */

  function docRow(d) {
    var manage = perm('newsManage') ? '<button type="button" class="iconbtn" data-go="doc-edit/' + esc(d.id) + '" aria-label="編輯 ' + esc(d.title) + '">' + icon('edit') + '</button>' : '';
    return '<div class="drow doc-row"><a class="doc-main" href="' + esc(d.url) + '" data-ext>' + icon('doc') + '<div><b>' + esc(d.title) +
      (d.status === '草稿' ? '<span class="tag">草稿</span>' : '') + '</b>' +
      (d.description ? '<span>' + esc(d.description) + '</span>' : '') + '</div>' + icon('next', 'chev') + '</a>' + manage + '</div>';
  }

  function viewDocs() {
    var add = perm('newsManage') ? '<button type="button" class="btn btn-small" data-go="doc-edit/new">' + icon('plus') + '新增文件</button>' : '';
    var html = topbar({ back: 'me', title: '文件庫', actions: add }) + '<main class="view">';
    if (!S.docs.length) {
      html += empty('還沒有文件', perm('newsManage') ? '把章程、會議紀錄、表單的雲端硬碟連結加進來，會員就能在這裡找到。' : '秘書處放上文件後會在這裡出現。');
      return html + '</main>';
    }
    var groups = [], by = {};
    S.docs.forEach(function (d) {
      if (!by[d.category]) { by[d.category] = { cat: d.category, items: [] }; groups.push(by[d.category]); }
      by[d.category].items.push(d);
    });
    html += groups.map(function (g) {
      return '<h3 class="month">' + esc(g.cat) + '<small>' + g.items.length + ' 份</small></h3><div class="rows">' + g.items.map(docRow).join('') + '</div>';
    }).join('');
    return html + '</main>';
  }

  function viewDocEdit(r) {
    if (!perm('newsManage')) return forbidden();
    var isNew = r.a === 'new';
    var d = isNew ? { category: '章程規章', audience: '會員', status: '發布' } : S.docs.filter(function (x) { return x.id === r.a; })[0];
    if (!d) return topbar({ back: 'docs', title: '編輯文件' }) + '<main class="view">' + empty('找不到這份文件', '') + '</main>';
    return topbar({ back: 'docs', title: isNew ? '新增文件' : '編輯文件' }) +
      '<main class="view"><form class="form" data-form="doc" novalidate><input type="hidden" name="id" value="' + esc(d.id || '') + '">' +
      field('標題', '<input id="d-title" name="title" required maxlength="80" value="' + esc(d.title || '') + '" placeholder="例如：第 11 次理監事會議紀錄">', '', 'd-title') +
      field('分類', '<select id="d-cat" name="category">' + catOptions(S.categories.doc || [], d.category) + '</select>', '', 'd-cat') +
      field('連結', '<input id="d-url" name="url" type="url" inputmode="url" required value="' + esc(d.url || '') + '" placeholder="https://drive.google.com/…">',
        '把檔案放在 Google 雲端硬碟，按「共用 → 知道連結的使用者」後複製連結貼上', 'd-url') +
      field('說明（選填）', '<input id="d-desc" name="description" maxlength="300" value="' + esc(d.description || '') + '" placeholder="例如：2025 年會員大會修訂版">', '', 'd-desc') +
      field('誰看得到', '<select id="d-aud" name="audience">' + audienceOptions(d.audience) + '</select>', '會議紀錄建議選「幹部以上」', 'd-aud') +
      '<fieldset class="field"><legend>狀態</legend><div class="radios">' +
      '<label><input type="radio" name="status" value="發布"' + (d.status !== '草稿' ? ' checked' : '') + '>發布</label>' +
      '<label><input type="radio" name="status" value="草稿"' + (d.status === '草稿' ? ' checked' : '') + '>草稿</label></div></fieldset>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">' + (isNew ? '新增文件' : '儲存變更') + '</button></div>' +
      (isNew ? '' : '<button type="button" class="btn btn-ghost is-danger btn-block" data-act="deleteDoc" data-id="' + esc(d.id) + '">' + icon('trash') + '刪除這份文件</button>') +
      '</form></main>';
  }

  /* ═════════════ 畫面：出席統計 ═════════════ */

  function viewAttendance() {
    if (!perm('viewRegs')) return forbidden();
    var year = S.attYear || new Date().getFullYear();
    var key = 'att:' + year;
    var d = ensure(key, function () { return Api.call('attendanceStats', { year: year }); });
    var html = topbar({ back: 'me', title: '出席統計' }) + '<main class="view">';
    var thisYear = new Date().getFullYear();
    html += '<div class="seg" role="tablist" aria-label="年度">' + [thisYear, thisYear - 1].map(function (y) {
      return '<button type="button" role="tab" aria-selected="' + (y === year) + '" data-act="attYear" data-v="' + y + '">' + y + ' 年</button>';
    }).join('') + '</div>';
    if (!d) return html + skeleton(6) + '</main>';
    if (d.__error) return html + errorBlock(d.__error) + '</main>';
    html += '<p class="summary">' + d.year + ' 年已舉行例會 <b>' + d.meetingTotal + '</b> 場，其他活動 <b>' + d.otherTotal + '</b> 場。出席以掃碼報到或幹部點名為準。</p>';
    if (!d.meetingTotal && !d.otherTotal) return html + empty('這一年還沒有已舉行的活動', '') + '</main>';
    html += '<div class="att-table"><div class="att-head"><span>會員</span><span>例會</span><span>其他</span></div>' + d.members.map(function (m) {
      var pct = d.meetingTotal ? Math.round(m.meetingAttended / d.meetingTotal * 100) : 0;
      return '<div class="att-line"><div class="att-name"><b>' + esc(m.name) + '</b><span>' + esc(m.role) + '</span></div>' +
        '<div class="att-cell"><b>' + m.meetingAttended + '</b><small>／' + d.meetingTotal + '</small><span class="capbar' + (d.meetingTotal && pct < 50 ? ' is-alert' : '') + '"><i style="width:' + pct + '%"></i></span></div>' +
        '<div class="att-cell"><b>' + m.otherAttended + '</b><small>／' + d.otherTotal + '</small></div></div>';
    }).join('') + '</div>';
    html += '<button type="button" class="btn btn-ghost btn-block" data-act="copyAtt" data-year="' + year + '">' + icon('copy') + '複製統計表</button>';
    return html + '</main>';
  }

  /* ═════════════ 畫面：通訊錄 ═════════════ */

  function viewDirectory() {
    if (!perm('directory')) {
      return topbar() + '<main class="view"><h1 class="page-title">會員通訊錄</h1>' + empty('通訊錄只開放給會員', '完成會員綁定後就能查看。', '<button type="button" class="btn btn-ghost" data-tab="me">前往綁定</button>') + '</main>';
    }
    var list = ensure('directory', function () { return Api.call('directory'); });
    var body;
    if (!list) body = skeleton(5);
    else if (list.__error) body = errorBlock(list.__error);
    else body = '<div id="dir-list">' + directoryList(list) + '</div>';
    var chips = '';
    if (list && !list.__error) {
      var inds = [];
      list.forEach(function (m) { if (m.industry && inds.indexOf(m.industry) < 0) inds.push(m.industry); });
      if (inds.length > 1) {
        chips = '<div class="chips" role="tablist" aria-label="行業"><button type="button" role="tab" aria-selected="' + (!S.dirIndustry) + '" data-act="dirIndustry" data-v="">全部</button>' +
          inds.map(function (i) { return '<button type="button" role="tab" aria-selected="' + (S.dirIndustry === i) + '" data-act="dirIndustry" data-v="' + esc(i) + '">' + esc(i) + '</button>'; }).join('') + '</div>';
      }
    }
    return topbar() + '<main class="view"><h1 class="page-title">會員通訊錄</h1>' +
      '<div class="search">' + icon('search') + '<input type="search" data-filter="dir" placeholder="搜尋姓名、職稱、公司" value="' + esc(S.dirQuery) + '" aria-label="搜尋會員"></div>' +
      chips + body + '</main>';
  }

  function directoryList(list) {
    var q = S.dirQuery.trim().toLowerCase();
    if (S.dirIndustry) list = list.filter(function (m) { return m.industry === S.dirIndustry; });
    if (q) list = list.filter(function (m) { return (m.name + m.title + m.company + m.role + (m.industry || '')).toLowerCase().indexOf(q) >= 0; });
    if (!list.length) return empty('找不到符合的會員', '換個關鍵字或行業試試。');
    // 同一個角色的人放在同一組；組的順序依「權限」表：等級高的在前，同等級照表上的列順序
    var rank = {};
    S.roles.slice().sort(function (a, b) { return b.level - a.level; })
      .forEach(function (r, i) { rank[r.role] = i; });
    var byRole = {}, groups = [];
    list.forEach(function (m) {
      if (!byRole[m.role]) { byRole[m.role] = { role: m.role, items: [] }; groups.push(byRole[m.role]); }
      byRole[m.role].items.push(m);
    });
    groups.sort(function (a, b) {
      var ra = rank[a.role], rb = rank[b.role];
      if (ra === undefined || rb === undefined) return (ra === undefined) - (rb === undefined) || a.role.localeCompare(b.role);
      return ra - rb;
    });
    groups.forEach(function (g) { g.items.sort(byName); });
    return groups.map(function (g) {
      return '<h3 class="month">' + esc(g.role) + '<small>' + g.items.length + ' 位</small></h3><div class="rows">' + g.items.map(function (m) {
        return '<details class="drow"><summary><span class="avatar avatar-txt">' + esc(m.name.charAt(0)) + '</span><div class="drow-main"><b>' + esc(m.name) + '</b>' +
          '<span>' + esc([m.title, m.company].filter(Boolean).join('　')) + '</span></div>' +
          (m.phone ? '<a class="iconbtn" href="tel:' + esc(m.phone) + '" aria-label="打電話給' + esc(m.name) + '">' + icon('phone') + '</a>' : '') + '</summary>' +
          '<dl class="drow-more">' + (m.phone ? '<div><dt>手機</dt><dd><a href="tel:' + esc(m.phone) + '">' + esc(m.phone) + '</a></dd></div>' : '') +
          (m.email ? '<div><dt>Email</dt><dd><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a></dd></div>' : '') +
          (m.company ? '<div><dt>公司</dt><dd>' + esc(m.company) + '</dd></div>' : '') +
          (m.industry ? '<div><dt>行業</dt><dd>' + esc(m.industry) + '</dd></div>' : '') +
          (m.joinYear ? '<div><dt>入會</dt><dd>' + esc(m.joinYear) + ' 年</dd></div>' : '') +
          '<div><dt>會員編號</dt><dd>' + esc(m.id) + '</dd></div></dl></details>';
      }).join('') + '</div>';
    }).join('');
  }

  /* ═════════════ 畫面：我的 ═════════════ */

  function bindSection() {
    var me = S.me;
    if (me.member) return '';
    if (me.disabled) return '<section class="block"><div class="banner is-danger">這個 LINE 帳號對應的會員目前停用中。如有疑問請洽秘書處。</div></section>';
    if (me.pendingRequest) {
      return '<section class="block card"><h2>綁定申請審核中</h2><p class="muted">你在 ' + fmtDate(me.pendingRequest.createdAt) +
        ' 以「' + esc(me.pendingRequest.name) + '」送出申請，秘書處確認後會用 LINE 通知你。</p></section>';
    }
    var nf = S.bindResult;
    var html = '<section class="block card" id="bind"><h2>綁定會員身分</h2>' +
      '<p class="muted">輸入入會時登記的姓名與手機，系統比對會員名冊後立即完成綁定。</p>' +
      '<form class="form" data-form="bind" novalidate>' +
      field('姓名', '<input id="b-name" name="name" autocomplete="name" required value="' + esc(nf ? nf.name : '') + '">', '', 'b-name') +
      field('手機', '<input id="b-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="0912345678" value="' + esc(nf ? nf.phone : '') + '">', '', 'b-phone') +
      '<button type="submit" class="btn btn-primary btn-block">綁定</button>' +
      (S.demo ? '<p class="hint">示範：輸入「' + Mock.bindHint.name + '」與「' + Mock.bindHint.phone + '」可綁定成功</p>' : '') + '</form>';
    if (nf) {
      html += '<div class="notfound"><p><b>名冊裡找不到「' + esc(nf.name) + '／' + esc(nf.phone) + '」。</b></p>' +
        '<p>請確認與入會資料相同。如果你是新朋友，或手機號碼已變更，可以送出申請，由秘書處協助綁定。</p>' +
        '<form class="form" data-form="bindRequest" novalidate><input type="hidden" name="name" value="' + esc(nf.name) + '"><input type="hidden" name="phone" value="' + esc(nf.phone) + '">' +
        field('給秘書處的話（選填）', '<textarea id="b-note" name="note" rows="2" maxlength="200" placeholder="例如：去年參加過淨灘，想了解入會"></textarea>', '', 'b-note') +
        '<button type="submit" class="btn btn-ghost btn-block">送出申請</button></form></div>';
    }
    return html + '</section>';
  }

  function profileSection(me) {
    var m = me.member, a = me.attendance;
    var rows = [['公司／職業', m.company], ['行業', m.industry], ['Email', m.email], ['生日', m.birthday ? m.birthday.replace(/-/g, '/') : '']];
    var filled = rows.filter(function (r) { return r[1]; });
    var html = '<section class="block card profile-card"><div class="block-head"><h2>我的資料</h2>' +
      '<button type="button" class="linkbtn" data-act="editMe">' + icon('edit') + '編輯</button></div>';
    html += filled.length ? '<dl class="kv">' + filled.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>'
      : '<p class="muted">補上公司、行業與生日，會友才找得到你，壽星祝福也才收得到。</p>';
    if (a && (a.meetingTotal || a.otherTotal)) {
      var pct = a.meetingTotal ? Math.round(a.meetingAttended / a.meetingTotal * 100) : 0;
      html += '<div class="att-me"><div class="att-row"><span>' + a.year + ' 年例會出席</span><b>' + a.meetingAttended + '／' + a.meetingTotal + '</b></div>' +
        (a.meetingTotal ? '<span class="capbar"><i style="width:' + pct + '%"></i></span>' : '') +
        (a.otherTotal ? '<div class="att-row muted"><span>其他活動出席</span><b>' + a.otherAttended + '／' + a.otherTotal + '</b></div>' : '') + '</div>';
    }
    return html + '</section>';
  }

  function viewMe() {
    var me = S.me;
    var html = topbar() + '<main class="view"><h1 class="page-title">我的</h1>';
    html += '<section class="profile">' + avatar(me, 56) + '<div><b>' + esc(me.member ? me.member.name : me.lineName) + '</b>' +
      '<span>' + esc(me.role) + (me.member && me.member.title ? '　' + esc(me.member.title) : '') + '</span>' +
      (me.member ? '<span class="muted">LINE：' + esc(me.lineName) + '</span>' : '') + '</div></section>';
    html += bindSection();
    if (me.member) html += profileSection(me);
    html += friendNotice();

    var mine = S.events.filter(function (e) { return e.myReg && !isPast(e); });
    html += '<section class="block"><div class="block-head"><h2>我報名的活動</h2></div>' +
      (mine.length ? '<div class="rows rows-compact">' + mine.map(eventRow).join('') + '</div>' : '<p class="muted">目前沒有即將參加的活動。</p>') + '</section>';

    if (S.docs.length || perm('newsManage')) {
      html += '<section class="block"><div class="menu"><button type="button" class="menu-item" data-go="docs">' + icon('doc') + '<div><b>文件庫</b><span>' +
        (S.docs.length ? '章程、會議紀錄、表單等 ' + S.docs.length + ' 份' : '還沒有文件') + '</span></div>' + icon('next', 'chev') + '</button></div></section>';
    }

    if (anyAdmin() || perm('viewRegs')) {
      var items = [];
      if (canPush()) items.push(['admin/push', 'send', '發送通知', '依角色或活動推播 LINE 訊息']);
      if (perm('eventManage')) items.push(['event-edit/new', 'calendar', '新增活動', '']);
      if (perm('newsManage')) items.push(['news-edit/new', 'edit', '發布消息', '']);
      if (perm('viewRegs')) items.push(['admin/attendance', 'chart', '出席統計', '全年例會出席率']);
      if (perm('memberManage')) {
        items.push(['admin/requests', 'inbox', '綁定審核', S.pendingCount ? S.pendingCount + ' 筆待處理' : '沒有待處理的申請', S.pendingCount]);
        items.push(['admin/members', 'users', '會員管理', '角色、狀態、LINE 綁定']);
      }
      html += '<section class="block"><div class="block-head"><h2>' + (anyAdmin() ? '管理功能' : '幹部功能') + '</h2></div><div class="menu">' + items.map(function (it) {
        return '<button type="button" class="menu-item" data-go="' + it[0] + '">' + icon(it[1]) + '<div><b>' + it[2] + '</b>' + (it[3] ? '<span>' + esc(it[3]) + '</span>' : '') + '</div>' +
          (it[4] ? '<i class="count">' + it[4] + '</i>' : '') + icon('next', 'chev') + '</button>';
      }).join('') + '</div></section>';
    }

    html += '<section class="block about"><p>' + esc(CFG.ORG_NAME) + ' 會員專區</p>';
    if (S.demo) html += '<p>目前是示範模式，資料不會儲存。<button type="button" class="linkbtn" data-act="demoReset">還原示範資料</button></p>';
    else if (!Api.isInClient()) html += '<p><button type="button" class="linkbtn" data-act="logout">登出 LINE</button></p>';
    return html + '</section></main>';
  }

  /* ═════════════ 畫面：發送通知 ═════════════ */

  function pushDefaults() {
    return { mode: 'all', roles: [], eventId: '', title: '', text: '', linkType: 'home', linkId: '', linkUrl: '', preview: null, previewKey: '' };
  }

  function viewPush() {
    if (!perm('push')) return forbidden();
    if (!S.pushReady) {
      return topbar({ back: 'me', title: '發送通知' }) + '<main class="view">' +
        empty('還沒連接 LINE 官方帳號', '建立官方帳號並在試算表選單「設定 LINE 金鑰」填入 Channel access token、重新部署後，就能發送通知。') + '</main>';
    }
    var p = S.push || (S.push = pushDefaults());
    var log = ensure('pushLog', function () { return Api.call('pushLog'); });
    var upcoming = S.events.filter(function (e) { return e.status !== '草稿'; }).slice().reverse();
    var roleChips = S.roles.filter(function (r) { return r.level > 0; }).slice().reverse().map(function (r) {
      return '<label class="chip-check"><input type="checkbox" name="roles" value="' + esc(r.role) + '"' + (p.roles.indexOf(r.role) >= 0 ? ' checked' : '') + '><span>' + esc(r.role) + '</span></label>';
    }).join('');
    var evOpts = '<option value="">選擇活動</option>' + upcoming.map(function (e) {
      return '<option value="' + esc(e.id) + '"' + (p.eventId === e.id ? ' selected' : '') + '>' + esc(fmtMD(e.start) + ' ' + e.title + (e.audienceLevel > 0 ? '' : '（公開）')) + '</option>';
    }).join('');
    var newsOpts = '<option value="">選擇消息</option>' + S.news.filter(function (n) { return n.status === '發布'; }).map(function (n) {
      return '<option value="' + esc(n.id) + '"' + (p.linkType === 'news' && p.linkId === n.id ? ' selected' : '') + '>' + esc(n.title) + '</option>';
    }).join('');
    var linkEvOpts = '<option value="">選擇活動</option>' + upcoming.map(function (e) {
      return '<option value="' + esc(e.id) + '"' + (p.linkType === 'event' && p.linkId === e.id ? ' selected' : '') + '>' + esc(fmtMD(e.start) + ' ' + e.title) + '</option>';
    }).join('');
    function radio(v, label, sub) {
      return '<label class="choice"><input type="radio" name="mode" value="' + v + '"' + (p.mode === v ? ' checked' : '') + '><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
    }

    var html = topbar({ back: 'me', title: '發送通知' }) + '<main class="view"><form class="form push" data-form="push" novalidate>';
    html += '<div id="quota" class="quota">' + quotaHtml(p.preview) + '</div>';
    html += '<section class="step"><h2><span class="step-n">1</span>發給誰</h2><div class="choices">' +
      radio('all', '全體已綁定會員', '') +
      radio('roles', '指定角色', '') + '<div class="choice-more" data-show="roles"><div class="chips">' + roleChips + '</div></div>' +
      radio('event', '活動報名者', '') + '<div class="choice-more" data-show="event"><select name="eventId" aria-label="活動">' + evOpts + '</select></div>' +
      radio('eventUnreplied', '活動未回覆者', '限會員以上的活動，提醒還沒回覆出席或請假的人') + '<div class="choice-more" data-show="eventUnreplied"><select name="eventId2" aria-label="活動">' + evOpts + '</select></div>' +
      radio('friends', '所有加入官方帳號的好友', '包含非會員，人數最多、額度用得最快') +
      '</div><p class="estimate" id="estimate" aria-live="polite">' + estimateHtml(p.preview) + '</p></section>';
    html += '<section class="step"><h2><span class="step-n">2</span>內容</h2>' +
      field('標題', '<input id="p-title" name="title" maxlength="60" required value="' + esc(p.title) + '" placeholder="例如：例會改地點通知">', '', 'p-title') +
      field('內容', '<textarea id="p-text" name="text" rows="5" maxlength="1000" required>' + esc(p.text) + '</textarea>', '<span id="p-count">' + p.text.length + '</span>／1000 字', 'p-text') +
      field('訊息按鈕', '<select id="p-link" name="linkType">' +
        [['none', '不附按鈕'], ['home', '開啟會員專區'], ['event', '查看活動'], ['news', '閱讀消息'], ['url', '開啟網址']].map(function (o) {
          return '<option value="' + o[0] + '"' + (p.linkType === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>', '', 'p-link') +
      '<div class="choice-more" data-showlink="event"><select name="linkEvent" aria-label="連結的活動">' + linkEvOpts + '</select></div>' +
      '<div class="choice-more" data-showlink="news"><select name="linkNews" aria-label="連結的消息">' + newsOpts + '</select></div>' +
      '<div class="choice-more" data-showlink="url"><input name="linkUrl" type="url" inputmode="url" placeholder="https://…" value="' + esc(p.linkUrl) + '" aria-label="網址"></div>' +
      '</section>';
    html += '<section class="step"><h2><span class="step-n">3</span>預覽與發送</h2><div id="lp">' + linePreview(p) + '</div>' +
      '<button type="submit" class="btn btn-primary btn-block" id="p-send">' + icon('send') + '發送</button></section>';
    html += '</form>';

    html += '<section class="block"><div class="block-head"><h2>最近發送紀錄</h2></div>';
    if (!log) html += skeleton(2);
    else if (log.__error) html += errorBlock(log.__error);
    else if (!log.length) html += '<p class="muted">還沒有發送紀錄。</p>';
    else html += '<ol class="log">' + log.map(function (l) {
      return '<li><div><b>' + esc(l.title) + '</b><span>' + esc(l.audience) + '　' + (l.recipients === null ? '' : l.recipients + ' 人') + '</span></div>' +
        '<div class="log-side"><time>' + fmtDT(l.time) + '</time><span>' + esc(l.sender) + '</span>' +
        (l.result !== 'OK' ? '<span class="pill is-danger">失敗</span>' : '') + '</div></li>';
    }).join('') + '</ol>';
    return html + '</section></main>';
  }

  function quotaHtml(pv) {
    if (!pv || !pv.quota) return '<span class="muted">正在查詢本月訊息額度…</span>';
    var q = pv.quota;
    if (q.limit === null && q.used === null) return '<span class="muted">無法取得訊息額度' + (q.error ? '（' + esc(q.error) + '）' : '') + '</span>';
    if (q.limit === null) return '<span>本月已發送 <b>' + q.used + '</b> 則（無上限方案）</span>';
    var pct = Math.min(100, Math.round(q.used / q.limit * 100));
    return '<div class="quota-row"><span>本月訊息額度</span><span><b>' + q.used + '</b>／' + q.limit + ' 則</span></div>' +
      '<span class="capbar' + (pct > 80 ? ' is-alert' : '') + '"><i style="width:' + pct + '%"></i></span>';
  }
  function estimateHtml(pv) {
    if (!pv) return '計算收件人數中…';
    if (pv.error) return '<span class="is-danger-text">' + esc(pv.error) + '</span>';
    var n = pv.recipients;
    if (n === null || n === undefined) return '會發給所有好友，人數以 LINE 統計為準';
    var rem = pv.quota && pv.quota.remaining;
    var txt = '預計發給 <b>' + n + '</b> 人，用掉 ' + n + ' 則額度';
    if (pv.broadcast) txt = '預計約 <b>' + n + '</b> 位好友（依昨日統計），用掉約 ' + n + ' 則額度';
    if (rem !== null && rem !== undefined && n > rem) txt += '<span class="is-danger-text">，超過本月剩餘的 ' + rem + ' 則</span>';
    if (n === 0) txt = '目前沒有符合的收件人（對方需先完成 LINE 綁定）';
    return txt;
  }
  function linePreview(p) {
    var labels = { home: '開啟會員專區', event: '查看活動', news: '閱讀全文', url: '開啟連結' };
    var btn = p.linkType !== 'none' ? '<div class="lp-foot"><span class="lp-btn">' + labels[p.linkType] + '</span></div>' : '';
    return '<div class="lp" aria-label="LINE 訊息預覽"><span class="lp-avatar">' + logo('') + '</span><div class="lp-bubble"><div class="lp-body">' +
      '<div class="lp-org">' + esc(CFG.ORG_NAME) + '</div><div class="lp-title">' + (esc(p.title) || '<span class="muted">（標題）</span>') + '</div>' +
      '<div class="lp-text">' + (esc(p.text).replace(/\n/g, '<br>') || '<span class="muted">（內容）</span>') + '</div></div>' + btn + '</div></div>';
  }

  function readPushForm(form) {
    var p = S.push;
    var fd = new FormData(form);
    p.mode = fd.get('mode') || 'all';
    p.roles = fd.getAll('roles');
    p.eventId = (p.mode === 'eventUnreplied' ? fd.get('eventId2') : fd.get('eventId')) || '';
    p.title = fd.get('title') || '';
    p.text = fd.get('text') || '';
    p.linkType = fd.get('linkType') || 'none';
    p.linkId = p.linkType === 'event' ? fd.get('linkEvent') : p.linkType === 'news' ? fd.get('linkNews') : '';
    p.linkUrl = fd.get('linkUrl') || '';
    form.querySelectorAll('[data-show]').forEach(function (el) { el.hidden = el.getAttribute('data-show') !== p.mode; });
    form.querySelectorAll('[data-showlink]').forEach(function (el) { el.hidden = el.getAttribute('data-showlink') !== p.linkType; });
  }
  function pushAudience() {
    var p = S.push;
    if (p.mode === 'roles') return { mode: 'roles', roles: p.roles };
    if (p.mode === 'event' || p.mode === 'eventUnreplied') return { mode: p.mode, eventId: p.eventId };
    return { mode: p.mode };
  }
  var previewTimer = null;
  function refreshPushPreview() {
    var p = S.push;
    var key = JSON.stringify(pushAudience());
    if (key === p.previewKey && p.preview) return;
    var est = document.getElementById('estimate');
    if ((p.mode === 'roles' && !p.roles.length) || ((p.mode === 'event' || p.mode === 'eventUnreplied') && !p.eventId)) {
      p.preview = Object.assign({}, p.preview || {}, { recipients: 0, error: p.mode === 'roles' ? '請至少選一個角色' : '請選擇活動' });
      p.previewKey = '';
      if (est) est.innerHTML = estimateHtml(p.preview);
      return;
    }
    clearTimeout(previewTimer);
    if (est) est.innerHTML = '計算收件人數中…';
    previewTimer = setTimeout(function () {
      Api.call('pushPreview', { audience: pushAudience() }).then(function (pv) {
        p.preview = pv;
        p.previewKey = key;
      }, function (e) {
        p.preview = { error: e.message };
        p.previewKey = '';
      }).then(function () {
        var q = document.getElementById('quota'), es = document.getElementById('estimate');
        if (q) q.innerHTML = quotaHtml(p.preview);
        if (es) es.innerHTML = estimateHtml(p.preview);
      });
    }, 350);
  }

  /* ═════════════ 畫面：會員管理 ═════════════ */

  function viewMembers() {
    if (!perm('memberManage')) return forbidden();
    var list = ensure('members', function () { return Api.call('members'); });
    var html = topbar({ back: 'me', title: '會員管理' }) + '<main class="view">';
    if (!list) return html + skeleton(6) + '</main>';
    if (list.__error) return html + errorBlock(list.__error) + '</main>';
    var bound = list.filter(function (m) { return m.bound; }).length;
    html += '<p class="summary">會員 <b>' + list.length + '</b> 位，已綁定 LINE <b>' + bound + '</b> 位' +
      (list.length - bound ? '，還有 ' + (list.length - bound) + ' 位未綁定' : '') + '</p>';
    var filters = [['', '全部'], ['unbound', '未綁定'], ['disabled', '已停用']].concat(S.roles.filter(function (r) { return r.level > 0; }).slice().reverse().map(function (r) { return [r.role, r.role]; }));
    html += '<div class="search">' + icon('search') + '<input type="search" data-filter="mem" placeholder="搜尋姓名、手機、編號" value="' + esc(S.memQuery) + '" aria-label="搜尋會員"></div>' +
      '<div class="chips" role="tablist" aria-label="篩選">' + filters.map(function (f) {
        return '<button type="button" role="tab" aria-selected="' + (S.memFilter === f[0]) + '" data-act="memFilter" data-v="' + esc(f[0]) + '">' + esc(f[1]) + '</button>';
      }).join('') + '</div>';
    html += '<div id="mem-list">' + memberRows(list) + '</div>';
    html += '<p class="hint">新增會員、修改姓名或手機，請直接在試算表的「會員」工作表編輯。</p>';
    return html + '</main>';
  }

  function memberRows(list) {
    var q = S.memQuery.trim().toLowerCase(), f = S.memFilter;
    list = list.filter(function (m) {
      if (f === 'unbound' && m.bound) return false;
      if (f === 'disabled' && m.status !== '停用') return false;
      if (f && f !== 'unbound' && f !== 'disabled' && m.role !== f) return false;
      return !q || (m.name + m.phone + m.id + m.title).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) return empty('沒有符合的會員', '');
    list = list.slice().sort(byLevelThenName);
    return '<div class="rows">' + list.map(function (m) {
      return '<button type="button" class="mrow' + (m.status === '停用' ? ' is-disabled' : '') + '" data-act="editMember" data-id="' + esc(m.id) + '">' +
        '<div class="mrow-main"><b>' + esc(m.name) + '</b><span>' + esc(m.id) + '　' + esc(m.phone) + '</span></div>' +
        '<div class="mrow-side"><span class="role-tag">' + esc(m.role || '未設定') + (m.roleKnown ? '' : '⚠') + '</span>' +
        '<span class="bound' + (m.bound ? ' is-on' : '') + '">' + (m.status === '停用' ? '已停用' : m.bound ? '已綁定' : '未綁定') + '</span></div></button>';
    }).join('') + '</div>';
  }

  function memberSheet(m) {
    var roles = S.roles.filter(function (r) { return r.level > 0 && r.level <= S.me.level; }).slice().reverse();
    return '<h2 class="sheet-title">' + esc(m.name) + '<small>' + esc(m.id) + '　' + esc(m.phone) + '</small></h2>' +
      '<form class="form" data-form="member" novalidate><input type="hidden" name="id" value="' + esc(m.id) + '">' +
      field('角色', '<select id="m-role" name="role">' + roles.map(function (r) {
        return '<option' + (r.role === m.role ? ' selected' : '') + '>' + esc(r.role) + '</option>';
      }).join('') + '</select>', '角色決定能看到哪些內容、能使用哪些管理功能', 'm-role') +
      field('職稱', '<input id="m-title" name="title" maxlength="40" value="' + esc(m.title) + '" placeholder="例如：理事、公關主委">', '', 'm-title') +
      '<label class="check"><input type="checkbox" name="disabled"' + (m.status === '停用' ? ' checked' : '') + '><span>停用這位會員<small>停用後只能看到公開內容，也不會收到會員推播</small></span></label>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">儲存</button></div></form>' +
      '<div class="sheet-sub"><p><b>LINE 綁定</b>　' + (m.bound ? esc(m.lineName || '已綁定') + '（' + fmtDate(m.boundAt) + '）' : '尚未綁定') + '</p>' +
      (m.bound ? '<button type="button" class="btn btn-ghost is-danger btn-block" data-act="unbind" data-id="' + esc(m.id) + '">解除 LINE 綁定</button><p class="hint">會員換手機或換 LINE 帳號時使用，解除後請對方重新綁定。</p>' : '') + '</div>';
  }

  /* ═════════════ 畫面：綁定審核 ═════════════ */

  function viewRequests() {
    if (!perm('memberManage')) return forbidden();
    var d = ensure('requests', function () { return Api.call('requests'); });
    var html = topbar({ back: 'me', title: '綁定審核' }) + '<main class="view">';
    if (!d) return html + skeleton(3) + '</main>';
    if (d.__error) return html + errorBlock(d.__error) + '</main>';
    html += '<p class="summary">名冊比對不到的人會出現在這裡。確認身分後可以綁到既有會員，或新增為會員。</p>';
    if (!d.pending.length) html += empty('沒有待處理的申請', '');
    else html += d.pending.map(function (q) {
      return '<article class="req card"><div class="req-head"><b>' + esc(q.name) + '</b><time>' + fmtDT(q.createdAt) + '</time></div>' +
        '<dl class="req-info"><div><dt>手機</dt><dd><a href="tel:' + esc(q.phone) + '">' + esc(q.phone) + '</a></dd></div>' +
        '<div><dt>LINE 名稱</dt><dd>' + esc(q.lineName || '—') + '</dd></div>' +
        (q.note ? '<div><dt>留言</dt><dd>' + esc(q.note) + '</dd></div>' : '') + '</dl>' +
        '<div class="req-actions"><button type="button" class="btn btn-ghost btn-small" data-act="reqLink" data-id="' + esc(q.id) + '">綁到既有會員</button>' +
        '<button type="button" class="btn btn-ghost btn-small" data-act="reqCreate" data-id="' + esc(q.id) + '">新增為會員</button>' +
        '<button type="button" class="btn btn-ghost btn-small is-danger" data-act="reqReject" data-id="' + esc(q.id) + '">拒絕</button></div></article>';
    }).join('');
    if (d.handled.length) {
      html += '<details class="handled"><summary>已處理（' + d.handled.length + '）</summary><ol class="log">' + d.handled.map(function (q) {
        return '<li><div><b>' + esc(q.name) + '</b><span>' + esc(q.status) + (q.memberId ? '　' + esc(q.memberId) : '') + '</span></div>' +
          '<div class="log-side"><time>' + fmtDT(q.handledAt) + '</time><span>' + esc(q.handledBy) + '</span></div></li>';
      }).join('') + '</ol></details>';
    }
    return html + '</main>';
  }

  /* ═════════════ 主要 render ═════════════ */

  var VIEWS = {
    home: viewHome, events: viewEvents, event: viewEvent, 'event-edit': viewEventEdit,
    news: function (r) { return r.a ? viewNewsItem(r) : viewNews(); },
    'news-edit': viewNewsEdit, directory: viewDirectory, me: viewMe, checkin: viewCheckin,
    docs: viewDocs, 'doc-edit': viewDocEdit,
    admin: function (r) {
      if (r.a === 'push') return viewPush();
      if (r.a === 'members') return viewMembers();
      if (r.a === 'requests') return viewRequests();
      if (r.a === 'attendance') return viewAttendance();
      return viewMe();
    }
  };

  function render() {
    if (!S.ready) return;
    var r = route();
    var fn = VIEWS[r.name] || viewHome;
    var html;
    try {
      html = fn(r);
    } catch (e) {
      console.error(e);
      html = topbar({ back: 'home', title: '' }) + '<main class="view">' + errorBlock(e) + '</main>';
    }
    var focusSel = null;
    var ae = document.activeElement;
    if (ae && ae.matches && ae.matches('input[data-filter]')) focusSel = 'input[data-filter="' + ae.getAttribute('data-filter') + '"]';
    $app.innerHTML = demoBar() + html;
    var isRoot = !!ROOTS[r.name] && !(r.name === 'news' && r.a);
    renderTabbar(r, isRoot);
    document.body.classList.toggle('has-tabbar', isRoot);
    document.body.classList.toggle('has-actionbar', !!$app.querySelector('.actionbar'));
    if (r.path !== lastPath) {
      window.scrollTo(0, 0);
      lastPath = r.path;
    }
    if (focusSel) {
      var el = $app.querySelector(focusSel);
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
    var pf = $app.querySelector('form[data-form="push"]');
    if (pf) { readPushForm(pf); refreshPushPreview(); }
  }

  function renderTabbar(r, isRoot) {
    var tabs = [['home', '首頁', 'home'], ['events', '活動', 'calendar'], ['news', '消息', 'news']];
    if (perm('directory')) tabs.push(['directory', '通訊錄', 'book']);
    tabs.push(['me', '我的', 'user']);
    $tabbar.hidden = !isRoot;
    $tabbar.innerHTML = tabs.map(function (t) {
      var badge = t[0] === 'me' && S.pendingCount ? '<i class="badge" aria-label="' + S.pendingCount + ' 筆待審核">' + S.pendingCount + '</i>' : '';
      return '<a class="tab" href="#/' + t[0] + '" data-tab="' + t[0] + '"' + (r.name === t[0] ? ' aria-current="page"' : '') + '>' + icon(t[2]) + '<span>' + t[1] + '</span>' + badge + '</a>';
    }).join('');
  }

  /* ═════════════ 對話框、提示 ═════════════ */

  var toastTimer = null;
  function toast(msg, kind) {
    $toast.textContent = msg;
    $toast.className = 'toast show' + (kind ? ' is-' + kind : '');
    $toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.className = 'toast'; }, kind === 'error' ? 4200 : 2600);
  }
  function fail(e) {
    toast(e && e.message ? e.message : '發生錯誤，請再試一次', 'error');
  }

  var sheetResolve = null;
  var sheetReturnFocus = null;
  function openSheet(html, label) {
    sheetReturnFocus = document.activeElement;
    $layer.innerHTML = '<div class="scrim" data-act="closeSheet"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(label || '') + '">' +
      '<button type="button" class="iconbtn sheet-close" data-act="closeSheet" aria-label="關閉">' + icon('close') + '</button>' + html + '</div>';
    $layer.hidden = false;
    document.body.classList.add('sheet-open');
    requestAnimationFrame(function () {
      $layer.classList.add('open');
      var f = $layer.querySelector('input:not([type=hidden]),select,textarea,button[type=submit]');
      if (f && f.tagName !== 'BUTTON') f.focus(); else $layer.querySelector('.sheet').focus();
    });
  }
  function closeSheet(result) {
    if (!$layer.classList.contains('open') && $layer.hidden) return;
    $layer.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(function () { $layer.hidden = true; $layer.innerHTML = ''; }, 220);
    if (sheetResolve) { var r = sheetResolve; sheetResolve = null; r(result || null); }
    if (sheetReturnFocus && sheetReturnFocus.focus) try { sheetReturnFocus.focus(); } catch (e) { /* ignore */ }
  }
  /** 確認對話框：回傳 Promise<FormData|null> */
  function confirmSheet(o) {
    return new Promise(function (resolve) {
      openSheet('<h2 class="sheet-title">' + esc(o.title) + '</h2>' + (o.body ? '<p class="sheet-text">' + o.body + '</p>' : '') +
        '<form class="form" data-form="__confirm" novalidate>' + (o.extra || '') +
        '<div class="form-actions two"><button type="button" class="btn btn-ghost" data-act="closeSheet">' + esc(o.cancel || '返回') + '</button>' +
        '<button type="submit" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '">' + esc(o.ok) + '</button></div></form>', o.title);
      sheetResolve = resolve;
    });
  }

  function busy(btn, promise) {
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    return promise.then(function (v) {
      if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
      return v;
    }, function (e) {
      if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
      throw e;
    });
  }

  function copyText(text) {
    var done = function () { toast('已複製'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    }
    fallbackCopy(text);
    done();
    return Promise.resolve();
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /** 儲存結果提示：通知被略過時，後端訊息已包含「活動已儲存」之類的前綴 */
  function saveToast(prefix, push) {
    if (push && push.skipped) return toast(push.message, /沒有送出/.test(push.message) ? 'error' : '');
    toast(prefix + (push ? '，已通知 ' + push.sent + ' 人' : ''));
  }

  function gcalStamp(iso) {
    return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function googleCalUrl(ev) {
    var end = ev.end || new Date(Date.parse(ev.start) + 7200000).toISOString();
    var details = (ev.description ? ev.description + '\n\n' : '') + '報名與詳情：' + Api.liffUrl('event/' + ev.id);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.title) +
      '&dates=' + gcalStamp(ev.start) + '/' + gcalStamp(end) + '&details=' + encodeURIComponent(details) +
      (ev.location ? '&location=' + encodeURIComponent(ev.location) : '') + '&ctz=Asia/Taipei';
  }
  function qrSvg(text) {
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (e) {
      return '<p class="muted">無法產生 QR code</p>';
    }
  }
  function qrSheet(ev, q) {
    var when = q.open ? '<span class="pill is-ok">報到進行中</span>' : '<span class="pill is-muted">報到時間：' + fmtDT(q.from) + ' 起</span>';
    return '<div class="qr-head"><span class="qr-label">' + icon('qr') + '活動報到</span><h2 class="qr-title">' + esc(ev ? ev.title : '') + '</h2>' +
      (ev && ev.start ? '<p class="qr-when">' + esc(fmtWhen(ev.start, ev.end)) + (ev.location ? '<br>' + esc(ev.location) : '') + '</p>' : '') + '</div>' +
      '<div class="qr-box">' + qrSvg(q.url) + '</div>' +
      '<p class="qr-code">報到碼 <b>' + esc(q.code) + '</b></p><p class="sheet-text" style="text-align:center">' + when + '</p>' +
      '<p class="hint">把這個畫面投影或列印在報到桌，會員用 LINE 掃描（LINE 首頁右上角的掃描）就能自己報到。報到時間為活動開始前 2 小時到結束後 3 小時。</p>' +
      '<div class="form-actions two"><button type="button" class="btn btn-ghost" data-act="copyText" data-text="' + esc(q.url) + '">' + icon('copy') + '複製連結</button>' +
      '<button type="button" class="btn btn-ghost" data-act="checkinQr" data-id="' + esc(ev ? ev.id : '') + '" data-renew="1">' + icon('refresh') + '換一組報到碼</button></div>' +
      '<p class="hint">換報到碼後，舊的 QR code 就失效，適合用在有人把連結外流的時候。</p>';
  }
  function walkinRows(cands, q) {
    q = (q || '').trim().toLowerCase();
    var list = cands.filter(function (m) { return !q || (m.name + m.role + m.company).toLowerCase().indexOf(q) >= 0; }).slice(0, 40);
    if (!list.length) return '<p class="muted" style="padding:14px">沒有符合的會員</p>';
    return list.map(function (m) {
      return '<button type="button" class="menu-item" data-act="walkinPick" data-id="' + esc(m.id) + '"><span class="avatar avatar-txt">' + esc(m.name.charAt(0)) + '</span><div><b>' + esc(m.name) + '</b><span>' + esc(m.role + (m.title ? '　' + m.title : '')) + '</span></div>' + icon('plus', 'chev') + '</button>';
    }).join('');
  }

  /* ═════════════ 畫面：掃碼報到 ═════════════ */

  function viewCheckin(r) {
    var id = r.a, code = r.b;
    var detail = ensure('event:' + id, function () { return Api.call('event', { id: id }); });
    var html = topbar({ back: 'events', title: '活動報到' }) + '<main class="view view-checkin">';
    if (!detail) return html + skeleton(3) + '</main>';
    if (detail.__error) return html + errorBlock(detail.__error) + '</main>';
    var ev = detail;
    var done = S.checkinDone[id];
    html += '<div class="checkin-card">' + catTag(ev.category) + '<h1>' + esc(ev.title) + '</h1>' +
      '<p class="muted">' + esc(fmtWhen(ev.start, ev.end)) + (ev.location ? '　' + esc(ev.location) : '') + '</p>';
    var mr = ev.myReg;
    if ((mr && mr.attended) || (done && done.at)) {
      html += '<div class="checkin-ok">' + icon('checkcircle') + '<b>' + (done && done.already ? '你已經報到過了' : '報到完成') + '</b>' +
        '<span>' + esc(S.me.member ? S.me.member.name : S.me.lineName) + '　' + fmtDT((mr && mr.attended) || done.at).replace(/^.*?）/, '') + '</span></div>' +
        '<a class="btn btn-ghost btn-block" href="#/event/' + encodeURIComponent(ev.id) + '" data-nav>查看活動</a>';
    } else if (done && done.error) {
      html += '<div class="banner is-danger">' + esc(done.error) + '</div>' +
        '<button type="button" class="btn btn-primary btn-block" data-act="doCheckin" data-event="' + esc(id) + '" data-code="' + esc(code) + '">再試一次</button>';
    } else if (!S.me.member && !mr) {
      html += '<div class="banner is-muted">你還沒有綁定會員身分，也沒有報名這場活動。</div>' +
        (ev.regOpen ? '<a class="btn btn-primary btn-block" href="#/event/' + encodeURIComponent(ev.id) + '" data-nav>先去報名</a>' : '') +
        '<a class="btn btn-ghost btn-block" href="#/me" data-nav>綁定會員身分</a>';
    } else if (!ev.checkinOpen) {
      html += '<div class="banner is-muted">目前不在報到時間。報到開放：' + esc(fmtDT(ev.checkinFrom)) + ' 到 ' + esc(fmtDT(ev.checkinTo)) + '</div>';
    } else {
      html += '<p class="sheet-text">' + esc(S.me.member ? S.me.member.name : S.me.lineName) + (mr ? '，你已報名 ' + mr.count + ' 人' : mr === null && S.me.member ? '，你沒有事先報名，報到後會自動補登' : '') + '</p>' +
        '<button type="button" class="btn btn-primary btn-block btn-big" data-act="doCheckin" data-event="' + esc(id) + '" data-code="' + esc(code) + '">' + icon('scan') + '我到了，報到</button>';
    }
    return html + '</div></main>';
  }

  /** 分享到 LINE 聊天室用的 Flex 訊息 */
  function shareFlex(ev) {
    var rows = [['時間', fmtWhen(ev.start, ev.end)]];
    if (ev.location) rows.push(['地點', ev.location]);
    if (ev.fee) rows.push(['費用', ev.fee]);
    var bubble = {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: CFG.ORG_NAME + '｜' + (ev.category || '活動'), size: 'xs', color: '#0567B1', weight: 'bold', wrap: true },
        { type: 'text', text: ev.title, size: 'lg', weight: 'bold', wrap: true, color: '#13243A' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: rows.map(function (r) {
          return { type: 'box', layout: 'baseline', spacing: 'md', contents: [
            { type: 'text', text: r[0], size: 'sm', color: '#8A94A3', flex: 2 },
            { type: 'text', text: r[1], size: 'sm', color: '#13243A', flex: 7, wrap: true }] };
        }) }] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#0567B1', height: 'sm', action: { type: 'uri', label: '查看與報名', uri: Api.liffUrl('event/' + ev.id) } }] }
    };
    if (ev.imageUrl) bubble.hero = { type: 'image', url: ev.imageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
    return [{ type: 'flex', altText: '【活動】' + ev.title, contents: bubble }];
  }

  function findEvent(id) {
    var d = S.cache['event:' + id];
    return d && !d.__error ? d : S.events.filter(function (e) { return e.id === id; })[0];
  }

  /* ═════════════ 動作 ═════════════ */

  var ACTS = {
    back: function (el) { back(el.getAttribute('data-parent')); },
    closeSheet: function () { closeSheet(null); },
    refresh: function (el) {
      busy(el, reloadAll()).then(function () { toast('已更新'); }, fail);
    },
    retry: function () { S.cache = {}; reloadAll().catch(fail); },
    logout: function () { Api.logout(); },
    demoRole: function () {
      openSheet('<h2 class="sheet-title">切換示範身分</h2><p class="sheet-text">同一個畫面，不同角色看到的內容與功能不同。</p><div class="menu">' +
        Mock.roleNames().map(function (r) {
          return '<button type="button" class="menu-item" data-act="demoPick" data-v="' + esc(r) + '"><div><b>' + esc(r) + '</b><span>' +
            esc((S.roles.filter(function (x) { return x.role === r; })[0] || {}).desc || '') + '</span></div>' + (Mock.getRole() === r ? icon('check', 'chev') : '') + '</button>';
        }).join('') + '</div>', '切換示範身分');
    },
    demoPick: function (el) {
      Mock.setRole(el.getAttribute('data-v'));
      closeSheet();
      S.bindResult = null;
      S.push = null;
      reloadAll().then(function () { toast('目前身分：' + Mock.getRole()); }, fail);
    },
    demoReset: function () {
      Mock.reset();
      S.bindResult = null;
      reloadAll().then(function () { toast('示範資料已還原'); }, fail);
    },
    addFriend: function () {
      if (S.demo) {
        Mock.setFriend(true);
        S.friend = true;
        render();
        toast('示範：已加入好友');
        return;
      }
      Api.openExternal(Api.addFriendUrl());
    },
    evFilter: function (el) { S.evFilter = el.getAttribute('data-v'); render(); },
    newsCat: function (el) { S.newsCat = el.getAttribute('data-v'); render(); },
    memFilter: function (el) { S.memFilter = el.getAttribute('data-v'); render(); },
    dirIndustry: function (el) { S.dirIndustry = el.getAttribute('data-v'); render(); },
    attYear: function (el) { S.attYear = Number(el.getAttribute('data-v')); render(); },
    copyAtt: function (el) {
      var d = S.cache['att:' + el.getAttribute('data-year')];
      if (!d || !d.members) return;
      var lines = [d.year + ' 年出席統計（例會 ' + d.meetingTotal + ' 場、其他活動 ' + d.otherTotal + ' 場）', '姓名\t角色\t例會出席\t其他活動'];
      d.members.forEach(function (m) { lines.push(m.name + '\t' + m.role + '\t' + m.meetingAttended + '/' + d.meetingTotal + '\t' + m.otherAttended + '/' + d.otherTotal); });
      copyText(lines.join('\n'));
    },
    editMe: function () {
      var m = S.me.member;
      if (!m) return;
      var list = '<datalist id="ind-list">' + (S.industries || []).map(function (i) { return '<option value="' + esc(i) + '">'; }).join('') + '</datalist>';
      openSheet('<h2 class="sheet-title">編輯我的資料<small>姓名與手機如需修改請洽秘書處</small></h2>' +
        '<form class="form" data-form="updateMe" novalidate>' +
        field('公司／職業', '<input id="u-company" name="company" maxlength="60" value="' + esc(m.company) + '" autocomplete="organization">', '', 'u-company') +
        field('行業', '<input id="u-industry" name="industry" maxlength="30" list="ind-list" value="' + esc(m.industry) + '" placeholder="選擇或自行輸入">' + list, '會友在通訊錄可以依行業找到你', 'u-industry') +
        field('Email', '<input id="u-email" name="email" type="email" inputmode="email" maxlength="80" value="' + esc(m.email) + '" autocomplete="email">', '', 'u-email') +
        field('生日', '<input id="u-birthday" name="birthday" type="date" value="' + esc(m.birthday) + '" max="' + new Date().toISOString().slice(0, 10) + '">', '生日當天會收到祝福；首頁的「本月壽星」只顯示月日，不顯示年份', 'u-birthday') +
        '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">儲存</button></div></form>', '編輯我的資料');
    },
    deleteDoc: function (el) {
      var id = el.getAttribute('data-id');
      var d = S.docs.filter(function (x) { return x.id === id; })[0];
      confirmSheet({ title: '刪除這份文件？', body: '「' + esc(d ? d.title : '') + '」會從文件庫移除，雲端硬碟上的檔案不受影響。', ok: '刪除', danger: true }).then(function (fd) {
        if (!fd) return;
        return Api.call('deleteDoc', { id: id }).then(function (res) {
          S.docs = res.docs || S.docs.filter(function (x) { return x.id !== id; });
          go('docs', true);
          toast('文件已刪除');
        });
      }).catch(fail);
    },
    openRegister: function (el) {
      var ev = findEvent(el.getAttribute('data-id'));
      if (!ev) return;
      var me = S.me;
      var leaveOnly = el.getAttribute('data-leaveonly') === '1';
      var wasLeave = !!(ev.myReg && ev.myReg.status === '請假');
      var mode = leaveOnly || wasLeave ? 'leave' : 'attend';
      var count = ev.myReg && !wasLeave ? ev.myReg.count : 1;
      var who = me.member
        ? '<p class="sheet-text">' + esc(me.member.name) + '（' + esc(me.member.id) + '）</p>'
        : field('姓名', '<input id="r-name" name="name" required autocomplete="name">', '', 'r-name') +
          field('手機', '<input id="r-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="0912345678">', '主辦單位聯絡你用，不會公開', 'r-phone');
      var canAttend = ev.regOpen, canLeave = ev.leaveOpen && !!me.member;
      var seg = canAttend && canLeave ? '<div class="seg seg-reply" role="radiogroup" aria-label="回覆">' +
        '<label><input type="radio" name="reply" value="出席"' + (mode === 'attend' ? ' checked' : '') + '><span>' + icon('check') + '出席</span></label>' +
        '<label><input type="radio" name="reply" value="請假"' + (mode === 'leave' ? ' checked' : '') + '><span>' + icon('leave') + '請假</span></label></div>'
        : '<input type="hidden" name="reply" value="' + (canAttend ? '出席' : '請假') + '">';
      if (!canAttend) mode = 'leave';
      var attendFields = '<div data-reply="出席"' + (mode !== 'attend' ? ' hidden' : '') + '>' +
        '<div class="field"><label for="r-count">人數（含本人）</label><div class="stepper">' +
        '<button type="button" class="iconbtn" data-act="step" data-d="-1" aria-label="減少">' + icon('minus') + '</button>' +
        '<input id="r-count" name="count" type="number" min="1" max="10" inputmode="numeric" value="' + count + '">' +
        '<button type="button" class="iconbtn" data-act="step" data-d="1" aria-label="增加">' + icon('plus') + '</button></div></div>' +
        field('備註', '<textarea id="r-note" name="note" rows="2" maxlength="200" placeholder="例如：吃素、攜伴姓名">' + esc(ev.myReg && !wasLeave ? ev.myReg.note : '') + '</textarea>', '', 'r-note') + '</div>';
      var leaveFields = '<div data-reply="請假"' + (mode !== 'leave' ? ' hidden' : '') + '>' +
        field('請假原因（選填）', '<textarea id="r-reason" name="reason" rows="2" maxlength="200" placeholder="例如：出差、家裡有事">' + esc(wasLeave ? ev.myReg.note : '') + '</textarea>', '會顯示給幹部，不會公開', 'r-reason') + '</div>';
      openSheet('<h2 class="sheet-title">' + (ev.myReg ? '修改回覆' : ev.category === '理監事會' ? '回覆出席' : '報名') + '<small>' + esc(ev.title) + '</small></h2>' +
        '<form class="form" data-form="register" novalidate><input type="hidden" name="eventId" value="' + esc(ev.id) + '">' + who + seg + attendFields + leaveFields +
        '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">' + (mode === 'leave' ? '送出請假' : ev.myReg ? '更新報名' : '確認報名') + '</button></div></form>', '報名');
    },
    step: function (el) {
      var input = el.parentNode.querySelector('input');
      var v = Math.max(1, Math.min(10, (parseInt(input.value, 10) || 1) + Number(el.getAttribute('data-d'))));
      input.value = v;
    },
    cancelReg: function (el) {
      var id = el.getAttribute('data-id');
      var ev = findEvent(id);
      var leaving = !!(ev && ev.myReg && ev.myReg.status === '請假');
      confirmSheet(leaving
        ? { title: '取消請假？', body: '「' + esc(ev.title) + '」會回到未回覆狀態。', ok: '取消請假', cancel: '返回', danger: true }
        : { title: '取消報名？', body: '「' + esc(ev ? ev.title : '') + '」的報名會被取消，名額會釋出給其他人。', ok: '取消報名', cancel: '保留報名', danger: true })
        .then(function (fd) {
          if (!fd) return;
          return Api.call('cancelRegistration', { eventId: id }).then(function (ev2) {
            upsertEvent(ev2);
            render();
            toast(leaving ? '已取消請假' : '已取消報名');
          });
        }).catch(fail);
    },
    calendar: function (el) {
      var ev = findEvent(el.getAttribute('data-id'));
      if (!ev) return;
      var g = googleCalUrl(ev);
      openSheet('<h2 class="sheet-title">加入行事曆<small>' + esc(ev.title) + '</small></h2><div class="menu">' +
        '<button type="button" class="menu-item" data-act="openUrl" data-url="' + esc(g) + '">' + icon('calendar') + '<div><b>Google 日曆</b><span>Android 手機、或有安裝 Google 日曆</span></div>' + icon('next', 'chev') + '</button>' +
        (ev.icsUrl ? '<button type="button" class="menu-item" data-act="openUrl" data-url="' + esc(ev.icsUrl) + '">' + icon('calplus') + '<div><b>iPhone 行事曆</b><span>下載行事曆檔後按「加入」</span></div>' + icon('next', 'chev') + '</button>' : '') +
        '</div>', '加入行事曆');
    },
    openUrl: function (el) {
      closeSheet();
      Api.openExternal(el.getAttribute('data-url'));
    },
    checkinQr: function (el) {
      var id = el.getAttribute('data-id');
      var ev = findEvent(id);
      busy(el, Api.call('checkinQr', { eventId: id, renew: el.getAttribute('data-renew') === '1' })).then(function (q) {
        if (ev) { ev.checkin = { code: q.code, url: q.url }; }
        openSheet(qrSheet(ev, q), '報到 QR code');
      }).catch(fail);
    },
    toggleAttend: function (el) {
      var eventId = el.getAttribute('data-event'), regId = el.getAttribute('data-reg');
      var on = el.checked;
      el.disabled = true;
      Api.call('setAttendance', { eventId: eventId, regId: regId, attended: on }).then(function (ev) {
        upsertEvent(ev);
        render();
      }).catch(function (e) { el.checked = !on; el.disabled = false; fail(e); });
    },
    walkin: function (el) {
      var id = el.getAttribute('data-id');
      var d = S.cache['event:' + id];
      var listP = S.cache.directory && !S.cache.directory.__error ? Promise.resolve(S.cache.directory)
        : Api.call('directory').then(function (l) { S.cache.directory = l; return l; });
      busy(el, listP).then(function (list) {
        var have = {};
        ((d && d.registrations) || []).forEach(function (r) { if (r.memberId) have[r.memberId] = 1; });
        ((d && d.leaves) || []).forEach(function (r) { if (r.memberId) have[r.memberId] = 1; });
        var cands = list.filter(function (m) { return !have[m.id]; });
        openSheet('<h2 class="sheet-title">現場加入<small>選擇到場但沒報名的會員</small></h2>' +
          '<div class="search">' + icon('search') + '<input type="search" data-filter="walkin" placeholder="搜尋姓名" aria-label="搜尋會員"></div>' +
          '<div id="walkin-list" class="menu">' + walkinRows(cands, '') + '</div>', '現場加入');
        S.walkinCands = cands;
        S.walkinEvent = id;
      }).catch(fail);
    },
    walkinPick: function (el) {
      var memberId = el.getAttribute('data-id');
      busy(el, Api.call('setAttendance', { eventId: S.walkinEvent, memberId: memberId })).then(function (ev) {
        upsertEvent(ev);
        closeSheet();
        render();
        toast('已標記出席');
      }).catch(fail);
    },
    doCheckin: function (el) {
      var eventId = el.getAttribute('data-event'), code = el.getAttribute('data-code');
      busy(el, Api.call('checkin', { eventId: eventId, code: code })).then(function (res) {
        upsertEvent(res.event);
        S.checkinDone[eventId] = { at: res.event.myReg && res.event.myReg.attended, already: res.already };
        render();
        // 更新「我的」出席次數
        Api.call('init').then(function (d) { S.me = d.me; S.events = d.events || S.events; if (route().name === 'me') render(); }).catch(function () {});
      }).catch(function (e) {
        S.checkinDone[eventId] = { error: e.message };
        render();
      });
    },
    share: function (el) {
      var ev = findEvent(el.getAttribute('data-id'));
      if (!ev) return;
      if (Api.canShare()) {
        Api.share(shareFlex(ev)).then(function (res) { if (res) toast('已分享'); }, function () {
          copyText(Api.liffUrl('event/' + ev.id));
        });
      } else {
        copyText(ev.title + '\n' + fmtWhen(ev.start, ev.end) + (ev.location ? '\n' + ev.location : '') + '\n' + Api.liffUrl('event/' + ev.id));
      }
    },
    copyText: function (el) { copyText(el.getAttribute('data-text') || ''); },
    copyRegs: function (el) {
      var d = S.cache['event:' + el.getAttribute('data-id')];
      if (!d || !d.registrations) return;
      var lines = [d.title + '　報名名單（共 ' + d.regCount + ' 人）'];
      d.registrations.forEach(function (r, i) {
        lines.push((i + 1) + '. ' + r.name + (r.count > 1 ? ' ×' + r.count : '') + '　' + r.phone + (r.note ? '　' + r.note : '') + (r.guest ? '　(非會員)' : ''));
      });
      copyText(lines.join('\n'));
    },
    cancelEvent: function (el) {
      var id = el.getAttribute('data-id');
      var ev = findEvent(id);
      var extra = field('取消原因（選填）', '<input id="c-reason" name="reason" maxlength="200" placeholder="例如：颱風停班停課">', '', 'c-reason') +
        (canPush() && ev.regPeople ? '<label class="check"><input type="checkbox" name="notify" checked><span>通知 ' + ev.regPeople + ' 位報名者<small>用掉 ' + ev.regPeople + ' 則訊息額度</small></span></label>' : '');
      confirmSheet({ title: '取消這場活動？', body: '「' + esc(ev.title) + '」會標示為已取消，無法再報名。', ok: '取消活動', cancel: '返回', danger: true, extra: extra })
        .then(function (fd) {
          if (!fd) return;
          return Api.call('cancelEvent', { id: id, notify: fd.get('notify') === 'on', reason: fd.get('reason') || '' }).then(function (res) {
            upsertEvent(res.event);
            render();
            saveToast('活動已取消', res.push);
          });
        }).catch(fail);
    },
    deleteNews: function (el) {
      var id = el.getAttribute('data-id');
      confirmSheet({ title: '刪除這則消息？', body: '刪除後無法復原。', ok: '刪除', danger: true }).then(function (fd) {
        if (!fd) return;
        return Api.call('deleteNews', { id: id }).then(function () {
          S.news = S.news.filter(function (n) { return n.id !== id; });
          go('news', true);
          toast('消息已刪除');
        });
      }).catch(fail);
    },
    pushFor: function (el) {
      var type = el.getAttribute('data-type'), id = el.getAttribute('data-id');
      S.push = pushDefaults();
      if (type === 'event' || type === 'unreplied') {
        var ev = findEvent(id);
        Object.assign(S.push, { mode: type === 'unreplied' ? 'eventUnreplied' : 'event', eventId: id, linkType: 'event', linkId: id,
          title: ev ? (type === 'unreplied' ? '請回覆：' + ev.title : ev.title + ' 通知') : '',
          text: ev && type === 'unreplied' ? fmtWhen(ev.start, ev.end) + (ev.location ? ' ' + ev.location : '') + '\n請到會員專區回覆出席或請假，謝謝。' : '' });
      } else {
        var n = S.news.filter(function (x) { return x.id === id; })[0];
        Object.assign(S.push, { mode: 'all', linkType: 'news', linkId: id, title: n ? n.title : '', text: n ? excerpt(n.content, 120) : '' });
      }
      go('admin/push');
    },
    editMember: function (el) {
      var list = S.cache.members;
      var m = list && list.filter ? list.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0] : null;
      if (m) openSheet(memberSheet(m), '編輯會員');
    },
    unbind: function (el) {
      var id = el.getAttribute('data-id');
      closeSheet();
      setTimeout(function () {
        confirmSheet({ title: '解除 LINE 綁定？', body: '解除後，對方需要重新用姓名與手機綁定。', ok: '解除綁定', danger: true }).then(function (fd) {
          if (!fd) return;
          return Api.call('unbindMember', { id: id }).then(function (m) {
            replaceMember(m);
            toast('已解除綁定');
          });
        }).catch(fail);
      }, 240);
    },
    reqLink: function (el) {
      var q = findRequest(el.getAttribute('data-id'));
      if (!q) return;
      var membersP = S.cache.members && !S.cache.members.__error ? Promise.resolve(S.cache.members) : Api.call('members').then(function (l) { S.cache.members = l; return l; });
      busy(el, membersP).then(function (list) {
        var cands = list.filter(function (m) { return !m.bound && m.status !== '停用' && m.level <= S.me.level; });
        cands.sort(function (a, b) { return score(b, q) - score(a, q); });
        openSheet('<h2 class="sheet-title">綁到既有會員<small>' + esc(q.name) + '　' + esc(q.phone) + '</small></h2>' +
          (cands.length ? '<form class="form" data-form="reqLink" novalidate><input type="hidden" name="id" value="' + esc(q.id) + '">' +
            field('選擇會員（只列出尚未綁定的）', '<select id="q-mem" name="memberId">' + cands.map(function (m) {
              return '<option value="' + esc(m.id) + '">' + esc(m.name + '　' + m.id + '　' + m.phone) + '</option>';
            }).join('') + '</select>', '姓名或手機相符的會員排在最前面', 'q-mem') +
            (S.pushReady ? '<label class="check"><input type="checkbox" name="notify" checked><span>用 LINE 通知申請人<small>用掉 1 則訊息額度</small></span></label>' : '') +
            '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">綁定</button></div></form>'
            : empty('沒有尚未綁定的會員', '可以改用「新增為會員」。')), '綁到既有會員');
      }).catch(fail);
    },
    reqCreate: function (el) {
      var q = findRequest(el.getAttribute('data-id'));
      if (!q) return;
      var roles = S.roles.filter(function (r) { return r.level > 0 && r.level <= S.me.level; }).slice().reverse();
      openSheet('<h2 class="sheet-title">新增為會員<small>' + esc(q.name) + '　' + esc(q.phone) + '</small></h2>' +
        '<form class="form" data-form="reqCreate" novalidate><input type="hidden" name="id" value="' + esc(q.id) + '">' +
        field('角色', '<select id="q-role" name="role">' + roles.map(function (r) {
          return '<option' + (r.role === '預備會員' ? ' selected' : '') + '>' + esc(r.role) + '</option>';
        }).join('') + '</select>', '', 'q-role') +
        field('職稱（選填）', '<input id="q-title" name="title" maxlength="40">', '', 'q-title') +
        (S.pushReady ? '<label class="check"><input type="checkbox" name="notify" checked><span>用 LINE 通知申請人<small>用掉 1 則訊息額度</small></span></label>' : '') +
        '<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">新增並綁定</button></div></form>', '新增為會員');
    },
    reqReject: function (el) {
      var id = el.getAttribute('data-id');
      var q = findRequest(id);
      confirmSheet({ title: '拒絕這筆申請？', body: '「' + esc(q ? q.name : '') + '」的申請會被標記為已拒絕，不會通知對方。', ok: '拒絕', danger: true }).then(function (fd) {
        if (!fd) return;
        return Api.call('handleRequest', { id: id, decision: 'reject' }).then(afterRequest);
      }).catch(fail);
    }
  };

  function score(m, q) {
    return (m.name === q.name ? 2 : 0) + (m.phone === q.phone ? 2 : 0) + (m.name.charAt(0) === q.name.charAt(0) ? 0.5 : 0);
  }
  function findRequest(id) {
    var d = S.cache.requests;
    return d && d.pending ? d.pending.filter(function (q) { return q.id === id; })[0] : null;
  }
  function afterRequest(res) {
    S.cache.requests = res.requests;
    delete S.cache.members;
    S.pendingCount = res.requests.pending.length;
    closeSheet();
    render();
    toast(res.decision === 'reject' ? '已拒絕' : '已完成綁定' + (res.notifyError ? '，但通知失敗：' + res.notifyError : ''));
  }
  function replaceMember(m) {
    var list = S.cache.members;
    if (list && list.map) S.cache.members = list.map(function (x) { return x.id === m.id ? m : x; });
    render();
  }

  /* ═════════════ 表單 ═════════════ */

  var FORMS = {
    __confirm: function (form) {
      var fd = new FormData(form);
      var r = sheetResolve;
      sheetResolve = null;
      closeSheet();
      if (r) r(fd);
    },
    bind: function (form, btn) {
      var fd = new FormData(form);
      var name = String(fd.get('name') || '').trim(), phone = String(fd.get('phone') || '').trim();
      if (!name || !phone) { toast('請輸入姓名與手機', 'error'); return; }
      busy(btn, Api.call('bind', { name: name, phone: phone })).then(function (res) {
        if (res.status === 'bound') {
          S.bindResult = null;
          return reloadAll().then(function () { go('home', true); toast('綁定完成，歡迎回來'); });
        }
        S.bindResult = { name: name, phone: phone };
        render();
        var nf = document.querySelector('.notfound');
        if (nf) nf.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }).catch(fail);
    },
    bindRequest: function (form, btn) {
      var fd = new FormData(form);
      busy(btn, Api.call('bind', { name: fd.get('name'), phone: fd.get('phone'), note: fd.get('note'), request: true })).then(function (res) {
        S.bindResult = null;
        if (res.me) S.me = res.me;
        render();
        toast('申請已送出');
      }).catch(fail);
    },
    register: function (form, btn) {
      var fd = new FormData(form);
      var leave = fd.get('reply') === '請假';
      var data = { eventId: fd.get('eventId'), count: Number(fd.get('count')) || 1, note: leave ? (fd.get('reason') || '') : (fd.get('note') || '') };
      if (leave) data.reply = '請假';
      if (!S.me.member && !leave) {
        data.name = String(fd.get('name') || '').trim();
        data.phone = String(fd.get('phone') || '').trim();
        if (!data.name || !data.phone) { toast('請填寫姓名與手機', 'error'); return; }
      }
      var wasReg = !!(findEvent(data.eventId) || {}).myReg;
      busy(btn, Api.call('register', data)).then(function (ev) {
        upsertEvent(ev);
        closeSheet();
        render();
        toast(leave ? '已回覆請假' : wasReg ? '報名已更新' : '報名完成');
      }).catch(fail);
    },
    event: function (form, btn) {
      var fd = new FormData(form);
      var e = {
        id: fd.get('id') || '', title: String(fd.get('title') || '').trim(), category: fd.get('category'),
        start: fromInput(fd.get('start')), end: fromInput(fd.get('end')), location: fd.get('location'), mapUrl: fd.get('mapUrl'),
        audience: fd.get('audience'), capacity: fd.get('capacity'), deadline: fromInput(fd.get('deadline')), fee: fd.get('fee'),
        description: fd.get('description'), imageUrl: fd.get('imageUrl'), albumUrl: fd.get('albumUrl'), status: fd.get('status')
      };
      if (!e.title) { toast('請填寫活動名稱', 'error'); form.title.focus(); return; }
      if (!e.start) { toast('請選擇開始時間', 'error'); form.start.focus(); return; }
      busy(btn, Api.call('saveEvent', { event: e, notify: fd.get('notify') === 'on' })).then(function (res) {
        upsertEvent(res.event);
        go('event/' + res.event.id, true);
        saveToast(res.event.status === '草稿' ? '草稿已儲存' : e.id ? '活動已更新' : '活動已建立', res.push);
      }).catch(fail);
    },
    news: function (form, btn) {
      var fd = new FormData(form);
      var n = {
        id: fd.get('id') || '', title: String(fd.get('title') || '').trim(), category: fd.get('category'), content: fd.get('content'),
        audience: fd.get('audience'), imageUrl: fd.get('imageUrl'), pinned: fd.get('pinned') === 'on', status: fd.get('status')
      };
      if (!n.title) { toast('請填寫標題', 'error'); return; }
      if (!String(n.content || '').trim()) { toast('請填寫內容', 'error'); return; }
      busy(btn, Api.call('saveNews', { news: n, notify: fd.get('notify') === 'on' })).then(function (res) {
        upsertNews(res.news);
        go('news/' + res.news.id, true);
        saveToast(res.news.status === '草稿' ? '草稿已儲存' : n.id ? '消息已更新' : '消息已發布', res.push);
      }).catch(fail);
    },
    push: function (form, btn) {
      readPushForm(form);
      var p = S.push;
      if (p.mode === 'roles' && !p.roles.length) { toast('請至少選一個角色', 'error'); return; }
      if ((p.mode === 'event' || p.mode === 'eventUnreplied') && !p.eventId) { toast('請選擇活動', 'error'); return; }
      if (!p.title.trim()) { toast('請填寫標題', 'error'); form.title.focus(); return; }
      if (!p.text.trim()) { toast('請填寫內容', 'error'); form.text.focus(); return; }
      if ((p.linkType === 'event' || p.linkType === 'news') && !p.linkId) { toast('請選擇按鈕要連到哪裡', 'error'); return; }
      if (p.linkType === 'url' && !/^https:\/\//.test(p.linkUrl)) { toast('網址需以 https:// 開頭', 'error'); return; }
      var pv = p.preview || {};
      var n = pv.recipients;
      var who = pv.label || '';
      confirmSheet({
        title: '確定發送？',
        body: esc(who) + (n !== null && n !== undefined ? '，預計 <b>' + n + '</b> 人' : '') + '。<br>LINE 訊息送出後無法收回。',
        ok: '發送'
      }).then(function (fd) {
        if (!fd) return;
        var link = { type: p.linkType, id: p.linkId, url: p.linkUrl };
        return busy(btn, Api.call('push', { audience: pushAudience(), title: p.title, text: p.text, link: link })).then(function (res) {
          toast('已發送給 ' + res.sent + ' 人');
          S.push = pushDefaults();
          delete S.cache.pushLog;
          render();
        });
      }).catch(fail);
    },
    member: function (form, btn) {
      var fd = new FormData(form);
      var data = { id: fd.get('id'), role: fd.get('role'), title: fd.get('title'), status: fd.get('disabled') === 'on' ? '停用' : '啟用' };
      if (data.id === (S.me.member && S.me.member.id) && (roleLevel(data.role) < S.me.level || data.status === '停用')) {
        toast('為避免把自己鎖在外面，請到試算表修改自己的角色或狀態', 'error');
        return;
      }
      busy(btn, Api.call('updateMember', data)).then(function (m) {
        closeSheet();
        replaceMember(m);
        toast('已儲存');
        if (S.me.member && m.id === S.me.member.id) reloadAll();
      }).catch(fail);
    },
    updateMe: function (form, btn) {
      var fd = new FormData(form);
      busy(btn, Api.call('updateMe', { company: fd.get('company'), industry: fd.get('industry'), email: fd.get('email'), birthday: fd.get('birthday') })).then(function (me) {
        S.me = me;
        delete S.cache.directory;
        closeSheet();
        render();
        toast('資料已更新');
      }).catch(fail);
    },
    doc: function (form, btn) {
      var fd = new FormData(form);
      var d = { id: fd.get('id') || '', title: String(fd.get('title') || '').trim(), category: fd.get('category'), url: String(fd.get('url') || '').trim(),
        description: fd.get('description'), audience: fd.get('audience'), status: fd.get('status') };
      if (!d.title) { toast('請填寫標題', 'error'); form.title.focus(); return; }
      if (!/^https:\/\//.test(d.url)) { toast('連結需以 https:// 開頭', 'error'); form.url.focus(); return; }
      busy(btn, Api.call('saveDoc', { doc: d })).then(function (res) {
        S.docs = res.docs || S.docs;
        go('docs', true);
        toast(d.id ? '文件已更新' : '文件已新增');
      }).catch(fail);
    },
    reqLink: function (form, btn) {
      var fd = new FormData(form);
      busy(btn, Api.call('handleRequest', { id: fd.get('id'), decision: 'link', memberId: fd.get('memberId'), notify: fd.get('notify') === 'on' }))
        .then(afterRequest).catch(fail);
    },
    reqCreate: function (form, btn) {
      var fd = new FormData(form);
      busy(btn, Api.call('handleRequest', { id: fd.get('id'), decision: 'create', role: fd.get('role'), title: fd.get('title'), notify: fd.get('notify') === 'on' }))
        .then(afterRequest).catch(fail);
    }
  };

  /* ═════════════ 事件委派 ═════════════ */

  document.addEventListener('click', function (e) {
    var t = e.target;
    var ext = t.closest('a[data-ext]');
    if (ext) {
      e.preventDefault();
      Api.openExternal(ext.getAttribute('href'));
      return;
    }
    var tab = t.closest('[data-tab]');
    if (tab) {
      e.preventDefault();
      navDepth = 0;
      go(tab.getAttribute('data-tab'), true);
      return;
    }
    var nav = t.closest('a[data-nav]');
    if (nav) {
      e.preventDefault();
      go(nav.getAttribute('href').replace(/^#\//, ''));
      return;
    }
    var g = t.closest('[data-go]');
    if (g) {
      e.preventDefault();
      if (!$layer.hidden) closeSheet();
      go(g.getAttribute('data-go'));
      return;
    }
    var a = t.closest('[data-act]');
    if (a && ACTS[a.getAttribute('data-act')]) {
      e.preventDefault();
      ACTS[a.getAttribute('data-act')](a, e);
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    var fn = FORMS[form.getAttribute('data-form')];
    if (fn) fn(form, form.querySelector('[type=submit]'));
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    var f = t.getAttribute && t.getAttribute('data-filter');
    if (f === 'dir') {
      S.dirQuery = t.value;
      var box = document.getElementById('dir-list');
      if (box && Array.isArray(S.cache.directory)) box.innerHTML = directoryList(S.cache.directory);
      return;
    }
    if (f === 'walkin') {
      var wl = document.getElementById('walkin-list');
      if (wl && S.walkinCands) wl.innerHTML = walkinRows(S.walkinCands, t.value);
      return;
    }
    if (f === 'mem') {
      S.memQuery = t.value;
      var mb = document.getElementById('mem-list');
      if (mb && Array.isArray(S.cache.members)) mb.innerHTML = memberRows(S.cache.members);
      return;
    }
    var pf = t.closest && t.closest('form[data-form="push"]');
    if (pf) {
      readPushForm(pf);
      var lp = document.getElementById('lp');
      if (lp) lp.innerHTML = linePreview(S.push);
      var c = document.getElementById('p-count');
      if (c) c.textContent = S.push.text.length;
      if (t.name === 'mode' || t.name === 'roles' || t.name === 'eventId' || t.name === 'eventId2') refreshPushPreview();
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.name === 'reply' && e.target.closest('form[data-form="register"]')) {
      var rf = e.target.closest('form');
      rf.querySelectorAll('[data-reply]').forEach(function (el) { el.hidden = el.getAttribute('data-reply') !== e.target.value; });
      var sb = rf.querySelector('button[type=submit]');
      if (sb) sb.textContent = e.target.value === '請假' ? '送出請假' : '確認報名';
      return;
    }
    var pf = e.target.closest && e.target.closest('form[data-form="push"]');
    if (pf && (e.target.type === 'radio' || e.target.type === 'checkbox' || e.target.tagName === 'SELECT')) {
      readPushForm(pf);
      var lp = document.getElementById('lp');
      if (lp) lp.innerHTML = linePreview(S.push);
      refreshPushPreview();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$layer.hidden) closeSheet(null);
  });
  window.addEventListener('hashchange', render);

  /* ═════════════ 啟動 ═════════════ */

  function bootScreen() {
    return '<div class="boot">' + logo('brand-logo big') + '<p>' + esc(CFG.ORG_NAME || '') + '</p><span class="spinner" aria-label="載入中"></span></div>';
  }
  function fatal(e) {
    var msg = e && e.message ? e.message : String(e);
    var hint = '';
    if (e && (e.code === 'NOT_CONFIGURED' || e.code === 'NO_SHEET' || e.code === 'NO_SPREADSHEET')) hint = '後端尚未設定完成，請通知秘書處。';
    $app.innerHTML = '<div class="boot">' + logo('brand-logo big') + '<p class="empty-title">無法開啟會員專區</p><p>' + esc(msg) + '</p>' +
      (hint ? '<p class="muted">' + hint + '</p>' : '') + '<button type="button" class="btn btn-primary" onclick="location.reload()">重新載入</button></div>';
  }

  function start() {
    window.__appStarted = true;
    $app.innerHTML = bootScreen();
    Api.init().then(function (info) {
      S.demo = info.demo;
      document.body.classList.toggle('is-demo', S.demo);
      if (info.deepLink) {
        var q = new URLSearchParams(location.search);
        q.delete('to');
        var qs = q.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + '#/' + info.deepLink);
      }
      return Promise.all([Api.call('init'), Api.friendship()]);
    }).then(function (r) {
      applyInit(r[0]);
      S.friend = r[1];
      S.ready = true;
      document.body.classList.add('is-ready');
      render();
    }).catch(fatal);
  }

  start();
})();
