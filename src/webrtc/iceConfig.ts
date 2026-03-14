/**
 * ICE サーバー設定の取得。
 *
 * Cloudflare Calls TURN クレデンシャルを Worker 経由で取得し、
 * STUN + TURN の ICE 設定を返す。
 * TURN が未設定・取得失敗の場合は STUN のみで動作する。
 */

const STUN_SERVERS: RTCIceServer[] = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' },
];

let cachedConfig: RTCConfiguration | null = null;
let cacheExpiry = 0;

/** TURN 込みの ICE 設定を取得する。キャッシュは 12 時間有効。 */
export async function getIceConfig(): Promise<RTCConfiguration> {
	if (cachedConfig && Date.now() < cacheExpiry) {
		return cachedConfig;
	}

	let turnServers: RTCIceServer[] = [];
	try {
		const resp = await fetch('/turn-credentials');
		if (resp.ok) {
			const data = (await resp.json()) as {
				iceServers?: { urls: string[]; username: string; credential: string }[];
			};
			if (data.iceServers && data.iceServers.length > 0) {
				turnServers = data.iceServers;
			}
		}
	} catch {
		/* TURN 取得失敗は無視して STUN のみで続行 */
	}

	cachedConfig = {
		iceServers: [...STUN_SERVERS, ...turnServers],
	};
	// 12 時間キャッシュ（TURN クレデンシャルの TTL は 24 時間）
	cacheExpiry = Date.now() + 12 * 60 * 60 * 1000;

	return cachedConfig;
}
