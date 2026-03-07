/**
 * Gamepad → switch-bt-ws リレー。
 *
 * キーマップを使って Web Gamepad の入力を switch-bt-ws WebSocket に変換して送信する。
 */

import type { KeymapEntry } from '../db/settings';
import type { SwitchBtWsClient } from '../switchBtWs/client';
import {
	addGamepadListener,
	type GamepadState,
	removeGamepadListener,
	startGamepadPolling,
} from './index';

export type RelayTarget = {
	gamepadIndex: number;
	client: SwitchBtWsClient;
	keymap: KeymapEntry[];
};

const activeRelays = new Map<number, () => void>();

/**
 * 指定のゲームパッドを switch-bt-ws クライアントにリレーする。
 * 既に同じゲームパッドのリレーが存在する場合は置き換える。
 */
export function startRelay(target: RelayTarget): void {
	stopRelay(target.gamepadIndex);

	startGamepadPolling();

	const handler = (state: GamepadState) => {
		if (state.index !== target.gamepadIndex) return;
		const _buttonStatus = applyKeymap(state.buttons, target.keymap);
		const axes = mapAxes(state.axes);
		target.client.sendGamepadState(state.buttons, axes);
	};

	addGamepadListener(handler);
	activeRelays.set(target.gamepadIndex, () => removeGamepadListener(handler));
}

export function stopRelay(gamepadIndex: number): void {
	const cleanup = activeRelays.get(gamepadIndex);
	if (cleanup) {
		cleanup();
		activeRelays.delete(gamepadIndex);
	}
}

export function stopAllRelays(): void {
	for (const [idx] of activeRelays) {
		stopRelay(idx);
	}
}

/**
 * Web Gamepad ボタン配列とキーマップから Switch ボタンビットマスクを計算する。
 */
export function applyKeymap(buttons: boolean[], keymap: KeymapEntry[]): number {
	let mask = 0;
	for (const entry of keymap) {
		if (buttons[entry.gamepadButton]) {
			mask |= entry.switchButton;
		}
	}
	return mask;
}

/**
 * Web Gamepad 軸値 [-1, 1] を switch-bt-ws 値 [0, 4095] に変換する。
 * 軸0=左X, 軸1=左Y, 軸2=右X, 軸3=右Y
 */
export function mapAxes(axes: number[]): number[] {
	return axes.map((v) => Math.round(((v + 1) / 2) * 4095));
}
