(() => {
  const { Engine, Bodies, Body, Composite } = Matter;

  // ---------- 定数（ワールド座標。横幅 WORLD_W を画面幅に合わせて拡大縮小する） ----------
  const WORLD_W = 420;
  const KANJI_SIZE = 76; // 漢字1字の一辺
  const PLATFORM_W = 270;
  const PLATFORM_H = 26;
  const PLATFORM_TOP = 0; // 台の上面の y
  const SEA_Y = PLATFORM_TOP + 110; // 墨の海の水面
  const FALL_Y = SEA_Y + 20; // これより下に字が落ちたら崩壊
  const HOLD_GAP = 130; // 構えた字の下端とタワー頂上の間隔（落とす高さ）
  const MOVE_SPEED = 4.5; // キー操作時の横移動量（1フレーム）
  const ROTATE_STEP = Math.PI / 4; // 45度ずつ回転
  const SETTLE_FRAMES = 45; // この間ずっと静止していたら「積めた」
  const SETTLE_TIMEOUT = 60 * 7; // 揺れが収まらなくても 7 秒で確定
  const STEP_MS = 1000 / 60;
  const INERTIA_SCALE = 4; // Matter.js の Body._inertiaScale と同じ値
  const BEST_KEY = "kanjitower.best";

  const COLORS = [
    { fill: "#2b2522", stroke: "#000000" }, // 墨
    { fill: "#d2452f", stroke: "#7a1e10" }, // 朱
    { fill: "#2f5d8a", stroke: "#13304d" }, // 藍
    { fill: "#5b8a3a", stroke: "#2b4a17" }, // 若竹
    { fill: "#e0a526", stroke: "#7d5508" }, // 山吹
    { fill: "#8a4f9e", stroke: "#4a2257" }, // 江戸紫
  ];

  const POOL = window.KANJI_POOL;
  const DEBUG = new URLSearchParams(location.search).has("debug");

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("stage");
  const ctx = canvas.getContext("2d");
  const ui = {
    score: $("score"),
    height: $("height"),
    best: $("best"),
    choices: $("choices"),
    choiceList: $("choice-list"),
    aimInfo: $("aim-info"),
    aimChar: $("aim-char"),
    aimReading: $("aim-reading"),
    controls: $("controls"),
    title: $("title-screen"),
    over: $("over-screen"),
    start: $("btn-start"),
    retry: $("btn-retry"),
    finalScore: $("final-score"),
    finalHeight: $("final-height"),
    finalLog: $("final-log"),
    newRecord: $("new-record"),
    rankingScreen: $("ranking-screen"),
    rankForm: $("rank-form"),
    rankName: $("rank-name"),
    rankSubmit: $("btn-submit"),
    rankStatus: $("rank-status"),
  };

  // ---------- 状態 ----------
  const engine = Engine.create({ positionIterations: 12, velocityIterations: 10 });
  const world = engine.world;

  let platform = null;
  let kanjiBodies = [];
  let state = "title"; // title | choose | aim | settle | over
  let score = 0;
  let best = readBest();
  let candidates = [];
  let held = null; // { entry, shape, color, x, angle }
  let settleCount = 0;
  let settleTimer = 0;
  let towerTop = PLATFORM_TOP;
  let camY = 0; // 画面上端のワールド y
  let camTarget = 0;
  let scale = 1;
  let viewH = 700;
  let time = 0;
  let colorIndex = 0;
  let maxHeight = 0;
  const log = [];
  const keys = new Set();
  const holdButtons = { left: false, right: false };
  let dragging = false;

  function readBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function writeBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch {
      /* 保存できない環境では無視 */
    }
  }

  // ---------- 画面サイズ ----------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scale = canvas.width / WORLD_W;
    viewH = canvas.height / scale;
    camTarget = computeCamTarget();
    camY = camTarget;
  }

  // ---------- 物理ワールド ----------
  function resetWorld() {
    Composite.clear(world, false);
    platform = Bodies.rectangle(WORLD_W / 2, PLATFORM_TOP + PLATFORM_H / 2, PLATFORM_W, PLATFORM_H, {
      isStatic: true,
      chamfer: { radius: 6 },
      friction: 0.9,
      frictionStatic: 1.2,
      restitution: 0,
    });
    Composite.add(world, platform);
    kanjiBodies = [];
  }

  function createKanjiBody(shape, color, x, y, angle) {
    const material = { friction: 0.9, frictionStatic: 1.2, restitution: 0, density: 0.0015 };
    const parts = shape.rects.map((r) => Bodies.rectangle(x + r.x, y + r.y, r.w, r.h, material));
    const body = Body.create({ parts, ...material, frictionAir: 0.012 });
    // Matter.js は複合ボディの慣性モーメントを「各部品の慣性の単純和」で求めるため、
    // 離れた部品を持つ字（心・三など）は慣性が小さすぎて高速回転し吹き飛んでしまう。
    // 平行軸の定理で重心まわりの値に直す（係数は Matter の inertiaScale に合わせる）。
    let inertia = 0;
    for (const p of parts) {
      const dx = p.position.x - body.position.x;
      const dy = p.position.y - body.position.y;
      inertia += p.inertia + INERTIA_SCALE * p.mass * (dx * dx + dy * dy);
    }
    Body.setInertia(body, inertia);
    // 重心（body.position）から字形の基準点へのずれ。角度0のときのローカル座標で持つ。
    const offset = { x: x - body.position.x, y: y - body.position.y };
    Body.rotate(body, angle, { x, y });
    body.plugin.kanji = { shape, color, offset };
    return body;
  }

  // ---------- ターン進行 ----------
  function startGame() {
    resetWorld();
    score = 0;
    log.length = 0;
    colorIndex = 0;
    maxHeight = 0;
    towerTop = PLATFORM_TOP;
    held = null;
    ui.title.classList.add("hidden");
    ui.over.classList.add("hidden");
    updateHud();
    camTarget = computeCamTarget();
    camY = camTarget;
    nextTurn();
  }

  function pickCandidates() {
    const result = [];
    for (const tier of [1, 2, 3]) {
      const list = POOL.filter((k) => k.t === tier && !result.includes(k));
      result.push(list[Math.floor(Math.random() * list.length)]);
    }
    // 並び順をシャッフル
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function nextTurn() {
    candidates = pickCandidates();
    showChoices();
  }

  function showChoices() {
    state = "choose";
    held = null;
    ui.choiceList.innerHTML = "";
    candidates.forEach((entry, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.innerHTML = `<span class="glyph"></span><span class="reading"></span><span class="key">${i + 1}</span>`;
      btn.querySelector(".glyph").textContent = entry.c;
      btn.querySelector(".reading").textContent = entry.r;
      btn.addEventListener("click", () => choose(i));
      ui.choiceList.appendChild(btn);
    });
    ui.choices.classList.remove("hidden");
    ui.aimInfo.classList.add("hidden");
    ui.controls.classList.add("hidden");
  }

  function choose(i) {
    if (state !== "choose") return;
    const entry = candidates[i];
    held = {
      entry,
      shape: KanjiShape.build(entry.c, KANJI_SIZE),
      color: COLORS[colorIndex % COLORS.length],
      x: WORLD_W / 2,
      angle: 0,
    };
    state = "aim";
    ui.aimChar.textContent = entry.c;
    ui.aimReading.textContent = entry.r;
    ui.choices.classList.add("hidden");
    ui.aimInfo.classList.remove("hidden");
    ui.controls.classList.remove("hidden");
  }

  function holdY() {
    return Math.min(towerTop, PLATFORM_TOP) - HOLD_GAP - (held ? held.shape.radius : KANJI_SIZE / 2);
  }

  function clampHeldX() {
    const margin = held.shape.radius * 0.5;
    held.x = Math.max(margin, Math.min(WORLD_W - margin, held.x));
  }

  function rotateHeld() {
    if (state === "aim") held.angle = (held.angle + ROTATE_STEP) % (Math.PI * 2);
  }

  function drop() {
    if (state !== "aim") return;
    const body = createKanjiBody(held.shape, held.color, held.x, holdY(), held.angle);
    Composite.add(world, body);
    kanjiBodies.push(body);
    log.push(held.entry.c);
    colorIndex++;
    held = null;
    dragging = false;
    state = "settle";
    settleCount = 0;
    settleTimer = 0;
    ui.aimInfo.classList.add("hidden");
    ui.controls.classList.add("hidden");
  }

  function cancelAim() {
    if (state === "aim") showChoices();
  }

  function isStill(body) {
    return body.speed < 0.12 && Math.abs(body.angularVelocity) < 0.004;
  }

  function measureTowerTop() {
    let top = PLATFORM_TOP;
    for (const b of kanjiBodies) top = Math.min(top, b.bounds.min.y);
    return top;
  }

  function checkSettled() {
    settleTimer++;
    settleCount = kanjiBodies.every(isStill) ? settleCount + 1 : 0;
    if (settleCount >= SETTLE_FRAMES || settleTimer >= SETTLE_TIMEOUT) {
      score++;
      towerTop = measureTowerTop();
      updateHud();
      nextTurn();
    }
  }

  function checkCollapse() {
    for (const b of kanjiBodies) {
      if (b.bounds.min.y > FALL_Y) return true;
    }
    return false;
  }

  function gameOver() {
    state = "over";
    held = null;
    ui.choices.classList.add("hidden");
    ui.aimInfo.classList.add("hidden");
    ui.controls.classList.add("hidden");
    const isRecord = score > best;
    if (isRecord) {
      best = score;
      writeBest(best);
    }
    // 崩壊後の演出を少し見せてから結果を出す
    setTimeout(() => {
      ui.finalScore.textContent = String(score);
      ui.finalHeight.textContent = `最高の高さ ${formatHeight(maxHeight)}`;
      ui.finalLog.textContent = log.slice(0, score).join("") || "—";
      ui.newRecord.classList.toggle("hidden", !isRecord || score === 0);
      prepareRankForm();
      ui.over.classList.remove("hidden");
      updateHud();
    }, 1200);
  }

  // ---------- ランキング ----------
  let submitted = false;
  let rankInfo = { mode: "local", canWrite: true };

  function prepareRankForm() {
    submitted = false;
    ui.rankForm.classList.toggle("hidden", score === 0);
    ui.rankName.value = Ranking.savedName();
    ui.rankSubmit.disabled = false;
    ui.rankStatus.textContent = "";
    applyWritePermission();
  }

  function applyWritePermission() {
    if (rankInfo.mode === "shared" && !rankInfo.canWrite) {
      ui.rankSubmit.disabled = true;
      ui.rankStatus.textContent = "閲覧のみの共有なので、ランキングへの登録はできません";
    }
  }

  async function submitRanking(e) {
    e.preventDefault();
    if (submitted || score === 0) return;
    submitted = true;
    ui.rankSubmit.disabled = true;
    ui.rankStatus.textContent = "登録しています…";
    const result = await Ranking.submit({
      name: ui.rankName.value,
      score,
      height: maxHeight,
      kanji: log.slice(0, score).join(""),
    });
    if (result.ok) {
      ui.rankStatus.textContent =
        result.improved === false ? "自己ベストの方が上なので、名前だけ更新しました" : "登録しました！";
    } else if (result.reason === "no_permission") {
      ui.rankStatus.textContent = "閲覧のみの共有なので、ランキングへの登録はできません";
    } else {
      submitted = false;
      ui.rankSubmit.disabled = false;
      ui.rankStatus.textContent = "通信に失敗しました。もう一度「登録」を押してください";
    }
  }

  function renderRanking(rows, info) {
    const scope =
      info.mode === "shared" ? "みんなのランキング（1人1件・自己ベスト）" : "この端末のランキング";
    for (const el of document.querySelectorAll(".ranking-scope")) el.textContent = scope;
    for (const list of document.querySelectorAll(".ranking-list")) {
      list.replaceChildren();
      if (rows.length === 0) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "まだ記録がありません。最初の記録を作ろう！";
        list.appendChild(li);
        continue;
      }
      rows.forEach((row, i) => {
        const li = document.createElement("li");
        if (Ranking.isMine(row)) li.classList.add("mine");
        const pos = document.createElement("span");
        pos.className = "pos";
        pos.textContent = String(i + 1);
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = row.name;
        const detail = document.createElement("small");
        detail.textContent = `${formatHeight(row.height)}　${row.kanji}`;
        who.appendChild(detail);
        const pts = document.createElement("span");
        pts.className = "pts";
        pts.textContent = String(row.score);
        const unit = document.createElement("small");
        unit.textContent = "個";
        pts.appendChild(unit);
        li.append(pos, who, pts);
        list.appendChild(li);
      });
    }
    rankInfo = info;
    if (!submitted) applyWritePermission();
  }

  Ranking.onChange(renderRanking);

  // ---------- HUD ----------
  function formatHeight(units) {
    // 漢字1字 ≒ 7.6cm として換算
    return `${(units / 10).toFixed(1)}cm`;
  }

  function updateHud() {
    const h = Math.max(0, PLATFORM_TOP - towerTop);
    maxHeight = Math.max(maxHeight, h);
    ui.score.textContent = String(score);
    ui.height.innerHTML = `${(h / 10).toFixed(1)}<small>cm</small>`;
    ui.best.textContent = String(best);
  }

  // ---------- カメラ ----------
  function computeCamTarget() {
    // 台は画面下寄り、タワーが伸びたら構えた字が画面上 30% あたりに来るよう追従
    const base = PLATFORM_TOP - viewH * 0.68;
    const radius = held ? held.shape.radius : KANJI_SIZE * 0.6;
    const follow = Math.min(towerTop, PLATFORM_TOP) - HOLD_GAP - radius * 2 - viewH * 0.24;
    return Math.min(base, follow);
  }

  // ---------- 入力 ----------
  function pointerWorldX(e) {
    const rect = canvas.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * WORLD_W;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (state !== "aim") return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    held.x = pointerWorldX(e);
    clampHeldX();
  });

  canvas.addEventListener("pointermove", (e) => {
    // マウスはボタンを押さなくても追従、タッチはドラッグ中のみ
    if (state !== "aim" || (!dragging && e.pointerType !== "mouse")) return;
    held.x = pointerWorldX(e);
    clampHeldX();
  });

  canvas.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    drop();
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });

  window.addEventListener("keydown", (e) => {
    // 名前入力中やランキング表示中はゲーム操作にしない
    if (e.target instanceof HTMLInputElement || !ui.rankingScreen.classList.contains("hidden")) return;
    if (e.repeat && !["ArrowLeft", "ArrowRight", "a", "d"].includes(e.key)) return;
    keys.add(e.key);
    if (state === "choose" && ["1", "2", "3"].includes(e.key)) choose(Number(e.key) - 1);
    else if (state === "aim") {
      if (["ArrowUp", "w", "x", "z"].includes(e.key)) rotateHeld();
      else if ([" ", "ArrowDown", "Enter", "s"].includes(e.key)) drop();
      else if (["Escape", "Backspace"].includes(e.key)) cancelAim();
    } else if (state === "title" && !ui.start.disabled && [" ", "Enter"].includes(e.key)) startGame();
    else if (state === "over" && !ui.over.classList.contains("hidden") && [" ", "Enter", "r"].includes(e.key)) startGame();
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
  });

  window.addEventListener("keyup", (e) => keys.delete(e.key));
  window.addEventListener("blur", () => keys.clear());

  function bindHoldButton(id, dir) {
    const el = $(id);
    const on = (e) => {
      e.preventDefault();
      holdButtons[dir] = true;
    };
    const off = () => (holdButtons[dir] = false);
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointerleave", off);
    el.addEventListener("pointercancel", off);
  }

  bindHoldButton("btn-left", "left");
  bindHoldButton("btn-right", "right");
  $("btn-rotate").addEventListener("click", rotateHeld);
  $("btn-drop").addEventListener("click", drop);
  $("btn-back").addEventListener("click", cancelAim);
  ui.start.addEventListener("click", startGame);
  ui.retry.addEventListener("click", startGame);
  $("btn-ranking").addEventListener("click", () => {
    ui.title.classList.add("hidden");
    ui.rankingScreen.classList.remove("hidden");
  });
  $("btn-ranking-close").addEventListener("click", () => {
    ui.rankingScreen.classList.add("hidden");
    ui.title.classList.remove("hidden");
  });
  ui.rankForm.addEventListener("submit", submitRanking);
  window.addEventListener("resize", resize);

  function applyHeldMovement() {
    if (state !== "aim") return;
    let dx = 0;
    if (keys.has("ArrowLeft") || keys.has("a") || holdButtons.left) dx -= MOVE_SPEED;
    if (keys.has("ArrowRight") || keys.has("d") || holdButtons.right) dx += MOVE_SPEED;
    if (dx) {
      held.x += dx;
      clampHeldX();
    }
  }

  // ---------- 描画 ----------
  function drawBackground() {
    const w = canvas.width;
    const h = canvas.height;
    // 高く積むほど空の色が夕暮れ→夜へ変わる
    const altitude = Math.max(0, -camY - viewH * 0.68);
    const t = Math.min(1, altitude / 2500);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, mix("#f6efe0", "#22304a", t));
    g.addColorStop(1, mix("#efe2c4", "#6b5a7a", t));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (p, s) => (p >> s) & 255;
    const c = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
    return `rgb(${c(16)},${c(8)},${c(0)})`;
  }

  function toWorld() {
    ctx.setTransform(scale, 0, 0, scale, 0, -camY * scale);
  }

  function drawHeightMarks() {
    ctx.save();
    ctx.strokeStyle = "rgba(43,37,34,0.14)";
    ctx.fillStyle = "rgba(43,37,34,0.4)";
    ctx.lineWidth = 1 / scale;
    ctx.font = `500 11px ${KanjiShape.FONT_FAMILY}`;
    ctx.textAlign = "right";
    const step = 100;
    const from = Math.floor(camY / step) * step;
    for (let y = from; y < camY + viewH; y += step) {
      // 台より下と、HUD に重なる画面上端は描かない
      if (y >= PLATFORM_TOP || y < camY + 140) continue;
      ctx.beginPath();
      ctx.moveTo(WORLD_W - 34, y);
      ctx.lineTo(WORLD_W - 6, y);
      ctx.stroke();
      ctx.fillText(`${(PLATFORM_TOP - y) / 10}cm`, WORLD_W - 6, y - 3);
    }
    if (towerTop < PLATFORM_TOP) {
      // 今のタワー頂上ライン
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(210,69,47,0.5)";
      ctx.beginPath();
      ctx.moveTo(0, towerTop);
      ctx.lineTo(WORLD_W, towerTop);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlatform() {
    const x = WORLD_W / 2 - PLATFORM_W / 2;
    // 脚
    ctx.fillStyle = "#6e4a2f";
    ctx.fillRect(x + 28, PLATFORM_TOP + PLATFORM_H - 2, 18, SEA_Y - PLATFORM_TOP + 40);
    ctx.fillRect(x + PLATFORM_W - 46, PLATFORM_TOP + PLATFORM_H - 2, 18, SEA_Y - PLATFORM_TOP + 40);
    // 天板
    ctx.fillStyle = "#9a6a43";
    roundRect(x, PLATFORM_TOP, PLATFORM_W, PLATFORM_H, 6);
    ctx.fill();
    ctx.fillStyle = "#b9875c";
    roundRect(x + 4, PLATFORM_TOP + 3, PLATFORM_W - 8, 6, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `900 13px ${KanjiShape.FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("漢 字 の 台", WORLD_W / 2, PLATFORM_TOP + PLATFORM_H / 2 + 3);
  }

  function drawSea() {
    const bottom = camY + viewH + 10;
    if (SEA_Y - 20 > bottom) return;
    ctx.fillStyle = "#2b2522";
    ctx.beginPath();
    ctx.moveTo(-10, bottom);
    for (let x = -10; x <= WORLD_W + 10; x += 10) {
      ctx.lineTo(x, SEA_Y + Math.sin(x * 0.045 + time * 0.035) * 4);
    }
    ctx.lineTo(WORLD_W + 10, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(246,239,224,0.25)";
    ctx.font = `900 16px ${KanjiShape.FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText("墨 の 海", WORLD_W / 2, SEA_Y + 48);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawGlyph(shape, color, x, y, angle, alpha = 1) {
    const img = KanjiShape.image(shape.char, color.fill, color.stroke);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(img, shape.imageOffset.x, shape.imageOffset.y, shape.imageSize, shape.imageSize);
    if (DEBUG) {
      ctx.strokeStyle = "rgba(0,160,255,0.9)";
      ctx.lineWidth = 1 / scale;
      for (const r of shape.rects) ctx.strokeRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h);
    }
    ctx.restore();
  }

  function drawBodies() {
    for (const b of kanjiBodies) {
      const { shape, color, offset } = b.plugin.kanji;
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const x = b.position.x + offset.x * cos - offset.y * sin;
      const y = b.position.y + offset.x * sin + offset.y * cos;
      drawGlyph(shape, color, x, y, b.angle);
    }
  }

  function drawHeld() {
    if (state !== "aim" || !held) return;
    const y = holdY();
    // 落下ガイド
    ctx.save();
    ctx.strokeStyle = "rgba(210,69,47,0.45)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(held.x, y + held.shape.radius * 0.6);
    ctx.lineTo(held.x, SEA_Y);
    ctx.stroke();
    ctx.restore();
    const bob = Math.sin(time * 0.08) * 2;
    drawGlyph(held.shape, held.color, held.x, y + bob, held.angle, 0.92);
  }

  function render() {
    drawBackground();
    toWorld();
    drawHeightMarks();
    drawPlatform();
    drawBodies();
    drawHeld();
    drawSea();
  }

  // ---------- メインループ ----------
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    acc += Math.min(100, now - last);
    last = now;
    let steps = 0;
    while (acc >= STEP_MS && steps < 5) {
      step();
      acc -= STEP_MS;
      steps++;
    }
    if (steps === 5) acc = 0;
    render();
    requestAnimationFrame(frame);
  }

  function step() {
    time++;
    applyHeldMovement();
    Engine.update(engine, STEP_MS);
    if (state === "settle" || state === "choose" || state === "aim") {
      if (checkCollapse()) gameOver();
      else if (state === "settle") checkSettled();
    }
    // 落ちていく字を追いすぎないよう、カメラは確定した頂上を基準にする
    camTarget = computeCamTarget();
    camY += (camTarget - camY) * 0.06;
  }

  // ---------- 起動 ----------
  async function boot() {
    if (window.matchMedia("(pointer: fine)").matches) {
      document.querySelector(".aim-hint").textContent = "マウスで移動・クリックで落下";
    }
    resetWorld();
    resize();
    updateHud();
    requestAnimationFrame(frame);
    await KanjiShape.loadFont(POOL.map((k) => k.c).join("") + "漢字タワーの台墨海");
    // 字形を先に作っておく（初回選択時のカクつき防止）
    for (const k of POOL) KanjiShape.build(k.c, KANJI_SIZE);
    ui.start.disabled = false;
    ui.start.textContent = "はじめる";
  }

  // 自動テスト・デバッグ用
  window.__kanjiTower = {
    get state() {
      return state;
    },
    get score() {
      return score;
    },
    get candidates() {
      return candidates.map((c) => c.c);
    },
    get bodies() {
      return kanjiBodies.length;
    },
    debugBodies() {
      return kanjiBodies.map((b) => [Math.round(b.position.x), Math.round(b.position.y), +b.angle.toFixed(2)]);
    },
    choose,
    drop,
    rotate: rotateHeld,
    setX(x) {
      if (held) {
        held.x = x;
        clampHeldX();
      }
    },
  };

  boot();
})();
