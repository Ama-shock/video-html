/**
 * サービスワーカー — WebPush 受信とシグナリングメッセージのリレー。
 *
 * push イベントで受け取ったペイロードを window クライアントに転送する。
 * 通知はシグナリング用途なので必要最小限。
 */

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (ev) => {
	ev.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (ev) => {
	ev.waitUntil(self.clients.claim());
});

self.addEventListener('push', (ev) => {
	ev.waitUntil(handlePush(ev));
});

async function handlePush(ev: PushEvent): Promise<void> {
	if (!ev.data) return;

	let payload: unknown;
	try {
		payload = ev.data.json();
	} catch {
		payload = ev.data.text();
	}

	// ウィンドウクライアントにメッセージを転送
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of clients) {
		client.postMessage({ type: 'push_received', payload });
	}

	// join_request のみ目に見える通知（Chrome の userVisibleOnly 要件）
	const msg = payload as { type?: string };
	if (msg?.type === 'join_request') {
		await self.registration.showNotification('接続要求', {
			body: 'ゲストからの入室要求があります',
			silent: true,
			tag: 'join-request',
		});
	}
}

self.addEventListener('notificationclick', (ev) => {
	ev.notification.close();
	ev.waitUntil(
		self.clients.matchAll({ type: 'window' }).then((clients) => {
			if (clients.length > 0) clients[0].focus();
			else self.clients.openWindow('/');
		}),
	);
});
