// ランキング。
// - Claude の公開ページ（claude.ai/artifact）で開いたとき: 共有データベースに各プレイヤーの自己ベストを1件ずつ保存し、
//   遊んだ人全員で同じランキングを見る。
// - それ以外（GitHub Pages・ローカル）: この端末の localStorage に上位10件を保存する。
window.Ranking = (() => {
  const LOCAL_KEY = "kanjitower.ranking";
  const NAME_KEY = "kanjitower.name";
  const LIMIT = 10;

  let mode = "local"; // "local" | "shared"
  let db = null;
  let myId = null;
  let canWrite = true;
  let sharedRows = [];
  let lastLocalId = null; // この端末で直前に登録した記録
  const listeners = new Set();

  function readLocal() {
    try {
      const rows = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      return Array.isArray(rows) ? rows.map(normalize) : [];
    } catch {
      return [];
    }
  }

  function writeLocal(rows) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
    } catch {
      /* 保存できない環境では無視 */
    }
  }

  // 共有データは他の人が書いたものなので、型と長さを整えてから使う
  function normalize(row) {
    return {
      id: String(row.id),
      name: cleanName(row.name),
      score: Math.max(0, Math.floor(Number(row.score) || 0)),
      height: Math.max(0, Number(row.height) || 0),
      kanji: String(row.kanji || "").slice(0, 60),
      at: Number(row.at) || 0,
    };
  }

  function byRank(a, b) {
    return b.score - a.score || b.height - a.height || a.at - b.at;
  }

  function rows() {
    const list = mode === "shared" ? sharedRows : readLocal();
    return [...list].sort(byRank).slice(0, LIMIT);
  }

  function emit() {
    const list = rows();
    for (const fn of listeners) fn(list, info());
  }

  function info() {
    return { mode, canWrite };
  }

  function onChange(fn) {
    listeners.add(fn);
    fn(rows(), info());
    return () => listeners.delete(fn);
  }

  function savedName() {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* 保存できない環境では無視 */
    }
  }

  function cleanName(name) {
    return String(name || "").trim().slice(0, 12) || "名無し";
  }

  // record: { name, score, height, kanji }
  async function submit(record) {
    const entry = {
      name: cleanName(record.name),
      score: record.score,
      height: Math.round(record.height),
      kanji: String(record.kanji || "").slice(0, 60),
      at: Date.now(),
    };
    saveName(entry.name);

    if (mode !== "shared") {
      const list = readLocal();
      lastLocalId = String(entry.at);
      list.push({ ...entry, id: lastLocalId });
      list.sort(byRank);
      writeLocal(list.slice(0, LIMIT));
      emit();
      return { ok: true, id: String(entry.at) };
    }

    // 共有ランキングは1人1件（自己ベスト）。記録が下がるときは名前だけ更新する。
    const ref = db.collection("scores").doc(myId);
    try {
      const snap = await ref.get();
      const prev = snap.exists ? snap.data() : null;
      if (!prev || byRank(entry, prev) < 0) await ref.set(entry);
      else if (prev.name !== entry.name) await ref.update({ name: entry.name });
      return { ok: true, id: myId, improved: !prev || byRank(entry, prev) < 0 };
    } catch (e) {
      if (e && e.code === "invalid_argument") {
        canWrite = false;
        emit();
        return { ok: false, reason: "no_permission" };
      }
      return { ok: false, reason: "error" };
    }
  }

  function isMine(row) {
    return mode === "shared" ? row.id === myId : row.id === lastLocalId;
  }

  async function init() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    const [dbApi, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!dbApi || !user) return;
    const id = await user.id();
    if (!id) return;
    db = dbApi;
    myId = id;
    if ((await user.can("data.write")) === false) canWrite = false;
    mode = "shared";
    emit();
    db.collection("scores")
      .orderBy("score", "desc")
      .limit(50)
      .onSnapshot(
        (snap) => {
          sharedRows = snap.docs.map((d) => normalize({ ...d.data(), id: d.id }));
          emit();
        },
        () => {
          // 共有ランキングが使えなくなったら端末内のランキングに戻す
          mode = "local";
          emit();
        },
      );
  }

  init();

  return { onChange, submit, savedName, isMine, LIMIT };
})();
