// ランキング。
// - js/config.js の rankingUrl が設定されていれば、Google スプレッドシート（Apps Script）に保存して
//   遊んだ人全員で同じランキングを見る（1人1件・自己ベスト）。
// - 未設定、または通信できない環境では、この端末の localStorage に上位10件を保存する。
window.Ranking = (() => {
  const LOCAL_KEY = "kanjitower.ranking";
  const NAME_KEY = "kanjitower.name";
  const PLAYER_KEY = "kanjitower.player";
  const LIMIT = 10;
  const URL = ((window.KANJI_TOWER_CONFIG || {}).rankingUrl || "").trim();

  const mode = URL ? "remote" : "local";
  let remoteRows = [];
  let status = mode === "remote" ? "loading" : "ready"; // loading | ready | error
  let lastLocalId = null; // この端末で直前に登録した記録
  const listeners = new Set();

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 保存できない環境では無視 */
    }
  }

  function cleanName(name) {
    return Array.from(String(name || "").trim()).slice(0, 12).join("") || "名無し";
  }

  // サーバーから来たデータは他の人が書いたものなので、型と長さを整えてから使う
  function normalize(row) {
    return {
      id: String(row.id),
      name: cleanName(row.name),
      score: Math.max(0, Math.floor(Number(row.score) || 0)),
      height: Math.max(0, Number(row.height) || 0),
      kanji: Array.from(String(row.kanji || "")).slice(0, 60).join(""),
      at: Number(row.at) || 0,
    };
  }

  function byRank(a, b) {
    return b.score - a.score || b.height - a.height || a.at - b.at;
  }

  function readLocal() {
    try {
      const rows = JSON.parse(storageGet(LOCAL_KEY) || "[]");
      return Array.isArray(rows) ? rows.map(normalize) : [];
    } catch {
      return [];
    }
  }

  function randomId(bytes) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // この端末のプレイヤーID（公開）と合言葉（非公開・自分の記録を上書きするのに使う）
  function player() {
    try {
      const saved = JSON.parse(storageGet(PLAYER_KEY) || "null");
      if (saved && saved.id && saved.secret) return saved;
    } catch {
      /* 作り直す */
    }
    const created = { id: randomId(8), secret: randomId(16) };
    storageSet(PLAYER_KEY, JSON.stringify(created));
    return created;
  }

  function rows() {
    const list = mode === "remote" ? remoteRows : readLocal();
    return [...list].sort(byRank).slice(0, LIMIT);
  }

  function emit() {
    const list = rows();
    for (const fn of listeners) fn(list, { mode, status });
  }

  function onChange(fn) {
    listeners.add(fn);
    fn(rows(), { mode, status });
    return () => listeners.delete(fn);
  }

  function setRemote(data) {
    if (!data || !data.ok || !Array.isArray(data.rows)) throw new Error("bad response");
    remoteRows = data.rows.map(normalize);
    status = "ready";
  }

  async function refresh() {
    if (mode !== "remote") return emit();
    try {
      const res = await fetch(`${URL}?action=top&t=${Date.now()}`);
      setRemote(await res.json());
    } catch {
      status = "error";
    }
    emit();
  }

  // record: { name, score, height, kanji }
  async function submit(record) {
    const name = cleanName(record.name);
    storageSet(NAME_KEY, name);
    const entry = {
      name,
      score: record.score,
      height: Math.round(record.height),
      kanji: String(record.kanji || ""),
      at: Date.now(),
    };

    if (mode === "local") {
      const list = readLocal();
      lastLocalId = String(entry.at);
      list.push({ ...entry, id: lastLocalId });
      list.sort(byRank);
      storageSet(LOCAL_KEY, JSON.stringify(list.slice(0, LIMIT)));
      emit();
      return { ok: true };
    }

    const me = player();
    try {
      // text/plain で送ると Apps Script へのクロスオリジン送信がそのまま通る
      const res = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "submit", playerId: me.id, secret: me.secret, ...entry }),
      });
      const data = await res.json();
      if (!data.ok) return { ok: false, reason: data.error || "error" };
      setRemote(data);
      emit();
      return { ok: true, improved: data.improved };
    } catch {
      return { ok: false, reason: "network" };
    }
  }

  function isMine(row) {
    return mode === "remote" ? row.id === player().id : row.id === lastLocalId;
  }

  function savedName() {
    return storageGet(NAME_KEY) || "";
  }

  refresh();

  return { onChange, submit, refresh, savedName, isMine, LIMIT };
})();
