/**
 * キーボード入力モジュール。
 *
 * keydown/keyup イベントを監視し、GamepadState 互換の状態を生成する。
 * ゲームパッドと同じコールバック形式で変化を通知する。
 */

import type { GamepadState } from '../gamepad';

/** キーボード → ゲームパッドボタンインデックスのマッピング */
export type KeyboardKeymapEntry = {
	key: string; // KeyboardEvent.code (e.g. "KeyW", "ArrowUp")
	buttonIndex: number; // GamepadState.buttons のインデックス (0-17)
};

type KeyboardCallback = (state: GamepadState) => void;

const KEYBOARD_GAMEPAD_INDEX = -1; // 仮想ゲームパッドインデックス

const pressedKeys = new Set<string>();
const listeners = new Set<KeyboardCallback>();
let currentKeymap: KeyboardKeymapEntry[] = [];
let listenRefCount = 0;
let lastKey = '';

export function setKeyboardKeymap(keymap: KeyboardKeymapEntry[]): void {
	currentKeymap = keymap;
}

export function startKeyboardListening(): void {
	listenRefCount++;
	if (listenRefCount === 1) {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
	}
}

export function stopKeyboardListening(): void {
	if (listenRefCount <= 0) return;
	listenRefCount--;
	if (listenRefCount === 0) {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		pressedKeys.clear();
	}
}

export function addKeyboardListener(cb: KeyboardCallback): void {
	listeners.add(cb);
}

export function removeKeyboardListener(cb: KeyboardCallback): void {
	listeners.delete(cb);
}

export function isKeyboardActive(): boolean {
	return listenRefCount > 0;
}

/** 現在のキーボード状態を GamepadState として返す */
export function getKeyboardState(): GamepadState {
	const buttons = new Array(18).fill(false);
	for (const entry of currentKeymap) {
		if (pressedKeys.has(entry.key)) {
			buttons[entry.buttonIndex] = true;
		}
	}
	// キーボードにはアナログスティックがないので 0（ニュートラル）
	return { buttons, axes: [0, 0, 0, 0], index: KEYBOARD_GAMEPAD_INDEX };
}

function emitState(): void {
	const state = getKeyboardState();
	const key = state.buttons.join(',');
	if (key === lastKey) return;
	lastKey = key;
	for (const cb of listeners) {
		cb(state);
	}
}

function onKeyDown(e: KeyboardEvent): void {
	// テキスト入力中は無視
	const tag = (e.target as HTMLElement)?.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

	if (currentKeymap.some((m) => m.key === e.code)) {
		e.preventDefault();
		pressedKeys.add(e.code);
		emitState();
	}
}

function onKeyUp(e: KeyboardEvent): void {
	if (pressedKeys.has(e.code)) {
		pressedKeys.delete(e.code);
		emitState();
	}
}

export { KEYBOARD_GAMEPAD_INDEX };
