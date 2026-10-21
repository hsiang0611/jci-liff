/**
 * Auth.gs — 驗證 LINE 身分並依會員清單決定權限
 *
 * 前端用 liff.getIDToken() 取得 ID Token，後端向 LINE 驗證後取得 userId（sub），
 * 再到「會員」工作表找 LINE_UID 對應的會員，依「角色」欄到「權限」工作表查權限。
 * 前端送來的任何身分資料都不採信，一律以驗證結果為準。
 */

function verifyIdToken_(idToken) {
  if (!idToken) throw apiError_('NO_TOKEN', '缺少登入憑證，請從 LINE 開啟');
  var channelId = prop_('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw apiError_('NOT_CONFIGURED', '後端尚未設定 LINE_LOGIN_CHANNEL_ID');

  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8));
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true
  });
  var body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = {}; }
  if (res.getResponseCode() !== 200) {
    var desc = str_(body.error_description);
    if (/expired/i.test(desc)) throw apiError_('TOKEN_EXPIRED', '登入已逾時，正在重新登入');
    throw apiError_('TOKEN_INVALID', '登入驗證失敗（' + (desc || res.getResponseCode()) + '）');
  }

  var info = { uid: body.sub, name: str_(body.name), picture: str_(body.picture) };
  var remain = Number(body.exp) - Math.floor(Date.now() / 1000);
  if (remain > 90) cache.put(key, JSON.stringify(info), Math.min(21600, remain - 60));
  return info;
}

/** 讀取「權限」工作表 → { list: [...依等級排序], byName: { 角色: {...} } } */
function loadRoles_() {
  var list = Db.rows(SHEETS.ROLES).map(function (r) {
    var role = { role: str_(r.role), level: num_(r.level, 0), desc: str_(r.desc), perms: {} };
    PERM_KEYS.forEach(function (k) { role.perms[k] = bool_(r[k]); });
    return role;
  }).filter(function (r) { return r.role; });
  list.sort(function (a, b) { return b.level - a.level; });
  var byName = {};
  list.forEach(function (r) { byName[r.role] = r; });
  if (!byName[GUEST_ROLE]) {
    var guest = { role: GUEST_ROLE, level: 0, desc: '', perms: {} };
    PERM_KEYS.forEach(function (k) { guest.perms[k] = false; });
    byName[GUEST_ROLE] = guest;
    list.push(guest);
  }
  return { list: list, byName: byName };
}

/** 「可見對象」欄（角色名稱）→ 最低等級；空白或「公開」視為訪客等級 */
function audienceLevel_(audience, roles) {
  var a = str_(audience);
  if (!a || a === '公開' || a === '全部') return 0;
  var r = roles.byName[a];
  return r ? r.level : 0;
}

function isMemberActive_(m) {
  var s = str_(m.status);
  return !s || s === MEMBER_STATUS.ACTIVE;
}

/** 依 LINE userId 建立本次請求的使用者情境 */
function contextForUid_(lineUser) {
  var roles = loadRoles_();
  var members = Db.rows(SHEETS.MEMBERS);
  var found = null;
  for (var i = 0; i < members.length; i++) {
    if (str_(members[i].lineUid) === lineUser.uid) { found = members[i]; break; }
  }
  var disabled = !!(found && !isMemberActive_(found));
  var member = (found && !disabled) ? found : null;
  var roleName = member ? (str_(member.role) || GUEST_ROLE) : GUEST_ROLE;
  var role = roles.byName[roleName] || roles.byName[GUEST_ROLE];
  return {
    line: lineUser,
    member: member,
    disabled: disabled,
    roleName: roleName,
    level: role.level,
    perms: role.perms,
    roles: roles,
    actorName: member ? str_(member.name) : (lineUser.name || 'LINE 使用者')
  };
}

/** 回傳給前端的「我」 */
function meOut_(ctx) {
  var m = ctx.member;
  return {
    uid: ctx.line.uid,
    lineName: ctx.line.name,
    picture: ctx.line.picture,
    bound: !!m,
    disabled: ctx.disabled,
    role: ctx.roleName,
    level: ctx.level,
    perms: ctx.perms,
    member: m ? {
      id: str_(m.id),
      name: str_(m.name),
      phone: normPhone_(m.phone),
      title: str_(m.title),
      company: str_(m.company),
      email: str_(m.email),
      joinYear: str_(m.joinYear)
    } : null,
    pendingRequest: m ? null : pendingRequestFor_(ctx.line.uid)
  };
}

function pendingRequestFor_(uid) {
  var reqs = Db.rows(SHEETS.REQUESTS);
  for (var i = reqs.length - 1; i >= 0; i--) {
    if (str_(reqs[i].lineUid) === uid && str_(reqs[i].status) === REQ_STATUS.PENDING) {
      return { id: str_(reqs[i].id), name: str_(reqs[i].name), createdAt: toIso_(reqs[i].createdAt) };
    }
  }
  return null;
}
