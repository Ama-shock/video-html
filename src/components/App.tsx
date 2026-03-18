import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadProfile, saveProfile } from '../db/identity';
import {
	loadConnectionMap,
	loadKeyboardKeymap,
	loadKeymap,
	loadKnownDongles,
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
import { dongleKey } from '../switchBtWs/types';
import { setGamepads, setKeyboardKeymap, setKeymap } from '../store/gamepadSlice';
import { setSelectedDevice } from '../store/guestSlice';
import { setIdentity, setUsername } from '../store/identitySlice';
import { store } from '../store';
import { startGlobalWs, stopGlobalWs } from '../switchBtWs/dongleWs';
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

			// 既知ドングルのリンクキー有無を確認（knownDongles に含まれている）
			for (const k of knownDongles) {
				if (k.linkKeys) {
					const dKey = dongleKey(k.vid, k.pid, k.instance);
					dispatch(setLinkKeysAvailable({ key: dKey, available: true }));
				}
			}

			dispatch(setInitialized());

			// URL hash に room= が含まれる場合はゲストモード（hash は GuestMenu 側で消す）
			const hash = new URLSearchParams(window.location.hash.slice(1));
			if (hash.get('room')) dispatch(setMode('guest'));
		})();
	}, [dispatch]);

	// ホストモード時にグローバル WS 接続を開始
	const mode = useSelector((s: RootState) => s.app.mode);
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);
	useEffect(() => {
		if (!initialized) return;
		if (mode !== 'guest') {
			startGlobalWs(`http://localhost:${wsPort}`);
		} else {
			stopGlobalWs();
		}
		return () => stopGlobalWs();
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

	// ゲームパッドのポーリング（メニューが開いていなくても常時動作）
	const gamepads = useSelector((s: RootState) => s.gamepad.gamepads);
	useEffect(() => {
		const update = () => {
			const { listConnectedGamepads } = require('../gamepad') as typeof import('../gamepad');
			const gps = listConnectedGamepads();
			const current = store.getState().gamepad.gamepads;
			const mapped = gps.map((gp: Gamepad) => ({
				index: gp.index,
				id: gp.id,
				connected: gp.connected,
				relayActive: current.find((g: any) => g.index === gp.index)?.relayActive ?? false,
				relayControllerId: current.find((g: any) => g.index === gp.index)?.relayControllerId ?? null,
			}));
			dispatch(setGamepads(mapped));
		};
		window.addEventListener('gamepadconnected', update);
		window.addEventListener('gamepaddisconnected', update);
		update();
		const pollTimer = setInterval(update, 2000);
		return () => {
			window.removeEventListener('gamepadconnected', update);
			window.removeEventListener('gamepaddisconnected', update);
			clearInterval(pollTimer);
		};
	}, [dispatch]);

	// ゲスト: 入力デバイスの自動選択
	useEffect(() => {
		if (mode !== 'guest') return;
		const sel = store.getState().guest.selectedDevice;
		if (gamepads.length > 0) {
			if (!sel || sel.type === 'keyboard') {
				dispatch(setSelectedDevice({ type: 'gamepad', index: gamepads[0].index }));
			} else if (sel.type === 'gamepad' && !gamepads.some((g: any) => g.index === sel.index)) {
				dispatch(setSelectedDevice({ type: 'gamepad', index: gamepads[0].index }));
			}
		} else {
			if (!sel) {
				dispatch(setSelectedDevice({ type: 'keyboard' }));
			} else if (sel.type === 'gamepad') {
				dispatch(setSelectedDevice({ type: 'keyboard' }));
			}
		}
	}, [mode, gamepads, dispatch]);

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
