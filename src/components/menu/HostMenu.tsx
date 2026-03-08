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

export default function HostMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const roomStatus = useSelector((s: RootState) => s.host.roomStatus);
	const roomKey = useSelector((s: RootState) => s.host.roomKey);
	const guests = useSelector((s: RootState) => s.host.guests);
	const pendingRequests = useSelector((s: RootState) => s.host.pendingRequests);
	const myPublicKey = useSelector((s: RootState) => s.identity.publicKeyB64);
	const myUsername = useSelector((s: RootState) => s.identity.username);

	const [validHours, setValidHours] = useState(12);
	const [error, setError] = useState<string | null>(null);
	const hostRtcRef = useRef<HostWebRTC | null>(null);
	const roomStatusRef = useRef(roomStatus);
	roomStatusRef.current = roomStatus;

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

	const handleOpenRoom = async () => {
		setError(null);
		try {
			const swReg = await navigator.serviceWorker.getRegistration();
			if (!swReg) throw new Error('Service worker が登録されていません');
			const gateway = await fetchGatewayInfo();
			const sub = await subscribeToPush(swReg);
			const expirationSec = Math.floor(Date.now() / 1000) + validHours * 3600;
			const key = await createRoomKey(sub, gateway, validHours * 3600);
			dispatch(openRoom({ roomKey: key, expiresAt: expirationSec }));
			const rtc = new HostWebRTC({
				onGuestStateChange: (userId, state) => {
					dispatch(updateGuestConnection({ userId, connectionState: state }));
					if (state === 'failed' || state === 'closed') {
						dispatch(removeGuest(userId));
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
					<div className="form-group">
						<label>
							有効期間
							<select value={validHours} onChange={(e) => setValidHours(Number(e.target.value))}>
								{[1, 2, 4, 8, 12, 24].map((h) => (
									<option key={h} value={h}>{h}時間</option>
								))}
							</select>
						</label>
					</div>
					<button type="button" className="btn btn-primary" onClick={handleOpenRoom}>
						部屋を開く
					</button>
				</div>
			) : (
				<>
					<div className="menu-card">
						<div className="room-status-badge">部屋開放中</div>
						<RoomKeyDisplay roomKey={roomKey!} />
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
