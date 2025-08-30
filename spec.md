# Nostr Event Search Viewer — 仕様書（GitHub Pages）

## プロダクト概要
- 目的: 指定した条件（投稿者は任意、kind は必須）に一致する Nostr イベントを、最新 20 件まで取得・表示する。
 - 目的: 指定した条件（投稿者は任意、kind は必須、タグ任意）に一致する Nostr イベントを、最新 20 件まで取得・表示する。
- 対象ユーザー: 開発者、研究者、運用者（PC ブラウザ）。
- 提供価値: クライアントやサーバなしで、ブラウザのみで手早く検索・確認。

## スコープ（MVP）
- 必須機能
  - 入力: 投稿者 `npub`（または 64 桁 hex、任意）と `kind`（整数、必須）。
  - 入力: タグフィルタ（任意）— タグ名（1 文字、例: `g`）と値（文字列）。
  - 入力: Relay URL（`wss://...`。複数可、カンマ/改行区切り）。
  - 検索: 指定条件に一致するイベントを最新 20 件取得（`created_at` 降順）。
  - 表示: イベントのメタ情報（`id`/`pubkey`/`kind`/`created_at`）、本文（`content`）、タグ（`tags`）、JSON 表示トグル。
  - エラー/空結果表示: バリデーション、接続/購読エラー、0 件時のメッセージ。
- 後回し機能
  - ページネーション（`until`/`since`）、プロフィール解決、kind プリセット、日時フィルタ、PWA。
- 非対象
  - 投稿・署名・鍵管理。

## 画面/遷移
- 単一ページ（`index.html`）
  - ヘッダー
    - 右上: nostr-login ウィジェットを設置（unpkg から読み込み）
    - ログイン状態の簡易表示（`npub` 先頭など）
  - フォーム
    - 検索対象ユーザの指定（どちらか）
      - テキスト入力: `npub`（空欄可）
      - ログインユーザのフォロー先から選択（アイコン・表示名・ハンドルを表示、`npub` は非表示）
    - 数値: `kind`（必須、0 以上の整数）
    - テキスト: タグ名（任意、1 文字。例: `g`）
    - テキスト: タグ値（任意、タグ名とセットで入力）
    - テキスト: Relay URL（必須、`wss://...`。初期値: `wss://yabu.me`。複数はカンマ/改行）
    - ボタン: 検索
  - 結果領域
    - 条件の再掲、ローディング、件数、経過時間
    - イベント一覧（最大 20 件、降順）。本文・タグ・JSON トグル。

## ユーザーフロー
ログイン選択 → ログイン状態を保持（拡張/npub/bot）→ 検索対象ユーザを指定（手入力またはログインユーザのフォロー先から選択）→ バリデーション → `npub` を hex へ変換（必要時）→ 各リレーへ `REQ` を送信（投稿者あり: `authors=[hex]` を付与／なし: 省略。タグあり: `['#' + name]: [value]` を付与。共通: `kinds=[kind]`, `limit=20`）→ `EVENT` 受信を集約 → `EOSE`/タイムアウトで購読終了 → 降順整列し 20 件表示。

## データ設計
- 入力モデル
  - `authorInput`: `''` | `npub1...` | 64 桁 hex（空欄可）
  - `kind`: 整数（0 以上）
  - `relays`: `wss://...` の配列（1 件以上、重複除去）
  - `tagName`: `''` | `[a-z]`（1 文字、例: `g`）
  - `tagValue`: `''` | 文字列（`tagName` 入力時は必須）
- 内部モデル
  - `authorHex`: `null` | 64 桁 hex（`npub` は nip19/bech32 デコード）
  - `tagFilter`: `null` | `{ name: string, value: string }`
  - `events`: `Map<id, Event>`（重複排除）
  - `status`: `idle | connecting | streaming | done | error`
 - ログイン状態
   - `login.method`: `'nostr-login' | null`
   - `login.pubkeyHex`: `null | 64 桁 hex`
   - `login.npub`: `null | string`
 - キャッシュ
   - `followingsCache`（ローカル保存: `localStorage`）
     - キー: `nostr-esv.followings.<hex>.<relaysHash>`
     - 値: `{ items: string[] /* hex の配列 */, fetchedAt: number /* epoch ms */ }`
     - TTL: 86400 秒（1 日）
   - `profilesCache`（ローカル保存: `localStorage`）
     - キー: `nostr-esv.profiles.<hex>`
     - 値: `{ display?: string, nick?: string, picture?: string, fetchedAt: number }`
     - TTL: 86400 秒（1 日）
   - アイコン画像: ブラウザの HTTP キャッシュに依存（`img-src https:` 許可済み）
 - 永続保存
   - 保存先: `localStorage`
   - キー: `nostr-event-search-viewer.form`
   - 形式: `{ author: string, kind: string, relays: string, tagName: string, tagValue: string }`
   - 読み込みタイミング: 初期表示時に自動反映（存在する場合）
   - 保存タイミング: 入力変更時に随時保存、または検索時

## 技術選定
- ホスティング: GitHub Pages（静的）
- スタック: バニラ HTML/CSS/JS（ビルド不要）
- 依存ライブラリ: なし（npub デコードは最小 bech32 実装を自前で同梱）
- 通信: WebSocket（NIP-01）
- 対応ブラウザ: 最新の Chrome/Edge/Firefox（PC）

## Nostr プロトコル（NIP-01）
- 購読（クライアント→サーバ）:
  - 投稿者あり: `['REQ', '<subId>', { authors: [hex], kinds: [kind], limit: 20 }]`
  - 投稿者なし: `['REQ', '<subId>', { kinds: [kind], limit: 20 }]`
  - タグあり: `['REQ', '<subId>', { '#g': ['<value>'], kinds: [kind], limit: 20, ...(authors) }]`
- 受信（サーバ→クライアント）: `['EVENT','<subId>', <event>]`
- 終了: `['EOSE','<subId>']` 受信でそのリレーの購読を停止。
- 複数リレー: `id` で重複排除 → `created_at` 降順 → 先頭 20 件を表示。

## 入力バリデーション
- `npub`/hex（任意）
  - 空欄: 許可（`authors` フィルタなしで検索）
  - `npub`: 正規表現で前提形を確認 → bech32 デコード → prefix=`npub` → 32 バイトであること
  - `hex`: `^[0-9a-f]{64}$`
- `kind`: `Number.isInteger(kind) && kind >= 0`
- Relay: `^wss://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$`
  - カンマ/改行区切りで分割、重複除去、最大 5 件を目安。
- タグ: 両方空欄は許可。片方のみ入力はエラー。`tagName`: `^[a-z]$`（英小文字 1 文字）。`tagValue`: 非空文字列。

## UI/UX
- PC 想定の 1 カラム（横幅 800–960px）
- ボタン/入力はキーボード操作可、フォーカス可視
- `textContent` による安全なテキスト描画（`innerHTML` は使わない）
- JSON/本文はモノスペースで折りたたみ表示切替
 - 前回の入力値をブラウザに保存し、次回アクセス時に自動復元

## セキュリティ
- 実行時外部スクリプト依存なし（CDN 不使用）
- DOM 挿入は `textContent`/`createTextNode` のみ
- CSP（`index.html` の `<meta http-equiv="Content-Security-Policy">`）
  - `default-src 'none'`
  - `script-src 'self'`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: https:`（プロフィール画像の表示に対応）
  - `connect-src 'self' wss:`
  - `base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`

## エラーハンドリング
- 接続失敗/ハンドシェイク失敗: リレーごとに通知
- タイムアウト: 10 秒で EOSE なしの場合は切断しエラー表示
- 不正メッセージ: 当該リレーをスキップ
- 検索中: ボタン無効化・進捗表示

## パフォーマンス
- 初回ロード合計 < 50KB（目安、未圧縮）
- DOM 更新は完了時に一括反映（逐次カウントは `aria-live`）

## アクセシビリティ
- `label for` の紐付け、Enter で送信
- `aria-live="polite"` で件数/状態の読み上げ
- コントラストは WCAG AA 目安

## ログ/法務
- アナリティクス: なし
- プライバシー: 収集なし
- ライセンス: MIT（`LICENSE` 同梱）

## 既定値
- `limit`: 20（固定）
- タイムアウト: 10 秒
- デフォルトリレー: `wss://yabu.me`（ユーザーが自由に変更可）

## フォルダ構成
- `index.html`（UI＋CSP）
- `styles.css`
- `app.js`（UI ロジック・Nostr 最小クライアント）
- `bech32.js`（bech32/nip19 デコード最小実装）
- `spec.md`（本ファイル）
- `README.md`（使い方）
- `LICENSE`（MIT）

## ログイン仕様
- UI: 画面右上に nostr-login ウィジェットを設置
- 方式: nostr-login に準拠（主に NIP-07 によるログイン）
- 保持: `localStorage` に保存して自動復元
- 表示: ログイン状態（`npub1...` の先頭など）
- ロジック:
  - nostr-login の `login`/`logout` イベントを監視し、`pubkey` を `hex`/`npub` へ整形して状態に保存
  - 初期表示時、ウィジェットに既存ログインがあれば採用

## 主要ロジック（擬似）
```js
// npub → hex
function decodeAuthor(input) {
  if (input.trim() === '') return null;
  if (input.startsWith('npub1')) {
    const { prefix, words } = bech32.decode(input);
    if (prefix !== 'npub') throw new Error('npub のプレフィックス不一致');
    const bytes = bech32.fromWords(words);
    if (bytes.length !== 32) throw new Error('npub 長さ不正');
    return toHex(bytes);
  }
  if (/^[0-9a-f]{64}$/.test(input)) return input;
  throw new Error('公開鍵は npub または 64 桁 hex');
}

// リレー購読
async function queryRelays(relays, authorHex, kind, limit=20, timeoutMs=10000) {
  const subId = 'sub-' + Math.random().toString(36).slice(2, 10);
  const events = new Map();
  const done = new Set();
  const sockets = relays.map(url => new WebSocket(url));
  const filter = { kinds: [kind], limit };
  if (authorHex) filter.authors = [authorHex];
  // ... onopen で REQ（filter を使用）、onmessage で EVENT/EOSE、エラー/タイムアウト処理
}
```

## デプロイ
- 手動: `gh-pages` ブランチに静的ファイルを配置 → リポ設定で Pages を有効化。
- 自動（任意）: GitHub Actions（Pages 公式ワークフロー）で `main` → Pages へ反映。
