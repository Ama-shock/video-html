/**
 * WebPush サブスクリプション管理。
 *
 * - VAPID 公開鍵を使ってブラウザに WebPush を登録する
 * - サービスワーカーを通じて通知を受け取る
 * - push イベントから受け取ったシグナリングメッセージをコールバックで処理する
 */

export type WebPushSubscriptionInfo = {
	endpoint: string;
	p256dh: string; // base64url
	auth: string; // base64url
};

/**
 * VAPID 公開鍵を取得し、WebPush サブスクリプションを作成して返す（同一オリジン前提）。
 */
export async function subscribeToPush(
	swRegistration: ServiceWorkerRegistration,
): Promise<WebPushSubscriptionInfo> {
	// まず既存のサブスクリプションを確認
	let sub = await swRegistration.pushManager.getSubscription();

	if (!sub) {
		// VAPID 公開鍵を取得
		const resp = await fetch('/vapid-public-key');
		if (!resp.ok) throw new Error(`Failed to fetch VAPID public key: ${resp.status}`);
		const { publicKey } = (await resp.json()) as { publicKey: string };

		// Notification 許可
		const perm = await Notification.requestPermission();
		if (perm !== 'granted') throw new Error('Notification permission denied');

		sub = await swRegistration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey) as Uint8Array<ArrayBuffer>,
		});
	}

	return extractSubscriptionInfo(sub);
}

export async function unsubscribeFromPush(
	swRegistration: ServiceWorkerRegistration,
): Promise<void> {
	const sub = await swRegistration.pushManager.getSubscription();
	if (sub) await sub.unsubscribe();
}

export function extractSubscriptionInfo(sub: PushSubscription): WebPushSubscriptionInfo {
	const p256dh = sub.getKey('p256dh');
	const auth = sub.getKey('auth');
	if (!p256dh || !auth) throw new Error('Missing push subscription keys');

	return {
		endpoint: sub.endpoint,
		p256dh: bufToBase64Url(p256dh),
		auth: bufToBase64Url(auth),
	};
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

function bufToBase64Url(buf: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(buf)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
