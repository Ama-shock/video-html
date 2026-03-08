import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { defaultKeymap, saveKeymap, saveSettings } from '../../db/settings';
import { listConnectedGamepads } from '../../gamepad';
import { startRelay, stopRelay } from '../../gamepad/relay';
import type { AppDispatch, RootState } from '../../store';
import { setSwitchBtWsPort } from '../../store/appSlice';
import { setGamepads, setKeymap, setRelayActive } from '../../store/gamepadSlice';
import { setGuestController, type GuestStatus } from '../../store/hostSlice';
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

type Controller = {
	id: number;
	vid: string;
	pid: string;
	instance: number;
	paired: boolean;
};

/** ドラッグで渡す入力ソースの種別 */
type InputSource =
	| { type: 'gamepad'; index: number; id: string }
	| { type: 'guest'; userId: string; username: string };

export default function GamepadMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const mode = useSelector((s: RootState) => s.app.mode);
	const gamepads = useSelector((s: RootState) => s.gamepad.gamepads);
	const keymap = useSelector((s: RootState) => s.gamepad.keymap);
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);
	const guests = useSelector((s: RootState) => s.host.guests);

	const isGuest = mode === 'guest';

	const tabs = isGuest
		? (['devices', 'keymap'] as const)
		: (['map', 'keymap', 'connection'] as const);
	type Tab = (typeof tabs)[number];
	const [tab, setTab] = useState<Tab>(tabs[0]);

	// switch-bt-ws port editing
	const [portEditing, setPortEditing] = useState(false);
	const [portInput, setPortInput] = useState(String(wsPort));

	// Registered controllers from switch-bt-ws
	const [controllers, setControllers] = useState<Controller[]>([]);

	useEffect(() => setPortInput(String(wsPort)), [wsPort]);

	const handlePortSave = async () => {
		const port = Number(portInput) || 8765;
		dispatch(setSwitchBtWsPort(port));
		await saveSettings({ switchBtWsPort: port });
		setPortEditing(false);
	};

	// Fetch controllers for the connection map
	const fetchControllers = useCallback(async () => {
		try {
			const resp = await fetch(`http://localhost:${wsPort}/api/controllers`);
			if (resp.ok) setControllers(await resp.json());
		} catch { /* ignore */ }
	}, [wsPort]);

	useEffect(() => {
		if (!isGuest) fetchControllers();
	}, [isGuest, fetchControllers]);

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

	/** ドングルに入力ソースを割り当て */
	const assignSource = (controllerId: number, source: InputSource) => {
		if (source.type === 'gamepad') {
			// Gamepad → controller relay
			const client = getClient(`ws://localhost:${wsPort}`, controllerId);
			startRelay({ gamepadIndex: source.index, client, keymap });
			dispatch(setRelayActive({ index: source.index, active: true, controllerId }));
		} else {
			// Guest → controller
			dispatch(setGuestController({ userId: source.userId, controllerId }));
		}
	};

	/** ドングルから入力ソースを解除 */
	const unassignSource = (controllerId: number) => {
		// Check gamepads
		const gp = gamepads.find((g) => g.relayActive && g.relayControllerId === controllerId);
		if (gp) {
			stopRelay(gp.index);
			dispatch(setRelayActive({ index: gp.index, active: false, controllerId: null }));
		}
		// Check guests
		const guest = guests.find((g) => g.controllerId === controllerId);
		if (guest) {
			dispatch(setGuestController({ userId: guest.userId, controllerId: null }));
		}
	};

	/** 割り当て済みの入力ソースを取得 */
	const getAssignedSource = (controllerId: number): InputSource | null => {
		const gp = gamepads.find((g) => g.relayActive && g.relayControllerId === controllerId);
		if (gp) return { type: 'gamepad', index: gp.index, id: gp.id };
		const guest = guests.find((g) => g.controllerId === controllerId);
		if (guest) return { type: 'guest', userId: guest.userId, username: guest.username };
		return null;
	};

	/** 未割り当ての入力ソース一覧 */
	const unassignedSources: InputSource[] = [
		...guests
			.filter((g) => g.controllerId == null && g.connectionState === 'connected')
			.map((g): InputSource => ({ type: 'guest', userId: g.userId, username: g.username })),
		...gamepads
			.filter((g) => !g.relayActive)
			.map((g): InputSource => ({ type: 'gamepad', index: g.index, id: g.id })),
	];

	const tabLabels: Record<string, string> = {
		devices: 'デバイス',
		map: '接続マップ',
		keymap: 'キーマップ',
		connection: 'switch-bt-ws',
	};

	return (
		<div className="menu-section">
			<div className="menu-subtabs">
				{tabs.map((t) => (
					<button
						type="button"
						key={t}
						className={`menu-subtab ${tab === t ? 'active' : ''}`}
						onClick={() => setTab(t)}
					>
						{tabLabels[t]}
					</button>
				))}
			</div>

			{/* Guest mode: simple device list */}
			{tab === 'devices' && isGuest && (
				<div className="gamepad-list">
					{gamepads.length === 0 ? (
						<p className="empty-msg">ゲームパッドが接続されていません。ボタンを押して認識させてください。</p>
					) : (
						gamepads.map((gp) => (
							<div key={gp.index} className="gamepad-row">
								<div className="gamepad-info">
									<span className="gamepad-index">#{gp.index}</span>
									<span className="gamepad-id" title={gp.id}>{gp.id.slice(0, 40)}</span>
								</div>
							</div>
						))
					)}
				</div>
			)}

			{/* Host/Standalone: connection map */}
			{tab === 'map' && !isGuest && (
				<div className="connection-map">
					<h4>BT ドングル</h4>
					{controllers.length === 0 ? (
						<p className="empty-msg">
							ドングルが登録されていません。switch-bt-ws タブで追加してください。
						</p>
					) : (
						controllers.map((c) => (
							<DongleSlot
								key={c.id}
								controller={c}
								assigned={getAssignedSource(c.id)}
								onDrop={(src) => assignSource(c.id, src)}
								onUnassign={() => unassignSource(c.id)}
							/>
						))
					)}

					{unassignedSources.length > 0 && (
						<>
							<h4>未割り当て</h4>
							<div className="unassigned-sources">
								{unassignedSources.map((src) => (
									<DraggableSource key={sourceKey(src)} source={src} />
								))}
							</div>
						</>
					)}

					<button
						type="button"
						className="btn btn-secondary btn-sm"
						onClick={fetchControllers}
						style={{ marginTop: 8, alignSelf: 'flex-start' }}
					>
						更新
					</button>
				</div>
			)}

			{tab === 'keymap' && (
				<KeymapEditor
					keymap={keymap}
					onSave={async (km) => { await saveKeymap(km); dispatch(setKeymap(km)); }}
					onReset={async () => { const km = defaultKeymap(); await saveKeymap(km); dispatch(setKeymap(km)); }}
				/>
			)}

			{tab === 'connection' && !isGuest && (
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

					<h4>ドングル管理</h4>
					<ControllerList />
				</div>
			)}
		</div>
	);
}

function sourceKey(src: InputSource): string {
	return src.type === 'gamepad' ? `gp-${src.index}` : `guest-${src.userId}`;
}

function sourceLabel(src: InputSource): string {
	if (src.type === 'guest') return src.username;
	return src.id.slice(0, 30);
}

function sourceSubLabel(src: InputSource): string {
	if (src.type === 'guest') return 'ゲスト';
	return `ローカル #${src.index}`;
}

/** ドングルのドロップターゲット */
function DongleSlot({
	controller,
	assigned,
	onDrop,
	onUnassign,
}: {
	controller: Controller;
	assigned: InputSource | null;
	onDrop: (src: InputSource) => void;
	onUnassign: () => void;
}) {
	const [dragOver, setDragOver] = useState(false);

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'link';
		setDragOver(true);
	};

	const handleDragLeave = () => setDragOver(false);

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setDragOver(false);
		try {
			const data = JSON.parse(e.dataTransfer.getData('application/json')) as InputSource;
			onDrop(data);
		} catch { /* ignore */ }
	};

	return (
		<div
			className={`dongle-slot ${dragOver ? 'drag-over' : ''} ${assigned ? 'assigned' : ''}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<div className="dongle-header">
				<span className="dongle-label">
					<span className={`status-dot ${controller.paired ? 'connected' : ''}`} />
					ドングル #{controller.id}
				</span>
				<span className="dongle-hw">{controller.vid}:{controller.pid}</span>
			</div>
			{assigned ? (
				<div className="dongle-assigned">
					<div className="assigned-source">
						<span className="assigned-name">{sourceLabel(assigned)}</span>
						<span className="assigned-type">{sourceSubLabel(assigned)}</span>
					</div>
					<button type="button" className="btn btn-danger btn-sm" onClick={onUnassign}>
						解除
					</button>
				</div>
			) : (
				<div className="dongle-empty">ドラッグして割り当て</div>
			)}
		</div>
	);
}

/** ドラッグ可能な入力ソースカード */
function DraggableSource({ source }: { source: InputSource }) {
	const handleDragStart = (e: React.DragEvent) => {
		e.dataTransfer.setData('application/json', JSON.stringify(source));
		e.dataTransfer.effectAllowed = 'link';
	};

	return (
		<div className="source-card" draggable onDragStart={handleDragStart}>
			<span className="source-name">{sourceLabel(source)}</span>
			<span className="source-type">{sourceSubLabel(source)}</span>
		</div>
	);
}
