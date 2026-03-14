import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { GamepadState } from '../../gamepad';
import { addGamepadListener, removeGamepadListener, startGamepadPolling } from '../../gamepad';
import {
	addKeyboardListener,
	KEYBOARD_GAMEPAD_INDEX,
	removeKeyboardListener,
	startKeyboardListening,
	stopKeyboardListening,
} from '../../keyboard/index';
import { store, type AppDispatch, type RootState } from '../../store';
import { setMenuOpen, setMenuSection } from '../../store/appSlice';
import {
	setHostStream,
	setStatus,
} from '../../store/guestSlice';
import { getGuestRtc } from '../../webrtc/guestConnection';
import type { JoinAccepted } from '../../webrtc/types';

/**
 * Guest main view — video display + WebPush handler + gamepad relay.
 * The join form is in GuestMenu (overlay menu).
 */
export default function GuestMainView() {
	const dispatch = useDispatch<AppDispatch>();
	const status = useSelector((s: RootState) => s.guest.status);
	const hostStream = useSelector((s: RootState) => s.guest.hostStream);
	const controllerId = useSelector((s: RootState) => s.guest.controllerId);
	const playerNumber = useSelector((s: RootState) => s.guest.playerNumber);

	const videoRef = useRef<HTMLVideoElement>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const [muted, setMuted] = useState(false);

	// ストリーム受信時は ref に保存し、video 要素への反映は effect に任せる
	useEffect(() => {
		const rtc = getGuestRtc();
		if (!rtc) return;
		rtc.callbacks.onRemoteStream = (stream: MediaStream) => {
			streamRef.current = stream;
			dispatch(setHostStream(true));
		};
	}, [status, dispatch]);

	// streamRef / hostStream が変わったら video 要素にストリームを設定
	useEffect(() => {
		const video = videoRef.current;
		const stream = streamRef.current;
		if (!video || !stream) return;
		if (video.srcObject === stream) return;
		video.pause();
		video.srcObject = stream;
		video.muted = false;
		setMuted(false);
		video.play().catch(() => {
			if (videoRef.current) {
				videoRef.current.muted = true;
				setMuted(true);
				videoRef.current.play().catch((err2) => {
					console.error('[GuestMainView] muted play() also failed:', err2);
				});
			}
		});
	}, [hostStream]);

	// WebPush から Answer SDP / Reject を受信
	useEffect(() => {
		const handleMessage = async (ev: MessageEvent) => {
			const data = ev.data as { type?: string; payload?: unknown };
			if (data.type !== 'push_received') return;
			const msg = data.payload as { type: string };
			const rtc = getGuestRtc();
			if (msg.type === 'join_accepted' && rtc) {
				const accepted = msg as unknown as JoinAccepted;
				await rtc.handleAnswer(accepted);
			} else if (msg.type === 'join_rejected') {
				dispatch(setStatus('rejected'));
			}
		};
		navigator.serviceWorker.addEventListener('message', handleMessage);
		return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
	}, [dispatch]);

	// ゲームパッド/キーボードリレー (WebRTC データチャネル経由)
	// selectedDevice の変更で再構築（stale closure 回避のため store.getState() も併用）
	const selectedDevice = useSelector((s: RootState) => s.guest.selectedDevice);
	useEffect(() => {
		const rtc = getGuestRtc();
		if (status !== 'connected' || !rtc) return;

		const send = (state: GamepadState) => {
			const sel = store.getState().guest.selectedDevice;
			if (!sel) return;
			if (sel.type === 'gamepad' && state.index !== sel.index) return;
			if (sel.type === 'keyboard' && state.index !== KEYBOARD_GAMEPAD_INDEX) return;
			rtc.sendControllerInput({
				type: 'controller_input',
				buttons: state.buttons,
				axes: state.axes,
			});
		};

		const cleanups: (() => void)[] = [];

		// ゲームパッドリスナー
		startGamepadPolling();
		addGamepadListener(send);
		cleanups.push(() => removeGamepadListener(send));

		// キーボードリスナー
		startKeyboardListening();
		addKeyboardListener(send);
		cleanups.push(() => {
			removeKeyboardListener(send);
			stopKeyboardListening();
		});

		return () => { for (const fn of cleanups) fn(); };
	}, [status, selectedDevice]);

	const handleUnmute = () => {
		if (videoRef.current) {
			videoRef.current.muted = false;
			setMuted(false);
		}
	};

	const openGuestMenu = () => {
		dispatch(setMenuSection('guest'));
		dispatch(setMenuOpen(true));
	};

	// 全状態で同一の video 要素を使い回す（再マウントによるストリーム消失を防ぐ）
	const showVideo = hostStream;
	const showWaiting = !hostStream && status === 'connected';
	const showIdle = !hostStream && status !== 'connected';

	return (
		<div className={`video-bg ${showVideo ? '' : 'guest-idle'}`}>
			{/* biome-ignore lint/a11y/useMediaCaption: live stream */}
			<video
				ref={videoRef}
				autoPlay
				playsInline
				controls={false}
				style={{ display: showVideo ? undefined : 'none' }}
			/>
			{muted && showVideo && (
				<button
					type="button"
					className="unmute-btn"
					onClick={(e) => { e.stopPropagation(); handleUnmute(); }}
				>
					ミュート解除
				</button>
			)}
			{showVideo && controllerId !== null && (
				<div className="guest-controller-badge">
					{playerNumber ? `P${playerNumber}` : `コントローラー #${controllerId}`}
				</div>
			)}
			{showWaiting && (
				<div className="guest-prompt">
					<div className="spinner" />
					<p>接続済み — 映像待機中</p>
					{controllerId !== null && (
						<p className="guest-controller-badge inline">
							{playerNumber ? `P${playerNumber}` : `コントローラー #${controllerId}`}
						</p>
					)}
				</div>
			)}
			{showIdle && (
				<div className="guest-prompt">
					<p>ホストの部屋鍵を入力して接続してください</p>
					<button type="button" className="btn btn-primary" onClick={openGuestMenu}>
						ホストに接続
					</button>
				</div>
			)}
		</div>
	);
}
