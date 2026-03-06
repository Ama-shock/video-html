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
 *   VAPID_PUBLIC_KEY     — P-256 非圧縮公開鍵 (base64url, 65 bytes)
 *   GATEWAY_KEY_ID       — 8 バイト鍵識別子 (base64url)
 */

export interface Env {
    ALLOWED_ORIGIN: string;
    VAPID_SUBJECT: string;
    VAPID_PRIVATE_KEY_D: string;
    VAPID_PUBLIC_KEY: string;
    GATEWAY_KEY_ID: string;
    KV: KVNamespace;
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

        if (request.method === 'GET' && url.pathname === '/vapid-public-key') {
            return corsResponse(json({ publicKey: env.VAPID_PUBLIC_KEY }), 200, origin, allowedOrigin);
        }

        if (request.method === 'GET' && url.pathname === '/gateway-key-id') {
            return corsResponse(json({ keyId: env.GATEWAY_KEY_ID }), 200, origin, allowedOrigin);
        }

        if (request.method === 'POST' && url.pathname === '/push') {
            return handlePush(request, env, origin, allowedOrigin);
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
        // バンドルを復号して WebPush サブスクリプション情報を取得
        const subscription = await decodeBundle(body.bundle, env);

        // WebPush で送信
        await sendWebPush(subscription, JSON.stringify(body.payload), ttl, env);

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

async function decodeBundle(bundleB64url: string, env: Env): Promise<PushSubscription> {
    const bundle = fromBase64Url(bundleB64url);

    if (bundle.length < 9) throw new Error('Bundle too short');

    const keyId = bundle.slice(0, 8);
    const expectedKeyId = fromBase64Url(env.GATEWAY_KEY_ID);
    if (!bytesEqual(keyId, expectedKeyId)) {
        throw new Error('Key ID mismatch');
    }

    const ciphertext = bundle.slice(8);

    // Import P-256 private key (PKCS8 or raw scalar)
    const privateKeyBytes = fromBase64Url(env.VAPID_PRIVATE_KEY_D);
    const privateKey = await importP256PrivateKey(privateKeyBytes);

    // Decrypt using P-256 ECDH + AES-256-GCM (matches p256dhで復号 in Rust)
    const plaintext = await p256Decrypt(ciphertext, privateKey);

    // Parse plaintext credential (general format 0x01/0x00)
    return parseCredential(plaintext);
}

async function p256Decrypt(ciphertext: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
    if (ciphertext.length < 1) throw new Error('Ciphertext too short');

    const ephPubKeyLen = ciphertext[0];
    if (ciphertext.length < 1 + ephPubKeyLen + 12) throw new Error('Ciphertext header too short');

    const ephPubKeyBytes = ciphertext.slice(1, 1 + ephPubKeyLen);
    const nonce = ciphertext.slice(1 + ephPubKeyLen, 1 + ephPubKeyLen + 12);
    const body = ciphertext.slice(1 + ephPubKeyLen + 12);

    // Import ephemeral public key
    const ephPubKey = await crypto.subtle.importKey(
        'raw',
        ephPubKeyBytes,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
    );

    // ECDH → shared secret
    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: ephPubKey },
        privateKey,
        256,
    );

    // HKDF-SHA256 with info="credential-bundle", derive 32 bytes
    const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
    const aesKeyBytes = await crypto.subtle.deriveBits(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(0),
            info: new TextEncoder().encode('credential-bundle'),
        },
        hkdfKey,
        256,
    );

    // AES-256-GCM decrypt
    const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, body);

    return new Uint8Array(plaintext);
}

function parseCredential(data: Uint8Array): PushSubscription {
    if (data.length < 10) throw new Error('Credential data too short');

    const typeCategory = data[0];
    const minorVersion = data[1];
    // Support general format (0x01 / 0x00) only for now
    if (typeCategory !== 0x01 || minorVersion !== 0x00) {
        throw new Error(`Unsupported credential type: 0x${typeCategory.toString(16)}/0x${minorVersion.toString(16)}`);
    }

    const dv = new DataView(data.buffer, data.byteOffset);

    // Skip: type(2) + expiration_time_48(6) + nonce(2) = 10 bytes
    let offset = 10;

    // p256dh
    const p256dhLen = dv.getUint16(offset, false); offset += 2;
    const p256dh = data.slice(offset, offset + p256dhLen); offset += p256dhLen;

    // auth
    const authLen = dv.getUint16(offset, false); offset += 2;
    const auth = data.slice(offset, offset + authLen); offset += authLen;

    // endpoint
    const endpointLen = dv.getUint16(offset, false); offset += 2;
    const endpoint = new TextDecoder().decode(data.slice(offset, offset + endpointLen));

    return {
        endpoint,
        p256dh: toBase64Url(p256dh),
        auth: toBase64Url(auth),
    };
}

// ---------------------------------------------------------------------------
// WebPush (RFC 8030 + VAPID RFC 8292)
// ---------------------------------------------------------------------------

async function sendWebPush(
    subscription: PushSubscription,
    payload: string,
    ttl: number,
    env: Env,
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
        'Authorization': `vapid t=${vapidJwt}, k=${env.VAPID_PUBLIC_KEY}`,
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

    const ephPublicRaw = await crypto.subtle.exportKey('raw', ephKeyPair.publicKey);

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
        { name: 'ECDH', public: recipientKey },
        ephKeyPair.privateKey,
        256,
    );

    // salt (16 bytes random)
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // RFC 8291 key derivation
    const { contentEncryptionKey, nonce } = await deriveRfc8291Keys(
        new Uint8Array(sharedBits),
        authSecret,
        new Uint8Array(ephPublicRaw),
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
    const keyId = new Uint8Array(ephPublicRaw);
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
    const prk = await hkdfExtract(authSecret, ecdhSecret);
    const prkKey = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
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

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
    const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const prk = await crypto.subtle.sign('HMAC', saltKey, ikm);
    return new Uint8Array(prk);
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

async function importP256PrivateKey(rawScalar: Uint8Array): Promise<CryptoKey> {
    // Build PKCS8 wrapper for P-256 private key
    // (SEC1 / PKCS8 header for P-256)
    const pkcs8 = buildP256Pkcs8(rawScalar);
    return crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveBits'],
    );
}

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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
}
