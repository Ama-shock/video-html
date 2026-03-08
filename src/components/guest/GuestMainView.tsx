import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { GamepadState } from '../../gamepad';
import { addGamepadListener, removeGamepadListener, startGamepadPolling } from '../../gamepad';
import type { AppDispatch, RootState } from '../../store';
import { setMenuOpen, setMenuSection } from '../../store/appSlice';
import {
	setHostProfile,
	setHostStream,
	setStatus,
	setVideoQuality,
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

	const videoRef = useRef<HTMLVideoElement>(null);

	// GuestMenu で join した後、ストリーム受信時に video 要素へ反映する
	useEffect(() => {
		const rtc = getGuestRtc();
		if (!rtc) return;
		rtc.callbacks.onRemoteStream = (stream: MediaStream) => {
			dispatch(setHostStream(true));
			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				videoRef.current.play();
			}
		};
	}, [status, dispatch]);

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
				if (accepted.hostProfile) {
					dispatch(setHostProfile(accepted.hostProfile));
				}
				if (accepted.videoQuality) {
					dispatch(setVideoQuality(accepted.videoQuality));
				}
			} else if (msg.type === 'join_rejected') {
				dispatch(setStatus('rejected'));
			}
		};
		navigator.serviceWorker.addEventListener('message', handleMessage);
		return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
	}, [dispatch]);

	// ゲームパッドリレー (WebRTC データチャネル経由)
	useEffect(() => {
		const rtc = getGuestRtc();
		if (status !== 'connected' || !rtc) return;
		startGamepadPolling();
		const handler = (state: GamepadState) => {
			rtc.sendControllerInput({
				type: 'controller_input',
				buttons: state.buttons,
				axes: state.axes,
			});
		};
		addGamepadListener(handler);
		return () => removeGamepadListener(handler);
	}, [status]);

	// 映像受信中: フルスクリーンビデオ
	if (hostStream) {
		return (
			<div className="video-bg">
				{/* biome-ignore lint/a11y/useMediaCaption: live stream */}
				<video ref={videoRef} autoPlay playsInline controls={false} />
				{controllerId !== null && (
					<div className="guest-controller-badge">
						コントローラー #{controllerId}
					</div>
				)}
			</div>
		);
	}

	const openGuestMenu = () => {
		dispatch(setMenuSection('guest'));
		dispatch(setMenuOpen(true));
	};

	// 接続済み・映像待ち
	if (status === 'connected') {
		return (
			<div className="video-bg guest-idle">
				{/* biome-ignore lint/a11y/useMediaCaption: live stream */}
				<video ref={videoRef} style={{ display: 'none' }} autoPlay playsInline />
				<div className="guest-prompt">
					<div className="spinner" />
					<p>接続済み — 映像待機中</p>
				</div>
			</div>
		);
	}

	// 未接続: 案内画面
	return (
		<div className="video-bg guest-idle">
			{/* biome-ignore lint/a11y/useMediaCaption: live stream */}
			<video ref={videoRef} style={{ display: 'none' }} autoPlay playsInline />
			<div className="guest-prompt">
				<p>ホストの部屋鍵を入力して接続してください</p>
				<button type="button" className="btn btn-primary" onClick={openGuestMenu}>
					ホストに接続
				</button>
			</div>
		</div>
	);
}
