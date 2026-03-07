/**
 * Cloudflare バンドルゲートウェイクライアント。
 *
 * クレデンシャルバンドルをゲートウェイに送ってプッシュ配信する。
 */

import {
	encodeCredentialBundle,
	fromBase64Url,
	type PushSubscription,
	toBase64Url,
} from '../crypto/credentialBundle';
import type { WebPushSubscriptionInfo } from './subscription';

export type GatewayInfo = {
	url: string;
	publicKey: string; // base64url P-256 公開鍵
	keyId: string; // base64url 8-byte key ID
};

/**
 * ゲートウェイから公開鍵と鍵 ID を取得する。
 */
export async function fetchGatewayInfo(gatewayUrl: string): Promise<GatewayInfo> {
	const [pkResp, kidResp] = await Promise.all([
		fetch(`${gatewayUrl}/vapid-public-key`),
		fetch(`${gatewayUrl}/gateway-key-id`),
	]);

	if (!pkResp.ok || !kidResp.ok) throw new Error('Failed to fetch gateway info');

	const { publicKey } = (await pkResp.json()) as { publicKey: string };
	const { keyId } = (await kidResp.json()) as { keyId: string };

	return { url: gatewayUrl, publicKey, keyId };
}

/**
 * 自分の WebPush サブスクリプションを部屋鍵（クレデンシャルバンドル）にエンコードして返す。
 *
 * @param sub  自分の WebPush サブスクリプション
 * @param gateway  ゲートウェイ情報
 * @param validForSeconds  有効期間（秒、最大 86400）
 */
export async function createRoomKey(
	sub: WebPushSubscriptionInfo,
	gateway: GatewayInfo,
	validForSeconds: number,
): Promise<string> {
	const expirationSec = Math.floor(Date.now() / 1000) + Math.min(validForSeconds, 86400);

	const bundle = await encodeCredentialBundle(
		sub as PushSubscription,
		gateway.publicKey,
		gateway.keyId,
		expirationSec,
	);

	return toBase64Url(bundle);
}

/**
 * クレデンシャルバンドル宛てにペイロードをプッシュする。
 *
 * @param destBundle  宛先クレデンシャルバンドル (base64url)
 * @param payload  送信するオブジェクト
 * @param gatewayUrl  ゲートウェイ URL
 * @param ttl  TTL 秒 (デフォルト 60)
 */
export async function pushToBundle(
	destBundle: string,
	payload: unknown,
	gatewayUrl: string,
	ttl = 60,
): Promise<void> {
	const resp = await fetch(`${gatewayUrl}/push`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ bundle: destBundle, payload, ttl }),
	});

	if (!resp.ok) {
		const err = (await resp.json()) as { error?: string };
		throw new Error(`Push failed: ${err.error ?? resp.statusText}`);
	}
}

/**
 * 部屋鍵文字列 (base64url) から有効期限を取り出す（バンドル内の plaintext は暗号化されているため不可）。
 * ここでは単に長さチェックのみ行う。
 */
export function validateRoomKeyFormat(roomKey: string): boolean {
	try {
		const bytes = fromBase64Url(roomKey);
		return bytes.length >= 50; // 最低限のサイズ
	} catch {
		return false;
	}
}
