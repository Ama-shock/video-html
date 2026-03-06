import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { setInitialized, setMode, setVideoDevice, setAudioDevice, setSwitchBtWsUrl } from '../store/appSlice';
import { setIdentity, setUsername } from '../store/identitySlice';
import { setKeymap } from '../store/gamepadSlice';
import { getOrCreateIdentity } from '../identity';
import { loadProfile, saveProfile } from '../db/identity';
import { loadSettings, loadKeymap } from '../db/settings';
import Layout from './Layout';
import ProfileSetup from './identity/ProfileSetup';

export default function App() {
    const dispatch = useDispatch<AppDispatch>();
    const initialized = useSelector((s: RootState) => s.app.initialized);
    const username = useSelector((s: RootState) => s.identity.username);

    useEffect(() => {
        (async () => {
            const [settings, keymap, identity, profile] = await Promise.all([
                loadSettings(),
                loadKeymap(),
                getOrCreateIdentity(),
                loadProfile(),
            ]);

            dispatch(setIdentity({ publicKeyB64: identity.publicKeyB64, username: profile?.username ?? '' }));
            dispatch(setSwitchBtWsUrl(settings.switchBtWsUrl));
            dispatch(setVideoDevice(settings.videoDeviceId));
            dispatch(setAudioDevice(settings.audioDeviceId));
            dispatch(setKeymap(keymap));
            dispatch(setInitialized());

            // URL hash に room= が含まれる場合はゲストモード
            const hash = new URLSearchParams(window.location.hash.slice(1));
            if (hash.get('room')) dispatch(setMode('guest'));
        })();
    }, [dispatch]);

    if (!initialized) {
        return <div className="splash">読み込み中...</div>;
    }

    if (!username) {
        return (
            <ProfileSetup
                onComplete={async (name) => {
                    await saveProfile({ username: name });
                    dispatch(setUsername(name));
                }}
            />
        );
    }

    return <Layout />;
}
