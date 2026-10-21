/**
 * Api.gs — 前端（LIFF）呼叫的所有動作
 *
 * 前端送：{ action: 'xxx', idToken: '...', data: {...} }
 * 後端回：{ ok: true, data: ... } 或 { ok: false, error: { code, message } }
 *
 * perm 是該動作需要的權限（對應「權限」工作表的欄位），沒寫代表登入即可。
 */

var ACTIONS = {
  init:               { fn: apiInit_ },
  bind:               { fn: apiBind_ },
  event:              { fn: apiEvent_ },
  register:           { fn: apiRegister_ },
  cancelRegistration: { fn: apiCancelRegistration_ },
  directory:          { fn: apiDirectory_, perm: 'directory' },
  saveEvent:          { fn: apiSaveEvent_, perm: 'eventManage' },
  cancelEvent:        { fn: apiCancelEvent_, perm: 'eventManage' },
  saveNews:           { fn: apiSaveNews_, perm: 'newsManage' },
  deleteNews:         { fn: apiDeleteNews_, perm: 'newsManage' },
  pushPreview:        { fn: apiPushPreview_, perm: 'push' },
  push:               { fn: apiPush_, perm: 'push' },
  pushLog:            { fn: apiPushLog_, perm: 'push' },
  members:            { fn: apiMembers_, perm: 'memberManage' },
  updateMember:       { fn: apiUpdateMember_, perm: 'memberManage' },
  unbindMember:       { fn: apiUnbindMember_, perm: 'memberManage' },
  requests:           { fn: apiRequests_, perm: 'memberManage' },
  handleRequest:      { fn: apiHandleRequest_, perm: 'memberManage' }
};

function handleApi_(body) {
  try {
    Db.reset();
    var entry = ACTIONS[body.action];
    if (!entry) throw apiError_('UNKNOWN_ACTION', '未知的動作：' + body.action);
    var lineUser = verifyIdToken_(body.idToken);
    var ctx = contextForUid_(lineUser);
    if (entry.perm && !ctx.perms[entry.perm]) throw apiError_('FORBIDDEN', '你的角色沒有這項權限');
    return { ok: true, data: entry.fn(ctx, body.data || {}) };
  } catch (err) {
    if (err && err.apiCode) return { ok: false, error: { code: err.apiCode, message: err.message } };
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'SERVER_ERROR', message: '系統錯誤：' + (err && err.message ? err.message : err) } };
  }
}

/* ───────────── 首頁一次載入 ───────────── */

function apiInit_(ctx) {
  var out = {
    me: meOut_(ctx),
    roles: ctx.roles.list.map(function (r) { return { role: r.role, level: r.level, desc: r.desc }; }),
    events: visibleEvents_(ctx),
    news: visibleNews_(ctx),
    categories: { event: EVENT_CATEGORIES, news: NEWS_CATEGORIES },
    serverTime: new Date().toISOString(),
    pushReady: !!prop_('LINE_CHANNEL_ACCESS_TOKEN') // 還沒連接官方帳號時，前端會隱藏推播功能
  };
  if (ctx.perms.memberManage) {
    out.pendingCount = Db.rows(SHEETS.REQUESTS).filter(function (r) {
      return str_(r.status) === REQ_STATUS.PENDING;
    }).length;
  }
  return out;
}

/* ───────────── 綁定會員 ───────────── */

function apiBind_(ctx, d) {
  if (ctx.member) throw apiError_('ALREADY_BOUND', '你已完成綁定');
  if (ctx.disabled) throw apiError_('DISABLED', '這個 LINE 帳號對應的會員已停用，請洽秘書處');

  var name = normName_(d.name);
  var phone = normPhone_(d.phone);
  if (!name) throw apiError_('INVALID', '請輸入姓名');
  if (phone.length < 9) throw apiError_('INVALID', '請輸入手機號碼');

  var cache = CacheService.getScriptCache();
  var rateKey = 'bind_' + ctx.line.uid;
  var tries = num_(cache.get(rateKey), 0);
  if (tries >= 5) throw apiError_('TOO_MANY', '嘗試次數過多，請一小時後再試，或直接洽秘書處');

  return withLock_(function () {
    Db.reset();
    var members = Db.rows(SHEETS.MEMBERS);
    var match = null;
    for (var i = 0; i < members.length; i++) {
      if (normName_(members[i].name) === name && normPhone_(members[i].phone) === phone) { match = members[i]; break; }
    }

    if (match) {
      if (!isMemberActive_(match)) throw apiError_('DISABLED', '這位會員目前是停用狀態，請洽秘書處');
      var bound = str_(match.lineUid);
      if (bound && bound !== ctx.line.uid) {
        throw apiError_('BOUND_OTHER', '這位會員已綁定其他 LINE 帳號。如需更換手機或帳號，請洽秘書處解除綁定');
      }
      Db.update(SHEETS.MEMBERS, match._row, {
        lineUid: ctx.line.uid,
        lineName: safeText_(ctx.line.name, 50),
        boundAt: new Date()
      });
      closePendingRequests_(ctx.line.uid, str_(match.id), '系統自動比對');
      cache.remove(rateKey);
      Db.reset();
      return { status: 'bound' };
    }

    cache.put(rateKey, String(tries + 1), 3600);
    if (!d.request) return { status: 'notfound' };

    // 找不到 → 送出綁定申請給秘書處
    var reqs = Db.rows(SHEETS.REQUESTS);
    var existing = null;
    for (var j = 0; j < reqs.length; j++) {
      if (str_(reqs[j].lineUid) === ctx.line.uid && str_(reqs[j].status) === REQ_STATUS.PENDING) existing = reqs[j];
    }
    var rec = {
      name: safeText_(d.name, 30),
      phone: phoneCell_(phone),
      lineName: safeText_(ctx.line.name, 50),
      note: safeText_(d.note, 200)
    };
    if (existing) {
      Db.update(SHEETS.REQUESTS, existing._row, rec);
    } else {
      rec.id = newId_('Q');
      rec.lineUid = ctx.line.uid;
      rec.status = REQ_STATUS.PENDING;
      rec.createdAt = new Date();
      Db.append(SHEETS.REQUESTS, rec);
      if (prop_('NOTIFY_ADMIN_ON_REQUEST') === 'true') {
        try { notifyAdminsOfRequest_(rec); } catch (e) { console.error(e); }
      }
    }
    Db.reset();
    return { status: 'pending', me: meOut_(contextForUid_(ctx.line)) };
  });
}

function closePendingRequests_(uid, memberId, handler) {
  Db.rows(SHEETS.REQUESTS).forEach(function (r) {
    if (str_(r.lineUid) === uid && str_(r.status) === REQ_STATUS.PENDING) {
      Db.update(SHEETS.REQUESTS, r._row, {
        status: REQ_STATUS.APPROVED, handledBy: handler, handledAt: new Date(), memberId: memberId
      });
    }
  });
}

/* ───────────── 活動 ───────────── */

function activeRegsByEvent_() {
  var map = {};
  Db.rows(SHEETS.REGS).forEach(function (r) {
    if (str_(r.status) === REG_STATUS.CANCELLED) return;
    var id = str_(r.eventId);
    (map[id] = map[id] || []).push(r);
  });
  return map;
}

function eventStatus_(ev) {
  return str_(ev.status) || EVENT_STATUS.PUBLISHED;
}

function eventVisible_(ev, ctx) {
  if (eventStatus_(ev) === EVENT_STATUS.DRAFT && !ctx.perms.eventManage) return false;
  return audienceLevel_(ev.audience, ctx.roles) <= ctx.level;
}

function findRow_(sheetName, id) {
  id = str_(id);
  if (!id) return null;
  var rows = Db.rows(sheetName);
  for (var i = 0; i < rows.length; i++) if (str_(rows[i].id) === id) return rows[i];
  return null;
}

/** 回傳不能報名的原因；可以報名回傳空字串 */
function regClosedReason_(ev, ctx, othersTotal, mine) {
  var st = eventStatus_(ev);
  if (st === EVENT_STATUS.CANCELLED) return '活動已取消';
  if (st !== EVENT_STATUS.PUBLISHED) return '活動尚未發布';
  var now = new Date();
  var start = toDate_(ev.start);
  if (start && start <= now) return '活動已開始';
  var dl = toDate_(ev.deadline);
  if (dl && dl < now) return '報名已截止';
  if (ctx.disabled) return '帳號已停用，請洽秘書處';
  if (!ctx.member && audienceLevel_(ev.audience, ctx.roles) > 0) return '限會員報名';
  var cap = num_(ev.capacity, 0);
  if (cap > 0 && !mine && othersTotal >= cap) return '名額已滿';
  return '';
}

function eventOut_(ev, ctx, regsMap, withRegs) {
  var regs = regsMap[str_(ev.id)] || [];
  var mine = null, total = 0, othersTotal = 0;
  regs.forEach(function (r) {
    var c = Math.max(1, num_(r.count, 1));
    total += c;
    if (str_(r.lineUid) === ctx.line.uid) mine = r; else othersTotal += c;
  });
  var reason = regClosedReason_(ev, ctx, othersTotal, mine);
  var out = {
    id: str_(ev.id),
    title: str_(ev.title),
    category: str_(ev.category) || '其他',
    start: toIso_(ev.start),
    end: toIso_(ev.end),
    location: str_(ev.location),
    mapUrl: isHttpsUrl_(ev.mapUrl) ? str_(ev.mapUrl) : '',
    description: str_(ev.description),
    imageUrl: isHttpsUrl_(ev.imageUrl) ? str_(ev.imageUrl) : '',
    audience: str_(ev.audience) || GUEST_ROLE,
    audienceLevel: audienceLevel_(ev.audience, ctx.roles),
    deadline: toIso_(ev.deadline),
    capacity: num_(ev.capacity, 0),
    fee: str_(ev.fee),
    status: eventStatus_(ev),
    regCount: total,
    regPeople: regs.length,
    myReg: mine ? { id: str_(mine.id), count: Math.max(1, num_(mine.count, 1)), note: str_(mine.note) } : null,
    regOpen: !reason,
    regClosedReason: reason,
    createdBy: str_(ev.createdBy)
  };
  if (withRegs && ctx.perms.viewRegs) {
    out.registrations = regs.map(function (r) {
      return {
        name: str_(r.name), phone: normPhone_(r.phone), count: Math.max(1, num_(r.count, 1)),
        note: str_(r.note), memberId: str_(r.memberId), guest: !str_(r.memberId),
        createdAt: toIso_(r.createdAt)
      };
    });
  }
  return out;
}

function visibleEvents_(ctx) {
  var regsMap = activeRegsByEvent_();
  var cutoff = Date.now() - 120 * 86400000; // 只回傳近 120 天內與未來的活動
  return Db.rows(SHEETS.EVENTS).filter(function (ev) {
    if (!str_(ev.id) || !eventVisible_(ev, ctx)) return false;
    var s = toDate_(ev.start);
    return !s || s.getTime() >= cutoff;
  }).map(function (ev) {
    return eventOut_(ev, ctx, regsMap, false);
  }).sort(function (a, b) {
    return (a.start || '').localeCompare(b.start || '');
  });
}

function apiEvent_(ctx, d) {
  var ev = findRow_(SHEETS.EVENTS, d.id);
  if (!ev || !eventVisible_(ev, ctx)) throw apiError_('NOT_FOUND', '找不到這個活動，或你沒有權限查看');
  return eventOut_(ev, ctx, activeRegsByEvent_(), true);
}

function apiRegister_(ctx, d) {
  return withLock_(function () {
    Db.reset();
    var ev = findRow_(SHEETS.EVENTS, d.eventId);
    if (!ev || !eventVisible_(ev, ctx)) throw apiError_('NOT_FOUND', '找不到這個活動');
    var regs = activeRegsByEvent_()[str_(ev.id)] || [];
    var mine = null, othersTotal = 0;
    regs.forEach(function (r) {
      if (str_(r.lineUid) === ctx.line.uid) mine = r;
      else othersTotal += Math.max(1, num_(r.count, 1));
    });
    var reason = regClosedReason_(ev, ctx, othersTotal, mine);
    if (reason) throw apiError_('REG_CLOSED', reason);

    var count = Math.floor(num_(d.count, 1));
    if (count < 1 || count > 10) throw apiError_('INVALID', '報名人數請填 1 到 10 人');
    var cap = num_(ev.capacity, 0);
    if (cap > 0 && othersTotal + count > cap) {
      throw apiError_('FULL', '名額不足，目前只剩 ' + Math.max(0, cap - othersTotal) + ' 位');
    }

    var name, phone, memberId = '';
    if (ctx.member) {
      name = str_(ctx.member.name);
      phone = normPhone_(ctx.member.phone);
      memberId = str_(ctx.member.id);
    } else {
      name = safeText_(d.name, 30);
      phone = normPhone_(d.phone);
      if (!normName_(name)) throw apiError_('INVALID', '請填寫姓名');
      if (!/^09\d{8}$/.test(phone)) throw apiError_('INVALID', '請填寫正確的手機號碼（09 開頭共 10 碼）');
    }
    var now = new Date();
    var note = safeText_(d.note, 200);
    if (mine) {
      Db.update(SHEETS.REGS, mine._row, { count: count, note: note, updatedAt: now });
    } else {
      Db.append(SHEETS.REGS, {
        id: newId_('R'), eventId: str_(ev.id), memberId: memberId, name: name, phone: phoneCell_(phone),
        lineUid: ctx.line.uid, count: count, note: note, status: REG_STATUS.ACTIVE,
        createdAt: now, updatedAt: now
      });
    }
    Db.reset();
    return eventOut_(findRow_(SHEETS.EVENTS, ev.id), ctx, activeRegsByEvent_(), true);
  });
}

function apiCancelRegistration_(ctx, d) {
  return withLock_(function () {
    Db.reset();
    var ev = findRow_(SHEETS.EVENTS, d.eventId);
    if (!ev || !eventVisible_(ev, ctx)) throw apiError_('NOT_FOUND', '找不到這個活動');
    var start = toDate_(ev.start);
    if (start && start <= new Date()) throw apiError_('REG_CLOSED', '活動已開始，無法取消報名');
    var regs = activeRegsByEvent_()[str_(ev.id)] || [];
    var mine = null;
    regs.forEach(function (r) { if (str_(r.lineUid) === ctx.line.uid) mine = r; });
    if (!mine) throw apiError_('NOT_FOUND', '你沒有報名這個活動');
    Db.update(SHEETS.REGS, mine._row, { status: REG_STATUS.CANCELLED, updatedAt: new Date() });
    Db.reset();
    return eventOut_(findRow_(SHEETS.EVENTS, ev.id), ctx, activeRegsByEvent_(), true);
  });
}

function apiSaveEvent_(ctx, d) {
  var e = d.event || {};
  var title = safeText_(e.title, 80);
  if (!title) throw apiError_('INVALID', '請填寫活動標題');
  var start = toDate_(e.start);
  if (!start) throw apiError_('INVALID', '請選擇開始時間');
  var end = toDate_(e.end);
  if (end && end < start) throw apiError_('INVALID', '結束時間不能早於開始時間');
  var deadline = toDate_(e.deadline);
  if (deadline && deadline > start) throw apiError_('INVALID', '報名截止不能晚於活動開始');

  var audience = ctx.roles.byName[str_(e.audience)] ? str_(e.audience) : GUEST_ROLE;
  if (audienceLevel_(audience, ctx.roles) > ctx.level) audience = ctx.roleName; // 不能建立自己看不到的活動
  var status = str_(e.status) === EVENT_STATUS.DRAFT ? EVENT_STATUS.DRAFT : EVENT_STATUS.PUBLISHED;
  var now = new Date();
  var rec = {
    title: title,
    category: EVENT_CATEGORIES.indexOf(str_(e.category)) >= 0 ? str_(e.category) : '其他',
    start: start,
    end: end || '',
    location: safeText_(e.location, 100),
    mapUrl: isHttpsUrl_(e.mapUrl) ? str_(e.mapUrl) : '',
    description: safeText_(e.description, 3000),
    imageUrl: isHttpsUrl_(e.imageUrl) ? str_(e.imageUrl) : '',
    audience: audience,
    deadline: deadline || '',
    capacity: Math.max(0, Math.floor(num_(e.capacity, 0))) || '',
    fee: safeText_(e.fee, 40),
    status: status,
    updatedAt: now
  };

  var id = withLock_(function () {
    Db.reset();
    if (e.id) {
      var row = findRow_(SHEETS.EVENTS, e.id);
      if (!row || !eventVisible_(row, ctx)) throw apiError_('NOT_FOUND', '找不到這個活動');
      if (eventStatus_(row) === EVENT_STATUS.CANCELLED) rec.status = EVENT_STATUS.CANCELLED;
      var oldStart = toDate_(row.start);
      if (!oldStart || oldStart.getTime() !== start.getTime()) rec.reminded = ''; // 改期後重新提醒
      Db.update(SHEETS.EVENTS, row._row, rec);
      return str_(row.id);
    }
    rec.id = newId_('E');
    rec.createdBy = ctx.actorName;
    rec.createdAt = now;
    Db.append(SHEETS.EVENTS, rec);
    return rec.id;
  });

  Db.reset();
  var saved = findRow_(SHEETS.EVENTS, id);
  var result = { event: eventOut_(saved, ctx, activeRegsByEvent_(), true), push: null };
  if (d.notify && eventStatus_(saved) === EVENT_STATUS.PUBLISHED) {
    result.push = notifyAfterSave_(ctx, '活動已儲存', function () {
      return pushToAudience_(ctx, { mode: 'minRole', role: saved.audience },
        [eventFlex_(saved, '新活動')], '新活動：' + str_(saved.title), fmtEventTime_(toDate_(saved.start)) + ' ' + str_(saved.location));
    });
  }
  return result;
}

function apiCancelEvent_(ctx, d) {
  var ev = withLock_(function () {
    Db.reset();
    var row = findRow_(SHEETS.EVENTS, d.id);
    if (!row || !eventVisible_(row, ctx)) throw apiError_('NOT_FOUND', '找不到這個活動');
    Db.update(SHEETS.EVENTS, row._row, { status: EVENT_STATUS.CANCELLED, updatedAt: new Date() });
    Db.reset();
    return findRow_(SHEETS.EVENTS, d.id);
  });
  var result = { event: eventOut_(ev, ctx, activeRegsByEvent_(), true), push: null };
  if (d.notify) {
    if (result.event.regPeople > 0) {
      var reason = safeText_(d.reason, 200);
      result.push = notifyAfterSave_(ctx, '活動已取消', function () {
        return pushToAudience_(ctx, { mode: 'event', eventId: str_(ev.id) },
          [noticeFlex_('活動取消通知', '「' + str_(ev.title) + '」（' + fmtEventTime_(toDate_(ev.start)) + '）已取消。' +
            (reason ? '\n原因：' + reason : '') + '\n造成不便，敬請見諒。', liffUrl_('event/' + str_(ev.id)), '查看活動', '')],
          '活動取消：' + str_(ev.title), reason);
      });
    } else {
      result.push = { skipped: true, message: '活動已取消。目前沒有報名者，不需要通知' };
    }
  }
  return result;
}

/* ───────────── 消息 ───────────── */

function newsStatus_(n) {
  return str_(n.status) || NEWS_STATUS.PUBLISHED;
}

function newsVisible_(n, ctx) {
  if (newsStatus_(n) !== NEWS_STATUS.PUBLISHED && !ctx.perms.newsManage) return false;
  return audienceLevel_(n.audience, ctx.roles) <= ctx.level;
}

function newsOut_(n, ctx) {
  return {
    id: str_(n.id),
    title: str_(n.title),
    category: str_(n.category) || '其他',
    content: str_(n.content),
    imageUrl: isHttpsUrl_(n.imageUrl) ? str_(n.imageUrl) : '',
    audience: str_(n.audience) || GUEST_ROLE,
    audienceLevel: audienceLevel_(n.audience, ctx.roles),
    pinned: bool_(n.pinned),
    status: newsStatus_(n),
    publishedAt: toIso_(n.publishedAt),
    createdBy: str_(n.createdBy)
  };
}

function visibleNews_(ctx) {
  return Db.rows(SHEETS.NEWS).filter(function (n) {
    return str_(n.id) && newsVisible_(n, ctx);
  }).map(function (n) {
    return newsOut_(n, ctx);
  }).sort(function (a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.publishedAt || '9999').localeCompare(a.publishedAt || '9999');
  }).slice(0, 60);
}

function apiSaveNews_(ctx, d) {
  var n = d.news || {};
  var title = safeText_(n.title, 80);
  if (!title) throw apiError_('INVALID', '請填寫標題');
  var content = safeText_(n.content, 5000);
  if (!content) throw apiError_('INVALID', '請填寫內容');
  var audience = ctx.roles.byName[str_(n.audience)] ? str_(n.audience) : GUEST_ROLE;
  if (audienceLevel_(audience, ctx.roles) > ctx.level) audience = ctx.roleName;
  var status = str_(n.status) === NEWS_STATUS.DRAFT ? NEWS_STATUS.DRAFT : NEWS_STATUS.PUBLISHED;
  var now = new Date();
  var rec = {
    title: title,
    category: NEWS_CATEGORIES.indexOf(str_(n.category)) >= 0 ? str_(n.category) : '其他',
    content: content,
    imageUrl: isHttpsUrl_(n.imageUrl) ? str_(n.imageUrl) : '',
    audience: audience,
    pinned: !!n.pinned,
    status: status,
    updatedAt: now
  };

  var id = withLock_(function () {
    Db.reset();
    if (n.id) {
      var row = findRow_(SHEETS.NEWS, n.id);
      if (!row || !newsVisible_(row, ctx)) throw apiError_('NOT_FOUND', '找不到這則消息');
      if (status === NEWS_STATUS.PUBLISHED && !toDate_(row.publishedAt)) rec.publishedAt = now;
      Db.update(SHEETS.NEWS, row._row, rec);
      return str_(row.id);
    }
    rec.id = newId_('N');
    rec.createdBy = ctx.actorName;
    if (status === NEWS_STATUS.PUBLISHED) rec.publishedAt = now;
    Db.append(SHEETS.NEWS, rec);
    return rec.id;
  });

  Db.reset();
  var saved = findRow_(SHEETS.NEWS, id);
  var result = { news: newsOut_(saved, ctx), push: null };
  if (d.notify && newsStatus_(saved) === NEWS_STATUS.PUBLISHED) {
    result.push = notifyAfterSave_(ctx, '消息已發布', function () {
      return pushToAudience_(ctx, { mode: 'minRole', role: saved.audience },
        [newsFlex_(saved)], '消息：' + str_(saved.title), str_(saved.content).substring(0, 100));
    });
  }
  return result;
}

function apiDeleteNews_(ctx, d) {
  return withLock_(function () {
    Db.reset();
    var row = findRow_(SHEETS.NEWS, d.id);
    if (!row || !newsVisible_(row, ctx)) throw apiError_('NOT_FOUND', '找不到這則消息');
    Db.sheet(SHEETS.NEWS).deleteRow(row._row);
    Db.reset();
    return { id: str_(d.id), deleted: true };
  });
}

/* ───────────── 通訊錄 ───────────── */

function apiDirectory_(ctx) {
  return Db.rows(SHEETS.MEMBERS).filter(function (m) {
    return str_(m.name) && isMemberActive_(m) && str_(m.role) !== GUEST_ROLE;
  }).map(function (m) {
    var r = ctx.roles.byName[str_(m.role)];
    return {
      id: str_(m.id), name: str_(m.name), role: str_(m.role), level: r ? r.level : 0,
      title: str_(m.title), company: str_(m.company), phone: normPhone_(m.phone),
      email: str_(m.email), joinYear: str_(m.joinYear)
    };
  }).sort(function (a, b) {
    return (b.level - a.level) || a.id.localeCompare(b.id);
  });
}

/* ───────────── 推播 ───────────── */

/** 儲存後的附帶通知：沒權限、沒連官方帳號或發送失敗，都不影響已儲存的資料 */
function notifyAfterSave_(ctx, what, send) {
  if (!ctx.perms.push) return { skipped: true, message: what + '。你的角色沒有推播權限，所以沒有發送通知' };
  if (!prop_('LINE_CHANNEL_ACCESS_TOKEN')) return { skipped: true, message: what + '。還沒連接 LINE 官方帳號，所以沒有發送通知' };
  try {
    return send();
  } catch (e) {
    return { skipped: true, message: what + '，但通知沒有送出：' + e.message };
  }
}

/** 依對象設定找出收件人 LINE userId */
function resolveAudience_(ctx, aud) {
  aud = aud || {};
  var mode = str_(aud.mode) || 'all';
  if (mode === 'friends') return { broadcast: true, uids: null, label: '所有加入官方帳號的好友' };

  var uids = [];
  var seen = {};
  function add(uid) {
    uid = str_(uid);
    if (uid && !seen[uid]) { seen[uid] = true; uids.push(uid); }
  }

  if (mode === 'event') {
    var ev = findRow_(SHEETS.EVENTS, aud.eventId);
    if (!ev) throw apiError_('NOT_FOUND', '找不到這個活動');
    (activeRegsByEvent_()[str_(ev.id)] || []).forEach(function (r) { add(r.lineUid); });
    return { uids: uids, label: '「' + str_(ev.title) + '」報名者' };
  }

  var members = Db.rows(SHEETS.MEMBERS).filter(function (m) { return isMemberActive_(m) && str_(m.lineUid); });
  var label;
  if (mode === 'roles') {
    var wanted = (aud.roles || []).map(str_);
    if (!wanted.length) throw apiError_('INVALID', '請至少選一個角色');
    members.forEach(function (m) { if (wanted.indexOf(str_(m.role)) >= 0) add(m.lineUid); });
    label = wanted.join('、');
  } else if (mode === 'members') {
    var ids = (aud.memberIds || []).map(str_);
    members.forEach(function (m) { if (ids.indexOf(str_(m.id)) >= 0) add(m.lineUid); });
    label = '指定會員 ' + ids.length + ' 位';
  } else if (mode === 'minRole') {
    var min = audienceLevel_(aud.role, ctx.roles);
    members.forEach(function (m) {
      var r = ctx.roles.byName[str_(m.role)];
      if (r && r.level >= min && r.level > 0) add(m.lineUid);
    });
    label = min > 0 ? str_(aud.role) + '以上' : '全體已綁定會員';
  } else {
    members.forEach(function (m) {
      var r = ctx.roles.byName[str_(m.role)];
      if (r && r.level > 0) add(m.lineUid);
    });
    label = '全體已綁定會員';
  }
  return { uids: uids, label: label };
}

function apiPushPreview_(ctx, d) {
  var target = resolveAudience_(ctx, d.audience);
  var quota = getQuota_();
  var recipients = target.broadcast ? estimateFriends_() : target.uids.length;
  return { label: target.label, recipients: recipients, broadcast: !!target.broadcast, quota: quota };
}

function apiPush_(ctx, d) {
  var title = safeText_(d.title, 60);
  var text = str_(d.text).substring(0, 1500);
  if (!title) throw apiError_('INVALID', '請填寫通知標題');
  if (!text) throw apiError_('INVALID', '請填寫通知內容');
  var link = d.link || {};
  var url = '', label = '查看詳情';
  if (link.type === 'event' && link.id) { url = liffUrl_('event/' + link.id); label = '查看活動'; }
  else if (link.type === 'news' && link.id) { url = liffUrl_('news/' + link.id); label = '閱讀全文'; }
  else if (link.type === 'url' && isHttpsUrl_(link.url)) { url = str_(link.url); label = '開啟連結'; }
  else if (link.type === 'home') { url = liffUrl_(''); label = '開啟會員專區'; }
  var imageUrl = isHttpsUrl_(d.imageUrl) ? str_(d.imageUrl) : '';
  return pushToAudience_(ctx, d.audience, [noticeFlex_(title, text, url, label, imageUrl)], title, text);
}

/**
 * 實際發送：multicast 每次最多 500 人；廣播用 broadcast。
 * 發送前先檢查本月剩餘則數，不夠就不發（避免發到一半被 LINE 擋下）。
 */
function pushToAudience_(ctx, aud, messages, logTitle, logContent) {
  var target = resolveAudience_(ctx, aud);
  var quota = getQuota_();
  var count = 0;
  var result = 'OK';
  try {
    if (target.broadcast) {
      lineApi_('post', '/v2/bot/message/broadcast', { messages: messages });
      count = estimateFriends_();
    } else {
      if (!target.uids.length) throw apiError_('NO_RECIPIENT', '沒有符合的收件人（對方需要先在會員專區完成 LINE 綁定）');
      if (quota.remaining !== null && target.uids.length > quota.remaining) {
        throw apiError_('QUOTA', '本月剩餘訊息 ' + quota.remaining + ' 則，不夠發給 ' + target.uids.length + ' 人。請縮小對象或升級官方帳號方案');
      }
      for (var i = 0; i < target.uids.length; i += 500) {
        lineApi_('post', '/v2/bot/message/multicast', { to: target.uids.slice(i, i + 500), messages: messages });
      }
      count = target.uids.length;
    }
  } catch (err) {
    result = '失敗：' + err.message;
    logPush_(ctx.actorName, target.label, logTitle, logContent, 0, result);
    throw err;
  }
  logPush_(ctx.actorName, target.label, logTitle, logContent, count, result);
  return { sent: count, label: target.label, broadcast: !!target.broadcast };
}

function logPush_(sender, label, title, content, count, result) {
  try {
    Db.append(SHEETS.PUSHLOG, {
      time: new Date(), sender: safeText_(sender, 50), audience: safeText_(label, 100),
      title: safeText_(title, 100), content: safeText_(content, 500), recipients: count === null ? '' : count,
      result: safeText_(result, 200)
    });
  } catch (e) {
    console.error(e);
  }
}

function apiPushLog_() {
  var rows = Db.rows(SHEETS.PUSHLOG);
  return rows.slice(Math.max(0, rows.length - 30)).reverse().map(function (r) {
    return {
      time: toIso_(r.time), sender: str_(r.sender), audience: str_(r.audience), title: str_(r.title),
      content: str_(r.content), recipients: r.recipients === '' ? null : num_(r.recipients, 0), result: str_(r.result)
    };
  });
}

/* ───────────── 會員管理 ───────────── */

function apiMembers_(ctx) {
  return Db.rows(SHEETS.MEMBERS).filter(function (m) { return str_(m.name); }).map(function (m) {
    var r = ctx.roles.byName[str_(m.role)];
    return {
      id: str_(m.id), name: str_(m.name), phone: normPhone_(m.phone), role: str_(m.role),
      level: r ? r.level : 0, roleKnown: !!r, title: str_(m.title), company: str_(m.company),
      email: str_(m.email), joinYear: str_(m.joinYear), status: str_(m.status) || MEMBER_STATUS.ACTIVE,
      bound: !!str_(m.lineUid), lineName: str_(m.lineName), boundAt: toIso_(m.boundAt), note: str_(m.note)
    };
  }).sort(function (a, b) {
    return (b.level - a.level) || a.id.localeCompare(b.id);
  });
}

function guardMemberEdit_(ctx, m) {
  var r = ctx.roles.byName[str_(m.role)];
  if (r && r.level > ctx.level) throw apiError_('FORBIDDEN', '不能修改角色等級比你高的會員');
}

function apiUpdateMember_(ctx, d) {
  return withLock_(function () {
    Db.reset();
    var m = findRow_(SHEETS.MEMBERS, d.id);
    if (!m) throw apiError_('NOT_FOUND', '找不到這位會員');
    guardMemberEdit_(ctx, m);
    var patch = {};
    if (d.role !== undefined) {
      var r = ctx.roles.byName[str_(d.role)];
      if (!r) throw apiError_('INVALID', '沒有「' + d.role + '」這個角色，請先在「權限」工作表新增');
      if (r.level > ctx.level) throw apiError_('FORBIDDEN', '不能指派比自己高的角色');
      patch.role = r.role;
    }
    if (d.status !== undefined) {
      patch.status = str_(d.status) === MEMBER_STATUS.DISABLED ? MEMBER_STATUS.DISABLED : MEMBER_STATUS.ACTIVE;
    }
    if (d.title !== undefined) patch.title = safeText_(d.title, 40);
    if (d.company !== undefined) patch.company = safeText_(d.company, 60);
    Db.update(SHEETS.MEMBERS, m._row, patch);
    Db.reset();
    return memberById_(ctx, d.id);
  });
}

function apiUnbindMember_(ctx, d) {
  return withLock_(function () {
    Db.reset();
    var m = findRow_(SHEETS.MEMBERS, d.id);
    if (!m) throw apiError_('NOT_FOUND', '找不到這位會員');
    guardMemberEdit_(ctx, m);
    Db.update(SHEETS.MEMBERS, m._row, { lineUid: '', lineName: '', boundAt: '' });
    Db.reset();
    return memberById_(ctx, d.id);
  });
}

function memberById_(ctx, id) {
  var list = apiMembers_(ctx);
  for (var i = 0; i < list.length; i++) if (list[i].id === str_(id)) return list[i];
  return null;
}

function nextMemberId_() {
  var max = 0;
  Db.rows(SHEETS.MEMBERS).forEach(function (m) {
    var mm = str_(m.id).match(/^M(\d+)$/);
    if (mm) max = Math.max(max, Number(mm[1]));
  });
  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return 'M' + n;
}

function apiRequests_() {
  var rows = Db.rows(SHEETS.REQUESTS);
  var pending = [], handled = [];
  rows.forEach(function (r) {
    var o = {
      id: str_(r.id), name: str_(r.name), phone: normPhone_(r.phone), lineName: str_(r.lineName),
      note: str_(r.note), status: str_(r.status), createdAt: toIso_(r.createdAt),
      handledBy: str_(r.handledBy), handledAt: toIso_(r.handledAt), memberId: str_(r.memberId)
    };
    if (o.status === REQ_STATUS.PENDING) pending.push(o); else handled.push(o);
  });
  return { pending: pending, handled: handled.reverse().slice(0, 20) };
}

/**
 * 處理綁定申請
 * decision = 'link'   → 綁到既有會員（memberId）
 *          = 'create' → 新增一筆會員（role、title）
 *          = 'reject' → 拒絕
 */
function apiHandleRequest_(ctx, d) {
  var outcome = withLock_(function () {
    Db.reset();
    var req = findRow_(SHEETS.REQUESTS, d.id);
    if (!req) throw apiError_('NOT_FOUND', '找不到這筆申請');
    if (str_(req.status) !== REQ_STATUS.PENDING) throw apiError_('INVALID', '這筆申請已經處理過了');
    var uid = str_(req.lineUid);
    var now = new Date();
    var memberId = '';

    if (d.decision === 'reject') {
      Db.update(SHEETS.REQUESTS, req._row, { status: REQ_STATUS.REJECTED, handledBy: ctx.actorName, handledAt: now });
      return { decision: 'reject', uid: uid };
    }

    var already = Db.rows(SHEETS.MEMBERS).filter(function (m) { return str_(m.lineUid) === uid; })[0];
    if (already) throw apiError_('INVALID', '這個 LINE 帳號已綁定會員 ' + str_(already.name) + '（' + str_(already.id) + '）');

    if (d.decision === 'link') {
      var m = findRow_(SHEETS.MEMBERS, d.memberId);
      if (!m) throw apiError_('NOT_FOUND', '找不到要綁定的會員');
      guardMemberEdit_(ctx, m);
      if (str_(m.lineUid)) throw apiError_('INVALID', str_(m.name) + ' 已經綁定其他 LINE 帳號，請先解除綁定');
      Db.update(SHEETS.MEMBERS, m._row, { lineUid: uid, lineName: str_(req.lineName), boundAt: now });
      memberId = str_(m.id);
    } else if (d.decision === 'create') {
      var r = ctx.roles.byName[str_(d.role)];
      if (!r) throw apiError_('INVALID', '請選擇角色');
      if (r.level > ctx.level) throw apiError_('FORBIDDEN', '不能指派比自己高的角色');
      memberId = nextMemberId_();
      Db.append(SHEETS.MEMBERS, {
        id: memberId, name: safeText_(req.name, 30), phone: phoneCell_(req.phone), role: r.role,
        title: safeText_(d.title, 40), status: MEMBER_STATUS.ACTIVE, joinYear: fmtDate_(now, 'yyyy'),
        note: '由 LINE 綁定申請建立', lineUid: uid, lineName: str_(req.lineName), boundAt: now
      });
    } else {
      throw apiError_('INVALID', '未知的處理方式');
    }
    Db.update(SHEETS.REQUESTS, req._row, {
      status: REQ_STATUS.APPROVED, handledBy: ctx.actorName, handledAt: now, memberId: memberId
    });
    return { decision: d.decision, uid: uid, memberId: memberId };
  });

  if (d.notify && outcome.decision !== 'reject') {
    try {
      pushMessages_(outcome.uid, [noticeFlex_('會員綁定完成', '秘書處已確認你的身分，現在可以使用會員專屬功能了。', liffUrl_(''), '開啟會員專區', '')]);
      logPush_(ctx.actorName, '綁定申請人', '會員綁定完成', '', 1, 'OK');
    } catch (e) {
      outcome.notifyError = e.message;
    }
  }
  Db.reset();
  outcome.requests = apiRequests_();
  return outcome;
}
