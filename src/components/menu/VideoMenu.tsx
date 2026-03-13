import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { saveSettings } from '../../db/settings';
import type { AppDispatch, RootState } from '../../store';
import { setAudioDevice, setResolution, setVideoDevice } from '../../store/appSlice';

type DeviceList = { videos: MediaDeviceInfo[]; audios: MediaDeviceInfo[] };

const RESOLUTIONS = [
	{ label: '1920x1080 (FHD)', w: 1920, h: 1080 },
	{ label: '1280x720 (HD)', w: 1280, h: 720 },
	{ label: '854x480 (SD)', w: 854, h: 480 },
	{ label: '640x360', w: 640, h: 360 },
] as const;

export default function VideoMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const mode = useSelector((s: RootState) => s.app.mode);
	const videoDeviceId = useSelector((s: RootState) => s.app.videoDeviceId);
	const audioDeviceId = useSelector((s: RootState) => s.app.audioDeviceId);
	const videoWidth = useSelector((s: RootState) => s.app.videoWidth);
	const videoHeight = useSelector((s: RootState) => s.app.videoHeight);

	const isHost = mode === 'host';

	const [devices, setDevices] = useState<DeviceList>({ videos: [], audios: [] });
	const [volume, setVolume] = useState(100);
	const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

	// Enumerate devices
	useEffect(() => {
		navigator.mediaDevices.enumerateDevices().then((devs) => {
			const selectable = devs.filter(
				(d) => !['default', 'communications', ''].includes(d.deviceId),
			);
			setDevices({
				videos: selectable.filter((d) => d.kind === 'videoinput'),
				audios: selectable.filter((d) => d.kind === 'audioinput'),
			});
		});
	}, []);

	// Track fullscreen state
	useEffect(() => {
		const handler = () => setIsFullscreen(!!document.fullscreenElement);
		document.addEventListener('fullscreenchange', handler);
		return () => document.removeEventListener('fullscreenchange', handler);
	}, []);

	const handleVideoChange = async (id: string) => {
		dispatch(setVideoDevice(id));
		await saveSettings({ videoDeviceId: id });
		const vc = (window as any).__vidcapt;
		if (vc) await vc.startCapture(id, audioDeviceId);
	};

	const handleAudioChange = async (id: string) => {
		dispatch(setAudioDevice(id));
		await saveSettings({ audioDeviceId: id });
		const vc = (window as any).__vidcapt;
		if (vc) await vc.startCapture(videoDeviceId, id);
	};

	const handleVolumeChange = (v: number) => {
		setVolume(v);
		const vc = (window as any).__vidcapt;
		if (vc?.videoRef?.current) vc.videoRef.current.volume = v / 100;
	};

	const handleResolutionChange = async (value: string) => {
		const [w, h] = value.split('x').map(Number);
		dispatch(setResolution({ width: w, height: h }));
		await saveSettings({ videoWidth: w, videoHeight: h });
		const vc = (window as any).__vidcapt;
		if (vc?.started) await vc.startCapture(videoDeviceId, audioDeviceId);
	};

	const toggleFullscreen = async () => {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
		} else {
			await document.documentElement.requestFullscreen();
		}
	};

	const handleStart = async () => {
		const vc = (window as any).__vidcapt;
		if (vc) await vc.startCapture(videoDeviceId, audioDeviceId);
	};

	const isStarted = (window as any).__vidcapt?.started ?? false;

	return (
		<div className="menu-section">
			{/* Start capture — top of menu, hidden once started */}
			{isHost && !isStarted && (
				<button type="button" className="btn btn-primary" onClick={handleStart}>
					映像キャプチャ開始
				</button>
			)}

			{/* Fullscreen toggle — always visible */}
			<button type="button" className="btn btn-secondary" onClick={toggleFullscreen}>
				{isFullscreen ? 'フルスクリーン解除' : 'フルスクリーン'}
			</button>

			{/* Volume — always visible */}
			<div className="form-group">
				<label>
					音量 {volume}%
					<input
						type="range"
						min={0}
						max={100}
						value={volume}
						onChange={(e) => handleVolumeChange(Number(e.target.value))}
					/>
				</label>
			</div>

			{/* Host-only: capture settings */}
			{isHost && (
				<>
					<div className="form-group">
						<label>
							映像デバイス
							<select
								value={videoDeviceId ?? ''}
								onChange={(e) => handleVideoChange(e.target.value)}
							>
								<option value="">デフォルト</option>
								{devices.videos.map((d) => (
									<option key={d.deviceId} value={d.deviceId}>{d.label}</option>
								))}
							</select>
						</label>
					</div>

					<div className="form-group">
						<label>
							音声デバイス
							<select
								value={audioDeviceId ?? ''}
								onChange={(e) => handleAudioChange(e.target.value)}
							>
								<option value="">デフォルト</option>
								{devices.audios.map((d) => (
									<option key={d.deviceId} value={d.deviceId}>{d.label}</option>
								))}
							</select>
						</label>
					</div>

					<div className="form-group">
						<label>
							キャプチャ解像度
							<select
								value={`${videoWidth}x${videoHeight}`}
								onChange={(e) => handleResolutionChange(e.target.value)}
							>
								{RESOLUTIONS.map((r) => (
									<option key={`${r.w}x${r.h}`} value={`${r.w}x${r.h}`}>{r.label}</option>
								))}
							</select>
						</label>
					</div>

				</>
			)}

		</div>
	);
}
