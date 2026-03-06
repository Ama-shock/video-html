/**
 * non-resident-vapid クレデンシャルバンドルの TypeScript 実装。
 *
 * Rust ライブラリ (non-resident-vapid) と完全互換のバイナリフォーマット。
 *
 * バンドル構造:
 *   [key_id: 8B] [encrypted_blob]
 *
 * encrypted_blob (p256dhで暗号化 出力):
 *   [eph_pub_key_len: 1B] [eph_pub_key: 33B] [aes_nonce: 12B] [AES-256-GCM ciphertext+tag]
 *
 * plaintext (general format 0x01/0x00):
 *   [type: 1B=0x01] [minor: 1B=0x00] [expiration_time_48: 6B BE] [nonce: 2B BE]
 *   [p256dh_len: 2B BE] [p256dh] [auth_len: 2B BE] [auth] [endpoint_len: 2B BE] [endpoint UTF-8]
 */

export type PushSubscription = {
    endpoint: string;
    p256dh: string; // base64url
    auth: string;   // base64url
};

export type CredentialBundle = Uint8Array;

/**
 * WebPush サブスクリプションをクレデンシャルバンドルにエンコードする。
 *
 * @param subscription  WebPush サブスクリプション情報
 * @param gatewayPublicKey  Cloudflare Worker の P-256 公開鍵 (65バイト非圧縮形式、base64url)
 * @param keyId  8バイト鍵 ID (base64url)
 * @param expirationSec  有効期限 Unix タイムスタンプ (秒)
 */
export async function encodeCredentialBundle(
    subscription: PushSubscription,
    gatewayPublicKeyB64: string,
    keyIdB64: string,
    expirationSec: number,
): Promise<CredentialBundle> {
    const keyId = fromBase64Url(keyIdB64);
    if (keyId.length !== 8) throw new Error('keyId must be 8 bytes');

    const gatewayPublicKey = fromBase64Url(gatewayPublicKeyB64);

    // Build plaintext
    const p256dh = fromBase64Url(subscription.p256dh);
    const auth = fromBase64Url(subscription.auth);
    const endpointBytes = new TextEncoder().encode(subscription.endpoint);

    const plaintext = buildPlaintext(expirationSec, p256dh, auth, endpointBytes);

    // Encrypt with P-256 ECDH + AES-256-GCM
    const encrypted = await p256dhEncrypt(gatewayPublicKey, plaintext);

    // Assemble bundle: key_id + encrypted_blob
    const bundle = new Uint8Array(8 + encrypted.length);
    bundle.set(keyId, 0);
    bundle.set(encrypted, 8);

    return bundle;
}

function buildPlaintext(
    expirationSec: number,
    p256dh: Uint8Array,
    auth: Uint8Array,
    endpoint: Uint8Array,
): Uint8Array {
    // header: type(1) + minor(1) + exp_48(6) + nonce(2) = 10 bytes
    const header = new Uint8Array(10);
    header[0] = 0x01; // general type
    header[1] = 0x00; // minor version

    // expiration_time: lower 48 bits of u64 (BE), stored in bytes 2..8
    const exp = BigInt(expirationSec) & 0x0000_FFFF_FFFF_FFFFn;
    const expBytes = new Uint8Array(8);
    new DataView(expBytes.buffer).setBigUint64(0, exp, false);
    header.set(expBytes.slice(2), 2); // upper 2 bytes dropped → 6 bytes

    // nonce: 0x0000 (random not needed on client side, server ignores)
    header[8] = 0x00;
    header[9] = 0x00;

    const dv = {
        u16: (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, false); return b; },
    };

    return concat(
        header,
        dv.u16(p256dh.length), p256dh,
        dv.u16(auth.length), auth,
        dv.u16(endpoint.length), endpoint,
    );
}

/**
 * P-256 ECDH + AES-256-GCM 暗号化 (Rust の p256dhで暗号化 と同等)
 *
 * 出力: [eph_pub_key_len(1)] [eph_pub_key(33)] [nonce(12)] [ciphertext+tag]
 */
async function p256dhEncrypt(recipientPublicKeyRaw: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    // Import recipient public key
    const recipientKey = await crypto.subtle.importKey(
        'raw',
        recipientPublicKeyRaw,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
    );

    // Generate ephemeral key pair
    const ephKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
    );

    // Export ephemeral public key (compressed, 33 bytes)
    const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephKeyPair.publicKey));
    const ephPubCompressed = compressP256PublicKey(ephPubRaw);

    // ECDH shared secret
    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: recipientKey },
        ephKeyPair.privateKey,
        256,
    );

    // HKDF-SHA256(shared, info="credential-bundle") → 32-byte AES key
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

    const aesKey = await crypto.subtle.importKey(
        'raw',
        aesKeyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
    );

    // Random 12-byte nonce
    const nonce = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext),
    );

    // Output: [eph_len(1)] [eph_pub(33)] [nonce(12)] [ciphertext]
    return concat(
        new Uint8Array([ephPubCompressed.length]),
        ephPubCompressed,
        nonce,
        ciphertext,
    );
}

/**
 * P-256 非圧縮公開鍵 (65 bytes, 0x04 prefix) を圧縮形式 (33 bytes) に変換する。
 */
function compressP256PublicKey(raw: Uint8Array): Uint8Array {
    if (raw.length === 33) return raw; // 既に圧縮済み
    if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('Invalid P-256 public key');
    const compressed = new Uint8Array(33);
    compressed[0] = (raw[64] & 1) ? 0x03 : 0x02; // y の偶奇で prefix を決定
    compressed.set(raw.slice(1, 33), 1);
    return compressed;
}

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export function fromBase64Url(b64: string): Uint8Array {
    const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (pad.length % 4)) % 4);
    const bin = atob(pad + padding);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function concat(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
}
