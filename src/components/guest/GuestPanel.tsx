import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { GamepadState } from '../../gamepad';
import { addGamepadListener, removeGamepadListener, startGamepadPolling } from '../../gamepad';
import { getOrCreateIdentity } from '../../identity';
import type { AppDispatch, RootState } from '../../store';
import {
	reset,
	setControllerAssignment,
	setError,
	setHostStream,
	setRoomKey,
	setStatus,
} from '../../store/guestSlice';
import { createRoomKey, fetchGatewayInfo, validateRoomKeyFormat } from '../../webpush/gateway';
import { subscribeToPush } from '../../webpush/subscription';
import { GuestWebRTC } from '../../webrtc/guest';
import type { JoinAccepted } from '../../webrtc/types';

export default function GuestPanel() {
	const dispatch = useDispatch<AppDispatch>();
	const mode = useSelector((s: RootState) => s.app.mode);
	const status = useSelector((s: RootState) => s.guest.status);
	const _roomKey = useSelector((s: RootState) => s.guest.roomKey);
	const hostStream = useSelector((s: RootState) => s.guest.hostStream);
	const controllerId = useSelector((s: RootState) => s.guest.controllerId);
	const error = useSelector((s: RootState) => s.guest.error);
	const username = useSelector((s: RootState) => s.identity.username);

	const videoRef = useRef<HTMLVideoElement>(null);
	const guestRtcRef = useRef<GuestWebRTC | null>(null);
	const [inputKey, setInputKey] = useState('');

	// URL hash から部屋鍵を取得
	useEffect(() => {
		const hash = new URLSearchParams(window.location.hash.slice(1));
		const key = hash.get('room');
		if (key) {
			setInputKey(decodeURIComponent(key));
			dispatch(setRoomKey(decodeURIComponent(key)));
		}
	}, [dispatch]);

	const handleJoin = async () => {
		const key = inputKey.trim();
		if (!validateRoomKeyFormat(key)) {
			dispatch(setError('無効な部屋鍵です'));
			return;
		}

		dispatch(setRoomKey(key));
		dispatch(setStatus('joining'));

		try {
			const swReg = await navigator.serviceWorker.getRegistration();
			if (!swReg) throw new Error('Service worker が登録されていません');

			const gateway = await fetchGatewayInfo();
			const sub = await subscribeToPush(swReg);
			const guestBundle = await createRoomKey(sub, gateway, 3600); // 1時間有効

			const identity = await getOrCreateIdentity();

			const rtc = new GuestWebRTC({
				onRemoteStream: (stream) => {
					dispatch(setHostStream(true));
					if (videoRef.current) {
						videoRef.current.srcObject = stream;
						videoRef.current.play();
					}
				},
				onConnectionState: (state) => {
					if (state === 'connected') dispatch(setStatus('connected'));
					else if (state === 'failed' || state === 'closed') {
						dispatch(setStatus('idle'));
						dispatch(setHostStream(false));
					}
				},
				onControllerAssignment: (cid) => {
					dispatch(setControllerAssignment(cid));
				},
			});
			guestRtcRef.current = rtc;

			await rtc.join(key, guestBundle, identity, username);
			dispatch(setStatus('waiting'));
		} catch (err) {
			dispatch(setError(err instanceof Error ? err.message : String(err)));
		}
	};

	const handleLeave = () => {
		guestRtcRef.current?.close();
		guestRtcRef.current = null;
		dispatch(reset());
		if (videoRef.current) videoRef.current.srcObject = null;
	};

	// ゲームパッドリレー (WebRTC データチャネル経由)
	useEffect(() => {
		if (status !== 'connected' || !guestRtcRef.current) return;
		startGamepadPolling();

		const handler = (state: GamepadState) => {
			guestRtcRef.current?.sendControllerInput({
				type: 'controller_input',
				buttons: state.buttons,
				axes: state.axes,
			});
		};
		addGamepadListener(handler);
		return () => removeGamepadListener(handler);
	}, [status]);

	// WebPush から Answer SDP を受信
	useEffect(() => {
		const handleMessage = async (ev: MessageEvent) => {
			const data = ev.data as { type?: string; payload?: unknown };
			if (data.type !== 'push_received') return;
			const msg = data.payload as { type: string };
			if (msg.type === 'join_accepted' && guestRtcRef.current) {
				await guestRtcRef.current.handleAnswer(msg as unknown as JoinAccepted);
			} else if (msg.type === 'join_rejected') {
				dispatch(setStatus('rejected'));
			}
		};
		navigator.serviceWorker.addEventListener('message', handleMessage);
		return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
	}, [dispatch]);

	if (mode !== 'guest') {
		return (
			<div className="panel">
				<h2>ゲストパネル</h2>
				<p>上部のモード切替で「ゲスト」を選択してください。</p>
			</div>
		);
	}

	return (
		<div className="panel guest-panel">
			<h2>ゲストパネル</h2>

			{error && <div className="error-msg">{error}</div>}

			{status === 'idle' || status === 'error' ? (
				<div className="join-form">
					<h3>部屋に入室</h3>
					<div className="form-group">
						<label>
							部屋鍵
							<textarea
								value={inputKey}
								onChange={(e) => setInputKey(e.target.value)}
								placeholder="ホストから受け取った部屋鍵を貼り付けてください"
								rows={4}
							/>
						</label>
					</div>
					<button
						type="button"
						className="btn btn-primary"
						onClick={handleJoin}
						disabled={!inputKey.trim()}
					>
						入室する
					</button>
				</div>
			) : (
				<div className="guest-active">
					<div className={`status-badge ${status}`}>
						{status === 'joining' && '⏳ 接続中…'}
						{status === 'waiting' && '⌛ ホストの承認を待っています…'}
						{status === 'connected' && '🟢 接続中'}
						{status === 'rejected' && '🔴 拒否されました'}
					</div>

					{hostStream && (
						<div className="guest-video-container">
							{/* biome-ignore lint/a11y/useMediaCaption: live stream */}
							<video ref={videoRef} autoPlay playsInline controls={false} className="guest-video" />
						</div>
					)}

					{controllerId !== null && (
						<div className="controller-info">コントローラー #{controllerId} として接続中</div>
					)}

					<button type="button" className="btn btn-danger" onClick={handleLeave}>
						退出する
					</button>
				</div>
			)}
		</div>
	);
}
