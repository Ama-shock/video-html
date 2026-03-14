/**
 * ゲストの最新入力状態を保持する軽量ストア。
 *
 * Redux を経由せず、useSyncExternalStore で必要なコンポーネントだけ再描画する。
 * ホスト側の接続マップでゲスト入力を可視化するために使う。
 */

import { useSyncExternalStore } from 'react';
import type { InputState } from '../components/gamepad/InputVisualizer';

const store = new Map<string, InputState>();
const subs = new Set<() => void>();

function notify() {
	for (const cb of subs) cb();
}

export function setGuestInput(userId: string, input: InputState): void {
	store.set(userId, input);
	notify();
}

export function clearGuestInput(userId: string): void {
	store.delete(userId);
	notify();
}

export function useGuestInput(userId: string | null): InputState | null {
	return useSyncExternalStore(
		(cb) => {
			subs.add(cb);
			return () => subs.delete(cb);
		},
		() => (userId ? store.get(userId) ?? null : null),
	);
}
