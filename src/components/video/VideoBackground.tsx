import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';

/**
 * Full-viewport video element that always fills the screen.
 * Capture starts automatically on mount. Controls live in the overlay menu.
 */
export default function VideoBackground() {
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
			setCaptureError(null);
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: { deviceId: vidId ?? undefined, width: videoWidth, height: videoHeight },
					audio: {
						deviceId: audId ?? undefined,
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
		};
	}, []);

	return (
		<div className="video-bg">
			{/* biome-ignore lint/a11y/useMediaCaption: live stream */}
			<video ref={videoRef} autoPlay={false} controls={false} playsInline muted />
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
