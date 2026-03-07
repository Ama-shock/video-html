import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { defaultKeymap, saveKeymap } from '../../db/settings';
import { listConnectedGamepads } from '../../gamepad';
import { startRelay, stopRelay } from '../../gamepad/relay';
import type { AppDispatch, RootState } from '../../store';
import { setGamepads, setKeymap, setRelayActive } from '../../store/gamepadSlice';
import { SwitchBtWsClient } from '../../switchBtWs/client';
import KeymapEditor from './KeymapEditor';

// コントローラーごとのクライアントキャッシュ
const clientCache = new Map<number, SwitchBtWsClient>();

function getClient(wsBaseUrl: string, controllerId: number): SwitchBtWsClient {
	if (!clientCache.has(controllerId)) {
		const client = new SwitchBtWsClient(wsBaseUrl, controllerId);
		client.connect();
		clientCache.set(controllerId, client);
	}
	return clientCache.get(controllerId)!;
}

export default function GamepadPanel() {
	const dispatch = useDispatch<AppDispatch>();
	const gamepads = useSelector((s: RootState) => s.gamepad.gamepads);
	const keymap = useSelector((s: RootState) => s.gamepad.keymap);
	const wsUrl = useSelector((s: RootState) => s.app.switchBtWsUrl);
	const [tab, setTab] = useState<'gamepads' | 'keymap'>('gamepads');

	// ゲームパッド接続状態の監視
	useEffect(() => {
		const update = () => {
			const gps = listConnectedGamepads();
			dispatch(
				setGamepads(
					gps.map((gp) => ({
						index: gp.index,
						id: gp.id,
						connected: gp.connected,
						relayActive: gamepads.find((g) => g.index === gp.index)?.relayActive ?? false,
						relayControllerId:
							gamepads.find((g) => g.index === gp.index)?.relayControllerId ?? null,
					})),
				),
			);
		};

		window.addEventListener('gamepadconnected', update);
		window.addEventListener('gamepaddisconnected', update);
		update();

		return () => {
			window.removeEventListener('gamepadconnected', update);
			window.removeEventListener('gamepaddisconnected', update);
		};
	}, [dispatch, gamepads.find]);

	const handleToggleRelay = (gpIndex: number, controllerId: number) => {
		const gp = gamepads.find((g) => g.index === gpIndex);
		if (!gp) return;

		if (gp.relayActive) {
			stopRelay(gpIndex);
			dispatch(setRelayActive({ index: gpIndex, active: false, controllerId: null }));
		} else {
			const client = getClient(
				wsUrl.replace('ws://', 'http://').replace('wss://', 'https://'),
				controllerId,
			);
			startRelay({ gamepadIndex: gpIndex, client, keymap });
			dispatch(setRelayActive({ index: gpIndex, active: true, controllerId }));
		}
	};

	const handleResetKeymap = async () => {
		const km = defaultKeymap();
		await saveKeymap(km);
		dispatch(setKeymap(km));
	};

	const handleSaveKeymap = async (km: typeof keymap) => {
		await saveKeymap(km);
		dispatch(setKeymap(km));
	};

	return (
		<div className="panel gamepad-panel">
			<h2>ゲームパッド</h2>

			<div className="tab-bar">
				<button
					type="button"
					className={`tab-btn ${tab === 'gamepads' ? 'active' : ''}`}
					onClick={() => setTab('gamepads')}
				>
					デバイス
				</button>
				<button
					type="button"
					className={`tab-btn ${tab === 'keymap' ? 'active' : ''}`}
					onClick={() => setTab('keymap')}
				>
					キーマップ
				</button>
			</div>

			{tab === 'gamepads' && (
				<div className="gamepad-list">
					{gamepads.length === 0 ? (
						<p className="empty-msg">
							ゲームパッドが接続されていません。ボタンを押して認識させてください。
						</p>
					) : (
						gamepads.map((gp) => <GamepadRow key={gp.index} gp={gp} onToggle={handleToggleRelay} />)
					)}
				</div>
			)}

			{tab === 'keymap' && (
				<KeymapEditor keymap={keymap} onSave={handleSaveKeymap} onReset={handleResetKeymap} />
			)}
		</div>
	);
}

function GamepadRow({
	gp,
	onToggle,
}: {
	gp: { index: number; id: string; relayActive: boolean; relayControllerId: number | null };
	onToggle: (gpIndex: number, controllerId: number) => void;
}) {
	const [controllerId, setControllerId] = useState(gp.relayControllerId ?? 0);

	return (
		<div className={`gamepad-row ${gp.relayActive ? 'relay-active' : ''}`}>
			<div className="gamepad-info">
				<span className="gamepad-index">#{gp.index}</span>
				<span className="gamepad-id" title={gp.id}>
					{gp.id.slice(0, 40)}
				</span>
			</div>
			<div className="relay-config">
				<select
					value={controllerId}
					onChange={(e) => setControllerId(Number(e.target.value))}
					disabled={gp.relayActive}
				>
					{[0, 1, 2, 3].map((i) => (
						<option key={i} value={i}>
							Switch #{i}
						</option>
					))}
				</select>
				<button
					type="button"
					className={`btn btn-sm ${gp.relayActive ? 'btn-danger' : 'btn-primary'}`}
					onClick={() => onToggle(gp.index, controllerId)}
				>
					{gp.relayActive ? 'リレー停止' : 'リレー開始'}
				</button>
			</div>
		</div>
	);
}
