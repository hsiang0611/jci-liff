/**
 * mock.js — 示範模式的假後端
 *
 * 行為與 Apps Script 後端一致（可見等級、報名名額、推播對象計算、權限檢查），
 * 只是資料存在記憶體，重新整理就會還原。正式上線時不會用到這個檔案。
 */
window.Mock = (function () {
  'use strict';

  var DAY = 86400000;
  var P = function (d, e, n, r, p, m) {
    return { directory: d, eventManage: e, newsManage: n, viewRegs: r, push: p, memberManage: m };
  };
  var ROLES = [
    { role: '管理員', level: 90, desc: '會長、秘書長、秘書處', perms: P(1, 1, 1, 1, 1, 1) },
    { role: '幹部', level: 70, desc: '副會長、理監事、主委', perms: P(1, 1, 1, 1, 0, 0) },
    { role: '會員', level: 50, desc: '正式會員', perms: P(1, 0, 0, 0, 0, 0) },
    { role: '特友', level: 40, desc: '特友會', perms: P(1, 0, 0, 0, 0, 0) },
    { role: '預備會員', level: 20, desc: '新朋友、輔導入會中', perms: P(0, 0, 0, 0, 0, 0) },
    { role: '訪客', level: 0, desc: '未綁定的 LINE 使用者', perms: P(0, 0, 0, 0, 0, 0) }
  ];
  ROLES.forEach(function (r) { for (var k in r.perms) r.perms[k] = !!r.perms[k]; });
  var BY = {};
  ROLES.forEach(function (r) { BY[r.role] = r; });

  var IDENTITY = {
    '管理員': { uid: 'U-demo-01', name: 'Chien-Hung' },
    '幹部': { uid: 'U-demo-04', name: '宜蓁 Ivy' },
    '會員': { uid: 'U-demo-05', name: '志豪' },
    '特友': { uid: 'U-demo-07', name: '國明' },
    '預備會員': { uid: 'U-demo-08', name: 'Tina' },
    '訪客': { uid: 'U-demo-guest', name: 'LINE 使用者' }
  };

  var EVENT_CATS = ['例會', '理監事會', '訓練', '公益服務', '聯誼', '國際交流', '其他'];
  var NEWS_CATS = ['會務公告', '活動花絮', '會員動態', '國際青商', '其他'];

  var db, current = '管理員', friend = {};

  var CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  function monthOf(days) { return CN[new Date(Date.now() + days * DAY).getMonth() + 1]; }
  function at(days, h, m) {
    var d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return new Date(d.getTime() + days * DAY).toISOString();
  }
  function err(code, msg) {
    var e = new Error(msg);
    e.code = code;
    return e;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid4() { return Math.random().toString(16).slice(2, 6).toUpperCase(); }
  function normPhone(v) {
    var s = String(v || '').replace(/\D/g, '');
    if (s.indexOf('886') === 0 && s.length === 12) s = '0' + s.slice(3);
    if (s.length === 9 && s[0] === '9') s = '0' + s;
    return s;
  }
  function normName(v) { return String(v || '').replace(/[\s　]+/g, ''); }

  function seed() {
    var m = function (id, name, phone, role, title, company, year, uid) {
      return { id: id, name: name, phone: phone, role: role, title: title, company: company, email: '',
        joinYear: year, status: '啟用', lineUid: uid || '', lineName: '', boundAt: uid ? at(-60, 10) : '' };
    };
    db = {
      members: [
        m('M001', '王建宏', '0912000001', '管理員', '會長', '建宏營造有限公司', '2016', 'U-demo-01'),
        m('M002', '陳怡君', '0912000002', '管理員', '秘書長', '怡君會計師事務所', '2019', 'U-demo-02'),
        m('M003', '李承翰', '0912000003', '幹部', '副會長', '承翰汽車美容', '2018', 'U-demo-03'),
        m('M004', '蔡宜蓁', '0912000004', '幹部', '理事', '蓁好烘焙坊', '2020', 'U-demo-04'),
        m('M005', '林志豪', '0912000005', '會員', '', '志豪水電行', '2022', 'U-demo-05'),
        m('M006', '吳佩珊', '0912000006', '會員', '公關主委', '珊珊花藝', '2023', 'U-demo-06'),
        m('M007', '黃國明', '0912000007', '特友', '特友會長', '國明茶行', '2008', 'U-demo-07'),
        m('M008', '張雅婷', '0912000008', '預備會員', '', '雅婷設計工作室', '2026', 'U-demo-08'),
        m('M009', '鄭凱文', '0912000009', '會員', '', '凱文咖啡', '2024', ''),
        m('M010', '劉家瑋', '0912000010', '會員', '', '家瑋保險經紀', '2021', ''),
        m('M011', '許文彥', '0912000011', '特友', '', '文彥土地代書', '2009', 'U-demo-11')
      ],
      events: [
        ev('E1', monthOf(5) + '月份月例會', '例會', at(5, 19), at(5, 21, 30), '龍井區公所 3 樓禮堂', '會員', at(3, 23, 59), 0, '會員免費，眷屬每位 300 元',
          '本月例會邀請台中港務分公司分享港區產業發展。\n\n18:30 報到用餐\n19:00 例會開始\n20:00 專題演講\n21:30 散會\n\n請穿著會服。'),
        ev('E2', '麗水漁港淨灘公益服務', '公益服務', at(11, 8), at(11, 11, 30), '麗水漁港南側沙灘', '訪客', at(9, 18), 60, '免費',
          '歡迎會友攜家帶眷，也歡迎朋友一起來！手套、夾子、垃圾袋由本會準備，請自備水壺與防曬。\n集合地點：漁港停車場。'),
        ev('E3', '第 11 次理監事會議', '理監事會', at(2, 19, 30), at(2, 21), '會館會議室', '幹部', '', 0, '',
          '議程：年度會員大會籌備、預算追加、新會員入會審查。'),
        ev('E4', '創業經驗分享：從夜市攤到連鎖店', '訓練', at(18, 14), at(18, 17), '龍井區農會 2 樓教室', '預備會員', at(16, 12), 40, '每位 200 元',
          '邀請連鎖餐飲創辦人分享展店心法，現場有 Q&A。'),
        ev('E5', '年度會員大會暨會長交接', '例會', at(46, 17, 30), at(46, 21), '台中港區飯店宴會廳', '預備會員', at(35, 23, 59), 220, '每位 1,200 元',
          '一年一度的大會，歡迎眷屬一同參加。'),
        ev('E6', monthOf(-16) + '月份月例會', '例會', at(-16, 19), at(-16, 21, 30), '龍井區公所 3 樓禮堂', '會員', '', 0, '', ''),
        ev('E7', '中秋聯誼烤肉', '聯誼', at(-30, 17), at(-30, 21), '竹坑南寮登山步道入口廣場', '訪客', '', 0, '', ''),
        ev('E8', '國際青商週：日本姊妹會來訪接待', '國際交流', at(60, 10), at(60, 16), '待定', '會員', '', 0, '', '草稿，行程確認中。', '草稿')
      ],
      regs: [],
      news: [
        nw('N1', '2027 年度會費繳交通知', '會務公告', '2027 年度會費每位 6,000 元，請於 12 月 31 日前繳交。\n\n轉帳：土地銀行龍井分行\n戶名：龍井國際青年商會\n\n也可在例會現場交給財務長。', '會員', true, -2),
        nw('N2', '第 11 屆理監事選舉公告', '會務公告', '登記期間至 11 月 15 日止，請向秘書處索取登記表。', '會員', false, -5),
        nw('N3', '十月淨灘成果：清出 180 公斤垃圾', '活動花絮', '感謝 32 位會友與眷屬參加，共清出 180 公斤垃圾，其中寶特瓶 46 公斤。下一場淨灘已開放報名！', '訪客', false, -9),
        nw('N4', '恭喜蔡宜蓁理事獲選青商總會傑出青年企業家', '會員動態', '蔡宜蓁理事經營蓁好烘焙坊八年，堅持使用在地小麥，獲選本屆傑出青年企業家。', '訪客', false, -14),
        nw('N5', '理監事會議程與預算表', '會務公告', '附件已寄到理監事信箱，請會前詳閱。', '幹部', false, -1),
        nw('N6', 'JCI 世界大會開放報名', '國際青商', '今年世界大會報名已開放，有興趣的會友請洽國際事務主委。', '訪客', false, -20)
      ],
      requests: [
        { id: 'Q1', name: '許志明', phone: '0937555123', lineUid: 'U-demo-req', lineName: 'Jimmy', note: '去年參加過淨灘，想入會', status: '待審核', createdAt: at(-1, 21, 12) }
      ],
      pushlog: [
        { time: at(-2, 9, 5), sender: '陳怡君', audience: '會員以上', title: '2027 年度會費繳交通知', content: '', recipients: 9, result: 'OK' },
        { time: at(-6, 18, 0), sender: '系統排程', audience: '「十月份月例會」報名者', title: '明日活動提醒', content: '', recipients: 21, result: 'OK' },
        { time: at(-10, 12, 30), sender: '王建宏', audience: '所有加入官方帳號的好友', title: '淨灘活動招募', content: '', recipients: 34, result: 'OK' }
      ],
      quota: { limit: 200, used: 64 }
    };
    // 示範報名資料
    var names = ['李承翰', '吳佩珊', '黃國明', '鄭凱文', '劉家瑋', '許文彥', '王建宏', '陳怡君'];
    names.forEach(function (n, i) {
      var mem = db.members.filter(function (x) { return x.name === n; })[0];
      addReg('E1', mem, i % 3 === 0 ? 2 : 1, i === 1 ? '吃素' : '');
      if (i < 6) addReg('E2', mem, i % 2 === 0 ? 3 : 1, '');
      if (i < 5) addReg('E6', mem, 1, '');
    });
    for (var g = 0; g < 9; g++) {
      db.regs.push({ id: 'R-g' + g, eventId: 'E2', memberId: '', name: '來賓' + (g + 1), phone: '09330000' + (10 + g), lineUid: 'U-guest-' + g, count: 2, note: '', status: '報名', createdAt: at(-3, 10 + g) });
    }
    friend = {};
    Object.keys(IDENTITY).forEach(function (k) { friend[k] = k !== '訪客'; });
  }

  function ev(id, title, cat, start, end, loc, aud, dl, cap, fee, desc, status) {
    return { id: id, title: title, category: cat, start: start, end: end, location: loc, mapUrl: loc === '待定' ? '' : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('台中市龍井區 ' + loc),
      description: desc, imageUrl: '', audience: aud, deadline: dl, capacity: cap, fee: fee, status: status || '發布', createdBy: '陳怡君' };
  }
  function nw(id, title, cat, content, aud, pinned, days) {
    return { id: id, title: title, category: cat, content: content, imageUrl: '', audience: aud, pinned: pinned, status: '發布', publishedAt: at(days, 9, 30), createdBy: '陳怡君' };
  }
  function addReg(eventId, mem, count, note) {
    db.regs.push({ id: 'R' + uid4(), eventId: eventId, memberId: mem.id, name: mem.name, phone: mem.phone, lineUid: mem.lineUid || 'U-x-' + mem.id, count: count, note: note, status: '報名', createdAt: at(-4, 12) });
  }

  /* ───────── 情境（等同後端 contextForUid_） ───────── */
  function ctx() {
    var who = IDENTITY[current];
    var found = db.members.filter(function (m) { return m.lineUid === who.uid; })[0] || null;
    var disabled = !!(found && found.status === '停用');
    var member = found && !disabled ? found : null;
    var roleName = member ? member.role : '訪客';
    var role = BY[roleName] || BY['訪客'];
    return { uid: who.uid, lineName: who.name, member: member, disabled: disabled, roleName: roleName, level: role.level, perms: role.perms };
  }
  function audLevel(a) { var r = BY[a]; return r ? r.level : 0; }
  function meOut(c) {
    var pend = db.requests.filter(function (r) { return r.lineUid === c.uid && r.status === '待審核'; })[0];
    return {
      uid: c.uid, lineName: c.lineName, picture: '', bound: !!c.member, disabled: c.disabled,
      role: c.roleName, level: c.level, perms: clone(c.perms),
      member: c.member ? { id: c.member.id, name: c.member.name, phone: c.member.phone, title: c.member.title, company: c.member.company, email: c.member.email, joinYear: c.member.joinYear } : null,
      pendingRequest: !c.member && pend ? { id: pend.id, name: pend.name, createdAt: pend.createdAt } : null
    };
  }

  /* ───────── 活動 ───────── */
  function activeRegs(eventId) {
    return db.regs.filter(function (r) { return r.eventId === eventId && r.status !== '取消'; });
  }
  function evVisible(e, c) {
    if (e.status === '草稿' && !c.perms.eventManage) return false;
    return audLevel(e.audience) <= c.level;
  }
  function closedReason(e, c, others, mine) {
    if (e.status === '取消') return '活動已取消';
    if (e.status !== '發布') return '活動尚未發布';
    var now = Date.now();
    if (e.start && Date.parse(e.start) <= now) return '活動已開始';
    if (e.deadline && Date.parse(e.deadline) < now) return '報名已截止';
    if (c.disabled) return '帳號已停用，請洽秘書處';
    if (!c.member && audLevel(e.audience) > 0) return '限會員報名';
    if (e.capacity > 0 && !mine && others >= e.capacity) return '名額已滿';
    return '';
  }
  function evOut(e, c, withRegs) {
    var regs = activeRegs(e.id), mine = null, total = 0, others = 0;
    regs.forEach(function (r) { total += r.count; if (r.lineUid === c.uid) mine = r; else others += r.count; });
    var reason = closedReason(e, c, others, mine);
    var o = clone(e);
    o.audienceLevel = audLevel(e.audience);
    o.regCount = total;
    o.regPeople = regs.length;
    o.myReg = mine ? { id: mine.id, count: mine.count, note: mine.note } : null;
    o.regOpen = !reason;
    o.regClosedReason = reason;
    if (withRegs && c.perms.viewRegs) {
      o.registrations = regs.map(function (r) {
        return { name: r.name, phone: r.phone, count: r.count, note: r.note, memberId: r.memberId, guest: !r.memberId, createdAt: r.createdAt };
      });
    }
    return o;
  }
  function findEvent(id, c) {
    var e = db.events.filter(function (x) { return x.id === id; })[0];
    if (!e || !evVisible(e, c)) throw err('NOT_FOUND', '找不到這個活動，或你沒有權限查看');
    return e;
  }
  function visibleEvents(c) {
    var cutoff = Date.now() - 120 * DAY;
    return db.events.filter(function (e) { return evVisible(e, c) && Date.parse(e.start) >= cutoff; })
      .map(function (e) { return evOut(e, c, false); })
      .sort(function (a, b) { return a.start.localeCompare(b.start); });
  }
  function newsVisible(n, c) {
    if (n.status !== '發布' && !c.perms.newsManage) return false;
    return audLevel(n.audience) <= c.level;
  }
  function newsOut(n) {
    var o = clone(n);
    o.audienceLevel = audLevel(n.audience);
    return o;
  }
  function visibleNews(c) {
    return db.news.filter(function (n) { return newsVisible(n, c); }).map(newsOut).sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.publishedAt || '9999').localeCompare(a.publishedAt || '9999');
    });
  }

  /* ───────── 推播 ───────── */
  function resolveAudience(c, aud) {
    aud = aud || {};
    var mode = aud.mode || 'all';
    if (mode === 'friends') return { broadcast: true, uids: null, label: '所有加入官方帳號的好友', estimate: 86 };
    var set = {}, uids = [];
    function add(u) { if (u && !set[u]) { set[u] = 1; uids.push(u); } }
    if (mode === 'event') {
      var e = db.events.filter(function (x) { return x.id === aud.eventId; })[0];
      if (!e) throw err('NOT_FOUND', '找不到這個活動');
      activeRegs(e.id).forEach(function (r) { add(r.lineUid); });
      return { uids: uids, label: '「' + e.title + '」報名者' };
    }
    var mem = db.members.filter(function (m) { return m.status !== '停用' && m.lineUid; });
    var label;
    if (mode === 'roles') {
      if (!aud.roles || !aud.roles.length) throw err('INVALID', '請至少選一個角色');
      mem.forEach(function (m) { if (aud.roles.indexOf(m.role) >= 0) add(m.lineUid); });
      label = aud.roles.join('、');
    } else if (mode === 'minRole') {
      var min = audLevel(aud.role);
      mem.forEach(function (m) { var r = BY[m.role]; if (r && r.level >= min && r.level > 0) add(m.lineUid); });
      label = min > 0 ? aud.role + '以上' : '全體已綁定會員';
    } else {
      mem.forEach(function (m) { var r = BY[m.role]; if (r && r.level > 0) add(m.lineUid); });
      label = '全體已綁定會員';
    }
    return { uids: uids, label: label };
  }
  function quota() {
    return { limit: db.quota.limit, used: db.quota.used, remaining: Math.max(0, db.quota.limit - db.quota.used) };
  }
  function doPush(c, aud, title, content) {
    var t = resolveAudience(c, aud);
    var n = t.broadcast ? t.estimate : t.uids.length;
    if (!t.broadcast && !n) throw err('NO_RECIPIENT', '沒有符合的收件人（對方需要先在會員專區完成 LINE 綁定）');
    if (n > quota().remaining) throw err('QUOTA', '本月剩餘訊息 ' + quota().remaining + ' 則，不夠發給 ' + n + ' 人。請縮小對象或升級官方帳號方案');
    db.quota.used += n;
    db.pushlog.push({ time: new Date().toISOString(), sender: c.member ? c.member.name : c.lineName, audience: t.label, title: title, content: content || '', recipients: n, result: 'OK' });
    return { sent: n, label: t.label, broadcast: !!t.broadcast };
  }

  function guardMember(c, m) {
    var r = BY[m.role];
    if (r && r.level > c.level) throw err('FORBIDDEN', '不能修改角色等級比你高的會員');
  }
  function memberOut(m) {
    var r = BY[m.role];
    return { id: m.id, name: m.name, phone: m.phone, role: m.role, level: r ? r.level : 0, roleKnown: !!r, title: m.title, company: m.company, email: m.email,
      joinYear: m.joinYear, status: m.status, bound: !!m.lineUid, lineName: m.lineName, boundAt: m.boundAt, note: '' };
  }
  function membersList() {
    return db.members.map(memberOut).sort(function (a, b) { return (b.level - a.level) || a.id.localeCompare(b.id); });
  }
  function requestsOut() {
    return {
      pending: db.requests.filter(function (r) { return r.status === '待審核'; }).map(clone),
      handled: db.requests.filter(function (r) { return r.status !== '待審核'; }).reverse().map(clone)
    };
  }

  /* ───────── 動作 ───────── */
  var A = {
    init: function (c) {
      var o = {
        me: meOut(c),
        roles: ROLES.map(function (r) { return { role: r.role, level: r.level, desc: r.desc }; }),
        events: visibleEvents(c), news: visibleNews(c),
        categories: { event: EVENT_CATS, news: NEWS_CATS },
        serverTime: new Date().toISOString(),
        pushReady: true
      };
      if (c.perms.memberManage) o.pendingCount = db.requests.filter(function (r) { return r.status === '待審核'; }).length;
      return o;
    },
    bind: function (c, d) {
      if (c.member) throw err('ALREADY_BOUND', '你已完成綁定');
      if (c.disabled) throw err('DISABLED', '這個 LINE 帳號對應的會員已停用，請洽秘書處');
      var name = normName(d.name), phone = normPhone(d.phone);
      if (!name) throw err('INVALID', '請輸入姓名');
      if (phone.length < 9) throw err('INVALID', '請輸入手機號碼');
      var match = db.members.filter(function (m) { return normName(m.name) === name && normPhone(m.phone) === phone; })[0];
      if (match) {
        if (match.status === '停用') throw err('DISABLED', '這位會員目前是停用狀態，請洽秘書處');
        if (match.lineUid && match.lineUid !== c.uid) throw err('BOUND_OTHER', '這位會員已綁定其他 LINE 帳號。如需更換手機或帳號，請洽秘書處解除綁定');
        match.lineUid = c.uid; match.lineName = c.lineName; match.boundAt = new Date().toISOString();
        return { status: 'bound' };
      }
      if (!d.request) return { status: 'notfound' };
      var ex = db.requests.filter(function (r) { return r.lineUid === c.uid && r.status === '待審核'; })[0];
      if (ex) { ex.name = d.name; ex.phone = phone; ex.note = d.note || ''; }
      else db.requests.push({ id: 'Q' + uid4(), name: d.name, phone: phone, lineUid: c.uid, lineName: c.lineName, note: d.note || '', status: '待審核', createdAt: new Date().toISOString() });
      return { status: 'pending', me: meOut(ctx()) };
    },
    event: function (c, d) { return evOut(findEvent(d.id, c), c, true); },
    register: function (c, d) {
      var e = findEvent(d.eventId, c);
      var regs = activeRegs(e.id), mine = null, others = 0;
      regs.forEach(function (r) { if (r.lineUid === c.uid) mine = r; else others += r.count; });
      var reason = closedReason(e, c, others, mine);
      if (reason) throw err('REG_CLOSED', reason);
      var count = Math.floor(Number(d.count) || 1);
      if (count < 1 || count > 10) throw err('INVALID', '報名人數請填 1 到 10 人');
      if (e.capacity > 0 && others + count > e.capacity) throw err('FULL', '名額不足，目前只剩 ' + Math.max(0, e.capacity - others) + ' 位');
      var name, phone, memberId = '';
      if (c.member) { name = c.member.name; phone = c.member.phone; memberId = c.member.id; }
      else {
        name = String(d.name || '').trim(); phone = normPhone(d.phone);
        if (!normName(name)) throw err('INVALID', '請填寫姓名');
        if (!/^09\d{8}$/.test(phone)) throw err('INVALID', '請填寫正確的手機號碼（09 開頭共 10 碼）');
      }
      if (mine) { mine.count = count; mine.note = d.note || ''; }
      else db.regs.push({ id: 'R' + uid4(), eventId: e.id, memberId: memberId, name: name, phone: phone, lineUid: c.uid, count: count, note: d.note || '', status: '報名', createdAt: new Date().toISOString() });
      return evOut(e, c, true);
    },
    cancelRegistration: function (c, d) {
      var e = findEvent(d.eventId, c);
      if (Date.parse(e.start) <= Date.now()) throw err('REG_CLOSED', '活動已開始，無法取消報名');
      var mine = activeRegs(e.id).filter(function (r) { return r.lineUid === c.uid; })[0];
      if (!mine) throw err('NOT_FOUND', '你沒有報名這個活動');
      mine.status = '取消';
      return evOut(e, c, true);
    },
    directory: function () {
      return db.members.filter(function (m) { return m.status !== '停用'; }).map(function (m) {
        var r = BY[m.role];
        return { id: m.id, name: m.name, role: m.role, level: r ? r.level : 0, title: m.title, company: m.company, phone: m.phone, email: m.email, joinYear: m.joinYear };
      }).sort(function (a, b) { return (b.level - a.level) || a.id.localeCompare(b.id); });
    },
    saveEvent: function (c, d) {
      var e = d.event || {};
      if (!String(e.title || '').trim()) throw err('INVALID', '請填寫活動標題');
      if (!e.start) throw err('INVALID', '請選擇開始時間');
      if (e.end && e.end < e.start) throw err('INVALID', '結束時間不能早於開始時間');
      if (e.deadline && e.deadline > e.start) throw err('INVALID', '報名截止不能晚於活動開始');
      var aud = BY[e.audience] ? e.audience : '訪客';
      if (audLevel(aud) > c.level) aud = c.roleName;
      var rec = {
        title: e.title.trim(), category: EVENT_CATS.indexOf(e.category) >= 0 ? e.category : '其他', start: e.start, end: e.end || '',
        location: e.location || '', mapUrl: /^https:\/\//.test(e.mapUrl || '') ? e.mapUrl : '', description: e.description || '',
        imageUrl: /^https:\/\//.test(e.imageUrl || '') ? e.imageUrl : '', audience: aud, deadline: e.deadline || '',
        capacity: Math.max(0, Math.floor(Number(e.capacity) || 0)), fee: e.fee || '', status: e.status === '草稿' ? '草稿' : '發布'
      };
      var row;
      if (e.id) {
        row = findEvent(e.id, c);
        if (row.status === '取消') rec.status = '取消';
        Object.assign(row, rec);
      } else {
        row = Object.assign({ id: 'E' + uid4(), createdBy: c.member.name }, rec);
        db.events.push(row);
      }
      var out = { event: evOut(row, c, true), push: null };
      if (d.notify && row.status === '發布') {
        out.push = c.perms.push ? doPush(c, { mode: 'minRole', role: row.audience }, '新活動：' + row.title)
          : { skipped: true, message: '活動已儲存。你的角色沒有推播權限，所以沒有發送通知' };
      }
      return out;
    },
    cancelEvent: function (c, d) {
      var e = findEvent(d.id, c);
      e.status = '取消';
      var out = { event: evOut(e, c, true), push: null };
      if (d.notify) {
        if (!c.perms.push) out.push = { skipped: true, message: '活動已取消。你的角色沒有推播權限，所以沒有通知報名者' };
        else if (out.event.regPeople) out.push = doPush(c, { mode: 'event', eventId: e.id }, '活動取消：' + e.title, d.reason);
        else out.push = { skipped: true, message: '活動已取消。目前沒有報名者，不需要通知' };
      }
      return out;
    },
    saveNews: function (c, d) {
      var n = d.news || {};
      if (!String(n.title || '').trim()) throw err('INVALID', '請填寫標題');
      if (!String(n.content || '').trim()) throw err('INVALID', '請填寫內容');
      var aud = BY[n.audience] ? n.audience : '訪客';
      if (audLevel(aud) > c.level) aud = c.roleName;
      var rec = { title: n.title.trim(), category: NEWS_CATS.indexOf(n.category) >= 0 ? n.category : '其他', content: n.content,
        imageUrl: /^https:\/\//.test(n.imageUrl || '') ? n.imageUrl : '', audience: aud, pinned: !!n.pinned, status: n.status === '草稿' ? '草稿' : '發布' };
      var row;
      if (n.id) {
        row = db.news.filter(function (x) { return x.id === n.id; })[0];
        if (!row) throw err('NOT_FOUND', '找不到這則消息');
        Object.assign(row, rec);
      } else {
        row = Object.assign({ id: 'N' + uid4(), createdBy: c.member.name, publishedAt: '' }, rec);
        db.news.push(row);
      }
      if (row.status === '發布' && !row.publishedAt) row.publishedAt = new Date().toISOString();
      var out = { news: newsOut(row), push: null };
      if (d.notify && row.status === '發布') {
        out.push = c.perms.push ? doPush(c, { mode: 'minRole', role: row.audience }, '消息：' + row.title)
          : { skipped: true, message: '消息已發布。你的角色沒有推播權限，所以沒有發送通知' };
      }
      return out;
    },
    deleteNews: function (c, d) {
      db.news = db.news.filter(function (x) { return x.id !== d.id; });
      return { id: d.id, deleted: true };
    },
    pushPreview: function (c, d) {
      var t = resolveAudience(c, d.audience);
      return { label: t.label, recipients: t.broadcast ? t.estimate : t.uids.length, broadcast: !!t.broadcast, quota: quota() };
    },
    push: function (c, d) {
      if (!String(d.title || '').trim()) throw err('INVALID', '請填寫通知標題');
      if (!String(d.text || '').trim()) throw err('INVALID', '請填寫通知內容');
      return doPush(c, d.audience, d.title, d.text);
    },
    pushLog: function () { return db.pushlog.slice().reverse().slice(0, 30); },
    members: function () { return membersList(); },
    updateMember: function (c, d) {
      var m = db.members.filter(function (x) { return x.id === d.id; })[0];
      if (!m) throw err('NOT_FOUND', '找不到這位會員');
      guardMember(c, m);
      if (d.role !== undefined) {
        if (!BY[d.role]) throw err('INVALID', '沒有「' + d.role + '」這個角色');
        if (BY[d.role].level > c.level) throw err('FORBIDDEN', '不能指派比自己高的角色');
        m.role = d.role;
      }
      if (d.status !== undefined) m.status = d.status === '停用' ? '停用' : '啟用';
      if (d.title !== undefined) m.title = d.title;
      if (d.company !== undefined) m.company = d.company;
      return memberOut(m);
    },
    unbindMember: function (c, d) {
      var m = db.members.filter(function (x) { return x.id === d.id; })[0];
      if (!m) throw err('NOT_FOUND', '找不到這位會員');
      guardMember(c, m);
      m.lineUid = ''; m.lineName = ''; m.boundAt = '';
      return memberOut(m);
    },
    requests: function () { return requestsOut(); },
    handleRequest: function (c, d) {
      var q = db.requests.filter(function (r) { return r.id === d.id; })[0];
      if (!q) throw err('NOT_FOUND', '找不到這筆申請');
      if (q.status !== '待審核') throw err('INVALID', '這筆申請已經處理過了');
      var name = c.member.name, now = new Date().toISOString();
      if (d.decision === 'reject') {
        Object.assign(q, { status: '已拒絕', handledBy: name, handledAt: now });
      } else {
        var already = db.members.filter(function (m) { return m.lineUid === q.lineUid; })[0];
        if (already) throw err('INVALID', '這個 LINE 帳號已綁定會員 ' + already.name);
        var memberId;
        if (d.decision === 'link') {
          var m = db.members.filter(function (x) { return x.id === d.memberId; })[0];
          if (!m) throw err('NOT_FOUND', '找不到要綁定的會員');
          if (m.lineUid) throw err('INVALID', m.name + ' 已經綁定其他 LINE 帳號，請先解除綁定');
          m.lineUid = q.lineUid; m.lineName = q.lineName; m.boundAt = now; memberId = m.id;
        } else if (d.decision === 'create') {
          if (!BY[d.role]) throw err('INVALID', '請選擇角色');
          if (BY[d.role].level > c.level) throw err('FORBIDDEN', '不能指派比自己高的角色');
          memberId = 'M' + String(db.members.length + 1).padStart(3, '0');
          db.members.push({ id: memberId, name: q.name, phone: q.phone, role: d.role, title: d.title || '', company: '', email: '', joinYear: String(new Date().getFullYear()),
            status: '啟用', lineUid: q.lineUid, lineName: q.lineName, boundAt: now });
        } else throw err('INVALID', '未知的處理方式');
        Object.assign(q, { status: '已核准', handledBy: name, handledAt: now, memberId: memberId });
        if (d.notify) db.quota.used += 1;
      }
      return { decision: d.decision, requests: requestsOut() };
    }
  };
  var PERM = { directory: 'directory', saveEvent: 'eventManage', cancelEvent: 'eventManage', saveNews: 'newsManage', deleteNews: 'newsManage',
    pushPreview: 'push', push: 'push', pushLog: 'push', members: 'memberManage', updateMember: 'memberManage', unbindMember: 'memberManage',
    requests: 'memberManage', handleRequest: 'memberManage' };

  function call(action, data) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var fn = A[action];
          if (!fn) throw err('UNKNOWN_ACTION', '未知的動作：' + action);
          var c = ctx();
          if (PERM[action] && !c.perms[PERM[action]]) throw err('FORBIDDEN', '你的角色沒有這項權限');
          resolve(clone(fn(c, data || {})));
        } catch (e) {
          reject(e);
        }
      }, 260);
    });
  }

  seed();

  return {
    call: call,
    roleNames: function () { return Object.keys(IDENTITY); },
    getRole: function () { return current; },
    setRole: function (r) { if (IDENTITY[r]) current = r; },
    isFriend: function () { return friend[current]; },
    setFriend: function (v) { friend[current] = v; },
    reset: seed,
    bindHint: { name: '鄭凱文', phone: '0912000009' }
  };
})();
