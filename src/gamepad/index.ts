/**
 * Web Gamepad API ポーリング。
 *
 * requestAnimationFrame でゲームパッド状態をポーリングし、
 * コールバックで変化を通知する。
 */

export type GamepadState = {
	buttons: boolean[];
	axes: number[];
	index: number;
};

type GamepadCallback = (state: GamepadState) => void;

let rafHandle: number | null = null;
const listeners = new Set<GamepadCallback>();
const lastStates: Map<number, string> = new Map();

export function startGamepadPolling(): void {
	if (rafHandle !== null) return;
	poll();
}

export function stopGamepadPolling(): void {
	if (rafHandle !== null) {
		cancelAnimationFrame(rafHandle);
		rafHandle = null;
	}
}

export function addGamepadListener(cb: GamepadCallback): void {
	listeners.add(cb);
}

export function removeGamepadListener(cb: GamepadCallback): void {
	listeners.delete(cb);
}

function poll(): void {
	const gamepads = navigator.getGamepads();
	for (const gp of gamepads) {
		if (!gp || !gp.connected) continue;

		const state: GamepadState = {
			index: gp.index,
			buttons: gp.buttons.map((b) => b.pressed),
			axes: Array.from(gp.axes),
		};

		const key = JSON.stringify(state.buttons) + JSON.stringify(state.axes);
		if (lastStates.get(gp.index) === key) continue;
		lastStates.set(gp.index, key);

		for (const cb of listeners) {
			cb(state);
		}
	}

	rafHandle = requestAnimationFrame(poll);
}

/**
 * 接続中のゲームパッドの一覧を返す。
 */
export function listConnectedGamepads(): Gamepad[] {
	return Array.from(navigator.getGamepads()).filter((gp): gp is Gamepad => !!gp?.connected);
}
