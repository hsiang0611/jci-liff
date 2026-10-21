/**
 * Jobs.gs — 排程工作（由試算表選單安裝觸發器）
 *
 * sendEventReminders     每天 18:00：提醒「明天」活動的報名者
 * sendBirthdayGreetings  每天 09:00：祝今天生日的會員生日快樂（選用）
 */

function taipeiDayRange_(offsetDays) {
  var today = fmtDate_(new Date(), 'yyyy-MM-dd');
  var start = new Date(new Date(today + 'T00:00:00+08:00').getTime() + offsetDays * 86400000);
  return { start: start, end: new Date(start.getTime() + 86400000) };
}

function sendEventReminders() {
  Db.reset();
  var range = taipeiDayRange_(1);
  var regsMap = activeRegsByEvent_();
  var sent = [];
  Db.rows(SHEETS.EVENTS).forEach(function (ev) {
    var s = toDate_(ev.start);
    if (!s || s < range.start || s >= range.end) return;
    if (eventStatus_(ev) !== EVENT_STATUS.PUBLISHED || str_(ev.reminded)) return;
    var uids = [], seen = {};
    (regsMap[str_(ev.id)] || []).forEach(function (r) {
      var u = str_(r.lineUid);
      if (u && !seen[u]) { seen[u] = true; uids.push(u); }
    });
    if (uids.length) {
      try {
        for (var i = 0; i < uids.length; i += 500) {
          lineApi_('post', '/v2/bot/message/multicast', { to: uids.slice(i, i + 500), messages: [eventFlex_(ev, '明天見')] });
        }
        logPush_('系統排程', '「' + str_(ev.title) + '」報名者', '明日活動提醒', str_(ev.title), uids.length, 'OK');
      } catch (e) {
        logPush_('系統排程', '「' + str_(ev.title) + '」報名者', '明日活動提醒', str_(ev.title), 0, '失敗：' + e.message);
        return;
      }
    }
    Db.update(SHEETS.EVENTS, ev._row, { reminded: new Date() });
    sent.push(str_(ev.title) + '（' + uids.length + ' 人）');
  });
  console.log('明日活動提醒：' + (sent.join('、') || '無'));
  return sent;
}

function sendBirthdayGreetings() {
  Db.reset();
  var today = fmtDate_(new Date(), 'MM-dd');
  var count = 0;
  Db.rows(SHEETS.MEMBERS).forEach(function (m) {
    if (!isMemberActive_(m) || !str_(m.lineUid)) return;
    var b = toDate_(m.birthday);
    var md = b ? fmtDate_(b, 'MM-dd') : '';
    if (!b) {
      var mm = str_(m.birthday).match(/(\d{1,2})[\/\-](\d{1,2})$/);
      if (mm) md = pad2_(mm[1]) + '-' + pad2_(mm[2]);
    }
    if (md !== today) return;
    try {
      pushMessages_(str_(m.lineUid), [noticeFlex_(str_(m.name) + '，生日快樂！',
        orgName_() + '全體兄弟姊妹祝你生日快樂，新的一歲事業順利、平安健康！', '', '', prop_('BIRTHDAY_IMAGE_URL'))]);
      count++;
    } catch (e) {
      console.error(e);
    }
  });
  if (count) logPush_('系統排程', '當日壽星', '生日祝福', '', count, 'OK');
  return count;
}
