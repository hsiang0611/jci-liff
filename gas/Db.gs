/**
 * Db.gs — 以「標題列文字」讀寫試算表
 *
 * Db.rows('會員') 會回傳 [{ _row: 2, id: 'M001', name: '王小明', ... }]
 * _row 是試算表實際列號，更新時用。
 */

function ss_() {
  if (ss_.cached) return ss_.cached;
  var id = prop_('SPREADSHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw apiError_('NO_SPREADSHEET', '找不到試算表，請先在試算表選單執行「初始化工作表」');
  ss_.cached = ss;
  return ss;
}

var Db = {
  _cache: {},

  /** 每次 API 呼叫開始時清除快取 */
  reset: function () {
    this._cache = {};
  },

  sheet: function (name) {
    var sh = ss_().getSheetByName(name);
    if (!sh) throw apiError_('NO_SHEET', '找不到工作表「' + name + '」，請在試算表選單執行「初始化工作表」');
    return sh;
  },

  read: function (name) {
    if (this._cache[name]) return this._cache[name];
    var sh = this.sheet(name);
    var values = sh.getDataRange().getValues();
    var header = (values[0] || []).map(function (h) { return str_(h); });
    var map = {};
    (SCHEMA[name] || []).forEach(function (pair) {
      var idx = header.indexOf(pair[1]);
      if (idx >= 0) map[pair[0]] = idx;
    });
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var empty = true;
      for (var c = 0; c < row.length; c++) {
        if (row[c] !== '' && row[c] !== null) { empty = false; break; }
      }
      if (empty) continue;
      var obj = { _row: r + 1 };
      for (var key in map) obj[key] = row[map[key]];
      rows.push(obj);
    }
    var table = { rows: rows, map: map, header: header, sheet: sh };
    this._cache[name] = table;
    return table;
  },

  rows: function (name) {
    return this.read(name).rows;
  },

  append: function (name, obj) {
    var t = this.read(name);
    var row = [];
    for (var i = 0; i < t.header.length; i++) row.push('');
    for (var key in t.map) {
      if (obj[key] !== undefined && obj[key] !== null) row[t.map[key]] = obj[key];
    }
    t.sheet.appendRow(row);
    delete this._cache[name];
  },

  /** 只更新 patch 裡有的欄位，不動其他欄位（保留秘書處自己加的公式） */
  update: function (name, rowNum, patch) {
    var t = this.read(name);
    for (var key in patch) {
      if (key === '_row' || !Object.prototype.hasOwnProperty.call(t.map, key)) continue;
      var v = patch[key];
      t.sheet.getRange(rowNum, t.map[key] + 1).setValue(v === null || v === undefined ? '' : v);
    }
    delete this._cache[name];
  }
};
