/**
 * 全体状態同期用 WebSocket クライアント。
 *
 * サーバーの `/ws` に永続接続し、デバイス一覧・コントローラー一覧の
 * スナップショットをリアルタイムで受信する。
 * 切断時は自動再接続し、リスト表示を空にする。
 */

import { store } from '../store';
import {
	setControllers,
	setDevices,
	setDongleInitialized,
	setDongleStatus,
	setError,
	setVersion,
	updateControllerStatus,
} from '../store/dongleSlice';
import { attachPairedController, hasControllerWs, markDongleAsKnown } from './dongleService';
import type { BtDevice, Controller } from './types';
import { dongleKey } from './types';

const RECONNECT_INTERVAL = 3000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentWsBase: string | null = null;
let stopped = true;

/** グローバル WS 接続を開始する。切断時は自動再接続する。 */
export function startGlobalWs(apiBase: string): void {
	if (!stopped && currentWsBase) return;
	stopped = false;
	currentWsBase = apiBase.replace(/^http/, 'ws');
	connect();
}

/** グローバル WS を停止する。 */
export function stopGlobalWs(): void {
	stopped = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (ws) {
		ws.close();
		ws = null;
	}
}

/** デバイス一覧の再スキャンを要求する。 */
export function requestRefresh(): void {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: 'refresh' }));
	}
}

function connect(): void {
	if (stopped || !currentWsBase) return;

	ws = new WebSocket(`${currentWsBase}/ws`);

	ws.onopen = () => {
		store.dispatch(setError(null));
	};

	ws.onmessage = async (ev) => {
		try {
			const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
			const msgType = msg.type as string;

			if (msgType === 'snapshot') {
				handleSnapshot(msg as unknown as SnapshotMsg);
			} else if (msgType === 'controller_status') {
				handleControllerStatus(msg as unknown as ControllerStatusMsg);
			} else if (msgType === 'controller_link_keys') {
				await handleLinkKeys(msg as unknown as LinkKeysMsg);
			}
		} catch {
			/* ignore parse errors */
		}
	};

	ws.onclose = () => {
		ws = null;
		// 切断時はリストを空にしてエラーを表示
		store.dispatch(setDevices([]));
		store.dispatch(setControllers([]));
		store.dispatch(setVersion(null));
		store.dispatch(setError('switch-bt-ws に接続できません'));

		// 自動再接続
		if (!stopped) {
			reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL);
		}
	};

	ws.onerror = () => {
		// onclose が呼ばれるのでここでは何もしない
	};
}

// ---------------------------------------------------------------------------
// メッセージハンドラ
// ---------------------------------------------------------------------------

type SnapshotMsg = { version?: string; devices?: BtDevice[]; controllers?: Controller[] };
type ControllerStatusMsg = { id: number; paired: boolean; rumble: boolean; syncing: boolean; player: number };
type LinkKeysMsg = { id: number; vid: string; pid: string; instance: number; data: string };

function handleSnapshot(msg: SnapshotMsg): void {
	const devices = msg.devices ?? [];
	const controllers = msg.controllers ?? [];

	store.dispatch(setDevices(devices));
	store.dispatch(setControllers(controllers));
	if (msg.version) store.dispatch(setVersion(msg.version));

	// コントローラー状態から dongleStatuses を更新し、ペアリング済みには個別 WS を接続
	const apiBase = currentWsBase?.replace(/^ws/, 'http') ?? '';
	for (const c of controllers) {
		const key = dongleKey(c.vid, c.pid, c.instance);
		if (c.paired) {
			store.dispatch(setDongleStatus({ key, status: 'paired' }));
			// link_keys があれば既知ドングルに保存
			if (c.link_keys) {
				markDongleAsKnown(
					{ vid: c.vid, pid: c.pid, instance: c.instance, description: '', driver: '' },
					c.link_keys,
				);
			}
			// 管理用 WS が未接続なら自動接続
			if (!hasControllerWs(c.id) && apiBase) {
				attachPairedController(apiBase, c);
			}
		} else if (c.syncing) {
			store.dispatch(setDongleStatus({ key, status: 'syncing' }));
		} else {
			store.dispatch(setDongleStatus({ key, status: 'connecting' }));
		}
	}

	if (!store.getState().dongle.initialized) {
		store.dispatch(setDongleInitialized());
	}
}

function handleControllerStatus(msg: ControllerStatusMsg): void {
	store.dispatch(updateControllerStatus(msg));

	// dongleStatuses も更新
	const controllers = store.getState().dongle.controllers;
	const ctrl = controllers.find((c) => c.id === msg.id);
	if (ctrl) {
		const key = dongleKey(ctrl.vid, ctrl.pid, ctrl.instance);
		if (msg.paired) {
			store.dispatch(setDongleStatus({ key, status: 'paired' }));
			// 管理用 WS が未接続なら自動接続
			const apiBase = currentWsBase?.replace(/^ws/, 'http') ?? '';
			if (!hasControllerWs(ctrl.id) && apiBase) {
				attachPairedController(apiBase, ctrl);
			}
		} else if (msg.syncing) {
			store.dispatch(setDongleStatus({ key, status: 'syncing' }));
		} else {
			store.dispatch(setDongleStatus({ key, status: 'connecting' }));
		}
	}
}

async function handleLinkKeys(msg: LinkKeysMsg): Promise<void> {
	await markDongleAsKnown(
		{ vid: msg.vid, pid: msg.pid, instance: msg.instance, description: '', driver: '' },
		msg.data,
	);
}
