# Nostr Event Search Viewer

ブラウザだけで動作する、Nostr のイベント検索ビューアです。GitHub Pages にそのままデプロイできます。

## 機能
- 右上の nostr-login ウィジェットでログイン
- 投稿者（`npub` または 64 桁 hex、任意）と `kind` を指定
- タグフィルタ（任意）を 1 組指定（例: タグ名=`g`, 値=`osaka`）
- ログインユーザのフォロー先から検索対象を選択（アイコン・表示名・ハンドルを表示）
- リレー URL（`wss://...`）を 1 件以上指定（複数可）
- 条件に一致するイベントを最新 20 件まで取得し、`created_at` 降順で表示
- 本文、タグ、JSON の確認（安全なテキスト表示）
- 前回の入力値・ログイン状態を保存して自動復元（localStorage）
- フォロー先・プロフィールをローカルにキャッシュ（TTL=1日）

## 使い方（ローカル）
1. `index.html` をブラウザで開きます。
2. 右上の nostr-login ウィジェットからログインします。
3. 投稿者の指定は次のいずれかです:
   - 著者欄に `npub`/hex を直接入力
   - 「ログインユーザのフォロー取得」→ 候補（アイコン・表示名・ハンドル）から選び「投稿者 = 選択ユーザ」
4. kind、リレー、必要に応じてタグ名・タグ値を入力します（初期値は `wss://yabu.me`）。
5. 検索を押すとイベントを取得・表示します。

## 仕様
詳細は `spec.md` を参照してください。

## デプロイ（GitHub Pages）
### 手動
1. リポジトリで `gh-pages` ブランチを作成し、このプロジェクトのファイルを配置します。
2. GitHub のリポジトリ設定 → Pages → Branch を `gh-pages` に設定します。

### GitHub Actions（任意）
公式の Pages ワークフローを使う場合は、`main` に push された内容を Pages に反映させるワークフローを追加します。

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [ main ]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Pages を有効化してから、`main` へ push すればデプロイされます。

## ライセンス
MIT License（`LICENSE` を参照）
