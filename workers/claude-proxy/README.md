# Claude Proxy (Cloudflare Worker)

Claude (Anthropic) API を Firebase Auth で保護した proxy。
GitHub Pages 上のアプリが、API キーをクライアントに持たずに Claude を使えるようにする。

## アーキテクチャ

```
[ブラウザ app]
    │  Authorization: Bearer <firebase-id-token>
    ▼
[Cloudflare Worker: claude-proxy]
    │  1. Firebase ID token 検証
    │  2. ANTHROPIC_API_KEY (secret) を x-api-key に
    │  3. Anthropic API に転送
    ▼
[api.anthropic.com]
```

## セットアップ（初回デプロイ）

### 1. 依存インストール

```bash
cd workers/claude-proxy
npm install
```

### 2. Cloudflare にログイン（未ログインなら）

```bash
npx wrangler login
```

### 3. Secret 登録

以下3つを **wrangler secret put** で登録（ダッシュボードには保存されず、Worker 実行時のみ環境変数として参照できる）：

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# プロンプトで sk-ant-xxxxx... を貼り付け

npx wrangler secret put FIREBASE_PROJECT_ID
# プロンプトで giq-teiki-pj を貼り付け

npx wrangler secret put ALLOWED_ORIGINS
# カンマ区切りで許可 Origin を入力
# 例: https://takeakilq.github.io,http://localhost:5173
```

### 4. デプロイ

```bash
npx wrangler deploy
```

初回デプロイ時に `https://claude-proxy.<your-subdomain>.workers.dev` のような URL が表示される。

### 5. 動作確認

```bash
curl https://claude-proxy.<your-subdomain>.workers.dev/health
# => {"ok":true,"service":"claude-proxy"}
```

## クライアント側の設定

アプリの `.env` に Worker URL を設定：

```env
VITE_CLAUDE_PROXY_URL=https://claude-proxy.<your-subdomain>.workers.dev
```

`VITE_ANTHROPIC_API_KEY` は不要（削除してよい）。

GitHub Actions の secrets でも `VITE_CLAUDE_PROXY_URL` を設定し、`VITE_ANTHROPIC_API_KEY` は削除。

## 運用

### ログを見る

```bash
npx wrangler tail
```

### Secret を更新

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# 上書き保存される
```

### Secret を一覧

```bash
npx wrangler secret list
```

### 許可 Origin を追加

```bash
npx wrangler secret put ALLOWED_ORIGINS
# カンマ区切りで入力し直す（元の値は上書き）
```

## トラブルシュート

- **401 invalid_token**: Firebase ID token の検証失敗。期限切れ or プロジェクト ID 不一致
- **401 missing_auth**: クライアントが Authorization ヘッダを送っていない
- **CORS エラー**: `ALLOWED_ORIGINS` に Origin が含まれていない
- **429 / 5xx**: Anthropic 側のレート制限 or 障害。`wrangler tail` でログ確認
