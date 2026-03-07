/**
 * ユーザーアイデンティティ管理。
 *
 * - Ed25519 鍵ペアを生成し、公開鍵をユーザー ID として使用する
 * - 秘密鍵は extractable=false で IndexedDB に保存（出力不可）
 * - 公開鍵は base64url でエンコードして表示・送信に使用する
 */

import { loadIdentity, type StoredIdentity, saveIdentity } from '../db/identity';

export type { StoredIdentity };

export async function getOrCreateIdentity(): Promise<StoredIdentity> {
	const existing = await loadIdentity();
	if (existing) return existing;

	return createIdentity();
}

export async function createIdentity(): Promise<StoredIdentity> {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'Ed25519' },
		false, // 秘密鍵は出力不可
		['sign', 'verify'],
	);

	const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

	const publicKeyB64 = toBase64Url(publicKeyRaw);

	const identity: StoredIdentity = {
		privateKey: keyPair.privateKey,
		publicKeyRaw,
		publicKeyB64,
	};

	await saveIdentity(identity);
	return identity;
}

/**
 * Ed25519 秘密鍵でメッセージを署名する。
 * ゲストがホストにプロフィールを送る際の認証に使用。
 */
export async function signMessage(
	identity: StoredIdentity,
	message: Uint8Array,
): Promise<Uint8Array> {
	const sig = await crypto.subtle.sign(
		{ name: 'Ed25519' },
		identity.privateKey,
		message as Uint8Array<ArrayBuffer>,
	);
	return new Uint8Array(sig);
}

/**
 * 公開鍵 (raw 32 bytes) で署名を検証する。
 */
export async function verifySignature(
	publicKeyRaw: Uint8Array,
	message: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	const publicKey = await crypto.subtle.importKey(
		'raw',
		publicKeyRaw as Uint8Array<ArrayBuffer>,
		{ name: 'Ed25519' },
		false,
		['verify'],
	);
	return crypto.subtle.verify(
		{ name: 'Ed25519' },
		publicKey,
		signature as Uint8Array<ArrayBuffer>,
		message as Uint8Array<ArrayBuffer>,
	);
}

function toBase64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
