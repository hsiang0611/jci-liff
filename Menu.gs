/**
 * Menu.gs — 試算表上方的「會員系統」選單：初始化、設定金鑰、排程
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('會員系統')
    .addItem('1. 初始化／修復工作表', 'setupSheets')
    .addItem('2. 設定 LINE 金鑰', 'promptSettings')
    .addItem('3. 檢查設定', 'checkConfig')
    .addSeparator()
    .addItem('安裝每日活動提醒（18:00）', 'installReminderTrigger')
    .addItem('安裝壽星祝福（09:00，選用）', 'installBirthdayTrigger')
    .addItem('立即寄出明日活動提醒', 'runRemindersNow')
    .addSeparator()
    .addItem('載入示範資料', 'loadDemoData')
    .addToUi();
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function headerIndex_(sh, label) {
  var lastCol = sh.getLastColumn();
  if (!lastCol) return 0;
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
  return header.indexOf(label) + 1; // 1-based；找不到回傳 0
}

function ensureSheet_(ss, name) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var labels = SCHEMA[name].map(function (p) { return p[1]; });
  var lastCol = sh.getLastColumn();
  var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(str_) : [];
  var missing = labels.filter(function (l) { return header.indexOf(l) < 0; });
  if (missing.length) sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
  var width = sh.getLastColumn();
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#E8F1F8').setFontColor('#13243A');
  sh.setFrozenRows(1);
  return sh;
}

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  setProp_('SPREADSHEET_ID', ss.getId());

  var sheets = {};
  Object.keys(SCHEMA).forEach(function (name) { sheets[name] = ensureSheet_(ss, name); });

  // 預設權限表
  var roleSh = sheets[SHEETS.ROLES];
  if (roleSh.getLastRow() < 2) {
    var labels = SCHEMA[SHEETS.ROLES].map(function (p) { return p[1]; });
    var header = roleSh.getRange(1, 1, 1, roleSh.getLastColumn()).getValues()[0].map(str_);
    var rows = DEFAULT_ROLES.map(function (d) {
      var row = header.map(function () { return ''; });
      labels.forEach(function (label, i) {
        var idx = header.indexOf(label);
        if (idx >= 0) row[idx] = d[i];
      });
      return row;
    });
    roleSh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }

  var MAXR = 1000;
  function rangeOf(sh, label) {
    var c = headerIndex_(sh, label);
    return c ? sh.getRange(2, c, MAXR - 1, 1) : null;
  }
  function listRule(values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  }
  var roleCol = colLetter_(headerIndex_(roleSh, '角色'));
  var roleRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(roleSh.getRange(roleCol + '2:' + roleCol + '50'), true).setAllowInvalid(false).build();
  var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().build();

  // 權限：勾選框
  PERM_KEYS.forEach(function (k) {
    var label = SCHEMA[SHEETS.ROLES].filter(function (p) { return p[0] === k; })[0][1];
    var r = rangeOf(roleSh, label);
    if (r) r.setDataValidation(checkbox);
  });

  // 會員
  var mem = sheets[SHEETS.MEMBERS];
  rangeOf(mem, '手機').setNumberFormat('@');
  rangeOf(mem, '角色').setDataValidation(roleRule);
  rangeOf(mem, '狀態').setDataValidation(listRule([MEMBER_STATUS.ACTIVE, MEMBER_STATUS.DISABLED]));
  rangeOf(mem, '生日').setNumberFormat('yyyy/mm/dd');
  rangeOf(mem, '綁定時間').setNumberFormat('yyyy/mm/dd hh:mm');

  // 活動
  var ev = sheets[SHEETS.EVENTS];
  rangeOf(ev, '類別').setDataValidation(listRule(EVENT_CATEGORIES));
  rangeOf(ev, '可見對象').setDataValidation(roleRule);
  rangeOf(ev, '狀態').setDataValidation(listRule([EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED, EVENT_STATUS.CANCELLED]));
  ['開始時間', '結束時間', '報名截止', '已提醒', '建立時間', '更新時間'].forEach(function (l) {
    var r = rangeOf(ev, l);
    if (r) r.setNumberFormat('yyyy/mm/dd hh:mm');
  });

  // 消息
  var news = sheets[SHEETS.NEWS];
  rangeOf(news, '類別').setDataValidation(listRule(NEWS_CATEGORIES));
  rangeOf(news, '可見對象').setDataValidation(roleRule);
  rangeOf(news, '狀態').setDataValidation(listRule([NEWS_STATUS.DRAFT, NEWS_STATUS.PUBLISHED]));
  rangeOf(news, '置頂').setDataValidation(checkbox);
  ['發布時間', '更新時間'].forEach(function (l) { rangeOf(news, l).setNumberFormat('yyyy/mm/dd hh:mm'); });

  // 報名、申請、推播紀錄
  rangeOf(sheets[SHEETS.REGS], '手機').setNumberFormat('@');
  ['報名時間', '更新時間'].forEach(function (l) { rangeOf(sheets[SHEETS.REGS], l).setNumberFormat('yyyy/mm/dd hh:mm'); });
  rangeOf(sheets[SHEETS.REQUESTS], '手機').setNumberFormat('@');
  ['申請時間', '處理時間'].forEach(function (l) { rangeOf(sheets[SHEETS.REQUESTS], l).setNumberFormat('yyyy/mm/dd hh:mm'); });
  rangeOf(sheets[SHEETS.PUSHLOG], '時間').setNumberFormat('yyyy/mm/dd hh:mm');

  // 移除空白的預設工作表
  ['工作表1', 'Sheet1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  SpreadsheetApp.getUi().alert('工作表已就緒。\n\n下一步：\n1. 在「會員」填入會員清單（至少把自己設為「管理員」）\n2. 選單「設定 LINE 金鑰」\n3. 部署成網頁應用程式');
}

function promptSettings() {
  var ui = SpreadsheetApp.getUi();
  var fields = [
    ['LINE_CHANNEL_ACCESS_TOKEN', 'Messaging API channel 的 Channel access token（long-lived）', true],
    ['LINE_LOGIN_CHANNEL_ID', 'LINE Login channel 的 Channel ID（LIFF 建在這個 channel 底下）', false],
    ['LIFF_ID', 'LIFF ID（例如 2001234567-AbCdEfGh）', false],
    ['ORG_NAME', '組織名稱（顯示在推播訊息上，預設：龍井國際青年商會）', false]
  ];
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i][0];
    var cur = prop_(key);
    var hint = cur ? (fields[i][2] ? '\n\n目前已設定，留空表示不變更。' : '\n\n目前：' + cur + '（留空表示不變更）') : '';
    var r = ui.prompt('設定 ' + key, fields[i][1] + hint, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) setProp_(key, v);
  }
  ui.alert('設定已儲存。可以用「檢查設定」確認金鑰是否有效。');
}

function checkConfig() {
  var lines = [];
  ['SPREADSHEET_ID', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_LOGIN_CHANNEL_ID', 'LIFF_ID'].forEach(function (k) {
    lines.push((prop_(k) ? '✅ ' : '❌ ') + k);
  });
  if (prop_('LINE_CHANNEL_ACCESS_TOKEN')) {
    var q = getQuota_();
    if (q.error) lines.push('\n❌ Messaging API 金鑰測試失敗：' + q.error);
    else lines.push('\n✅ Messaging API 連線正常。本月已用 ' + q.used + ' 則' + (q.limit === null ? '（無上限方案）' : '，上限 ' + q.limit + ' 則，剩 ' + q.remaining + ' 則'));
  }
  Db.reset();
  try {
    var roles = loadRoles_();
    var members = Db.rows(SHEETS.MEMBERS);
    var admins = members.filter(function (m) {
      var r = roles.byName[str_(m.role)];
      return r && r.perms.memberManage && isMemberActive_(m);
    });
    var bound = members.filter(function (m) { return str_(m.lineUid); }).length;
    lines.push('\n會員 ' + members.length + ' 位，已綁定 LINE ' + bound + ' 位，可管理會員者 ' + admins.length + ' 位');
    if (!admins.length) lines.push('⚠️ 還沒有任何「管理員」，請在「會員」工作表把自己的角色設為管理員');
    var unknown = members.filter(function (m) { return str_(m.role) && !roles.byName[str_(m.role)]; });
    if (unknown.length) lines.push('⚠️ 有 ' + unknown.length + ' 位會員的角色不在「權限」表內，會被當成訪客：' + unknown.map(function (m) { return m.name; }).join('、'));
  } catch (e) {
    lines.push('\n❌ ' + e.message);
  }
  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  lines.push('\n排程：' + (triggers.length ? triggers.join('、') : '尚未安裝'));
  SpreadsheetApp.getUi().alert('設定檢查', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function replaceTrigger_(fn, hour) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(hour).inTimezone(TZ).create();
}

function installReminderTrigger() {
  replaceTrigger_('sendEventReminders', 18);
  SpreadsheetApp.getUi().alert('已安裝：每天 18:00 左右提醒「明天」活動的報名者。\n每場活動只會提醒一次，改期後會重新提醒。');
}

function installBirthdayTrigger() {
  replaceTrigger_('sendBirthdayGreetings', 9);
  SpreadsheetApp.getUi().alert('已安裝：每天 09:00 左右祝當天生日的會員生日快樂（需在「會員」填生日）。\n每位壽星會用掉 1 則訊息額度。');
}

function runRemindersNow() {
  var sent = sendEventReminders();
  SpreadsheetApp.getUi().alert(sent.length ? '已提醒：\n' + sent.join('\n') : '明天沒有需要提醒的活動（或已提醒過）。');
}

/** 載入示範資料，方便第一次測試。正式使用前可直接刪除這些列。 */
function loadDemoData() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('載入示範資料', '會在「會員」「活動」「消息」新增幾筆示範資料，確定嗎？', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  Db.reset();
  var now = new Date();
  function at(days, hh, mm) {
    var d = fmtDate_(new Date(now.getTime() + days * 86400000), 'yyyy-MM-dd');
    return new Date(d + 'T' + pad2_(hh) + ':' + pad2_(mm || 0) + ':00+08:00');
  }
  [
    ['M901', '示範會長', '0900000001', '管理員', '會長', '示範建設', '1990/03/12', '2018'],
    ['M902', '示範秘書長', '0900000002', '管理員', '秘書長', '示範會計事務所', '1993/07/08', '2020'],
    ['M903', '示範理事', '0900000003', '幹部', '理事', '示範餐飲', '1991/11/20', '2019'],
    ['M904', '示範會員', '0900000004', '會員', '會員', '示範科技', '1995/01/05', '2022'],
    ['M905', '示範特友', '0900000005', '特友', '特友', '示範貿易', '1980/05/30', '2010'],
    ['M906', '示範新朋友', '0900000006', '預備會員', '', '示範設計', '1998/09/09', '2026']
  ].forEach(function (r) {
    Db.append(SHEETS.MEMBERS, {
      id: r[0], name: r[1], phone: phoneCell_(r[2]), role: r[3], title: r[4], company: r[5],
      birthday: new Date(r[6].replace(/\//g, '-') + 'T00:00:00+08:00'), joinYear: r[7], status: MEMBER_STATUS.ACTIVE
    });
  });
  [
    ['E-DEMO-1', ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][Number(fmtDate_(at(7, 19, 0), 'M'))] + '月份月例會', '例會', at(7, 19, 0), at(7, 21, 30), '龍井區公所 3 樓禮堂', '會員', at(5, 23, 59), 0, '會員免費，眷屬 300 元'],
    ['E-DEMO-2', '海線淨灘公益服務', '公益服務', at(12, 8, 0), at(12, 11, 30), '麗水漁港旁沙灘', GUEST_ROLE, at(10, 18, 0), 60, '免費'],
    ['E-DEMO-3', '理監事會議', '理監事會', at(3, 19, 30), at(3, 21, 0), '會館會議室', '幹部', '', 0, ''],
    ['E-DEMO-4', '年度會員大會暨交接', '例會', at(40, 17, 30), at(40, 21, 0), '台中港區飯店宴會廳', '預備會員', at(30, 23, 59), 200, '每位 1,200 元']
  ].forEach(function (r) {
    Db.append(SHEETS.EVENTS, {
      id: r[0], title: r[1], category: r[2], start: r[3], end: r[4], location: r[5], audience: r[6],
      deadline: r[7], capacity: r[8] || '', fee: r[9], status: EVENT_STATUS.PUBLISHED,
      description: '這是示範活動，正式使用前請刪除。', createdBy: '示範資料', createdAt: now, updatedAt: now
    });
  });
  [
    ['N-DEMO-1', '年費繳交提醒', '會務公告', '今年度會費請於 12 月底前繳交，可轉帳或於例會現場繳交。', '會員', true],
    ['N-DEMO-2', '十月淨灘活動花絮', '活動花絮', '感謝 32 位會友與眷屬參加，共清出 180 公斤垃圾。', GUEST_ROLE, false]
  ].forEach(function (r) {
    Db.append(SHEETS.NEWS, {
      id: r[0], title: r[1], category: r[2], content: r[3], audience: r[4], pinned: r[5],
      status: NEWS_STATUS.PUBLISHED, publishedAt: now, createdBy: '示範資料', updatedAt: now
    });
  });
  ui.alert('示範資料已載入。示範會員的手機是 0900000001～0900000006，可用來測試綁定。');
}
