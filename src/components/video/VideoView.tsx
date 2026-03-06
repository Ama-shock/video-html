import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { setVideoDevice, setAudioDevice } from '../../store/appSlice';
import { saveSettings } from '../../db/settings';

type DeviceList = { videos: MediaDeviceInfo[]; audios: MediaDeviceInfo[] };

export default function VideoView() {
    const dispatch = useDispatch<AppDispatch>();
    const videoDeviceId = useSelector((s: RootState) => s.app.videoDeviceId);
    const audioDeviceId = useSelector((s: RootState) => s.app.audioDeviceId);
    const videoWidth = useSelector((s: RootState) => s.app.videoWidth);
    const videoHeight = useSelector((s: RootState) => s.app.videoHeight);

    const videoRef = useRef<HTMLVideoElement>(null);
    const [devices, setDevices] = useState<DeviceList>({ videos: [], audios: [] });
    const [started, setStarted] = useState(false);
    const [volume, setVolume] = useState(100);
    const streamRef = useRef<MediaStream | null>(null);

    const startCapture = useCallback(async (vidId?: string | null, audId?: string | null) => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: vidId ?? undefined, width: videoWidth, height: videoHeight },
                audio: {
                    deviceId: audId ?? undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    latency: 0,
                },
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            // デバイス列挙（権限取得後）
            const devs = await navigator.mediaDevices.enumerateDevices();
            const selectable = devs.filter(d => !['default', 'communications', ''].includes(d.deviceId));
            setDevices({
                videos: selectable.filter(d => d.kind === 'videoinput'),
                audios: selectable.filter(d => d.kind === 'audioinput'),
            });
        } catch (err) {
            console.error('Capture failed:', err);
        }
    }, [videoWidth, videoHeight]);

    const handleStart = async () => {
        setStarted(true);
        await startCapture(videoDeviceId, audioDeviceId);
    };

    const handleVideoChange = async (id: string) => {
        dispatch(setVideoDevice(id));
        await saveSettings({ videoDeviceId: id });
        await startCapture(id, audioDeviceId);
    };

    const handleAudioChange = async (id: string) => {
        dispatch(setAudioDevice(id));
        await saveSettings({ audioDeviceId: id });
        await startCapture(videoDeviceId, id);
    };

    useEffect(() => {
        if (videoRef.current) videoRef.current.volume = volume / 100;
    }, [volume]);

    useEffect(() => {
        return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
    }, []);

    return (
        <div className="video-view">
            <div className="video-container">
                <video ref={videoRef} autoPlay={false} controls={false} playsInline />
                {!started && (
                    <div className="video-overlay">
                        <button className="btn btn-primary btn-large" onClick={handleStart}>
                            映像キャプチャ開始
                        </button>
                    </div>
                )}
            </div>

            {started && (
                <div className="video-controls">
                    <div className="control-group">
                        <label>映像デバイス</label>
                        <select value={videoDeviceId ?? ''} onChange={e => handleVideoChange(e.target.value)}>
                            <option value="">デフォルト</option>
                            {devices.videos.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="control-group">
                        <label>音声デバイス</label>
                        <select value={audioDeviceId ?? ''} onChange={e => handleAudioChange(e.target.value)}>
                            <option value="">デフォルト</option>
                            {devices.audios.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="control-group">
                        <label>音量 {volume}%</label>
                        <input
                            type="range" min={0} max={100} value={volume}
                            onChange={e => setVolume(Number(e.target.value))}
                        />
                    </div>

                    <button className="btn btn-secondary" onClick={() => videoRef.current?.requestFullscreen()}>
                        フルスクリーン
                    </button>
                </div>
            )}
        </div>
    );
}
