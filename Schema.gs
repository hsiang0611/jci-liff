/**
 * Schema.gs — 試算表結構定義
 *
 * 每張工作表的第 1 列是中文標題。程式依「標題文字」找欄位，
 * 所以秘書處可以調整欄位順序、或在最右邊加自己的欄位，不會影響系統。
 * 但請不要修改下列標題文字本身。
 */

var TZ = 'Asia/Taipei';

var SHEETS = {
  MEMBERS: '會員',
  ROLES: '權限',
  EVENTS: '活動',
  REGS: '報名',
  NEWS: '消息',
  REQUESTS: '綁定申請',
  PUSHLOG: '推播紀錄'
};

/** 欄位定義：[程式用 key, 試算表標題] */
var SCHEMA = {};
SCHEMA[SHEETS.MEMBERS] = [
  ['id', '會員編號'], ['name', '姓名'], ['phone', '手機'], ['role', '角色'], ['title', '職稱'],
  ['company', '公司/職業'], ['email', 'Email'], ['birthday', '生日'], ['joinYear', '入會年度'],
  ['status', '狀態'], ['note', '備註'],
  ['lineUid', 'LINE_UID'], ['lineName', 'LINE暱稱'], ['boundAt', '綁定時間']
];
SCHEMA[SHEETS.ROLES] = [
  ['role', '角色'], ['level', '等級'],
  ['directory', '查看通訊錄'], ['eventManage', '管理活動'], ['newsManage', '管理消息'],
  ['viewRegs', '查看報名名單'], ['push', '發送推播'], ['memberManage', '管理會員'],
  ['desc', '說明']
];
SCHEMA[SHEETS.EVENTS] = [
  ['id', '活動編號'], ['title', '標題'], ['category', '類別'], ['start', '開始時間'], ['end', '結束時間'],
  ['location', '地點'], ['mapUrl', '地圖連結'], ['description', '說明'], ['imageUrl', '圖片網址'],
  ['audience', '可見對象'], ['deadline', '報名截止'], ['capacity', '名額'], ['fee', '費用'],
  ['status', '狀態'], ['reminded', '已提醒'],
  ['createdBy', '建立者'], ['createdAt', '建立時間'], ['updatedAt', '更新時間']
];
SCHEMA[SHEETS.REGS] = [
  ['id', '報名編號'], ['eventId', '活動編號'], ['memberId', '會員編號'], ['name', '姓名'], ['phone', '手機'],
  ['lineUid', 'LINE_UID'], ['count', '人數'], ['note', '備註'], ['status', '狀態'],
  ['createdAt', '報名時間'], ['updatedAt', '更新時間']
];
SCHEMA[SHEETS.NEWS] = [
  ['id', '消息編號'], ['title', '標題'], ['category', '類別'], ['content', '內容'], ['imageUrl', '圖片網址'],
  ['audience', '可見對象'], ['pinned', '置頂'], ['status', '狀態'], ['publishedAt', '發布時間'],
  ['createdBy', '發布者'], ['updatedAt', '更新時間']
];
SCHEMA[SHEETS.REQUESTS] = [
  ['id', '申請編號'], ['name', '姓名'], ['phone', '手機'], ['lineUid', 'LINE_UID'], ['lineName', 'LINE暱稱'],
  ['note', '備註'], ['status', '狀態'], ['createdAt', '申請時間'],
  ['handledBy', '處理者'], ['handledAt', '處理時間'], ['memberId', '對應會員編號']
];
SCHEMA[SHEETS.PUSHLOG] = [
  ['time', '時間'], ['sender', '發送者'], ['audience', '對象'], ['title', '標題'], ['content', '內容'],
  ['recipients', '人數'], ['result', '結果']
];

/** 權限代碼與中文名稱（前端顯示用） */
var PERM_KEYS = ['directory', 'eventManage', 'newsManage', 'viewRegs', 'push', 'memberManage'];

/** 未綁定、不在名單或已停用的 LINE 使用者一律視為此角色 */
var GUEST_ROLE = '訪客';

/** 預設權限表（初始化時寫入「權限」工作表，之後以試算表內容為準） */
var DEFAULT_ROLES = [
  // 角色,     等級, 通訊錄, 活動, 消息, 報名名單, 推播, 會員, 說明
  ['管理員',   90, true,  true,  true,  true,  true,  true,  '會長、秘書長、秘書處：可管理一切並發送推播'],
  ['幹部',     70, true,  true,  true,  true,  false, false, '副會長、理監事、主委：可發布活動與消息、看報名名單'],
  ['會員',     50, true,  false, false, false, false, false, '正式會員'],
  ['特友',     40, true,  false, false, false, false, false, '特友會（超齡會友）'],
  ['預備會員', 20, false, false, false, false, false, false, '新朋友、輔導入會中'],
  [GUEST_ROLE,  0, false, false, false, false, false, false, '未綁定或不在名單的 LINE 使用者，只看得到公開內容']
];

var EVENT_CATEGORIES = ['例會', '理監事會', '訓練', '公益服務', '聯誼', '國際交流', '其他'];
var NEWS_CATEGORIES = ['會務公告', '活動花絮', '會員動態', '國際青商', '其他'];
var EVENT_STATUS = { DRAFT: '草稿', PUBLISHED: '發布', CANCELLED: '取消' };
var NEWS_STATUS = { DRAFT: '草稿', PUBLISHED: '發布' };
var MEMBER_STATUS = { ACTIVE: '啟用', DISABLED: '停用' };
var REG_STATUS = { ACTIVE: '報名', CANCELLED: '取消' };
var REQ_STATUS = { PENDING: '待審核', APPROVED: '已核准', REJECTED: '已拒絕' };
