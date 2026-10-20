/**
 * 漢字タワー ランキングサーバー（Google Apps Script）
 *
 * Google スプレッドシートを保存先にした、みんなで競うランキング。
 * 設定手順は docs/ranking-setup.md を参照。
 *
 * API
 *   GET  ?action=top                 → { ok, rows }
 *   POST {"action":"submit", ...}    → { ok, improved, rows }
 *     body: { playerId, secret, name, score, height, kanji }
 *
 * 1人1行（playerId ごとの自己ベスト）。secret が一致しないと上書きできない。
 * secret はゲームを遊んだブラウザにだけ保存されていて、ランキングには公開しない。
 */

var SHEET_NAME = "scores";
var HEADER = ["playerId", "secret", "name", "score", "height", "kanji", "at"];
var TOP_LIMIT = 10;
var MAX_SCORE = 300;

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "top";
  if (action !== "top") return json_({ ok: false, error: "unknown_action" });
  return json_({ ok: true, rows: topRows_(readAll_()) });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "bad_json" });
  }
  if (body.action !== "submit") return json_({ ok: false, error: "unknown_action" });

  var entry = validate_(body);
  if (!entry) return json_({ ok: false, error: "invalid" });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var rows = readAll_(sheet);
    var index = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].playerId === entry.playerId) {
        index = i;
        break;
      }
    }

    var improved = false;
    if (index < 0) {
      sheet.appendRow(toCells_(entry));
      rows.push(entry);
      improved = true;
    } else {
      var prev = rows[index];
      if (prev.secret !== entry.secret) return json_({ ok: false, error: "forbidden" });
      var rowNumber = index + 2; // 1行目は見出し
      if (compare_(entry, prev) < 0) {
        sheet.getRange(rowNumber, 1, 1, HEADER.length).setValues([toCells_(entry)]);
        rows[index] = entry;
        improved = true;
      } else if (prev.name !== entry.name) {
        sheet.getRange(rowNumber, 3).setValue(textCell_(entry.name));
        rows[index].name = entry.name;
      }
    }
    return json_({ ok: true, improved: improved, rows: topRows_(rows) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- 入力チェック ----------

function validate_(b) {
  var playerId = String(b.playerId || "");
  var secret = String(b.secret || "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(playerId) || !/^[A-Za-z0-9_-]{16,128}$/.test(secret)) return null;

  var score = Number(b.score);
  if (!isFinite(score) || score !== Math.floor(score) || score < 1 || score > MAX_SCORE) return null;

  var height = Number(b.height);
  if (!isFinite(height) || height < 0 || height > 100000) return null;

  // 積んだ漢字の並びと個数が一致しない記録は受け付けない
  var kanji = String(b.kanji || "");
  if (Array.from(kanji).length !== score) return null;

  var name = String(b.name || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  name = Array.from(name).slice(0, 12).join("") || "名無し";

  return {
    playerId: playerId,
    secret: secret,
    name: name,
    score: score,
    height: Math.round(height),
    kanji: kanji,
    at: Date.now(),
  };
}

// ---------- スプレッドシート ----------

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readAll_(sheet) {
  sheet = sheet || sheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
  return values.map(function (v) {
    return {
      playerId: String(v[0]),
      secret: String(v[1]),
      name: String(v[2]),
      score: Number(v[3]) || 0,
      height: Number(v[4]) || 0,
      kanji: String(v[5]),
      at: Number(v[6]) || 0,
    };
  });
}

function toCells_(r) {
  return [textCell_(r.playerId), textCell_(r.secret), textCell_(r.name), r.score, r.height, textCell_(r.kanji), r.at];
}

// 文字列を必ず文字列のまま保存する。先頭の ' はスプレッドシートの「テキストとして扱う」印で、値には含まれない。
// これが無いと「0123」が数値 123 に、「=SUM()」が数式に、「12e45」が指数表記の数値に変わってしまう。
function textCell_(s) {
  return "'" + s;
}

// ---------- 並び替え・応答 ----------

function compare_(a, b) {
  return b.score - a.score || b.height - a.height || a.at - b.at;
}

function topRows_(rows) {
  return rows
    .slice()
    .sort(compare_)
    .slice(0, TOP_LIMIT)
    .map(function (r) {
      // secret は返さない
      return { id: r.playerId, name: r.name, score: r.score, height: r.height, kanji: r.kanji, at: r.at };
    });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
