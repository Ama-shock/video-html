import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { saveSettings } from '../../db/settings';
import type { AppDispatch, RootState } from '../../store';
import { setSwitchBtWsPort } from '../../store/appSlice';
import ControllerList from './ControllerList';

export default function SettingsPanel() {
	const dispatch = useDispatch<AppDispatch>();
	const wsPort = useSelector((s: RootState) => s.app.switchBtWsPort);

	const [portInput, setPortInput] = useState(String(wsPort));
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		setPortInput(String(wsPort));
	}, [wsPort]);

	const handleSave = async () => {
		const port = Number(portInput) || 8765;
		dispatch(setSwitchBtWsPort(port));
		await saveSettings({ switchBtWsPort: port });
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	return (
		<div className="panel settings-panel">
			<h2>設定</h2>

			<section>
				<h3>switch-bt-ws 接続先</h3>
				<div className="form-group">
					<label>
						ポート番号
						<input
							type="number"
							value={portInput}
							onChange={(e) => setPortInput(e.target.value)}
							placeholder="8765"
							min={1}
							max={65535}
						/>
					</label>
					<p className="hint">ローカルの switch-bt-ws サーバーのポート番号です（localhost 固定）。</p>
				</div>

				<button type="button" className="btn btn-primary" onClick={handleSave}>
					{saved ? '✓ 保存しました' : '保存'}
				</button>
			</section>

			<section>
				<h3>switch-bt-ws コントローラー管理</h3>
				<ControllerList />
			</section>
		</div>
	);
}
