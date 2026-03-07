#!/bin/sh
# 開発コンテナ起動スクリプト
# 1. VAPID 秘密鍵がなければ生成してボリュームに永続化
# 2. フロントエンドをビルド (esbuild → public/)
# 3. wrangler dev で Worker + Static Assets を配信

set -e

KEY_FILE="/data/vapid-private-key-d.txt"

# 秘密鍵が無ければ生成
if [ ! -f "$KEY_FILE" ]; then
  echo "Generating new VAPID private key..."
  node -e "
    const { subtle } = globalThis.crypto;
    (async () => {
      const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
      const d = pkcs8.slice(-32);
      const b64url = Buffer.from(d).toString('base64url');
      require('fs').writeFileSync('$KEY_FILE', b64url);
      console.log('VAPID private key generated.');
    })();
  "
fi

VAPID_PRIVATE_KEY_D=$(cat "$KEY_FILE")

# .dev.vars を生成
cat > /app/.dev.vars <<EOF
VAPID_PRIVATE_KEY_D=${VAPID_PRIVATE_KEY_D}
EOF

echo "VAPID_PRIVATE_KEY_D is set from volume."

# 依存インストール
npm ci

# フロントエンドビルド
echo "Building frontend..."
node build.ts

# wrangler dev 起動 (Worker + Static Assets)
echo "Starting wrangler dev..."
npx wrangler dev
