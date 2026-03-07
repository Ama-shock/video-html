/**
 * アプリ設定の永続化。
 * switch-bt-ws の接続先、デバイス選択、キーマップなど。
 */

import { dbGet, dbSet } from './index';

export type AppSettings = {
	switchBtWsPort: number; // デフォルト: 8765
	videoDeviceId: string | null;
	audioDeviceId: string | null;
	videoWidth: number;
	videoHeight: number;
};

export type KeymapEntry = {
	gamepadButton: number; // Web Gamepad ボタンインデックス
	switchButton: number; // SwitchButton ビットマスク値
};

const DEFAULT_SETTINGS: AppSettings = {
	switchBtWsPort: 8765,
	videoDeviceId: null,
	audioDeviceId: null,
	videoWidth: 1920,
	videoHeight: 1080,
};

export async function loadSettings(): Promise<AppSettings> {
	const stored = await dbGet<Partial<AppSettings>>('settings', 'app');
	return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
	const current = await loadSettings();
	await dbSet('settings', 'app', { ...current, ...settings });
}

export async function loadKeymap(): Promise<KeymapEntry[]> {
	return (await dbGet<KeymapEntry[]>('keymap', 'default')) ?? defaultKeymap();
}

export async function saveKeymap(keymap: KeymapEntry[]): Promise<void> {
	await dbSet('keymap', 'default', keymap);
}

export function defaultKeymap(): KeymapEntry[] {
	// Web Gamepad Standard → Nintendo Switch Pro Controller
	// Switch button bits: Y=0,X=1,B=2,A=3,SR_R=4,SL_R=5,R=6,ZR=7
	//   Minus=8,Plus=9,RS=10,LS=11,Home=12,SS=13
	//   DDown=16,DUp=17,DRight=18,DLeft=19,SR_L=20,SL_L=21,L=22,ZL=23
	return [
		{ gamepadButton: 0, switchButton: 1 << 2 }, // A→B
		{ gamepadButton: 1, switchButton: 1 << 3 }, // B→A
		{ gamepadButton: 2, switchButton: 1 << 0 }, // X→Y
		{ gamepadButton: 3, switchButton: 1 << 1 }, // Y→X
		{ gamepadButton: 4, switchButton: 1 << 22 }, // LB→L
		{ gamepadButton: 5, switchButton: 1 << 6 }, // RB→R
		{ gamepadButton: 6, switchButton: 1 << 23 }, // LT→ZL
		{ gamepadButton: 7, switchButton: 1 << 7 }, // RT→ZR
		{ gamepadButton: 8, switchButton: 1 << 8 }, // Back→Minus
		{ gamepadButton: 9, switchButton: 1 << 9 }, // Start→Plus
		{ gamepadButton: 10, switchButton: 1 << 11 }, // L3→LS
		{ gamepadButton: 11, switchButton: 1 << 10 }, // R3→RS
		{ gamepadButton: 12, switchButton: 1 << 17 }, // DUp
		{ gamepadButton: 13, switchButton: 1 << 16 }, // DDown
		{ gamepadButton: 14, switchButton: 1 << 19 }, // DLeft
		{ gamepadButton: 15, switchButton: 1 << 18 }, // DRight
		{ gamepadButton: 16, switchButton: 1 << 12 }, // Home
		{ gamepadButton: 17, switchButton: 1 << 13 }, // Screenshot (SS)
	];
}
