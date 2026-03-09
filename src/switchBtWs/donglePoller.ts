/**
 * ドングル状態のバックグラウンドポーリング。
 *
 * ホストモード時に30秒おきにデバイス・コントローラー一覧を取得する。
 * 自動接続は行わない（ユーザーが明示的に「再接続」を押す必要がある）。
 */

import { store } from '../store';
import { setDongleInitialized } from '../store/dongleSlice';
import { fetchDongleData } from './dongleService';

const POLL_INTERVAL = 30_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let started = false;

export function startDonglePolling(apiBase: string): void {
	if (started) return;
	started = true;

	// 初回フェッチ
	(async () => {
		await fetchDongleData(apiBase);
		const { initialized } = store.getState().dongle;
		if (!initialized) {
			store.dispatch(setDongleInitialized());
		}
	})();

	// 30秒ポーリング（デバイス・コントローラー一覧の更新のみ）
	intervalId = setInterval(() => {
		fetchDongleData(apiBase);
	}, POLL_INTERVAL);
}

export function stopDonglePolling(): void {
	if (intervalId !== null) {
		clearInterval(intervalId);
		intervalId = null;
	}
	started = false;
}
