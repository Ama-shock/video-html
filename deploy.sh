#!/bin/sh
# Cloudflare Workers デプロイスクリプト
# フロントエンド (静的サイト) + WebPush ゲートウェイ Worker を単一デプロイ。
#
# 使い方:
#   docker compose --profile deploy run --rm deploy login   # 初回ログイン
#   docker compose --profile deploy run --rm deploy         # デプロイ
#
# または API トークン認証 (login 不要):
#   CLOUDFLARE_API_TOKEN=xxx docker compose --profile deploy run --rm deploy
#
# 任意:
#   VAPID_PRIVATE_KEY_D — VAPID 秘密鍵 (wrangler secret put 済みなら不要)

set -e

cd /app
npm ci --ignore-scripts

# サブコマンド: login
if [ "$1" = "login" ]; then
  echo "=== Cloudflare ログイン ==="
  echo "ブラウザが開いたら Cloudflare にログインしてください。"
  npx wrangler login --callback-host 0.0.0.0
  exit 0
fi

# API トークンもログイン済みキャッシュも無い場合はエラー
if [ -z "$CLOUDFLARE_API_TOKEN" ] && [ ! -f /root/.wrangler/config/default.toml ]; then
  echo "エラー: 認証情報がありません。"
  echo ""
  echo "方法 1: OAuth ログイン (初回のみ)"
  echo "  docker compose --profile deploy run --rm deploy login"
  echo ""
  echo "方法 2: API トークン"
  echo "  CLOUDFLARE_API_TOKEN=xxx docker compose --profile deploy run --rm deploy"
  exit 1
fi

echo "=== Cloudflare Workers デプロイ ==="

# フロントエンドビルド (esbuild → public/)
echo "Building frontend..."
node build.ts
echo "Frontend build complete."

# Worker + Static Assets デプロイ
echo "Deploying to Cloudflare..."
npx wrangler deploy

# VAPID 秘密鍵をシークレットに設定（環境変数で渡された場合のみ）
if [ -n "$VAPID_PRIVATE_KEY_D" ]; then
  echo "Setting VAPID_PRIVATE_KEY_D secret..."
  printf '%s' "$VAPID_PRIVATE_KEY_D" | npx wrangler secret put VAPID_PRIVATE_KEY_D
fi

echo ""
echo "=== デプロイ完了 ==="
