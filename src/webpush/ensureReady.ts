/**
 * Push 通知が利用可能であることを事前に確認し、
 * 不足があればユーザーに明示的な操作を促す。
 *
 * 部屋開放やゲスト入室の前に呼び出す。
 */

export type PushReadiness =
	| { ready: true; swRegistration: ServiceWorkerRegistration }
	| { ready: false; reason: string };

/**
 * Push 通知の準備状態をチェックする（権限要求は行わない）。
 */
export async function checkPushReadiness(): Promise<PushReadiness> {
	// 1. ブラウザサポート
	if (!('serviceWorker' in navigator)) {
		return { ready: false, reason: 'このブラウザは Service Worker に対応していません' };
	}
	if (!('PushManager' in window)) {
		return { ready: false, reason: 'このブラウザは Push 通知に対応していません' };
	}
	if (!('Notification' in window)) {
		return { ready: false, reason: 'このブラウザは通知に対応していません' };
	}

	// 2. 通知権限
	if (Notification.permission === 'denied') {
		return {
			ready: false,
			reason: 'notification_denied',
		};
	}

	// 3. Service Worker 登録
	const swReg = await navigator.serviceWorker.getRegistration();
	if (!swReg) {
		return { ready: false, reason: 'Service Worker が登録されていません。ページをリロードしてください。' };
	}

	// 4. 通知権限が未要求 → まだ ready ではない (requestPermission が必要)
	if (Notification.permission === 'default') {
		return { ready: false, reason: 'notification_default' };
	}

	return { ready: true, swRegistration: swReg };
}

/** requestPermission にタイムアウトを設ける（Edge 等でハングする対策） */
function requestPermissionWithTimeout(timeoutMs = 5000): Promise<NotificationPermission | 'timeout'> {
	return Promise.race([
		Notification.requestPermission(),
		new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
	]);
}

/** ブラウザの通知設定ページを開くためのガイドメッセージ */
function permissionGuideMessage(): string {
	const ua = navigator.userAgent;
	if (ua.includes('Edg/')) {
		return [
			'通知の許可ダイアログが表示されませんでした。',
			'Edge の設定から手動で許可してください:',
			'',
			'1. アドレスバー左の鍵アイコンをクリック',
			'2.「このサイトのアクセス許可」→ 通知 →「許可」',
			'',
			'または edge://settings/content/notifications を開き、',
			'このサイトを許可リストに追加してください。',
			'',
			'設定後、もう一度お試しください。',
		].join('\n');
	}
	if (ua.includes('Safari/') && !ua.includes('Chrome')) {
		return [
			'通知の許可ダイアログが表示されませんでした。',
			'Safari の設定から手動で許可してください:',
			'',
			'「Safari」→「設定」→「Webサイト」→「通知」から',
			'このサイトを許可してください。',
		].join('\n');
	}
	return [
		'通知の許可ダイアログが表示されませんでした。',
		'ブラウザの設定からこのサイトの通知を許可してください。',
		'設定後、もう一度お試しください。',
	].join('\n');
}

/**
 * Push 通知の権限を要求し、準備完了を確認する。
 * ユーザー操作コンテキストから呼び出す必要がある。
 *
 * @returns ServiceWorkerRegistration (成功時)
 * @throws Error (失敗時、reason を含む)
 */
export async function ensurePushReady(): Promise<ServiceWorkerRegistration> {
	const check = await checkPushReadiness();

	if (check.ready) {
		return check.swRegistration;
	}

	if (check.reason === 'notification_denied') {
		throw new Error(permissionGuideMessage());
	}

	// 権限未要求の場合は要求する
	if (check.reason === 'notification_default') {
		const perm = await requestPermissionWithTimeout(5000);

		if (perm === 'timeout') {
			// requestPermission がハングした（Edge 等）
			throw new Error(permissionGuideMessage());
		}

		if (perm !== 'granted') {
			throw new Error('通知の許可が必要です。通知を許可してからやり直してください。');
		}

		// 再チェック
		const recheck = await checkPushReadiness();
		if (recheck.ready) {
			return recheck.swRegistration;
		}
		throw new Error(recheck.reason);
	}

	throw new Error(check.reason);
}
