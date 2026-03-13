import { useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import {
	disconnectDongle,
	installWinUsbDriver,
	markDongleAsKnown,
	reconnectDongle,
	restoreStandardDriver,
	startPairing,
} from '../../switchBtWs/dongleService';
import { requestRefresh } from '../../switchBtWs/dongleWs';
import type { BtDevice, Controller } from '../../switchBtWs/types';
import { controllerPlayerMap, dongleKey, isBthUsb, isWinUsb } from '../../switchBtWs/types';

/** WinUSB デバイス + コントローラー情報を結合した行 */
type WinUsbRow = {
	device: BtDevice;
	controller: Controller | null;
	isKnown: boolean;
	displayName: string;
};

export default function ControllerList() {
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);
	const apiBase = `http://localhost:${wsPort}`;

	const devices = useSelector((s: RootState) => s.dongle.devices);
	const controllers = useSelector((s: RootState) => s.dongle.controllers);
	const knownDongles = useSelector((s: RootState) => s.dongle.knownDongles);
	const dongleStatuses = useSelector((s: RootState) => s.dongle.dongleStatuses);
	const error = useSelector((s: RootState) => s.dongle.error);
	const version = useSelector((s: RootState) => s.dongle.version);
	const linkKeysAvailable = useSelector((s: RootState) => s.dongle.linkKeysAvailable);

	const [driverBusy, setDriverBusy] = useState(false);
	const [actionBusy, setActionBusy] = useState<string | null>(null);

	// --- デバイスを3カテゴリに分類 ---
	const winUsbDevices: WinUsbRow[] = devices
		.filter((d) => isWinUsb(d.driver))
		.map((d) => {
			// description はインスタンス変化で一致しないことがあるため VID+PID で検索
			const knownByKey = knownDongles.find(
				(k) => k.vid === d.vid && k.pid === d.pid && k.instance === d.instance,
			);
			const knownByVidPid = knownDongles.find(
				(k) => k.vid === d.vid && k.pid === d.pid && k.description,
			);
			const isKnown = !!knownByKey;
			// 保存済み description → デバイスの description から "(WinUSB)" 等を除去した名称の順で選択
			const savedDesc = knownByVidPid?.description;
			const rawDesc = d.description.replace(/\s*\(WinUSB\)/i, '').trim();
			const displayName = savedDesc || rawDesc;
			return {
				device: d,
				controller:
					controllers.find((c) => c.vid === d.vid && c.pid === d.pid && c.instance === d.instance) ??
					null,
				isKnown,
				displayName,
			};
		});

	const bthUsbDevices = devices.filter((d) => isBthUsb(d.driver));
	const otherDevices = devices.filter((d) => !isWinUsb(d.driver) && !isBthUsb(d.driver));

	const orphanControllers = controllers.filter(
		(c) => !winUsbDevices.some((w) => w.controller?.id === c.id),
	);

	// コントローラー ID → P番号
	const playerMap = controllerPlayerMap(controllers);

	// --- アクション ---
	const handleReconnect = async (device: BtDevice) => {
		const key = dongleKey(device.vid, device.pid, device.instance);
		setActionBusy(key);
		await reconnectDongle(apiBase, device);
		setActionBusy(null);
	};

	const handlePairing = async (device: BtDevice) => {
		const key = dongleKey(device.vid, device.pid, device.instance);
		setActionBusy(key);
		await startPairing(apiBase, device);
		setActionBusy(null);
	};

	const handleDisconnect = async (controllerId: number, device?: BtDevice) => {
		if (device) {
			await markDongleAsKnown(device);
		}
		const key = device
			? dongleKey(device.vid, device.pid, device.instance)
			: `ctrl-${controllerId}`;
		setActionBusy(key);
		await disconnectDongle(apiBase, controllerId);
		setActionBusy(null);
	};

	const handleRestoreDriver = async (vid: string, pid: string) => {
		setDriverBusy(true);
		const msg = await restoreStandardDriver(apiBase, vid, pid);
		alert(msg);
		setDriverBusy(false);
	};

	const handleInstallWinUsb = async (device: BtDevice) => {
		const ok = window.confirm(
			'ドライバを切り替えると、このドングルは通常の Bluetooth デバイスとして利用できなくなります。\n' +
				'BTStack 専用ドングルとして使用する場合のみ続行してください。\n\n' +
				'続行しますか？',
		);
		if (!ok) return;
		setDriverBusy(true);
		const msg = await installWinUsbDriver(apiBase, device);
		alert(msg);
		setDriverBusy(false);
	};

	const handleRefresh = () => requestRefresh();

	return (
		<div className="controller-list">
			{version && <div className="version-label">switch-bt-ws v{version}</div>}
			{error && <div className="error-msg">{error}</div>}

			<div className="section-header">
				<h4>BT ドングル</h4>
				<button
					type="button"
					className="btn btn-secondary btn-sm"
					onClick={handleRefresh}
				>
					更新
				</button>
			</div>

			{devices.length === 0 && !error && (
				<p className="empty-msg">BT ドングルが検出されていません</p>
			)}

			{/* ===== 汎用USBドライバ (WinUSB) ===== */}
			{(winUsbDevices.length > 0 || orphanControllers.length > 0) && (
				<div className="dongle-category">
					<h5 className="dongle-category-label category-winusb">汎用USBドライバ</h5>
					<div className="dongle-card-list">
						{winUsbDevices.map((row) => {
							const key = dongleKey(row.device.vid, row.device.pid, row.device.instance);
							const status = dongleStatuses[key] ?? 'disconnected';
							const busy = actionBusy === key;
							// コントローラーが存在 = サーバー側に接続オブジェクトがある
							const hasController = row.controller != null;

							const playerNum = row.controller ? playerMap.get(row.controller.id) : null;

							return (
								<div key={key} className="dongle-card">
									<div className="dongle-card-row">
										{playerNum && <span className="player-badge">{`P${playerNum}`}</span>}
										<span className="mono">
											{row.device.vid}:{row.device.pid}
										</span>
										<span className="dongle-desc">{row.displayName}</span>
										<DongleStatusBadge
											status={status}
											paired={row.controller?.paired ?? false}
											syncing={row.controller?.syncing ?? false}
											hasLinkKeys={!!linkKeysAvailable[key]}
										/>
									</div>
									<div className="dongle-card-actions">
										{hasController ? (
											<button
												type="button"
												className="btn btn-danger btn-sm"
												disabled={busy}
												onClick={() => {
													if (row.controller) handleDisconnect(row.controller.id, row.device);
												}}
											>
												切断
											</button>
										) : (
											<>
												{row.isKnown && linkKeysAvailable[key] && (
													<button
														type="button"
														className="btn btn-primary btn-sm"
														disabled={busy}
														onClick={() => handleReconnect(row.device)}
													>
														再接続
													</button>
												)}
												<button
													type="button"
													className="btn btn-warning btn-sm"
													disabled={busy}
													onClick={() => handlePairing(row.device)}
												>
													ペアリング
												</button>
												<button
													type="button"
													className="btn btn-secondary btn-sm"
													disabled={busy || driverBusy}
													onClick={() => handleRestoreDriver(row.device.vid, row.device.pid)}
												>
													ドライバ復旧
												</button>
											</>
										)}
									</div>
								</div>
							);
						})}
						{orphanControllers.map((c) => {
							const pNum = playerMap.get(c.id);
							return (
								<div key={`o-${c.id}`} className="dongle-card orphan-row">
									<div className="dongle-card-row">
										{pNum && <span className="player-badge">{`P${pNum}`}</span>}
										<span className="mono">
											{c.vid}:{c.pid}
										</span>
										<span className="dongle-desc text-dim">（デバイス未検出）</span>
										<span className="status-badge offline">不明</span>
									</div>
									<div className="dongle-card-actions">
										<button
											type="button"
											className="btn btn-danger btn-sm"
											onClick={() => handleDisconnect(c.id)}
										>
											切断
										</button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* ===== OS 標準ドライバ (BTHUSB) ===== */}
			{bthUsbDevices.length > 0 && (
				<div className="dongle-category">
					<h5 className="dongle-category-label category-bthusb">OS標準BlueToothドライバ</h5>
					<table className="device-table">
						<thead>
							<tr>
								<th>VID:PID</th>
								<th>説明</th>
								<th>ドライバ</th>
								<th>操作</th>
							</tr>
						</thead>
						<tbody>
							{bthUsbDevices.map((d) => (
								<tr key={`${d.vid}:${d.pid}:${d.instance}`}>
									<td className="mono">
										{d.vid}:{d.pid}
									</td>
									<td>{d.description}</td>
									<td>{d.driver}</td>
									<td className="action-cell">
										<button
											type="button"
											className="btn btn-primary btn-sm"
											onClick={() => handleInstallWinUsb(d)}
											disabled={driverBusy}
										>
											BTStack 用に切替
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* ===== 非対応 ===== */}
			{otherDevices.length > 0 && (
				<div className="dongle-category">
					<h5 className="dongle-category-label category-other">非対応</h5>
					<table className="device-table">
						<thead>
							<tr>
								<th>VID:PID</th>
								<th>説明</th>
								<th>ドライバ</th>
							</tr>
						</thead>
						<tbody>
							{otherDevices.map((d) => (
								<tr key={`${d.vid}:${d.pid}:${d.instance}`} className="disabled-row">
									<td className="mono">
										{d.vid}:{d.pid}
									</td>
									<td>{d.description}</td>
									<td>{d.driver}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function DongleStatusBadge({
	status,
	paired,
	syncing,
	hasLinkKeys,
}: {
	status: string;
	paired: boolean;
	syncing: boolean;
	hasLinkKeys: boolean;
}) {
	const linkKeyLabel = (hasLinkKeys || paired) && (
		<span className="text-dim" style={{ fontSize: 11 }}>
			リンクキー保持
		</span>
	);

	if (paired)
		return (
			<>
				<span className="status-badge paired">接続中</span>
				{linkKeyLabel}
			</>
		);
	if (syncing) return <span className="status-badge syncing">ペアリング中…</span>;
	if (status === 'connecting') return <span className="status-badge waiting">接続中…</span>;
	if (status === 'error')
		return (
			<>
				<span className="status-badge offline">エラー</span>
				{linkKeyLabel}
			</>
		);
	return (
		<>
			<span className="status-badge offline">未接続</span>
			{linkKeyLabel}
		</>
	);
}
