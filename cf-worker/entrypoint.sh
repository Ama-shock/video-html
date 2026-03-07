#!/bin/sh
# Gateway コンテナ起動スクリプト
# ボリューム上に秘密鍵がなければ生成し、.dev.vars に設定して wrangler dev を起動する。

KEY_FILE="/data/vapid-private-key-d.txt"

# 秘密鍵が無ければ生成
if [ ! -f "$KEY_FILE" ]; then
  echo "Generating new VAPID private key..."
  node -e "
    const { subtle } = globalThis.crypto;
    (async () => {
      const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
      // PKCS8 P-256: last 32 bytes are the raw scalar
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

# 依存インストール & wrangler dev 起動
npm ci && npx wrangler dev
