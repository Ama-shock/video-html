/**
 * SwitchBtWsClient のシングルトンキャッシュ。
 *
 * GamepadMenu（ローカルリレー）と HostMenu（ゲスト転送）で共有する。
 */

import { SwitchBtWsClient } from './client';

const cache = new Map<number, SwitchBtWsClient>();

export function getOrCreateClient(wsBaseUrl: string, controllerId: number): SwitchBtWsClient {
	const cached = cache.get(controllerId);
	if (cached) return cached;
	const client = new SwitchBtWsClient(wsBaseUrl, controllerId);
	client.connect();
	cache.set(controllerId, client);
	return client;
}
