/**
 * ドングル接続フローのオーケストレーション。
 *
 * WS 接続・再接続・ペアリング・切断の複合フローを管理する。
 * Redux store に直接ディスパッチする。
 *
 * デバイス・コントローラー一覧の取得はグローバル WS (dongleWs.ts) が担当する。
 */

import { saveKnownDongles } from '../db/settings';
import { store } from '../store';
import {
	setControllers,
	setDongleStatus,
	setKnownDongles,
	setLinkKeysAvailable,
	setManuallyDisconnected,
} from '../store/dongleSlice';
import type { BtDevice, KnownDongle } from './types';
import { dongleKey, isWinUsb } from './types';

// ---------------------------------------------------------------------------
// 再接続フロー（既知ドングル用）
// ---------------------------------------------------------------------------

/**
 * 同じデバイスの既存コントローラーがあれば削除する。
 * 再接続・ペアリング前に呼び出して重複を防ぐ。
 */
async function cleanupExistingController(apiBase: string, device: BtDevice): Promise<void> {
	const controllers = store.getState().dongle.controllers;
	const existing = controllers.find(
		(c) => c.vid === device.vid && c.pid === device.pid && c.instance === device.instance,
	);
	if (existing) {
		await fetch(`${apiBase}/api/controllers/${existing.id}`, { method: 'DELETE' }).catch(() => {});
	}
}

/**
 * コントローラーを作成し WS を開いて再接続コマンドを送信する。
 * WS 経由でステータスとリンクキーをリアルタイム受信する。
 * @returns 成功時に controller ID、失敗時に null
 */
export async function reconnectDongle(apiBase: string, device: BtDevice): Promise<number | null> {
	const key = dongleKey(device.vid, device.pid, device.instance);
	store.dispatch(setManuallyDisconnected({ key, disconnected: false }));

	// 既にコントローラーが存在し paired なら、WS を接続して再利用する
	const controllers = store.getState().dongle.controllers;
	const existing = controllers.find(
		(c) => c.vid === device.vid && c.pid === device.pid && c.instance === device.instance,
	);
	if (existing && existing.paired) {
		store.dispatch(setDongleStatus({ key, status: 'paired' }));
		if (!controllerWsMap.has(existing.id)) {
			openControllerWs(apiBase, existing.id, key, device, { type: 'get_link_keys' });
		}
		return existing.id;
	}

	store.dispatch(setDongleStatus({ key, status: 'connecting' }));

	try {
		// knownDongles からリンクキーを取得
		const known = store.getState().dongle.knownDongles.find(
			(k) => dongleKey(k.vid, k.pid, k.instance) === key,
		);
		const linkKeys = known?.linkKeys ?? null;

		// リンクキー付きでコントローラーを作成（BTStack 起動前にインポートされる）
		const controllerId = await createController(apiBase, device, linkKeys);
		if (controllerId == null) {
			store.dispatch(setDongleStatus({ key, status: 'error' }));
			return null;
		}

		// WS を開いてステータス監視 + reconnect コマンドを送信
		// リンクキーは起動時にインポート済みなので WS 経由では送らない
		openControllerWs(apiBase, controllerId, key, device, { type: 'reconnect', link_keys: null });

		return controllerId;
	} catch {
		store.dispatch(setDongleStatus({ key, status: 'error' }));
		return null;
	}
}

// ---------------------------------------------------------------------------
// ペアリングフロー
// ---------------------------------------------------------------------------

/**
 * コントローラーを作成し WS を開いてペアリングコマンドを送信する。
 * WS 経由でステータスをリアルタイム監視する。
 * @returns controller ID（成功時）、失敗時に null
 */
export async function startPairing(apiBase: string, device: BtDevice): Promise<number | null> {
	const key = dongleKey(device.vid, device.pid, device.instance);
	store.dispatch(setManuallyDisconnected({ key, disconnected: false }));
	store.dispatch(setDongleStatus({ key, status: 'connecting' }));

	try {
		const controllerId = await createController(apiBase, device);
		if (controllerId == null) {
			store.dispatch(setDongleStatus({ key, status: 'error' }));
			return null;
		}

		store.dispatch(setDongleStatus({ key, status: 'syncing' }));

		// WS を開いてステータス監視 + sync_start コマンドを送信
		openControllerWs(apiBase, controllerId, key, device, { type: 'sync_start' });

		return controllerId;
	} catch {
		store.dispatch(setDongleStatus({ key, status: 'error' }));
		return null;
	}
}

// ---------------------------------------------------------------------------
// 切断
// ---------------------------------------------------------------------------

export async function disconnectDongle(apiBase: string, controllerId: number): Promise<void> {
	// コントローラー情報から key を取得し、直ちに未接続に更新
	const controllers = store.getState().dongle.controllers;
	const ctrl = controllers.find((c) => c.id === controllerId);
	const dKey = ctrl ? dongleKey(ctrl.vid, ctrl.pid, ctrl.instance) : null;

	if (dKey) {
		store.dispatch(setDongleStatus({ key: dKey, status: 'disconnected' }));
		store.dispatch(setManuallyDisconnected({ key: dKey, disconnected: true }));
	}

	// コントローラーの link_keys が取得済みなら既知ドングルに保存
	if (ctrl?.link_keys) {
		await markDongleAsKnown(
			{ vid: ctrl.vid, pid: ctrl.pid, instance: ctrl.instance, description: '', driver: '' },
			ctrl.link_keys,
		);
	}

	// コントローラーリストからも即座に除外
	store.dispatch(setControllers(controllers.filter((c) => c.id !== controllerId)));

	// 管理用 WS を閉じる
	closeControllerWs(controllerId);

	try {
		await fetch(`${apiBase}/api/controllers/${controllerId}`, { method: 'DELETE' });
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// 自動接続
// ---------------------------------------------------------------------------

/**
 * 既知ドングルの自動接続。
 * WinUSB デバイスのうち knownDongles に含まれ、まだコントローラーとして登録されていないものを再接続する。
 */
export async function autoConnectKnownDongles(apiBase: string): Promise<void> {
	const { devices, controllers, knownDongles, manuallyDisconnected } = store.getState().dongle;

	const winUsbDevices = devices.filter((d) => isWinUsb(d.driver));

	for (const device of winUsbDevices) {
		const dKey = dongleKey(device.vid, device.pid, device.instance);

		// ユーザーが手動切断した場合は自動再接続しない
		if (manuallyDisconnected[dKey]) continue;

		// 既に接続済みならスキップ
		const alreadyConnected = controllers.some(
			(c) => c.vid === device.vid && c.pid === device.pid && c.instance === device.instance,
		);
		if (alreadyConnected) continue;

		// 既知ドングルでなければスキップ
		const isKnown = knownDongles.some(
			(k) => k.vid === device.vid && k.pid === device.pid && k.instance === device.instance,
		);
		if (!isKnown) continue;

		// 再接続を試行
		await reconnectDongle(apiBase, device);
	}
}

// ---------------------------------------------------------------------------
// 既知ドングル管理
// ---------------------------------------------------------------------------

/** ペアリング成功時に既知ドングルに追加（リンクキーがあれば一緒に保存） */
export async function markDongleAsKnown(device: BtDevice, linkKeys?: string): Promise<void> {
	const state = store.getState().dongle;
	const key = dongleKey(device.vid, device.pid, device.instance);
	const prev = state.knownDongles.find((k) => dongleKey(k.vid, k.pid, k.instance) === key);
	// インスタンスが変わっても description が失われないよう、VID+PID 横断で検索する
	const anyDesc = state.knownDongles.find((k) => k.vid === device.vid && k.pid === device.pid && k.description)?.description;
	const existing = state.knownDongles.filter((k) => dongleKey(k.vid, k.pid, k.instance) !== key);
	const updated: KnownDongle[] = [
		...existing,
		{
			vid: device.vid,
			pid: device.pid,
			instance: device.instance,
			lastConnected: Date.now(),
			linkKeys: linkKeys ?? prev?.linkKeys,
			description: device.description || prev?.description || anyDesc,
		},
	];
	store.dispatch(setKnownDongles(updated));
	if (linkKeys) {
		store.dispatch(setLinkKeysAvailable({ key, available: true }));
	}
	await saveKnownDongles(updated);
}

/** 既知ドングルから削除 */
export async function forgetDongle(vid: string, pid: string, instance: number): Promise<void> {
	const state = store.getState().dongle;
	const key = dongleKey(vid, pid, instance);
	const updated = state.knownDongles.filter((k) => dongleKey(k.vid, k.pid, k.instance) !== key);
	store.dispatch(setKnownDongles(updated));
	await saveKnownDongles(updated);
}

// ---------------------------------------------------------------------------
// 既存コントローラーへの自動接続
// ---------------------------------------------------------------------------

/** 指定コントローラーに管理用 WS が開いているかを返す */
export function hasControllerWs(controllerId: number): boolean {
	return controllerWsMap.has(controllerId);
}

/**
 * グローバル WS で検出された既接続コントローラーに管理用 WS を接続する。
 * リンクキーの取得と既知ドングル登録を行う。
 */
export function attachPairedController(apiBase: string, controller: { id: number; vid: string; pid: string; instance: number }): void {
	if (controllerWsMap.has(controller.id)) return;

	const device: BtDevice = {
		vid: controller.vid,
		pid: controller.pid,
		instance: controller.instance,
		description: '',
		driver: 'WinUSB',
	};
	const key = dongleKey(controller.vid, controller.pid, controller.instance);

	store.dispatch(setDongleStatus({ key, status: 'paired' }));

	openControllerWs(apiBase, controller.id, key, device, { type: 'get_link_keys' });

	// 既知ドングルに登録
	markDongleAsKnown(device);
}

// ---------------------------------------------------------------------------
// ドライバ操作
// ---------------------------------------------------------------------------

export async function installWinUsbDriver(apiBase: string, device: BtDevice): Promise<string> {
	// インストール前に description を保存（WinUSB 化後は "Bluetooth Dongle" に変わるため）
	await markDongleAsKnown(device);
	const resp = await fetch(`${apiBase}/api/driver/install`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ vid: parseInt(device.vid, 16), pid: parseInt(device.pid, 16) }),
	});
	const result = (await resp.json()) as { message?: string; error?: string };
	return result.message ?? result.error ?? '完了';
}

export async function restoreStandardDriver(apiBase: string, vid: string, pid: string): Promise<string> {
	const resp = await fetch(`${apiBase}/api/driver/restore`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ vid: parseInt(vid, 16), pid: parseInt(pid, 16) }),
	});
	const result = (await resp.json()) as { message?: string; error?: string };
	return result.message ?? result.error ?? '完了';
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** 管理用 WS マップ（controllerId → WebSocket）。切断時に閉じる。 */
const controllerWsMap = new Map<number, WebSocket>();

/** 管理用 WS を閉じる */
export function closeControllerWs(controllerId: number): void {
	const ws = controllerWsMap.get(controllerId);
	if (ws) {
		ws.close();
		controllerWsMap.delete(controllerId);
	}
}

/**
 * コントローラーを POST で作成する。既存があれば先に削除。
 * コントローラーリストの更新はグローバル WS が自動的に配信する。
 * @returns controller ID、失敗時は null
 */
async function createController(apiBase: string, device: BtDevice, linkKeys?: string | null): Promise<number | null> {
	await cleanupExistingController(apiBase, device);

	const body: Record<string, unknown> = {
		vid: parseInt(device.vid, 16),
		pid: parseInt(device.pid, 16),
		instance: device.instance,
	};
	if (linkKeys) {
		body.link_keys = linkKeys;
	}

	const addResp = await fetch(`${apiBase}/api/controllers`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!addResp.ok) return null;

	const result = (await addResp.json()) as { id?: number };
	return result.id ?? null;
}

type WsInitCommand =
	| { type: 'reconnect'; link_keys: string | null }
	| { type: 'sync_start' }
	| { type: 'get_link_keys' };

/**
 * コントローラーに管理用 WS を開き、初期コマンドを送信する。
 * WS 経由でステータス (paired/syncing) とリンクキーをリアルタイム受信し、
 * Redux ストアに反映する。
 */
function openControllerWs(
	apiBase: string,
	controllerId: number,
	dKey: string,
	device: BtDevice,
	initCommand: WsInitCommand,
): void {
	// 既存の管理用 WS があれば閉じる
	closeControllerWs(controllerId);

	const wsBase = apiBase.replace(/^http/, 'ws');
	const ws = new WebSocket(`${wsBase}/ws/${controllerId}`);
	controllerWsMap.set(controllerId, ws);

	let prevPaired = false;

	ws.onopen = () => {
		ws.send(JSON.stringify(initCommand));
	};

	ws.onmessage = async (ev) => {
		try {
			const msg = JSON.parse(ev.data as string) as {
				type: string;
				paired?: boolean;
				rumble?: boolean;
				syncing?: boolean;
				data?: string;
			};

			if (msg.type === 'status') {
				if (msg.paired) {
					store.dispatch(setDongleStatus({ key: dKey, status: 'paired' }));

					// paired に遷移した瞬間のみ処理（毎 tick ではなく）
					if (!prevPaired) {
						await markDongleAsKnown(device);
					}
				} else if (msg.syncing) {
					store.dispatch(setDongleStatus({ key: dKey, status: 'syncing' }));
				} else {
					store.dispatch(setDongleStatus({ key: dKey, status: 'connecting' }));
				}
				prevPaired = !!msg.paired;
			} else if (msg.type === 'link_keys' && msg.data) {
				await markDongleAsKnown(device, msg.data);
			}
		} catch {
			/* ignore parse errors */
		}
	};

	ws.onclose = () => {
		controllerWsMap.delete(controllerId);
	};

	ws.onerror = () => {
		controllerWsMap.delete(controllerId);
	};
}

