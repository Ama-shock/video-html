import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { unlockAudio } from '../../audio/unlock';
import type { AppDispatch, RootState } from '../../store';
import { setStreaming } from '../../store/appSlice';

/**
 * Full-viewport video element that always fills the screen.
 * Capture starts automatically on mount. Controls live in the overlay menu.
 */
export default function VideoBackground() {
	const dispatch = useDispatch<AppDispatch>();
	const videoDeviceId = useSelector((s: RootState) => s.app.videoDeviceId);
	const audioDeviceId = useSelector((s: RootState) => s.app.audioDeviceId);
	const videoWidth = useSelector((s: RootState) => s.app.videoWidth);
	const videoHeight = useSelector((s: RootState) => s.app.videoHeight);

	const videoRef = useRef<HTMLVideoElement>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const [started, setStarted] = useState(false);
	const [captureError, setCaptureError] = useState<string | null>(null);

	const startCapture = useCallback(
		async (vidId?: string | null, audId?: string | null) => {
			if (streamRef.current) {
				streamRef.current.getTracks().forEach((t) => t.stop());
			}
			// 既存の再生を止めてからソースを差し替える（AbortError 防止）
			if (videoRef.current) {
				videoRef.current.pause();
				videoRef.current.srcObject = null;
			}
			// ユーザー操作コンテキストで AudioContext を resume（音声許可取得）
			unlockAudio();
			setCaptureError(null);
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: {
						deviceId: vidId ? { ideal: vidId } : undefined,
						width: { ideal: videoWidth },
						height: { ideal: videoHeight },
					},
					audio: {
						deviceId: audId ? { ideal: audId } : undefined,
						echoCancellation: false,
						noiseSuppression: false,
					},
				});
				streamRef.current = stream;
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
					await videoRef.current.play();
				}
				setStarted(true);
				dispatch(setStreaming(true));
			} catch (err) {
				console.error('Capture failed:', err);
				const msg = err instanceof Error ? err.message : String(err);
				setCaptureError(`キャプチャに失敗しました: ${msg}`);
			}
		},
		[videoWidth, videoHeight],
	);

	// Expose startCapture and videoRef globally for menu controls
	useEffect(() => {
		(window as any).__vidcapt = {
			startCapture,
			videoRef,
			streamRef,
			get started() { return started; },
		};
		return () => { delete (window as any).__vidcapt; };
	}, [startCapture, started]);

	useEffect(() => {
		return () => {
			streamRef.current?.getTracks().forEach((t) => t.stop());
			dispatch(setStreaming(false));
		};
	}, [dispatch]);

	return (
		<div className="video-bg">
			{/* biome-ignore lint/a11y/useMediaCaption: live stream */}
			<video ref={videoRef} autoPlay={false} controls={false} playsInline />
			{!started && (
				<div className="video-bg-prompt">
					<button
						type="button"
						className="btn btn-primary btn-large"
						onClick={(e) => {
							e.stopPropagation();
							startCapture(videoDeviceId, audioDeviceId);
						}}
					>
						映像キャプチャ開始
					</button>
					{captureError && <div className="capture-error">{captureError}</div>}
				</div>
			)}
		</div>
	);
}
