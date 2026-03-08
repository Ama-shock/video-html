import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { saveSettings } from '../../db/settings';
import type { AppDispatch, RootState } from '../../store';
import { setAudioDevice, setVideoDevice } from '../../store/appSlice';

type DeviceList = { videos: MediaDeviceInfo[]; audios: MediaDeviceInfo[] };

export default function VideoMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const videoDeviceId = useSelector((s: RootState) => s.app.videoDeviceId);
	const audioDeviceId = useSelector((s: RootState) => s.app.audioDeviceId);

	const [devices, setDevices] = useState<DeviceList>({ videos: [], audios: [] });
	const [volume, setVolume] = useState(100);

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

	const handleStart = async () => {
		const vc = (window as any).__vidcapt;
		if (vc) await vc.startCapture(videoDeviceId, audioDeviceId);
	};

	const isStarted = (window as any).__vidcapt?.started ?? false;

	return (
		<div className="menu-section">
			{!isStarted && (
				<button type="button" className="btn btn-primary" onClick={handleStart}>
					映像キャプチャ開始
				</button>
			)}

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
		</div>
	);
}
