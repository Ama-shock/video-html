import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadProfile, saveProfile } from '../db/identity';
import {
	loadConnectionMap,
	loadKeyboardKeymap,
	loadKeymap,
	loadKnownDongles,
	loadLinkKeys,
	loadSettings,
} from '../db/settings';
import { getOrCreateIdentity } from '../identity';
import { setKeyboardKeymap as setKeyboardKeymapModule } from '../keyboard/index';
import type { AppDispatch, RootState } from '../store';
import {
	setAudioDevice,
	setInitialized,
	setMode,
	setSwitchBtWsPort,
	setVideoDevice,
} from '../store/appSlice';
import { setConnectionMap, setKnownDongles, setLinkKeysAvailable } from '../store/dongleSlice';
import { setKeyboardKeymap, setKeymap } from '../store/gamepadSlice';
import { setIdentity, setUsername } from '../store/identitySlice';
import { startDonglePolling, stopDonglePolling } from '../switchBtWs/donglePoller';
import { dongleKey } from '../switchBtWs/types';
import ProfileSetup from './identity/ProfileSetup';
import Layout from './Layout';

export default function App() {
	const dispatch = useDispatch<AppDispatch>();
	const initialized = useSelector((s: RootState) => s.app.initialized);
	const username = useSelector((s: RootState) => s.identity.username);

	useEffect(() => {
		(async () => {
			const [settings, keymap, kbKeymap, identity, profile, knownDongles, connMap] =
				await Promise.all([
					loadSettings(),
					loadKeymap(),
					loadKeyboardKeymap(),
					getOrCreateIdentity(),
					loadProfile(),
					loadKnownDongles(),
					loadConnectionMap(),
				]);

			dispatch(
				setIdentity({
					publicKeyB64: identity.publicKeyB64,
					username: profile?.username ?? '',
				}),
			);
			dispatch(setSwitchBtWsPort(settings.switchBtWsPort));
			dispatch(setVideoDevice(settings.videoDeviceId));
			dispatch(setAudioDevice(settings.audioDeviceId));
			dispatch(setKeymap(keymap));
			dispatch(setKeyboardKeymap(kbKeymap));
			setKeyboardKeymapModule(kbKeymap);
			dispatch(setKnownDongles(knownDongles));
			dispatch(setConnectionMap(connMap));

			// 既知ドングルのリンクキー有無を確認
			for (const k of knownDongles) {
				const dKey = dongleKey(k.vid, k.pid, k.instance);
				const lk = await loadLinkKeys(dKey);
				if (lk) dispatch(setLinkKeysAvailable({ key: dKey, available: true }));
			}

			dispatch(setInitialized());

			// URL hash に room= が含まれる場合はゲストモード（hash は GuestMenu 側で消す）
			const hash = new URLSearchParams(window.location.hash.slice(1));
			if (hash.get('room')) dispatch(setMode('guest'));
		})();
	}, [dispatch]);

	// ホストモード時にドングルポーリングを開始
	const mode = useSelector((s: RootState) => s.app.mode);
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);
	useEffect(() => {
		if (!initialized) return;
		if (mode !== 'guest') {
			startDonglePolling(`http://localhost:${wsPort}`);
		} else {
			stopDonglePolling();
		}
		return () => stopDonglePolling();
	}, [initialized, mode, wsPort]);

	// hashchange でも room= があればゲストモードに切替
	useEffect(() => {
		const onHashChange = () => {
			const hash = new URLSearchParams(window.location.hash.slice(1));
			if (hash.get('room')) dispatch(setMode('guest'));
		};
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
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
