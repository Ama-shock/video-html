/**
 * ドングル接続フローのオーケストレーション。
 *
 * WS 接続・再接続・ペアリング・切断の複合フローを管理する。
 * Redux store に直接ディスパッチする。
 */

import { loadLinkKeys, saveKnownDongles, saveLinkKeys } from '../db/settings';
import { store } from '../store';
import {
	setControllers,
	setDevices,
	setDongleStatus,
	setError,
	setKnownDongles,
	setLinkKeysAvailable,
	setLoading,
	setManuallyDisconnected,
	setVersion,
} from '../store/dongleSlice';
import type { BtDevice, Controller, KnownDongle } from './types';
import { dongleKey, isWinUsb } from './types';

// ---------------------------------------------------------------------------
// データ取得
// ---------------------------------------------------------------------------

export async function fetchDongleData(apiBase: string): Promise<{
	devices: BtDevice[];
	controllers: Controller[];
	version: string | null;
}> {
	store.dispatch(setLoading(true));
	store.dispatch(setError(null));
	try {
		const [ctrlResp, devResp] = await Promise.all([
			fetch(`${apiBase}/api/controllers`),
			fetch(`${apiBase}/api/driver/list`),
		]);

		let controllers: Controller[] = [];
		if (ctrlResp.ok) {
			controllers = await ctrlResp.json();
			store.dispatch(setControllers(controllers));
		}

		let devices: BtDevice[] = [];
		let version: string | null = null;
		if (devResp.ok) {
			const data = (await devResp.json()) as { version?: string; devices?: BtDevice[] };
			if (data.devices) {
				devices = data.devices;
				version = data.version ?? null;
			} else {
				devices = data as unknown as BtDevice[];
			}
			store.dispatch(setDevices(devices));
			if (version) store.dispatch(setVersion(version));
		}

		// コントローラー状態から dongleStatuses を更新
		for (const c of controllers) {
			const key = dongleKey(c.vid, c.pid, c.instance);
			if (c.paired) {
				store.dispatch(setDongleStatus({ key, status: 'paired' }));
			} else if (c.syncing) {
				store.dispatch(setDongleStatus({ key, status: 'syncing' }));
			} else {
				store.dispatch(setDongleStatus({ key, status: 'connecting' }));
			}
		}

		return { devices, controllers, version };
	} catch {
		store.dispatch(setError('switch-bt-ws に接続できません'));
		return { devices: [], controllers: [], version: null };
	} finally {
		store.dispatch(setLoading(false));
	}
}

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
	store.dispatch(setDongleStatus({ key, status: 'connecting' }));

	try {
		const controllerId = await createController(apiBase, device);
		if (controllerId == null) {
			store.dispatch(setDongleStatus({ key, status: 'error' }));
			return null;
		}

		// IndexedDB からリンクキーを取得
		const linkKeys = await loadLinkKeys(key);

		// WS を開いてステータス監視 + reconnect コマンドを送信
		openControllerWs(apiBase, controllerId, key, device, {
			type: 'reconnect',
			link_keys: linkKeys,
		});

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
	// コントローラーリストからも即座に除外
	store.dispatch(setControllers(controllers.filter((c) => c.id !== controllerId)));

	// サブプロセス終了前にリンクキーを保存（プロセス終了でメモリ上のキーが消えるため）
	if (dKey) {
		await fetchAndSaveLinkKeys(apiBase, controllerId, dKey);
	}

	// 管理用 WS を閉じる
	closeControllerWs(controllerId);

	try {
		await fetch(`${apiBase}/api/controllers/${controllerId}`, { method: 'DELETE' });
	} catch {
		/* ignore */
	}

	await refreshControllers(apiBase);
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

/** ペアリング成功時に既知ドングルに追加 */
export async function markDongleAsKnown(device: BtDevice): Promise<void> {
	const state = store.getState().dongle;
	const key = dongleKey(device.vid, device.pid, device.instance);
	const existing = state.knownDongles.filter((k) => dongleKey(k.vid, k.pid, k.instance) !== key);
	const updated: KnownDongle[] = [
		...existing,
		{ vid: device.vid, pid: device.pid, instance: device.instance, lastConnected: Date.now() },
	];
	store.dispatch(setKnownDongles(updated));
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
// ドライバ操作
// ---------------------------------------------------------------------------

export async function installWinUsbDriver(
	apiBase: string,
	vid: string,
	pid: string,
): Promise<string> {
	const resp = await fetch(`${apiBase}/api/driver/install`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ vid: parseInt(vid, 16), pid: parseInt(pid, 16) }),
	});
	const result = (await resp.json()) as { message?: string; error?: string };
	return result.message ?? result.error ?? '完了';
}

export async function restoreStandardDriver(
	apiBase: string,
	vid: string,
	pid: string,
): Promise<string> {
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
 * @returns controller ID、失敗時は null
 */
async function createController(apiBase: string, device: BtDevice): Promise<number | null> {
	await cleanupExistingController(apiBase, device);

	const addResp = await fetch(`${apiBase}/api/controllers`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			vid: parseInt(device.vid, 16),
			pid: parseInt(device.pid, 16),
			instance: device.instance,
		}),
	});

	if (!addResp.ok) return null;

	const result = (await addResp.json()) as { id?: number };
	await refreshControllers(apiBase);
	return result.id ?? null;
}

type WsInitCommand = { type: 'reconnect'; link_keys: string | null } | { type: 'sync_start' };

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
						await refreshControllers(apiBase);
					}
				} else if (msg.syncing) {
					store.dispatch(setDongleStatus({ key: dKey, status: 'syncing' }));
				} else {
					store.dispatch(setDongleStatus({ key: dKey, status: 'connecting' }));
				}
				prevPaired = !!msg.paired;
			} else if (msg.type === 'link_keys' && msg.data) {
				await saveLinkKeys(dKey, msg.data);
				store.dispatch(setLinkKeysAvailable({ key: dKey, available: true }));
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

/**
 * サーバーからリンクキーをエクスポートし IndexedDB に保存する。
 * 一時的に WS を開いて LinkKeys メッセージを受信する。
 */
async function fetchAndSaveLinkKeys(
	apiBase: string,
	controllerId: number,
	dKey: string,
): Promise<void> {
	// 既に管理用 WS が開いている場合はそこから要求
	const existingWs = controllerWsMap.get(controllerId);
	if (existingWs && existingWs.readyState === WebSocket.OPEN) {
		return new Promise<void>((resolve) => {
			const origHandler = existingWs.onmessage;
			const timeout = setTimeout(() => {
				existingWs.onmessage = origHandler;
				resolve();
			}, 5000);

			existingWs.onmessage = async (ev) => {
				// 既存ハンドラも呼ぶ
				if (origHandler) (origHandler as (ev: MessageEvent) => void).call(existingWs, ev);
				try {
					const msg = JSON.parse(ev.data as string) as { type: string; data?: string };
					if (msg.type === 'link_keys' && msg.data) {
						await saveLinkKeys(dKey, msg.data);
						store.dispatch(setLinkKeysAvailable({ key: dKey, available: true }));
						clearTimeout(timeout);
						existingWs.onmessage = origHandler;
						resolve();
					}
				} catch {
					/* ignore */
				}
			};

			existingWs.send(JSON.stringify({ type: 'get_link_keys' }));
		});
	}

	// 管理用 WS が無い場合は一時的に WS を開く
	const wsBase = apiBase.replace(/^http/, 'ws');
	return new Promise<void>((resolve) => {
		const ws = new WebSocket(`${wsBase}/ws/${controllerId}`);
		const timeout = setTimeout(() => {
			ws.close();
			resolve();
		}, 5000);

		ws.onmessage = async (ev) => {
			try {
				const msg = JSON.parse(ev.data as string) as { type: string; data?: string };
				if (msg.type === 'link_keys' && msg.data) {
					await saveLinkKeys(dKey, msg.data);
					store.dispatch(setLinkKeysAvailable({ key: dKey, available: true }));
					clearTimeout(timeout);
					ws.close();
					resolve();
				}
			} catch {
				/* ignore */
			}
		};

		ws.onopen = () => {
			ws.send(JSON.stringify({ type: 'get_link_keys' }));
		};

		ws.onerror = () => {
			clearTimeout(timeout);
			resolve();
		};
	});
}

async function refreshControllers(apiBase: string): Promise<void> {
	try {
		const resp = await fetch(`${apiBase}/api/controllers`);
		if (resp.ok) {
			const controllers = (await resp.json()) as Controller[];
			store.dispatch(setControllers(controllers));
		}
	} catch {
		/* ignore */
	}
}
