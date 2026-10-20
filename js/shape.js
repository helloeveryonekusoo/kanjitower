// 漢字の字形から当たり判定（矩形の集合）と描画用画像を作る。
//
// 1. オフスクリーン canvas に漢字を描く
// 2. GRID×GRID のマス目ごとにインクの被覆率を測り、一定以上なら「塗り」とする
// 3. 塗りマスを貪欲法で大きな矩形にまとめる（部品数を減らして物理演算を軽くする）
//
// 描画も同じ canvas 画像を使うので、見た目と当たり判定が必ず一致する。
window.KanjiShape = (() => {
  const RASTER = 256; // オフスクリーン canvas の一辺（px）
  const GRID = 16; // 当たり判定のマス目数
  const CELL = RASTER / GRID;
  const FILL_THRESHOLD = 0.3; // マスを塗りとみなす被覆率

  const FONT_FAMILY =
    '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "IPAGothic", sans-serif';

  const shapes = new Map(); // char -> shape
  const images = new Map(); // char|color -> canvas

  function drawGlyph(ctx, char, fill, stroke) {
    ctx.clearRect(0, 0, RASTER, RASTER);
    ctx.font = `900 ${Math.round(RASTER * 0.78)}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = RASTER * 0.03;
    ctx.strokeStyle = stroke;
    ctx.strokeText(char, RASTER / 2, RASTER / 2);
    ctx.fillStyle = fill;
    ctx.fillText(char, RASTER / 2, RASTER / 2);
  }

  function makeCanvas() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = RASTER;
    return cv;
  }

  // 塗りマスを矩形にまとめる。横に伸ばせるだけ伸ばし、次に同じ幅のまま下へ伸ばす。
  function mergeCells(filled) {
    const used = new Uint8Array(GRID * GRID);
    const rects = [];
    const at = (x, y) => y * GRID + x;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!filled[at(x, y)] || used[at(x, y)]) continue;
        let w = 1;
        while (x + w < GRID && filled[at(x + w, y)] && !used[at(x + w, y)]) w++;
        let h = 1;
        grow: while (y + h < GRID) {
          for (let i = 0; i < w; i++) {
            if (!filled[at(x + i, y + h)] || used[at(x + i, y + h)]) break grow;
          }
          h++;
        }
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[at(xx, yy)] = 1;
        rects.push({ x, y, w, h });
      }
    }
    return rects;
  }

  // size: ワールド座標での漢字1字の一辺
  function build(char, size) {
    const key = char + "@" + size;
    if (shapes.has(key)) return shapes.get(key);

    const cv = makeCanvas();
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    drawGlyph(ctx, char, "#000", "#000");
    const alpha = ctx.getImageData(0, 0, RASTER, RASTER).data;

    // マスごとの被覆率と、ピクセル単位の外接矩形
    const filled = new Uint8Array(GRID * GRID);
    let minX = RASTER, minY = RASTER, maxX = -1, maxY = -1;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let ink = 0;
        for (let py = gy * CELL; py < (gy + 1) * CELL; py++) {
          for (let px = gx * CELL; px < (gx + 1) * CELL; px++) {
            const a = alpha[(py * RASTER + px) * 4 + 3];
            if (a > 0) {
              ink += a / 255;
              if (a > 64) {
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
              }
            }
          }
        }
        if (ink / (CELL * CELL) >= FILL_THRESHOLD) filled[gy * GRID + gx] = 1;
      }
    }

    let cells = mergeCells(filled);
    if (cells.length === 0 || maxX < 0) {
      // フォントが無い等で字形が取れない場合は正方形にしておく
      cells = [{ x: 3, y: 3, w: GRID - 6, h: GRID - 6 }];
      minX = minY = 3 * CELL;
      maxX = maxY = (GRID - 3) * CELL;
    }

    // 基準点 = 字形の外接矩形の中心。ここを原点にしたワールド座標へ変換する。
    const k = size / RASTER;
    const ox = (minX + maxX + 1) / 2;
    const oy = (minY + maxY + 1) / 2;
    const rects = cells.map((c) => ({
      x: ((c.x + c.w / 2) * CELL - ox) * k,
      y: ((c.y + c.h / 2) * CELL - oy) * k,
      w: c.w * CELL * k,
      h: c.h * CELL * k,
    }));

    let radius = 0;
    for (const r of rects) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          radius = Math.max(radius, Math.hypot(r.x + (sx * r.w) / 2, r.y + (sy * r.h) / 2));
        }
      }
    }

    const shape = {
      char,
      size,
      rects,
      radius,
      // 描画時：基準点を原点にしたとき、画像の左上がどこに来るか
      imageOffset: { x: -ox * k, y: -oy * k },
      imageSize: size,
    };
    shapes.set(key, shape);
    return shape;
  }

  function image(char, fill, stroke) {
    const key = char + "|" + fill;
    if (images.has(key)) return images.get(key);
    const cv = makeCanvas();
    drawGlyph(cv.getContext("2d"), char, fill, stroke);
    images.set(key, cv);
    return cv;
  }

  // Google Fonts は unicode-range で分割配信されるので、使う字をまとめて先読みする
  async function loadFont(chars, timeoutMs = 4000) {
    if (!document.fonts || !document.fonts.load) return;
    const load = document.fonts.load(`900 64px "Zen Maru Gothic"`, chars).catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([load, timeout]);
  }

  return { build, image, loadFont, FONT_FAMILY };
})();
