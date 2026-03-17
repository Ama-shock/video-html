# video-html

ゲームコントローラー エミュレーター ([switch-bt-ws](https://github.com/Ama-shock/switch-bt-ws)) のブラウザフロントエンドです。

画面キャプチャ配信、ゲームパッド入力のリレー、ゲスト接続によるリモートプレイを提供します。
Cloudflare Workers + Static Assets でホスティングされます。

---

## 主な機能

### ホスト機能
- **画面キャプチャ配信** — ブラウザの Media Capture and Streams API でキャプチャボードから画面を取得し、WebRTC でゲストに配信
- **接続マップ** — ドングル（BT コントローラー）にゲームパッドやゲストをドラッグ&ドロップで割り当て
- **ドングル管理** — WinUSB ドライバ導入/復旧、ペアリング/再接続/切断を UI から操作
- **QR コード読み取り** — キャプチャ映像内の QR コードをスキャン
- **ゲスト入力可視化** — 接続マップ上でゲストのコントローラー入力をリアルタイム表示

### ゲスト機能
- **リモートプレイ** — 部屋鍵（URL or テキスト）でホストに接続し、映像受信 + コントローラー入力を送信
- **デバイス選択** — 送信するゲームパッド/キーボードを明示的に選択
- **プレイヤー番号表示** — ホストから割り当てられた P1〜P4 番号を表示

### 通信
- **WebPush シグナリング** — ホスト↔ゲスト間の接続確立に WebPush を使用（サーバーレス）
- **WebRTC DataChannel** — コントローラー入力の低遅延転送
- **WebRTC MediaStream** — ゲーム映像のリアルタイム配信
- **TURN 対応** — Cloudflare Calls TURN でNAT越えの WebRTC 接続をサポート

---

## アーキテクチャ

```
[ホスト PC]
  ブラウザ (video-html)
    ├── Media Capture → WebRTC MediaStream → ゲスト
    ├── Web Gamepad API → switch-bt-ws WS → BT ドングル → Switch
    ├── ゲスト入力 (DataChannel) → switch-bt-ws WS → BT ドングル → Switch
    └── WebPush シグナリング → Cloudflare Worker → ゲスト

[ゲスト端末]
  ブラウザ (video-html)
    ├── WebRTC MediaStream ← ホスト（映像受信）
    ├── Web Gamepad API → DataChannel → ホスト（入力送信）
    └── WebPush シグナリング → Cloudflare Worker → ホスト

[Cloudflare]
  Worker (worker/index.ts)
    ├── /gateway-info       VAPID 公開鍵 + 鍵 ID
    ├── /push               暗号化バンドル復号 → WebPush 送信
    ├── /turn-credentials   Cloudflare Calls TURN クレデンシャル生成
    └── Static Assets       SPA 配信 (public/)
```

---

## セットアップ

### 前提
- Node.js 22+
- npm

### インストール

```bash
cd video-html
npm install
```

### 開発サーバー

```bash
# フロントエンド開発サーバー (port 3000)
npm run dev

# Cloudflare Worker ローカル開発
npm run dev:worker
```

### ビルド

```bash
npm run build
```

成果物は `public/` に出力されます。

---

## デプロイ

### Cloudflare Workers

```bash
# 初回: Cloudflare にログイン
npx wrangler login

# VAPID 秘密鍵の設定（1回だけ）
printf '%s' '<base64url-encoded-key>' | npx wrangler secret put VAPID_PRIVATE_KEY_D

# TURN を使う場合（任意）
printf '%s' '<api-token>' | npx wrangler secret put TURN_KEY_API_TOKEN

# デプロイ
npx wrangler deploy
```

### Docker でのデプロイ

```bash
docker compose --profile deploy run --service-ports --rm deploy
# deploy コンテナ内で:
#   npx wrangler login       # OAuth (port 8976)
#   npx wrangler deploy
```

---

## WebPush シグナリング (non-resident-vapid)

ホスト↔ゲスト間のシグナリングに [non-resident-vapid](https://github.com/Ama-shock/non-resident-vapid) を使用しています。

- ステートレスなゲートウェイ: Worker は状態を持たず、暗号化バンドルをその場で復号して Push 送信
- 短縮クレデンシャル: Push エンドポイントをバイナリ圧縮して部屋鍵のサイズを削減
- 対応 Push サービス: FCM (Chrome)、Autopush (Firefox)、WNS (Edge)、APNs (Safari)

---

## プロジェクト構成

```
video-html/
├── package.json
├── build.ts                  esbuild ビルドスクリプト
├── wrangler.toml             Cloudflare Workers 設定
├── docker-compose.yml        デプロイ用 compose 定義
├── deploy.sh                 Docker デプロイスクリプト
├── worker/
│   ├── index.ts              Cloudflare Worker（Push ゲートウェイ + TURN + 静的配信）
│   └── non-resident-vapid.ts WASM ラッパー
├── src/
│   ├── main.tsx              React エントリーポイント
│   ├── style.css             グローバルスタイル
│   ├── serviceWorker.ts      Service Worker（Push 受信 + リレー）
│   ├── store/                Redux store
│   │   ├── appSlice.ts       アプリ全般状態
│   │   ├── dongleSlice.ts    ドングル/コントローラー状態
│   │   ├── gamepadSlice.ts   ゲームパッド検出状態
│   │   ├── hostSlice.ts      ホスト部屋管理
│   │   ├── guestSlice.ts     ゲスト接続状態
│   │   └── identitySlice.ts  ユーザー識別情報
│   ├── components/
│   │   ├── menu/
│   │   │   ├── GamepadMenu.tsx   接続マップ + ゲームパッド管理
│   │   │   ├── VideoMenu.tsx     映像設定 + QR 読み取り
│   │   │   ├── HostMenu.tsx      ホスト部屋管理 + ゲスト管理
│   │   │   └── GuestMenu.tsx     ゲスト接続 UI
│   │   ├── host/
│   │   │   ├── GuestList.tsx     ゲスト一覧表示
│   │   │   ├── KnownGuestList.tsx 既知ゲスト管理
│   │   │   └── RoomKeyDisplay.tsx 部屋鍵表示 + QR 生成
│   │   └── guest/
│   │       └── GuestMainView.tsx  ゲスト映像 + 入力送信
│   ├── switchBtWs/            switch-bt-ws 接続
│   │   ├── client.ts          WebSocket クライアント
│   │   ├── clientCache.ts     クライアントキャッシュ
│   │   ├── dongleService.ts   ドングル接続オーケストレーション
│   │   └── dongleWs.ts        グローバル WS 管理
│   ├── webrtc/                WebRTC 通信
│   │   ├── host.ts            HostWebRTC（SDP交換 + メディア配信）
│   │   ├── guest.ts           GuestWebRTC（入室 + 入力送信）
│   │   ├── iceConfig.ts       STUN/TURN 動的設定
│   │   └── types.ts           メッセージ型定義
│   ├── webpush/               WebPush 管理
│   │   ├── subscription.ts    Push サブスクリプション
│   │   ├── gateway.ts         ゲートウェイクライアント
│   │   └── ensureReady.ts     Push 権限チェック + ガイド
│   ├── crypto/
│   │   └── credentialBundle.ts  non-resident-vapid WASM エンコーダー
│   ├── gamepad/
│   │   ├── poll.ts            Web Gamepad API ポーリング
│   │   └── relay.ts           ゲームパッド→switch-bt-ws リレー
│   └── identity/              Ed25519 ユーザー識別
│       └── identicon.ts       アイデンティコン生成
└── public/                    ビルド成果物（Cloudflare にデプロイ）
```

---

## ライセンス

MIT
