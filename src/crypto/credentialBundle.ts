/**
 * non-resident-vapid クレデンシャルバンドルのブラウザ側エンコード。
 *
 * @ama-shock/non-resident-vapid WASM パッケージの
 * encode_credential_bundle_wasm を使用する。
 * WASM は build.ts の wasmPlugin により ESM top-level await でロードされる。
 */

import { encode_credential_bundle_wasm } from '@ama-shock/non-resident-vapid';

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
 * @param gatewayPublicKeyB64  ゲートウェイの P-256 公開鍵 (65 バイト非圧縮形式、base64url)
 * @param keyIdB64  8 バイト鍵 ID (base64url)
 * @param expirationSec  有効期限 Unix タイムスタンプ (秒)
 */
export async function encodeCredentialBundle(
    subscription: PushSubscription,
    gatewayPublicKeyB64: string,
    keyIdB64: string,
    expirationSec: number,
): Promise<CredentialBundle> {
    const subscriptionJson = JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
    });

    const b64url = encode_credential_bundle_wasm(
        subscriptionJson,
        keyIdB64,
        gatewayPublicKeyB64,
        BigInt(expirationSec),
    );

    return fromBase64Url(b64url);
}

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
