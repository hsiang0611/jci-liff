/**
 * Code.gs — Web App 進入點
 *
 * 部署：試算表 → 擴充功能 → Apps Script → 部署 → 新增部署作業 → 網頁應用程式
 *       執行身分：我　｜　存取權：所有人
 *
 * 同一個網址同時處理兩種請求：
 *   1. LIFF 前端：{ action, idToken, data }
 *   2. LINE Webhook：{ destination, events: [...] }
 */

function doGet() {
  return json_({ ok: true, service: orgName_() + ' 會員系統 API', time: new Date().toISOString() });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: { code: 'BAD_JSON', message: '請求格式錯誤' } });
  }
  if (body && Array.isArray(body.events) && body.destination !== undefined) {
    handleWebhook_(body);
    return json_({ ok: true });
  }
  return json_(handleApi_(body || {}));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
