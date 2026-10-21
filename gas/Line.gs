/**
 * Line.gs — LINE Messaging API：推播、回覆、Flex 訊息、Webhook
 *
 * 計費提醒（台灣官方帳號）：push / multicast / broadcast 依「收到的人數」計算則數，
 * reply（回覆使用者訊息）不計費。所以「查活動」這類需求盡量讓使用者自己打開 LIFF
 * 或傳關鍵字觸發回覆，推播只留給重要通知。
 */

var BRAND_COLOR = '#0567B1';
var ACCENT_COLOR = '#E8590C';

function lineApi_(method, path, payload) {
  var token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw apiError_('NOT_CONFIGURED', '後端尚未設定 LINE_CHANNEL_ACCESS_TOKEN');
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var res = UrlFetchApp.fetch('https://api.line.me' + path, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 300) {
    var msg = text;
    try {
      var j = JSON.parse(text);
      msg = j.message + (j.details ? '：' + j.details.map(function (x) { return x.property + ' ' + x.message; }).join('；') : '');
    } catch (e) { /* 保留原文 */ }
    throw apiError_('LINE_API', 'LINE 回應錯誤（' + code + '）' + msg);
  }
  return text ? JSON.parse(text) : {};
}

function pushMessages_(uid, messages) {
  return lineApi_('post', '/v2/bot/message/push', { to: uid, messages: messages });
}

function replyMessages_(replyToken, messages) {
  return lineApi_('post', '/v2/bot/message/reply', { replyToken: replyToken, messages: messages });
}

/** 本月訊息額度：{ limit, used, remaining }；無上限方案 limit/remaining 為 null */
function getQuota_() {
  try {
    var q = lineApi_('get', '/v2/bot/message/quota');
    var c = lineApi_('get', '/v2/bot/message/quota/consumption');
    var limit = q.type === 'limited' ? num_(q.value, 0) : null;
    var used = num_(c.totalUsage, 0);
    return { limit: limit, used: used, remaining: limit === null ? null : Math.max(0, limit - used) };
  } catch (e) {
    return { limit: null, used: null, remaining: null, error: e.message };
  }
}

/** 以昨天的好友統計估算廣播人數（LINE 只提供前一天以前的數字） */
function estimateFriends_() {
  try {
    var y = new Date(Date.now() - 86400000);
    var r = lineApi_('get', '/v2/bot/insight/followers?date=' + fmtDate_(y, 'yyyyMMdd'));
    if (r.status !== 'ready') return null;
    return Math.max(0, num_(r.followers, 0) - num_(r.blocks, 0));
  } catch (e) {
    return null;
  }
}

/** 產生開啟 LIFF 的連結，to 例如 'event/E261021-AB12' */
function liffUrl_(to) {
  var url = 'https://liff.line.me/' + prop_('LIFF_ID');
  return to ? url + '?to=' + encodeURIComponent(to) : url;
}

function orgName_() {
  return prop_('ORG_NAME', '龍井國際青年商會');
}

/* ───────────── Flex 訊息 ───────────── */

function flexText_(text, opts) {
  var t = { type: 'text', text: String(text || ' '), wrap: true };
  for (var k in (opts || {})) t[k] = opts[k];
  return t;
}

function flexInfoRow_(label, value) {
  return {
    type: 'box', layout: 'baseline', spacing: 'md',
    contents: [
      flexText_(label, { size: 'sm', color: '#8A94A3', flex: 2 }),
      flexText_(value, { size: 'sm', color: '#13243A', flex: 7 })
    ]
  };
}

function flexButton_(label, uri) {
  return {
    type: 'button', style: 'primary', color: BRAND_COLOR, height: 'sm',
    action: { type: 'uri', label: label.substring(0, 20), uri: uri }
  };
}

function eventBubble_(ev, tag) {
  var start = toDate_(ev.start);
  var rows = [flexInfoRow_('時間', fmtEventTime_(start) || '另行通知')];
  if (str_(ev.location)) rows.push(flexInfoRow_('地點', str_(ev.location)));
  if (str_(ev.fee)) rows.push(flexInfoRow_('費用', str_(ev.fee)));
  var bubble = {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        flexText_((tag ? tag + '｜' : '') + (str_(ev.category) || '活動'), { size: 'xs', color: tag ? ACCENT_COLOR : BRAND_COLOR, weight: 'bold' }),
        flexText_(str_(ev.title), { size: 'lg', weight: 'bold', color: '#13243A' }),
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md', contents: rows }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [flexButton_('查看與報名', liffUrl_('event/' + str_(ev.id)))]
    }
  };
  if (isHttpsUrl_(ev.imageUrl)) {
    bubble.hero = { type: 'image', url: str_(ev.imageUrl), size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  }
  return bubble;
}

function eventFlex_(ev, tag) {
  return {
    type: 'flex',
    altText: ('【' + (tag || '活動') + '】' + str_(ev.title) + ' ' + fmtEventTime_(toDate_(ev.start))).substring(0, 400),
    contents: eventBubble_(ev, tag)
  };
}

function newsFlex_(n) {
  var content = str_(n.content);
  if (content.length > 120) content = content.substring(0, 120) + '…';
  var bubble = {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        flexText_(str_(n.category) || '消息', { size: 'xs', color: BRAND_COLOR, weight: 'bold' }),
        flexText_(str_(n.title), { size: 'lg', weight: 'bold', color: '#13243A' }),
        flexText_(content, { size: 'sm', color: '#4A5565' })
      ]
    },
    footer: { type: 'box', layout: 'vertical', contents: [flexButton_('閱讀全文', liffUrl_('news/' + str_(n.id)))] }
  };
  if (isHttpsUrl_(n.imageUrl)) {
    bubble.hero = { type: 'image', url: str_(n.imageUrl), size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  }
  return { type: 'flex', altText: ('【' + (str_(n.category) || '消息') + '】' + str_(n.title)).substring(0, 400), contents: bubble };
}

function noticeFlex_(title, text, url, label, imageUrl) {
  var bubble = {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        flexText_(orgName_(), { size: 'xs', color: BRAND_COLOR, weight: 'bold' }),
        flexText_(title, { size: 'lg', weight: 'bold', color: '#13243A' }),
        flexText_(text, { size: 'sm', color: '#4A5565' })
      ]
    }
  };
  if (url) bubble.footer = { type: 'box', layout: 'vertical', contents: [flexButton_(label || '查看詳情', url)] };
  if (imageUrl) bubble.hero = { type: 'image', url: imageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  return { type: 'flex', altText: (title + '：' + text).substring(0, 400), contents: bubble };
}

function notifyAdminsOfRequest_(req) {
  var roles = loadRoles_();
  var uids = Db.rows(SHEETS.MEMBERS).filter(function (m) {
    var r = roles.byName[str_(m.role)];
    return r && r.perms.memberManage && isMemberActive_(m) && str_(m.lineUid);
  }).map(function (m) { return str_(m.lineUid); });
  if (!uids.length) return;
  lineApi_('post', '/v2/bot/message/multicast', {
    to: uids.slice(0, 500),
    messages: [noticeFlex_('新的綁定申請', req.name + '（' + normPhone_(req.phone) + '）申請綁定會員，請到管理功能審核。',
      liffUrl_('admin/requests'), '前往審核', '')]
  });
}

/* ───────────── Webhook（使用者傳訊息給官方帳號） ───────────── */

/**
 * 注意：Apps Script 讀不到 HTTP 標頭，無法驗證 X-Line-Signature。
 * 因此這裡只做「回覆」：回覆需要 LINE 核發的 replyToken，偽造的請求無法觸發任何發送，
 * 也不會修改任何資料。
 */
function handleWebhook_(body) {
  (body.events || []).forEach(function (ev) {
    try {
      if (!ev.replyToken) return;
      if (ev.type === 'follow') {
        replyMessages_(ev.replyToken, [noticeFlex_('歡迎加入' + orgName_(),
          '會員請點下方按鈕，用姓名與手機完成綁定，就能報名活動、收到會務通知。\n\n想看近期活動，隨時傳「活動」給我們。',
          liffUrl_(''), '開啟會員專區', '')]);
        return;
      }
      if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
      var text = str_(ev.message.text);
      if (/^(活動|近期活動|行事曆)$/.test(text)) {
        replyUpcomingEvents_(ev);
      } else if (/^(會員|會員專區|綁定|選單)$/.test(text)) {
        replyMessages_(ev.replyToken, [noticeFlex_('會員專區', '活動報名、最新消息、會員通訊錄都在這裡。', liffUrl_(''), '開啟會員專區', '')]);
      }
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
    }
  });
}

function replyUpcomingEvents_(ev) {
  Db.reset();
  var uid = ev.source && ev.source.userId ? ev.source.userId : '';
  var ctx = contextForUid_({ uid: uid || '-', name: '', picture: '' });
  var now = Date.now();
  var list = Db.rows(SHEETS.EVENTS).filter(function (e) {
    var s = toDate_(e.start);
    return str_(e.id) && eventStatus_(e) === EVENT_STATUS.PUBLISHED && eventVisible_(e, ctx) && s && s.getTime() > now;
  }).sort(function (a, b) {
    return toDate_(a.start) - toDate_(b.start);
  }).slice(0, 5);
  if (!list.length) {
    replyMessages_(ev.replyToken, [{ type: 'text', text: '近期沒有排定的活動，有新活動會第一時間通知你。' }]);
    return;
  }
  replyMessages_(ev.replyToken, [{
    type: 'flex',
    altText: '近期活動（' + list.length + ' 場）',
    contents: { type: 'carousel', contents: list.map(function (e) { return eventBubble_(e, ''); }) }
  }]);
}
