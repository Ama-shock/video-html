import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';

type BtDevice = {
	vid: string;
	pid: string;
	description: string;
	driver: string;
	instance: number;
};

type Controller = {
	id: number;
	vid: string;
	pid: string;
	instance: number;
	paired: boolean;
	rumble: boolean;
};

/** WinUSB デバイス + コントローラー情報を結合した行 */
type WinUsbRow = {
	device: BtDevice;
	controller: Controller | null;
};

function isWinUsb(driver: string): boolean {
	return /^winusb$/i.test(driver);
}
function isBthUsb(driver: string): boolean {
	return /^(bthusb|bthenum)/i.test(driver);
}

export default function ControllerList() {
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);
	const apiBase = `http://localhost:${wsPort}`;

	const [controllers, setControllers] = useState<Controller[]>([]);
	const [devices, setDevices] = useState<BtDevice[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [driverBusy, setDriverBusy] = useState(false);
	const autoConnectedRef = useRef(false);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [ctrlResp, devResp] = await Promise.all([
				fetch(`${apiBase}/api/controllers`),
				fetch(`${apiBase}/api/driver/list`),
			]);
			if (ctrlResp.ok) setControllers(await ctrlResp.json());
			if (devResp.ok) setDevices(await devResp.json());
		} catch (_err) {
			setError('switch-bt-ws に接続できません。サーバーが起動しているか確認してください。');
		} finally {
			setLoading(false);
		}
	}, [apiBase]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const addController = useCallback(async (vid: string, pid: string, instance: number) => {
		try {
			const resp = await fetch(`${apiBase}/api/controllers`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ vid: parseInt(vid, 16), pid: parseInt(pid, 16), instance }),
			});
			if (resp.ok) await fetchData();
		} catch {
			setError('コントローラーの追加に失敗しました');
		}
	}, [apiBase, fetchData]);

	const removeController = async (id: number) => {
		try {
			await fetch(`${apiBase}/api/controllers/${id}`, { method: 'DELETE' });
			await fetchData();
		} catch {
			setError('コントローラーの削除に失敗しました');
		}
	};

	const installWinUsb = async (vid: string, pid: string) => {
		const ok = window.confirm(
			'ドライバを切り替えると、このドングルは通常の Bluetooth デバイスとして利用できなくなります。\n' +
			'BTStack 専用ドングルとして使用する場合のみ続行してください。\n\n' +
			'続行しますか？',
		);
		if (!ok) return;
		setDriverBusy(true);
		try {
			const resp = await fetch(`${apiBase}/api/driver/install`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ vid: parseInt(vid, 16), pid: parseInt(pid, 16) }),
			});
			const result = (await resp.json()) as { message?: string; error?: string };
			alert(result.message ?? result.error);
			await fetchData();
		} catch {
			setError('ドライバのインストールに失敗しました');
		} finally {
			setDriverBusy(false);
		}
	};

	const restoreDriver = async (vid: string, pid: string) => {
		setDriverBusy(true);
		try {
			const resp = await fetch(`${apiBase}/api/driver/restore`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ vid: parseInt(vid, 16), pid: parseInt(pid, 16) }),
			});
			const result = (await resp.json()) as { message?: string; error?: string };
			alert(result.message ?? result.error);
			await fetchData();
		} catch {
			setError('ドライバの復元に失敗しました');
		} finally {
			setDriverBusy(false);
		}
	};

	// --- デバイスを3カテゴリに分類 ---
	const winUsbDevices: WinUsbRow[] = devices
		.filter((d) => isWinUsb(d.driver))
		.map((d) => ({
			device: d,
			controller: controllers.find(
				(c) => c.vid === d.vid && c.pid === d.pid && c.instance === d.instance,
			) ?? null,
		}));

	const bthUsbDevices = devices.filter((d) => isBthUsb(d.driver));
	const otherDevices = devices.filter((d) => !isWinUsb(d.driver) && !isBthUsb(d.driver));

	// 登録されているがデバイス一覧に無いコントローラー（抜かれた等）
	const orphanControllers = controllers.filter(
		(c) => !winUsbDevices.some((w) => w.controller?.id === c.id),
	);

	// --- 初回自動接続: WinUSB デバイスで未登録のものを自動追加 ---
	useEffect(() => {
		if (autoConnectedRef.current) return;
		if (devices.length === 0) return;
		const unregistered = devices.filter(
			(d) => isWinUsb(d.driver) && !controllers.some(
				(c) => c.vid === d.vid && c.pid === d.pid && c.instance === d.instance,
			),
		);
		if (unregistered.length > 0) {
			autoConnectedRef.current = true;
			for (const d of unregistered) {
				addController(d.vid, d.pid, d.instance);
			}
		} else if (controllers.length > 0 || devices.some((d) => isWinUsb(d.driver))) {
			// 既に全て登録済み
			autoConnectedRef.current = true;
		}
	}, [devices, controllers, addController]);

	return (
		<div className="controller-list">
			{error && <div className="error-msg">{error}</div>}

			<div className="section-header">
				<h4>BT ドングル</h4>
				<button
					type="button"
					className="btn btn-secondary btn-sm"
					onClick={fetchData}
					disabled={loading}
				>
					{loading ? '更新中…' : '更新'}
				</button>
			</div>

			{devices.length === 0 && !loading && (
				<p className="empty-msg">BT ドングルが検出されていません</p>
			)}

			{/* ===== 汎用ドライバ (WinUSB) ===== */}
			{(winUsbDevices.length > 0 || orphanControllers.length > 0) && (
				<div className="dongle-category">
					<h5 className="dongle-category-label category-winusb">汎用ドライバ</h5>
					<table className="device-table">
						<thead>
							<tr>
								<th>VID:PID</th>
								<th>説明</th>
								<th>ドライバ</th>
								<th>状態</th>
								<th>操作</th>
							</tr>
						</thead>
						<tbody>
							{winUsbDevices.map((row, i) => (
								<tr key={`w-${i}`}>
									<td className="mono">{row.device.vid}:{row.device.pid}</td>
									<td>{row.device.description}</td>
									<td>{row.device.driver}</td>
									<td>
										{row.controller ? (
											<span className={`status-badge ${row.controller.paired ? 'paired' : 'waiting'}`}>
												{row.controller.paired ? '接続中' : '待機中'}
											</span>
										) : (
											<span className="status-badge offline">未接続</span>
										)}
									</td>
									<td className="action-cell">
										{row.controller ? (
											<button
												type="button"
												className="btn btn-danger btn-sm"
												onClick={() => removeController(row.controller!.id)}
											>
												切断
											</button>
										) : (
											<button
												type="button"
												className="btn btn-primary btn-sm"
												onClick={() => addController(row.device.vid, row.device.pid, row.device.instance)}
											>
												接続
											</button>
										)}
										<button
											type="button"
											className="btn btn-secondary btn-sm"
											onClick={() => restoreDriver(row.device.vid, row.device.pid)}
											disabled={driverBusy}
										>
											標準ドライバに戻す
										</button>
									</td>
								</tr>
							))}
							{orphanControllers.map((c) => (
								<tr key={`o-${c.id}`} className="orphan-row">
									<td className="mono">{c.vid}:{c.pid}</td>
									<td className="text-dim">（デバイス未検出）</td>
									<td>—</td>
									<td>
										<span className="status-badge offline">不明</span>
									</td>
									<td className="action-cell">
										<button
											type="button"
											className="btn btn-danger btn-sm"
											onClick={() => removeController(c.id)}
										>
											切断
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* ===== OS 標準ドライバ (BTHUSB) ===== */}
			{bthUsbDevices.length > 0 && (
				<div className="dongle-category">
					<h5 className="dongle-category-label category-bthusb">OS 標準ドライバ</h5>
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
							{bthUsbDevices.map((d, i) => (
								<tr key={`b-${i}`}>
									<td className="mono">{d.vid}:{d.pid}</td>
									<td>{d.description}</td>
									<td>{d.driver}</td>
									<td className="action-cell">
										<button
											type="button"
											className="btn btn-primary btn-sm"
											onClick={() => installWinUsb(d.vid, d.pid)}
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

			{/* ===== 非対応 (その他のドライバ) ===== */}
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
							{otherDevices.map((d, i) => (
								<tr key={`o-${i}`} className="disabled-row">
									<td className="mono">{d.vid}:{d.pid}</td>
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
