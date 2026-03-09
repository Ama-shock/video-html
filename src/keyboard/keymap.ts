/**
 * キーボードのデフォルトキーマップ定義。
 *
 * キーボードのキー (KeyboardEvent.code) を Web Gamepad ボタンインデックスにマッピング。
 * ゲームパッドキーマップ (KeymapEntry) で Switch ボタンに変換される。
 */

import type { KeyboardKeymapEntry } from './index';

/** KeyboardEvent.code の表示名 */
export const KEY_CODE_LABELS: Record<string, string> = {
	KeyW: 'W',
	KeyA: 'A',
	KeyS: 'S',
	KeyD: 'D',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	KeyJ: 'J',
	KeyK: 'K',
	KeyI: 'I',
	KeyL: 'L',
	KeyU: 'U',
	KeyO: 'O',
	ShiftLeft: 'L-Shift',
	ShiftRight: 'R-Shift',
	Space: 'Space',
	Enter: 'Enter',
	KeyQ: 'Q',
	KeyE: 'E',
	KeyZ: 'Z',
	KeyX: 'X',
	KeyC: 'C',
	KeyV: 'V',
	KeyR: 'R',
	KeyF: 'F',
	KeyG: 'G',
	KeyH: 'H',
	Backspace: 'Backspace',
	Tab: 'Tab',
	Escape: 'Escape',
	Digit1: '1',
	Digit2: '2',
	Digit3: '3',
	Digit4: '4',
};

/** ゲームパッドボタン名 (Web Gamepad Standard) */
export const GAMEPAD_BUTTON_NAMES: Record<number, string> = {
	0: 'A (下)',
	1: 'B (右)',
	2: 'X (左)',
	3: 'Y (上)',
	4: 'LB',
	5: 'RB',
	6: 'LT',
	7: 'RT',
	8: 'Back/−',
	9: 'Start/+',
	10: 'L3',
	11: 'R3',
	12: '↑',
	13: '↓',
	14: '←',
	15: '→',
	16: 'Home',
	17: 'Screenshot',
};

/**
 * デフォルトのキーボードキーマップ。
 * WASD で左スティック的な方向入力、JKIL でフェイスボタン。
 */
export function defaultKeyboardKeymap(): KeyboardKeymapEntry[] {
	return [
		// Face buttons: J=A, K=B, I=X, L=Y
		{ key: 'KeyJ', buttonIndex: 0 },
		{ key: 'KeyK', buttonIndex: 1 },
		{ key: 'KeyI', buttonIndex: 2 },
		{ key: 'KeyL', buttonIndex: 3 },
		// Shoulder: U=LB, O=RB, ShiftLeft=LT, ShiftRight=RT
		{ key: 'KeyU', buttonIndex: 4 },
		{ key: 'KeyO', buttonIndex: 5 },
		{ key: 'ShiftLeft', buttonIndex: 6 },
		{ key: 'ShiftRight', buttonIndex: 7 },
		// System: Q=Back, E=Start
		{ key: 'KeyQ', buttonIndex: 8 },
		{ key: 'KeyE', buttonIndex: 9 },
		// DPad: WASD
		{ key: 'KeyW', buttonIndex: 12 },
		{ key: 'KeyS', buttonIndex: 13 },
		{ key: 'KeyA', buttonIndex: 14 },
		{ key: 'KeyD', buttonIndex: 15 },
		// Home / Screenshot
		{ key: 'Enter', buttonIndex: 16 },
		{ key: 'Backspace', buttonIndex: 17 },
	];
}
