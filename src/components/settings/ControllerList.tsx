import { useCallback, useEffect, useState } from 'react';
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

export default function ControllerList() {
	const wsBaseUrl = useSelector((s: RootState) =>
		s.app.switchBtWsUrl.replace('ws://', 'http://').replace('wss://', 'https://'),
	);
	const apiBase = wsBaseUrl.replace(/\/ws.*$/, '');

	const [controllers, setControllers] = useState<Controller[]>([]);
	const [devices, setDevices] = useState<BtDevice[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

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

	const addController = async (vid: string, pid: string, instance: number) => {
		const vidNum = parseInt(vid, 16);
		const pidNum = parseInt(pid, 16);
		try {
			const resp = await fetch(`${apiBase}/api/controllers`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ vid: vidNum, pid: pidNum, instance }),
			});
			if (resp.ok) fetchData();
		} catch {
			setError('コントローラーの追加に失敗しました');
		}
	};

	const removeController = async (id: number) => {
		try {
			await fetch(`${apiBase}/api/controllers/${id}`, { method: 'DELETE' });
			fetchData();
		} catch {
			setError('コントローラーの削除に失敗しました');
		}
	};

	const installWinUsb = async (vid: string, pid: string) => {
		try {
			const resp = await fetch(`${apiBase}/api/driver/install`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ vid: parseInt(vid, 16), pid: parseInt(pid, 16) }),
			});
			const result = (await resp.json()) as { message?: string; error?: string };
			alert(result.message ?? result.error);
			fetchData();
		} catch {
			setError('ドライバのインストールに失敗しました');
		}
	};

	return (
		<div className="controller-list">
			{error && <div className="error-msg">{error}</div>}

			<div className="section-header">
				<h4>登録済みコントローラー</h4>
				<button
					type="button"
					className="btn btn-secondary btn-sm"
					onClick={fetchData}
					disabled={loading}
				>
					{loading ? '更新中…' : '更新'}
				</button>
			</div>

			{controllers.length === 0 ? (
				<p className="empty-msg">コントローラーが登録されていません</p>
			) : (
				<table className="controller-table">
					<thead>
						<tr>
							<th>ID</th>
							<th>VID</th>
							<th>PID</th>
							<th>Inst</th>
							<th>状態</th>
							<th>操作</th>
						</tr>
					</thead>
					<tbody>
						{controllers.map((c) => (
							<tr key={c.id}>
								<td>#{c.id}</td>
								<td>{c.vid}</td>
								<td>{c.pid}</td>
								<td>{c.instance}</td>
								<td>{c.paired ? '🟢 接続' : '⚪ 待機'}</td>
								<td>
									<button
										type="button"
										className="btn btn-danger btn-sm"
										onClick={() => removeController(c.id)}
									>
										削除
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			{devices.length > 0 && (
				<>
					<h4>検出された BT ドングル</h4>
					<table className="device-table">
						<thead>
							<tr>
								<th>VID</th>
								<th>PID</th>
								<th>Inst</th>
								<th>説明</th>
								<th>ドライバ</th>
								<th>操作</th>
							</tr>
						</thead>
						<tbody>
							{devices.map((d, i) => (
								<tr key={i}>
									<td>{d.vid}</td>
									<td>{d.pid}</td>
									<td>{d.instance}</td>
									<td>{d.description}</td>
									<td>{d.driver}</td>
									<td>
										<button
											type="button"
											className="btn btn-primary btn-sm"
											onClick={() => addController(d.vid, d.pid, d.instance)}
										>
											追加
										</button>
										{d.driver !== 'WinUSB' && (
											<button
												type="button"
												className="btn btn-secondary btn-sm"
												onClick={() => installWinUsb(d.vid, d.pid)}
											>
												WinUSB
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
		</div>
	);
}
