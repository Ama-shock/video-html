import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadGuest, saveGuest } from '../../db/guestRegistry';
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
} from '../../store/hostSlice';
import { createRoomKey, fetchGatewayInfo, pushToBundle } from '../../webpush/gateway';
import { subscribeToPush } from '../../webpush/subscription';
import { HostWebRTC } from '../../webrtc/host';
import type { JoinRequest } from '../../webrtc/types';
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

	const [error, setError] = useState<string | null>(null);
	const [renewing, setRenewing] = useState(false);
	const [remaining, setRemaining] = useState('');
	const [expiryLevel, setExpiryLevel] = useState<ExpiryLevel>('ok');
	const hostRtcRef = useRef<HostWebRTC | null>(null);
	const roomStatusRef = useRef(roomStatus);
	roomStatusRef.current = roomStatus;

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
				dispatch(
					addPendingGuest({
						userId: req.profile.userId,
						username: req.profile.username,
						connectionState: 'new',
						allowed: false,
						controllerId: null,
						videoQuality: 'high',
					}),
				);
				const existing = await loadGuest(req.profile.userId);
				if (existing?.allowed) {
					await hostRtcRef.current?.handleJoinRequest(req, 'high');
					dispatch(allowGuest({ userId: req.profile.userId, controllerId: existing.controllerId }));
				}
			}
		};
		navigator.serviceWorker.addEventListener('message', handleMessage);
		return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
	}, [dispatch]);

	/** 部屋鍵を発行（新規 or 更新共通） */
	const issueRoomKey = async () => {
		const swReg = await navigator.serviceWorker.getRegistration();
		if (!swReg) throw new Error('Service worker が登録されていません');
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
					if (state === 'failed' || state === 'closed') {
						dispatch(removeGuest(userId));
					}
					// ゲスト一覧の変更を全ゲストにブロードキャスト
					if (state === 'connected' || state === 'failed' || state === 'closed') {
						// connected 時はデータチャネルがまだ開いていない場合があるため少し待つ
						setTimeout(() => hostRtcRef.current?.broadcastGuestList(), state === 'connected' ? 500 : 0);
					}
				},
				onControllerInput: (userId, _input) => {
					const guest = guests.find((g) => g.userId === userId);
					if (guest?.controllerId != null) {
						// TODO: switch-bt-ws へ転送
					}
				},
			});
			if (myPublicKey) rtc.setHostProfile(myPublicKey, myUsername);
			hostRtcRef.current = rtc;
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
		dispatch(closeRoom());
	};

	const handleAllowGuest = async (userId: string) => {
		dispatch(allowGuest({ userId, controllerId: null }));
		const pending = pendingRequests.find((g) => g.userId === userId);
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
