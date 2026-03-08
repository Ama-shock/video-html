/**
 * video-html-gateway — Cloudflare Worker
 *
 * non-resident-vapid バンドルゲートウェイ。
 * 暗号化されたクレデンシャルバンドルを受け取り、復号して WebPush を送信する。
 * 特定ドメインからのリクエストのみ受け付ける。
 *
 * エンドポイント:
 *   GET  /vapid-public-key          → VAPID 公開鍵 (base64url) を返す
 *   GET  /gateway-key-id            → バンドル暗号化用の鍵 ID (base64url) を返す
 *   POST /push                      → バンドルを復号してプッシュ送信
 *   OPTIONS *                       → CORS preflight
 *
 * Secrets (wrangler secret put):
 *   VAPID_PRIVATE_KEY_D  — P-256 秘密鍵スカラー (base64url, 32 bytes)
 *
 * 公開鍵・鍵IDは秘密鍵から自動導出:
 *   VAPID_PUBLIC_KEY  — 非圧縮公開鍵 (65 bytes) … VAPID Authorization ヘッダ用
 *   GATEWAY_KEY_ID    — 公開鍵先頭 8 バイト … クレデンシャルバンドルの鍵識別子
 */

import { decode_credential_bundle_wasm } from './non-resident-vapid';

export interface Env {
    ALLOWED_ORIGIN: string;
    VAPID_SUBJECT: string;
    VAPID_PRIVATE_KEY_D: string;
}

// ---------------------------------------------------------------------------
// Public key derivation (cached per isolate)
// ---------------------------------------------------------------------------

let cachedKeys: { d: string; publicKey: string; gatewayKeyId: string } | null = null;

async function getDerivedKeys(env: Env): Promise<{ publicKey: string; gatewayKeyId: string }> {
    if (cachedKeys && cachedKeys.d === env.VAPID_PRIVATE_KEY_D) {
        return cachedKeys;
    }

    const rawScalar = fromBase64Url(env.VAPID_PRIVATE_KEY_D);
    const pkcs8 = buildP256Pkcs8(rawScalar);

    // extractable: true で秘密鍵をインポートし、JWK から x, y を取得
    const key = await crypto.subtle.importKey(
        'pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', key) as JsonWebKey;
    const x = fromBase64Url(jwk.x!);
    const y = fromBase64Url(jwk.y!);

    // 非圧縮公開鍵: 0x04 || x || y (65 bytes)
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.set(x, 1);
    uncompressed.set(y, 33);

    // 鍵識別子: 非圧縮公開鍵の先頭 8 バイト
    const keyId = uncompressed.slice(0, 8);

    cachedKeys = {
        d: env.VAPID_PRIVATE_KEY_D,
        publicKey: toBase64Url(uncompressed),
        gatewayKeyId: toBase64Url(keyId),
    };
    return cachedKeys;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const origin = request.headers.get('Origin') ?? '';
        const allowedOrigin = env.ALLOWED_ORIGIN;

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return corsResponse(null, 204, origin, allowedOrigin);
        }

        // Domain restriction
        if (!isAllowedOrigin(origin, allowedOrigin)) {
            return corsResponse(json({ error: 'Forbidden' }), 403, origin, allowedOrigin);
        }

        const url = new URL(request.url);
        const keys = await getDerivedKeys(env);

        if (request.method === 'GET' && url.pathname === '/gateway-info') {
            return corsResponse(json({ publicKey: keys.publicKey, keyId: keys.gatewayKeyId }), 200, origin, allowedOrigin);
        }

        // 後方互換
        if (request.method === 'GET' && url.pathname === '/vapid-public-key') {
            return corsResponse(json({ publicKey: keys.publicKey }), 200, origin, allowedOrigin);
        }
        if (request.method === 'GET' && url.pathname === '/gateway-key-id') {
            return corsResponse(json({ keyId: keys.gatewayKeyId }), 200, origin, allowedOrigin);
        }

        if (request.method === 'POST' && url.pathname === '/push') {
            return handlePush(request, env, keys, origin, allowedOrigin);
        }

        return corsResponse(json({ error: 'Not Found' }), 404, origin, allowedOrigin);
    },
};

// ---------------------------------------------------------------------------
// Push handler
// ---------------------------------------------------------------------------

/**
 * リクエストボディ:
 * {
 *   bundle: string,         // base64url: 宛先クレデンシャルバンドル
 *   payload: object,        // 送信する JSON ペイロード
 *   ttl?: number,           // TTL 秒 (デフォルト 60)
 * }
 */
async function handlePush(
    request: Request,
    env: Env,
    keys: { publicKey: string; gatewayKeyId: string },
    origin: string,
    allowedOrigin: string,
): Promise<Response> {
    let body: { bundle: string; payload: unknown; ttl?: number };
    try {
        body = await request.json();
    } catch {
        return corsResponse(json({ error: 'Invalid JSON' }), 400, origin, allowedOrigin);
    }

    if (!body.bundle || !body.payload) {
        return corsResponse(json({ error: 'bundle and payload are required' }), 400, origin, allowedOrigin);
    }

    const ttl = Math.min(body.ttl ?? 60, 86400);

    try {
        // WASM でバンドルを復号して WebPush サブスクリプション情報を取得
        const decoded = decode_credential_bundle_wasm(
            body.bundle, keys.gatewayKeyId, env.VAPID_PRIVATE_KEY_D,
        );
        const subscription: PushSubscription = {
            endpoint: decoded.endpoint,
            p256dh: decoded.p256dh,
            auth: decoded.auth,
        };

        // WebPush で送信
        await sendWebPush(subscription, JSON.stringify(body.payload), ttl, env, keys.publicKey);

        return corsResponse(json({ ok: true }), 200, origin, allowedOrigin);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Push failed:', message);
        return corsResponse(json({ error: message }), 500, origin, allowedOrigin);
    }
}

// ---------------------------------------------------------------------------
// Credential bundle decryption (matches non-resident-vapid Rust format)
// ---------------------------------------------------------------------------

interface PushSubscription {
    endpoint: string;
    p256dh: string; // base64url
    auth: string;   // base64url
}


// ---------------------------------------------------------------------------
// WebPush (RFC 8030 + VAPID RFC 8292)
// ---------------------------------------------------------------------------

async function sendWebPush(
    subscription: PushSubscription,
    payload: string,
    ttl: number,
    env: Env,
    vapidPublicKey: string,
): Promise<void> {
    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

    // Build VAPID JWT
    const vapidJwt = await buildVapidJwt(audience, env);

    // Encrypt payload using RFC 8291 (aesgcm128 / aes128gcm)
    const { ciphertext, headers: encHeaders } = await encryptPayload(
        new TextEncoder().encode(payload),
        subscription.p256dh,
        subscription.auth,
    );

    const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': String(ttl),
        'Authorization': `vapid t=${vapidJwt}, k=${vapidPublicKey}`,
        ...encHeaders,
    };

    const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers,
        body: ciphertext,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`WebPush failed: ${response.status} ${text}`);
    }
}

async function buildVapidJwt(audience: string, env: Env): Promise<string> {
    const header = { typ: 'JWT', alg: 'ES256' };
    const payload = {
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 43200, // 12 hours
        sub: env.VAPID_SUBJECT,
    };

    const encodeB64 = (obj: object) =>
        toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));

    const unsigned = `${encodeB64(header)}.${encodeB64(payload)}`;

    const privateKeyBytes = fromBase64Url(env.VAPID_PRIVATE_KEY_D);
    const signingKey = await importP256SigningKey(privateKeyBytes);

    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signingKey,
        new TextEncoder().encode(unsigned),
    );

    return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

// RFC 8291 aes128gcm payload encryption
async function encryptPayload(
    plaintext: Uint8Array,
    p256dhB64: string,
    authB64: string,
): Promise<{ ciphertext: Uint8Array; headers: Record<string, string> }> {
    const recipientPublicKey = fromBase64Url(p256dhB64);
    const authSecret = fromBase64Url(authB64);

    // Generate ephemeral P-256 key pair
    const ephKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
    );

    const keyPair = ephKeyPair as CryptoKeyPair;
    const ephPublicRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);

    // Import recipient public key
    const recipientKey = await crypto.subtle.importKey(
        'raw',
        recipientPublicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
    );

    // ECDH
    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', $public: recipientKey },
        keyPair.privateKey,
        256,
    );

    // salt (16 bytes random)
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // RFC 8291 key derivation
    const { contentEncryptionKey, nonce } = await deriveRfc8291Keys(
        new Uint8Array(sharedBits),
        authSecret,
        new Uint8Array(ephPublicRaw as ArrayBuffer),
        recipientPublicKey,
        salt,
    );

    // Add 2-byte padding delimiter (0x02 = last record)
    const padded = new Uint8Array(plaintext.length + 2);
    padded.set(plaintext);
    padded[plaintext.length] = 0x02;

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        contentEncryptionKey,
        padded,
    );

    // aes128gcm content-encoding header block
    // salt(16) + rs(4, BE) + idlen(1) + keyid(idlen)
    const rs = plaintext.length + 18; // record size
    const keyId = new Uint8Array(ephPublicRaw as ArrayBuffer);
    const header = new Uint8Array(21 + keyId.length);
    header.set(salt, 0);
    new DataView(header.buffer).setUint32(16, rs, false);
    header[20] = keyId.length;
    header.set(keyId, 21);

    const ciphertext = concat(header, new Uint8Array(encrypted));

    return { ciphertext, headers: {} };
}

async function deriveRfc8291Keys(
    ecdhSecret: Uint8Array,
    authSecret: Uint8Array,
    senderPublic: Uint8Array,
    recipientPublic: Uint8Array,
    salt: Uint8Array,
): Promise<{ contentEncryptionKey: CryptoKey; nonce: Uint8Array }> {
    // PRK = HKDF-SHA256(auth_secret, ecdh_secret, "WebPush: info\0" || recipient || sender)
    const infoLabel = new TextEncoder().encode('WebPush: info\x00');
    const info = concat(infoLabel, recipientPublic, senderPublic);
    const ikm = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info },
        await crypto.subtle.importKey('raw', ecdhSecret, 'HKDF', false, ['deriveBits']),
        256,
    ));

    // cek = HKDF-SHA256(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
    const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\x00');
    const cekBytes = await hkdfExpand(salt, ikm, cekInfo, 16);
    const contentEncryptionKey = await crypto.subtle.importKey(
        'raw', cekBytes, { name: 'AES-GCM' }, false, ['encrypt'],
    );

    // nonce = HKDF-SHA256(salt, ikm, "Content-Encoding: nonce\0", 12)
    const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\x00');
    const nonce = await hkdfExpand(salt, ikm, nonceInfo, 12);

    return { contentEncryptionKey, nonce };
}

async function hkdfExpand(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        key,
        length * 8,
    );
    return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// Key import helpers
// ---------------------------------------------------------------------------

async function importP256SigningKey(rawScalar: Uint8Array): Promise<CryptoKey> {
    const pkcs8 = buildP256Pkcs8(rawScalar);
    return crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
    );
}

/**
 * Build a minimal PKCS8 DER for a P-256 private key from raw 32-byte scalar.
 * Structure: SEQUENCE { INTEGER 0, SEQUENCE { OID ecPublicKey, OID P-256 }, OCTET STRING { SEC1 } }
 */
function buildP256Pkcs8(d: Uint8Array): Uint8Array {
    // SEC1 ECPrivateKey = SEQUENCE { INTEGER 1, OCTET STRING d }
    const sec1Inner = concat(
        new Uint8Array([0x02, 0x01, 0x01]),    // INTEGER 1
        new Uint8Array([0x04, d.length]),       // OCTET STRING
        d,
    );
    const sec1 = tlv(0x30, sec1Inner); // SEQUENCE

    // Algorithm OID: ecPublicKey (1.2.840.10045.2.1) + P-256 (1.2.840.10045.3.1.7)
    const oidEC = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
    const oidP256 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
    const algId = tlv(0x30, concat(oidEC, oidP256));

    // PKCS8 PrivateKeyInfo
    const privateKeyInfo = tlv(0x30, concat(
        new Uint8Array([0x02, 0x01, 0x00]), // INTEGER 0 (version)
        algId,
        tlv(0x04, sec1), // OCTET STRING wrapping SEC1
    ));

    return privateKeyInfo;
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
    const len = value.length;
    if (len < 0x80) {
        return concat(new Uint8Array([tag, len]), value);
    } else if (len < 0x100) {
        return concat(new Uint8Array([tag, 0x81, len]), value);
    } else {
        return concat(new Uint8Array([tag, 0x82, (len >> 8) & 0xff, len & 0xff]), value);
    }
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin: string, allowedOrigin: string): boolean {
    // Allow localhost for development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true;
    return origin === allowedOrigin;
}

function corsResponse(
    body: BodyInit | null,
    status: number,
    origin: string,
    allowedOrigin: string,
): Response {
    const headers = new Headers({
        'Access-Control-Allow-Origin': isAllowedOrigin(origin, allowedOrigin) ? origin : allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
    });
    if (body !== null) {
        headers.set('Content-Type', 'application/json');
    }
    return new Response(body, { status, headers });
}

function json(obj: unknown): string {
    return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

function fromBase64Url(b64: string): Uint8Array {
    const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (pad.length % 4)) % 4);
    const bin = atob(pad + padding);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
    const bin = Array.from(bytes, b => String.fromCharCode(b)).join('');
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}
