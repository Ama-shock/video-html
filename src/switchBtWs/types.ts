/**
 * switch-bt-ws 関連の共有型定義。
 */

/** BT ドングルデバイス（GET /api/driver/list） */
export type BtDevice = {
	vid: string;
	pid: string;
	description: string;
	driver: string;
	instance: number;
};

/** コントローラー（GET /api/controllers） */
export type Controller = {
	id: number;
	vid: string;
	pid: string;
	instance: number;
	paired: boolean;
	rumble: boolean;
	syncing: boolean;
	player: number;
};

/** IndexedDB に保存する既知ドングル */
export type KnownDongle = {
	vid: string;
	pid: string;
	instance: number;
	lastConnected: number;
};

/** IndexedDB に保存する接続マップエントリ */
export type ConnectionMapEntry = {
	dongleKey: string; // `${vid}:${pid}:${instance}`
	sourceType: 'gamepad' | 'keyboard' | 'guest';
	sourceId: string; // gamepad index, 'keyboard', userId
};

/** ドングルの接続状態 */
export type DongleConnectionStatus = 'disconnected' | 'connecting' | 'syncing' | 'paired' | 'error';

export function dongleKey(vid: string, pid: string, instance: number): string {
	return `${vid}:${pid}:${instance}`;
}

export function isWinUsb(driver: string): boolean {
	return /^winusb$/i.test(driver);
}

export function isBthUsb(driver: string): boolean {
	return /^(bthusb|bthenum)/i.test(driver);
}

/**
 * コントローラー ID → プレイヤー番号（P1〜P4）のマップを生成する。
 * Switch が LED で割り当てたプレイヤー番号（controller.player）を使用する。
 * player が 0（未割当）の場合はマップに含めない。
 */
export function controllerPlayerMap(controllers: Controller[]): Map<number, number> {
	const map = new Map<number, number>();
	for (const c of controllers) {
		if (c.player > 0) {
			map.set(c.id, c.player);
		}
	}
	return map;
}
