import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
	defaultKeymap,
	saveConnectionMap,
	saveKeyboardKeymap,
	saveKeymap,
	saveSettings,
} from '../../db/settings';
import { listConnectedGamepads } from '../../gamepad';
import { startRelay, stopRelay } from '../../gamepad/relay';
import { generateIdenticonDataUrl } from '../../identity/identicon';
import { KEYBOARD_GAMEPAD_INDEX, setKeyboardKeymap } from '../../keyboard/index';
import { defaultKeyboardKeymap } from '../../keyboard/keymap';
import { store, type AppDispatch, type RootState } from '../../store';
import { setSwitchBtWsPort } from '../../store/appSlice';
import { setConnectionMap } from '../../store/dongleSlice';
import {
	setGamepads,
	setKeyboardKeymap as setKeyboardKeymapAction,
	setKeyboardRelayActive,
	setKeymap,
	setRelayActive,
} from '../../store/gamepadSlice';
import { type GuestStatus, setGuestController } from '../../store/hostSlice';
import { SwitchBtWsClient } from '../../switchBtWs/client';
import type { ConnectionMapEntry, Controller } from '../../switchBtWs/types';
import { controllerPlayerMap, dongleKey } from '../../switchBtWs/types';
import InputVisualizer, { useGamepadInput, useKeyboardInput } from '../gamepad/InputVisualizer';
import KeyboardKeymapEditor from '../gamepad/KeyboardKeymapEditor';
import KeymapEditor from '../gamepad/KeymapEditor';
import ControllerList from '../settings/ControllerList';

const clientCache = new Map<number, SwitchBtWsClient>();

function getClient(wsBaseUrl: string, controllerId: number): SwitchBtWsClient {
	const cached = clientCache.get(controllerId);
	if (cached) return cached;
	const client = new SwitchBtWsClient(wsBaseUrl, controllerId);
	client.connect();
	clientCache.set(controllerId, client);
	return client;
}

/** ドラッグで渡す入力ソースの種別 */
type InputSource =
	| { type: 'gamepad'; index: number; id: string }
	| { type: 'keyboard' }
	| { type: 'guest'; userId: string; username: string };

export default function GamepadMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const mode = useSelector((s: RootState) => s.app.mode);
	const gamepads = useSelector((s: RootState) => s.gamepad.gamepads);
	const keymap = useSelector((s: RootState) => s.gamepad.keymap);
	const keyboardKeymap = useSelector((s: RootState) => s.gamepad.keyboardKeymap);
	const keyboardRelayActive = useSelector((s: RootState) => s.gamepad.keyboardRelayActive);
	const keyboardRelayControllerId = useSelector(
		(s: RootState) => s.gamepad.keyboardRelayControllerId,
	);
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);
	const guests = useSelector((s: RootState) => s.host.guests);
	const controllers = useSelector((s: RootState) => s.dongle.controllers);
	const connectionMap = useSelector((s: RootState) => s.dongle.connectionMap);

	const isGuest = mode === 'guest';
	const error = useSelector((s: RootState) => s.dongle.error);

	const tabs = isGuest
		? (['devices', 'keymap', 'kb-keymap'] as const)
		: (['map', 'keymap', 'kb-keymap', 'connection'] as const);
	type Tab = (typeof tabs)[number];
	const [tab, setTab] = useState<Tab>(tabs[0]);

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

	// Gamepad polling — イベント + 定期ポーリングで検出漏れを防ぐ
	useEffect(() => {
		const update = () => {
			const gps = listConnectedGamepads();
			// 現在の store から relay 状態を取得（stale closure 回避）
			const current = store.getState().gamepad.gamepads;
			const mapped = gps.map((gp) => ({
				index: gp.index,
				id: gp.id,
				connected: gp.connected,
				relayActive: current.find((g) => g.index === gp.index)?.relayActive ?? false,
				relayControllerId:
					current.find((g) => g.index === gp.index)?.relayControllerId ?? null,
			}));
			dispatch(setGamepads(mapped));
		};
		window.addEventListener('gamepadconnected', update);
		window.addEventListener('gamepaddisconnected', update);
		update();
		// 2秒ごとにポーリング（gamepadconnected が発火しないケースへの対応）
		const pollTimer = setInterval(update, 2000);
		return () => {
			window.removeEventListener('gamepadconnected', update);
			window.removeEventListener('gamepaddisconnected', update);
			clearInterval(pollTimer);
		};
	}, [dispatch]);

	// Sync keyboard keymap to the keyboard module
	useEffect(() => {
		setKeyboardKeymap(keyboardKeymap);
	}, [keyboardKeymap]);

	/** 接続マップを更新して IndexedDB に保存 */
	const persistConnectionMap = (entries: ConnectionMapEntry[]) => {
		dispatch(setConnectionMap(entries));
		saveConnectionMap(entries);
	};

	/** ドングルに入力ソースを割り当て（既存割り当ては自動解除） */
	const assignSource = (controller: Controller, source: InputSource) => {
		// 既に割り当て済みなら先に解除
		const existing = getAssignedSource(controller.id);
		if (existing) {
			unassignSourceRelay(controller.id);
		}

		const controllerId = controller.id;
		const dKey = dongleKey(controller.vid, controller.pid, controller.instance);

		if (source.type === 'gamepad') {
			const client = getClient(`ws://localhost:${wsPort}`, controllerId);
			startRelay({ gamepadIndex: source.index, client, keymap });
			dispatch(setRelayActive({ index: source.index, active: true, controllerId }));
		} else if (source.type === 'keyboard') {
			const client = getClient(`ws://localhost:${wsPort}`, controllerId);
			startRelay({ gamepadIndex: KEYBOARD_GAMEPAD_INDEX, client, keymap });
			dispatch(setKeyboardRelayActive({ active: true, controllerId }));
		} else {
			dispatch(setGuestController({ userId: source.userId, controllerId }));
		}

		// 接続マップを永続化
		const sourceId =
			source.type === 'gamepad'
				? String(source.index)
				: source.type === 'keyboard'
					? 'keyboard'
					: source.userId;
		const newMap = [
			...connectionMap.filter((e) => e.dongleKey !== dKey),
			{ dongleKey: dKey, sourceType: source.type, sourceId },
		];
		persistConnectionMap(newMap);
	};

	/** リレーのみ解除（接続マップは変更しない） */
	const unassignSourceRelay = (controllerId: number) => {
		const gp = gamepads.find((g) => g.relayActive && g.relayControllerId === controllerId);
		if (gp) {
			stopRelay(gp.index);
			dispatch(setRelayActive({ index: gp.index, active: false, controllerId: null }));
		}
		if (keyboardRelayActive && keyboardRelayControllerId === controllerId) {
			stopRelay(KEYBOARD_GAMEPAD_INDEX);
			dispatch(setKeyboardRelayActive({ active: false, controllerId: null }));
		}
		const guest = guests.find((g) => g.controllerId === controllerId);
		if (guest) {
			dispatch(setGuestController({ userId: guest.userId, controllerId: null }));
		}
	};

	/** ドングルから入力ソースを解除 */
	const unassignSource = (controller: Controller) => {
		unassignSourceRelay(controller.id);
		const dKey = dongleKey(controller.vid, controller.pid, controller.instance);
		persistConnectionMap(connectionMap.filter((e) => e.dongleKey !== dKey));
	};

	/** 割り当て済みの入力ソースを取得 */
	const getAssignedSource = (controllerId: number): InputSource | null => {
		const gp = gamepads.find((g) => g.relayActive && g.relayControllerId === controllerId);
		if (gp) return { type: 'gamepad', index: gp.index, id: gp.id };
		if (keyboardRelayActive && keyboardRelayControllerId === controllerId)
			return { type: 'keyboard' };
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
		...(!keyboardRelayActive ? [{ type: 'keyboard' } as InputSource] : []),
	];

	// コントローラー ID → P番号
	const playerMap = controllerPlayerMap(controllers);

	const tabLabels: Record<string, string> = {
		devices: 'デバイス',
		map: '接続マップ',
		keymap: 'キーマップ',
		'kb-keymap': 'KB マップ',
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

			{/* Guest mode: device list with input viz */}
			{tab === 'devices' && isGuest && (
				<div className="gamepad-list">
					<GuestDeviceRow type="keyboard" label="Keyboard" />
					{gamepads.length === 0 ? (
						<p className="empty-msg">
							ゲームパッドが接続されていません。ボタンを押して認識させてください。
						</p>
					) : (
						gamepads.map((gp) => (
							<GuestDeviceRow
								key={gp.index}
								type="gamepad"
								label={`#${gp.index} ${gp.id.slice(0, 30)}`}
								gamepadIndex={gp.index}
							/>
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
							{error
							? `switch-bt-ws に接続できません: ${error}`
							: 'ドングルが登録されていません。switch-bt-ws タブで追加してください。'}
						</p>
					) : (
						controllers.map((c) => (
							<DongleSlot
								key={c.id}
								controller={c}
								playerNum={playerMap.get(c.id) ?? null}
								assigned={getAssignedSource(c.id)}
								guests={guests}
								onDrop={(src) => assignSource(c, src)}
								onUnassign={() => unassignSource(c)}
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
				</div>
			)}

			{tab === 'keymap' && (
				<KeymapEditor
					keymap={keymap}
					onSave={async (km) => {
						await saveKeymap(km);
						dispatch(setKeymap(km));
					}}
					onReset={async () => {
						const km = defaultKeymap();
						await saveKeymap(km);
						dispatch(setKeymap(km));
					}}
				/>
			)}

			{tab === 'kb-keymap' && (
				<KeyboardKeymapEditor
					keymap={keyboardKeymap}
					onSave={async (km) => {
						await saveKeyboardKeymap(km);
						dispatch(setKeyboardKeymapAction(km));
					}}
					onReset={async () => {
						const km = defaultKeyboardKeymap();
						await saveKeyboardKeymap(km);
						dispatch(setKeyboardKeymapAction(km));
					}}
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
									<button type="button" className="btn btn-primary btn-sm" onClick={handlePortSave}>
										保存
									</button>
								) : (
									<button
										type="button"
										className="btn btn-secondary btn-sm"
										onClick={() => setPortEditing(true)}
									>
										変更
									</button>
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
	if (src.type === 'keyboard') return 'keyboard';
	return src.type === 'gamepad' ? `gp-${src.index}` : `guest-${src.userId}`;
}

function sourceLabel(src: InputSource): string {
	if (src.type === 'keyboard') return 'Keyboard';
	if (src.type === 'guest') return src.username;
	return src.id.slice(0, 30);
}

function sourceSubLabel(src: InputSource): string {
	if (src.type === 'keyboard') return 'ローカル';
	if (src.type === 'guest') return 'ゲスト';
	return `ローカル #${src.index}`;
}

/** ゲスト側デバイス行（入力ビジュアライザ付き） */
function GuestDeviceRow({
	type,
	label,
	gamepadIndex,
}: {
	type: 'keyboard' | 'gamepad';
	label: string;
	gamepadIndex?: number;
}) {
	const gpInput = useGamepadInput(type === 'gamepad' ? (gamepadIndex ?? null) : null);
	const kbInput = useKeyboardInput();
	const input = type === 'keyboard' ? kbInput : gpInput;

	return (
		<div className="gamepad-row">
			<div className="gamepad-info">
				<span className="gamepad-index">{type === 'keyboard' ? '⌨' : `#${gamepadIndex}`}</span>
				<span className="gamepad-id" title={label}>
					{label}
				</span>
			</div>
			<InputVisualizer input={input} />
		</div>
	);
}

/** ドングルのドロップターゲット（入力ビジュアライザ + アイデンティコン付き） */
function DongleSlot({
	controller,
	playerNum,
	assigned,
	guests: _guests,
	onDrop,
	onUnassign,
}: {
	controller: Controller;
	playerNum: number | null;
	assigned: InputSource | null;
	guests: GuestStatus[];
	onDrop: (src: InputSource) => void;
	onUnassign: () => void;
}) {
	const [dragOver, setDragOver] = useState(false);

	const gamepadIndex = assigned?.type === 'gamepad' ? assigned.index : null;
	const gpInput = useGamepadInput(gamepadIndex);
	const kbInput = useKeyboardInput();
	const input = assigned?.type === 'keyboard' ? kbInput : gpInput;

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
		} catch {
			/* ignore */
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drop target for drag-and-drop
		<div
			className={`dongle-slot ${dragOver ? 'drag-over' : ''} ${assigned ? 'assigned' : ''}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<div className="dongle-header">
				<span className="dongle-label">
					<span className={`status-dot ${controller.paired ? 'connected' : ''}`} />
					{playerNum ? `P${playerNum}` : `#${controller.id}`}
				</span>
				<span className="dongle-hw">
					{controller.vid}:{controller.pid}
				</span>
			</div>
			{assigned ? (
				<div className="dongle-assigned">
					<div className="assigned-source-row">
						{assigned.type === 'guest' && <GuestIdenticon userId={assigned.userId} size={24} />}
						<div className="assigned-source">
							<span className="assigned-name">{sourceLabel(assigned)}</span>
							<span className="assigned-type">{sourceSubLabel(assigned)}</span>
						</div>
						<InputVisualizer input={input} />
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

/** ドラッグ可能な入力ソースカード（入力ビジュアライザ付き） */
function DraggableSource({ source }: { source: InputSource }) {
	const gamepadIndex = source.type === 'gamepad' ? source.index : null;
	const gpInput = useGamepadInput(gamepadIndex);
	const kbInput = useKeyboardInput();
	const input = source.type === 'keyboard' ? kbInput : gpInput;

	const handleDragStart = (e: React.DragEvent) => {
		e.dataTransfer.setData('application/json', JSON.stringify(source));
		e.dataTransfer.effectAllowed = 'link';
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: draggable source card
		<div className="source-card" draggable onDragStart={handleDragStart}>
			<div className="source-info">
				{source.type === 'guest' && <GuestIdenticon userId={source.userId} size={24} />}
				<div>
					<span className="source-name">{sourceLabel(source)}</span>
					<span className="source-type">{sourceSubLabel(source)}</span>
				</div>
			</div>
			<InputVisualizer input={input} />
		</div>
	);
}

/** ゲスト用アイデンティコン（非同期生成 + キャッシュ） */
const identiconCache = new Map<string, string>();

function GuestIdenticon({ userId, size }: { userId: string; size: number }) {
	const [src, setSrc] = useState<string | null>(identiconCache.get(userId) ?? null);

	useEffect(() => {
		if (src) return;
		let cancelled = false;
		generateIdenticonDataUrl(userId).then((url) => {
			if (cancelled) return;
			identiconCache.set(userId, url);
			setSrc(url);
		});
		return () => {
			cancelled = true;
		};
	}, [userId, src]);

	if (!src) return <div className="avatar-placeholder" style={{ width: size, height: size }} />;
	return <img src={src} alt="" width={size} height={size} className="user-avatar" />;
}
