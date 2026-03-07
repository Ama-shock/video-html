/**
 * ゲストの許可・コントローラー割り当て・プロフィールを IndexedDB に永続化する。
 */

import { dbDelete, dbGet, dbGetAll, dbSet } from './index';

export type GuestEntry = {
	/** ゲストのユーザー ID (Ed25519 公開鍵 base64url) */
	userId: string;
	/** ゲスト表示名 */
	username: string;
	/** 許可済みかどうか */
	allowed: boolean;
	/** 割り当てコントローラー ID (switch-bt-ws の id)。未割当は null */
	controllerId: number | null;
	/** 最終接続日時 (ISO 8601) */
	lastSeen: string;
};

export async function loadGuest(userId: string): Promise<GuestEntry | null> {
	return (await dbGet<GuestEntry>('guests', userId)) ?? null;
}

export async function saveGuest(entry: GuestEntry): Promise<void> {
	await dbSet('guests', entry.userId, entry);
}

export async function deleteGuest(userId: string): Promise<void> {
	await dbDelete('guests', userId);
}

export async function listGuests(): Promise<GuestEntry[]> {
	const all = await dbGetAll<GuestEntry>('guests');
	return all.map(({ value }) => value);
}
