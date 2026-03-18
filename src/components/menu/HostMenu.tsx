import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadGuest, saveGuest } from '../../db/guestRegistry';
import { verifySignature } from '../../identity/index';
import type { AppDispatch, RootState } from '../../store';
import {
	addPendingGuest,
	allowGuest,
	closeRoom,
	openRoom,
	rejectGuest,
	removeGuest,
	setGuestVideoQuality,
	updateGuestConnection,
	updateGuestConnectionDetail,
	updateGuestUsername,
} from '../../store/hostSlice';
import { applyKeymap, mapAxes } from '../../gamepad/relay';
import { store } from '../../store';
import { getOrCreateClient } from '../../switchBtWs/clientCache';
import { onRumble, offRumble } from '../../switchBtWs/dongleService';
import { controllerPlayerMap } from '../../switchBtWs/types';
import { ensurePushReady } from '../../webpush/ensureReady';
import { createRoomKey, fetchGatewayInfo, pushToBundle } from '../../webpush/gateway';
import { subscribeToPush } from '../../webpush/subscription';
import { setGuestInput } from '../../webrtc/guestInputStore';
import { HostWebRTC } from '../../webrtc/host';
import { setHostRtc } from '../../webrtc/hostConnection';
import type { ControllerInput, JoinRequest } from '../../webrtc/types';
import GuestList from '../host/GuestList';
import KnownGuestList from '../host/KnownGuestList';
import RoomKeyDisplay from '../host/RoomKeyDisplay';

/** 部屋鍵の有効期間（秒） */
const ROOM_KEY_TTL_SEC = 12 * 3600;

/** 残り時間を「Xh Ym」形式で返す */
function formatRemaining(expiresAt: number): string {
	const remaining = expiresAt - Math.floor(Date.now() / 1000);
	if (remaining <= 0) return '期限切れ';
	const h = Math.floor(remaining / 3600);
	const m = Math.floor((remaining % 3600) / 60);
	if (h > 0) return `${h}時間${m}分`;
	return `${m}分`;
}

type ExpiryLevel = 'ok' | 'warn' | 'critical' | 'expired';

function getExpiryLevel(expiresAt: number): ExpiryLevel {
	const remaining = expiresAt - Math.floor(Date.now() / 1000);
	if (remaining <= 0) return 'expired';
	if (remaining <= 10 * 60) return 'critical';   // 10分以内
	if (remaining <= 60 * 60) return 'warn';        // 1時間以内
	return 'ok';
}

export default function HostMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const roomStatus = useSelector((s: RootState) => s.host.roomStatus);
	const roomKey = useSelector((s: RootState) => s.host.roomKey);
	const roomKeyExpiresAt = useSelector((s: RootState) => s.host.roomKeyExpiresAt);
	const guests = useSelector((s: RootState) => s.host.guests);
	const pendingRequests = useSelector((s: RootState) => s.host.pendingRequests);
	const myPublicKey = useSelector((s: RootState) => s.identity.publicKeyB64);
	const myUsername = useSelector((s: RootState) => s.identity.username);
	const streaming = useSelector((s: RootState) => s.app.streaming);

	const [error, setError] = useState<string | null>(null);
	const [renewing, setRenewing] = useState(false);
	const [remaining, setRemaining] = useState('');
	const [expiryLevel, setExpiryLevel] = useState<ExpiryLevel>('ok');
	const hostRtcRef = useRef<HostWebRTC | null>(null);
	const roomStatusRef = useRef(roomStatus);
	roomStatusRef.current = roomStatus;

	// 手動許可用: userId → JoinRequest を保持
	const pendingJoinRequests = useRef(new Map<string, JoinRequest>());

	// ゲストに割り当てられたコントローラーの振動を DataChannel で転送
	useEffect(() => {
		if (roomStatus !== 'open') return;
		const registeredIds = new Set<number>();
		for (const guest of guests) {
			if (guest.controllerId != null) {
				const cid = guest.controllerId;
				const uid = guest.userId;
				registeredIds.add(cid);
				onRumble(cid, (left, right) => {
					hostRtcRef.current?.sendCommand(uid, { type: 'rumble', left, right });
				});
			}
		}
		return () => {
			for (const cid of registeredIds) offRumble(cid);
		};
	}, [roomStatus, guests]);

	// キャプチャ開始/変更時にストリームを HostWebRTC に渡す
	useEffect(() => {
		if (!streaming || !hostRtcRef.current) return;
		const vc = (window as any).__vidcapt;
		const stream = vc?.streamRef?.current as MediaStream | undefined;
		if (stream) {
			hostRtcRef.current.setLocalStream(stream);
		}
	}, [streaming]);

	// 有効期限カウントダウン（30秒ごと更新）
	useEffect(() => {
		if (roomStatus !== 'open' || !roomKeyExpiresAt) return;
		const update = () => {
			setRemaining(formatRemaining(roomKeyExpiresAt));
			setExpiryLevel(getExpiryLevel(roomKeyExpiresAt));
		};
		update();
		const id = setInterval(update, 30_000);
		return () => clearInterval(id);
	}, [roomStatus, roomKeyExpiresAt]);

	useEffect(() => {
		const handleMessage = async (ev: MessageEvent) => {
			const data = ev.data as { type?: string; payload?: unknown };
			if (data.type !== 'push_received') return;
			const msg = data.payload as { type: string };
			if (msg.type === 'join_request') {
				const req = msg as unknown as JoinRequest;
				// 部屋が閉じている場合は拒否
				if (roomStatusRef.current !== 'open') {
					await pushToBundle(req.guestBundle, { type: 'join_rejected', reason: '部屋は開放されていません' }, 60);
					return;
				}
				pendingJoinRequests.current.set(req.userId, req);
				dispatch(
					addPendingGuest({
						userId: req.userId,
						username: '', // プロフィールは DataChannel 経由で後から届く
						connectionState: 'new',
						connectionDetail: 'Push 受信',
						allowed: false,
						controllerId: null,
						videoQuality: 'high',
					}),
				);
				const existing = await loadGuest(req.userId);
				if (existing?.allowed) {
					// 復元した controllerId に対応する playerNumber を取得
					const cid = existing.controllerId;
					let assignment: { controllerId: number; playerNumber: number | null } | undefined;
					if (cid != null) {
						const pMap = controllerPlayerMap(store.getState().dongle.controllers);
						assignment = { controllerId: cid, playerNumber: pMap.get(cid) ?? null };
					}
					dispatch(updateGuestConnectionDetail({ userId: req.userId, detail: '自動許可 — Answer 作成中' }));
					await hostRtcRef.current?.handleJoinRequest(req, 'high', assignment);
					dispatch(updateGuestConnectionDetail({ userId: req.userId, detail: 'Answer を Push 送信済み' }));
					dispatch(allowGuest({ userId: req.userId, controllerId: cid }));
					// 自動承認時に lastSeen を更新
					await saveGuest({ ...existing, lastSeen: new Date().toISOString() });
				}
			}
		};
		navigator.serviceWorker.addEventListener('message', handleMessage);
		return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
	}, [dispatch]);

	/** 部屋鍵を発行（新規 or 更新共通） */
	const issueRoomKey = async () => {
		const swReg = await ensurePushReady();
		const gateway = await fetchGatewayInfo();
		const sub = await subscribeToPush(swReg);
		const expirationSec = Math.floor(Date.now() / 1000) + ROOM_KEY_TTL_SEC;
		const key = await createRoomKey(sub, gateway, ROOM_KEY_TTL_SEC);
		return { key, expirationSec };
	};

	const handleOpenRoom = async () => {
		setError(null);
		try {
			const { key, expirationSec } = await issueRoomKey();
			dispatch(openRoom({ roomKey: key, expiresAt: expirationSec }));
			const rtc = new HostWebRTC({
				onGuestStateChange: (userId, state) => {
					dispatch(updateGuestConnection({ userId, connectionState: state }));
					const labels: Record<string, string> = {
						connecting: 'WebRTC 接続試行中',
						connected: '接続完了',
						disconnected: '切断検出',
						failed: '接続失敗',
					};
					if (labels[state]) dispatch(updateGuestConnectionDetail({ userId, detail: labels[state] }));
					if (state === 'failed' || state === 'closed') {
						// ゲスト切断時に lastSeen を更新
						const guest = store.getState().host.guests.find(g => g.userId === userId);
						if (guest) {
							loadGuest(userId).then(existing => {
								if (existing) saveGuest({ ...existing, username: guest.username, lastSeen: new Date().toISOString() });
							});
						}
						dispatch(removeGuest(userId));
					}
					// ゲスト一覧の変更を全ゲストにブロードキャスト
					if (state === 'connected' || state === 'failed' || state === 'closed') {
						// connected 時はデータチャネルがまだ開いていない場合があるため少し待つ
						setTimeout(() => {
							const s = store.getState();
							const guests = s.host.guests;
							const pMap = controllerPlayerMap(s.dongle.controllers);
							const assigns = new Map<string, { controllerId: number; playerNumber: number | null }[]>();
							// ゲストの割り当て
							for (const g of guests) {
								if (g.controllerId != null) {
									assigns.set(g.userId, [{ controllerId: g.controllerId, playerNumber: pMap.get(g.controllerId) ?? null }]);
								}
							}
							// ホストの割り当て（複数コントローラー対応）
							const myKey = s.identity.publicKeyB64;
							if (myKey) {
								const hostAssigns: { controllerId: number; playerNumber: number | null }[] = [];
								for (const gp of s.gamepad.gamepads) {
									if (gp.relayActive && gp.relayControllerId != null) {
										hostAssigns.push({ controllerId: gp.relayControllerId, playerNumber: pMap.get(gp.relayControllerId) ?? null });
									}
								}
								if (s.gamepad.keyboardRelayActive && s.gamepad.keyboardRelayControllerId != null) {
									hostAssigns.push({ controllerId: s.gamepad.keyboardRelayControllerId, playerNumber: pMap.get(s.gamepad.keyboardRelayControllerId) ?? null });
								}
								if (hostAssigns.length > 0) assigns.set(myKey, hostAssigns);
							}
							hostRtcRef.current?.broadcastGuestList(assigns);
						}, state === 'connected' ? 500 : 0);
					}
				},
				onControllerInput: (userId, input) => {
					// ゲスト入力を可視化用ストアに保存
					setGuestInput(userId, { buttons: input.buttons, axes: input.axes });

					// 割り当てられたコントローラーに転送
					const state = store.getState();
					const guest = state.host.guests.find((g) => g.userId === userId);
					if (guest?.controllerId != null) {
						const wsPort = state.app.switchBtWsPort;
						const client = getOrCreateClient(`ws://localhost:${wsPort}`, guest.controllerId);
						const keymap = state.gamepad.keymap;
						const buttonStatus = applyKeymap(input.buttons, keymap);
						const axes = mapAxes(input.axes);
						client.sendGamepadInput(buttonStatus, axes);
					}
				},
				onGuestProfile: async (userId, profile) => {
					// 署名検証: 公開鍵の所有者確認 + リプレイ攻撃防止
					try {
						const b64decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
						const pubKeyRaw = b64decode(profile.userId);
						const timestamp = profile.timestamp ?? 0;
						const message = new TextEncoder().encode(profile.userId + profile.username + timestamp);
						const sig = b64decode(profile.signature);
						const valid = await verifySignature(pubKeyRaw, message, sig);
						if (!valid) {
							console.warn('[host] guest signature INVALID — disconnecting', userId);
							hostRtcRef.current?.disconnectGuest(userId);
							dispatch(removeGuest(userId));
							return;
						}
						// リプレイ攻撃防止: タイムスタンプが 5 分以内か確認
						const MAX_SKEW_MS = 5 * 60 * 1000;
						if (Math.abs(Date.now() - timestamp) > MAX_SKEW_MS) {
							console.warn('[host] guest timestamp too old/future — disconnecting', userId, timestamp);
							hostRtcRef.current?.disconnectGuest(userId);
							dispatch(removeGuest(userId));
							return;
						}
					} catch (e) {
						console.warn('[host] signature verification error — disconnecting', userId, e);
						hostRtcRef.current?.disconnectGuest(userId);
						dispatch(removeGuest(userId));
						return;
					}
					dispatch(updateGuestUsername({ userId, username: profile.username }));
					// ゲスト情報を IndexedDB に保存
					const existing = await loadGuest(userId);
					await saveGuest({
						userId,
						username: profile.username,
						allowed: existing?.allowed ?? false,
						controllerId: existing?.controllerId ?? null,
						lastSeen: new Date().toISOString(),
					});
				},
			});
			if (myPublicKey) rtc.setHostProfile(myPublicKey, myUsername);
			// キャプチャ済みのストリームがあれば渡す
			const vc = (window as any).__vidcapt;
			if (vc?.streamRef?.current) {
				rtc.setLocalStream(vc.streamRef.current);
			}
			hostRtcRef.current = rtc;
			setHostRtc(rtc);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleRenewKey = async () => {
		setRenewing(true);
		setError(null);
		try {
			const { key, expirationSec } = await issueRoomKey();
			dispatch(openRoom({ roomKey: key, expiresAt: expirationSec }));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRenewing(false);
		}
	};

	const handleCloseRoom = () => {
		hostRtcRef.current?.disconnectAll();
		hostRtcRef.current = null;
		setHostRtc(null);
		dispatch(closeRoom());
	};

	const handleAllowGuest = async (userId: string) => {
		const req = pendingJoinRequests.current.get(userId);
		dispatch(allowGuest({ userId, controllerId: null }));
		const pending = pendingRequests.find((g) => g.userId === userId);

		if (req && hostRtcRef.current) {
			dispatch(updateGuestConnectionDetail({ userId, detail: 'Answer 作成中...' }));
			try {
				await hostRtcRef.current.handleJoinRequest(req, 'high');
				dispatch(updateGuestConnectionDetail({ userId, detail: 'Answer を Push 送信済み' }));
			} catch (err) {
				dispatch(updateGuestConnectionDetail({ userId, detail: `Answer 送信失敗: ${err instanceof Error ? err.message : String(err)}` }));
			}
			pendingJoinRequests.current.delete(userId);
		}

		if (!pending) return;
		await saveGuest({
			userId,
			username: pending.username,
			allowed: true,
			controllerId: null,
			lastSeen: new Date().toISOString(),
		});
	};

	return (
		<div className="menu-section">
			{error && <div className="error-msg">{error}</div>}

			{roomStatus === 'closed' ? (
				<div className="menu-card">
					<h3>部屋を開始</h3>
					<button type="button" className="btn btn-primary" onClick={handleOpenRoom}>
						部屋を開く
					</button>
				</div>
			) : (
				<>
					<div className="menu-card">
						<div className="room-status-badge">部屋開放中</div>
						<RoomKeyDisplay
							roomKey={roomKey!}
							remaining={remaining}
							expiryLevel={expiryLevel}
							onRenew={handleRenewKey}
							renewing={renewing}
						/>

						<button type="button" className="btn btn-danger" onClick={handleCloseRoom}>
							部屋を閉じる
						</button>
					</div>

					<GuestList
						pending={pendingRequests}
						guests={guests}
						onAllow={handleAllowGuest}
						onReject={(userId) => dispatch(rejectGuest(userId))}
						onRemove={(userId) => {
							hostRtcRef.current?.disconnectGuest(userId);
							dispatch(removeGuest(userId));
						}}
						onQualityChange={(userId, quality) => {
							dispatch(setGuestVideoQuality({ userId, videoQuality: quality }));
							hostRtcRef.current?.setVideoQuality(userId, quality);
						}}
						getGuestStats={(userId) =>
							hostRtcRef.current?.getGuestStats(userId) ?? Promise.resolve(null)
						}
					/>
				</>
			)}

			<KnownGuestList defaultOpen={roomStatus === 'closed'} />
		</div>
	);
}
