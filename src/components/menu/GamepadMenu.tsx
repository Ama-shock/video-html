import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { defaultKeymap, saveKeymap, saveSettings } from '../../db/settings';
import { listConnectedGamepads } from '../../gamepad';
import { startRelay, stopRelay } from '../../gamepad/relay';
import type { AppDispatch, RootState } from '../../store';
import { setSwitchBtWsPort } from '../../store/appSlice';
import { setGamepads, setKeymap, setRelayActive } from '../../store/gamepadSlice';
import { SwitchBtWsClient } from '../../switchBtWs/client';
import KeymapEditor from '../gamepad/KeymapEditor';
import ControllerList from '../settings/ControllerList';

const clientCache = new Map<number, SwitchBtWsClient>();

function getClient(wsBaseUrl: string, controllerId: number): SwitchBtWsClient {
	if (!clientCache.has(controllerId)) {
		const client = new SwitchBtWsClient(wsBaseUrl, controllerId);
		client.connect();
		clientCache.set(controllerId, client);
	}
	return clientCache.get(controllerId)!;
}

export default function GamepadMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const gamepads = useSelector((s: RootState) => s.gamepad.gamepads);
	const keymap = useSelector((s: RootState) => s.gamepad.keymap);
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);
	const [tab, setTab] = useState<'devices' | 'keymap' | 'connection'>('devices');

	// switch-bt-ws port editing
	const [portEditing, setPortEditing] = useState(false);
	const [portInput, setPortInput] = useState(String(wsPort));

	useEffect(() => setPortInput(String(wsPort)), [wsPort]);

	const handlePortSave = async () => {
		const port = Number(portInput) || 8765;
		dispatch(setSwitchBtWsPort(port));
		await saveSettings({ switchBtWsPort: port });
		setPortEditing(false);
	};

	// Gamepad polling
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
						relayControllerId: gamepads.find((g) => g.index === gp.index)?.relayControllerId ?? null,
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
			const client = getClient(`ws://localhost:${wsPort}`, controllerId);
			startRelay({ gamepadIndex: gpIndex, client, keymap });
			dispatch(setRelayActive({ index: gpIndex, active: true, controllerId }));
		}
	};

	return (
		<div className="menu-section">
			{/* Sub-tabs */}
			<div className="menu-subtabs">
				<button type="button" className={`menu-subtab ${tab === 'devices' ? 'active' : ''}`} onClick={() => setTab('devices')}>デバイス</button>
				<button type="button" className={`menu-subtab ${tab === 'keymap' ? 'active' : ''}`} onClick={() => setTab('keymap')}>キーマップ</button>
				<button type="button" className={`menu-subtab ${tab === 'connection' ? 'active' : ''}`} onClick={() => setTab('connection')}>switch-bt-ws</button>
			</div>

			{tab === 'devices' && (
				<div className="gamepad-list">
					{gamepads.length === 0 ? (
						<p className="empty-msg">ゲームパッドが接続されていません。ボタンを押して認識させてください。</p>
					) : (
						gamepads.map((gp) => (
							<GamepadRow key={gp.index} gp={gp} onToggle={handleToggleRelay} />
						))
					)}
				</div>
			)}

			{tab === 'keymap' && (
				<KeymapEditor
					keymap={keymap}
					onSave={async (km) => { await saveKeymap(km); dispatch(setKeymap(km)); }}
					onReset={async () => { const km = defaultKeymap(); await saveKeymap(km); dispatch(setKeymap(km)); }}
				/>
			)}

			{tab === 'connection' && (
				<div className="menu-card">
					<h4>switch-bt-ws 接続先</h4>
					<div className="form-group">
						<label>
							ポート番号 (localhost)
							<div className="port-input-row">
								<input
									type="number"
									value={portInput}
									onChange={(e) => setPortInput(e.target.value)}
									disabled={!portEditing}
									min={1}
									max={65535}
								/>
								{portEditing ? (
									<button type="button" className="btn btn-primary btn-sm" onClick={handlePortSave}>保存</button>
								) : (
									<button type="button" className="btn btn-secondary btn-sm" onClick={() => setPortEditing(true)}>変更</button>
								)}
							</div>
						</label>
					</div>

					<h4>コントローラー管理</h4>
					<ControllerList />
				</div>
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
				<span className="gamepad-id" title={gp.id}>{gp.id.slice(0, 40)}</span>
			</div>
			<div className="relay-config">
				<select value={controllerId} onChange={(e) => setControllerId(Number(e.target.value))} disabled={gp.relayActive}>
					{[0, 1, 2, 3].map((i) => (
						<option key={i} value={i}>Switch #{i}</option>
					))}
				</select>
				<button
					type="button"
					className={`btn btn-sm ${gp.relayActive ? 'btn-danger' : 'btn-primary'}`}
					onClick={() => onToggle(gp.index, controllerId)}
				>
					{gp.relayActive ? '停止' : '開始'}
				</button>
			</div>
		</div>
	);
}
