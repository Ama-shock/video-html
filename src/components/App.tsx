import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadProfile, saveProfile } from '../db/identity';
import { loadKeymap, loadSettings } from '../db/settings';
import { getOrCreateIdentity } from '../identity';
import type { AppDispatch, RootState } from '../store';
import {
	setAudioDevice,
	setInitialized,
	setMode,
	setSwitchBtWsPort,
	setVideoDevice,
} from '../store/appSlice';
import { setKeymap } from '../store/gamepadSlice';
import { setIdentity, setUsername } from '../store/identitySlice';
import ProfileSetup from './identity/ProfileSetup';
import Layout from './Layout';

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

			dispatch(
				setIdentity({ publicKeyB64: identity.publicKeyB64, username: profile?.username ?? '' }),
			);
			dispatch(setSwitchBtWsPort(settings.switchBtWsPort));
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
