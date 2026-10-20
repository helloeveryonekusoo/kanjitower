# 漢字タワー

「どうぶつタワーバトル」のゲーム構造を、動物の代わりに**漢字**で遊べるようにした物理積み上げゲームです。
毎ターン3つの漢字が出てくるので1つ選んで落とし、**何個積めたか**を競います。

## 遊び方

1. 画面上部に出る3つの漢字から1つをえらぶ
2. 落とす位置と向きを決める
3. 落として、タワー全体が静止すれば1個カウント
4. 台から漢字がひとつでも「墨の海」に落ちたら終了

| 操作 | スマホ | PC |
| --- | --- | --- |
| 漢字をえらぶ | カードをタップ | クリック / `1` `2` `3` |
| 移動 | 画面をドラッグ / ◀ ▶ ボタン | マウス移動 / `←` `→` |
| 回転（45°） | ⟳ ボタン | `↑` |
| 落とす | 指を離す / 「落とす」ボタン | クリック / `Space` |
| 選び直す | 「選び直す」ボタン | `Esc` |

ベスト記録はブラウザ（localStorage）に保存されます。

### ランキング

ゲームオーバー画面で名前を入れて「登録」するとランキングに載ります。タイトル画面の「ランキングを見る」からも確認できます。

- **`js/config.js` にランキングの URL を設定した場合**: Google スプレッドシートに記録を保存し、遊んだ人全員で競うランキングになります（1人1件・自己ベスト、上位10件）。設定手順は [docs/ranking-setup.md](docs/ranking-setup.md) を見てください。
- **未設定の場合**: その端末だけのランキング（上位10件）になります。

## 起動方法

ビルド不要の静的サイトです。

```sh
npx http-server -p 8080   # または python3 -m http.server 8080
# → http://localhost:8080/ を開く
```

`index.html` を直接ブラウザで開いても動きます。

### GitHub Pages で公開する

1. このリポジトリの **Settings → Pages** を開く
2. **Build and deployment** の Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして保存
3. 数分後に `https://helloeveryonekusoo.github.io/kanjitower/` で遊べるようになる

URL に `?debug` を付けると、当たり判定の長方形が表示されます。

## ファイル構成

```
index.html        画面（HUD・候補カード・操作ボタン・タイトル/結果画面）
style.css         見た目
js/kanji.js       出題する漢字と読み、難しさの目安（tier）
js/shape.js       漢字の字形 → 当たり判定（長方形の集合）と描画用画像の生成
js/config.js      設定（ランキングの保存先 URL）
js/ranking.js     ランキング（スプレッドシートに保存、未設定なら端末内に保存）
js/game.js        物理ワールド、ターン進行、入力、カメラ、描画
ranking-server/   ランキングの保存先にする Google Apps Script（Code.gs）
vendor/           Matter.js 0.20.0（MIT License）
docs/research.md  動物タワーバトルの調査メモと、漢字版への置き換え方
docs/ranking-setup.md  みんなで競うランキングの設定手順
```

## 調査と設計

動物タワーバトルのゲーム構造の分析と、漢字に置き換える際の設計は [docs/research.md](docs/research.md) にまとめています。

## ライセンス表記

- 物理エンジン: [Matter.js](https://brm.io/matter-js/)（MIT License, `vendor/matter-js.LICENSE`）
- フォント: [Zen Maru Gothic](https://fonts.google.com/specimen/Zen+Maru+Gothic)（SIL Open Font License, Google Fonts から読み込み）
