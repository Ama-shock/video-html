import { useState } from 'react';
import type { KeymapEntry } from '../../db/settings';

const GAMEPAD_BUTTON_NAMES: Record<number, string> = {
	0: 'A (下)',
	1: 'B (右)',
	2: 'X (左)',
	3: 'Y (上)',
	4: 'LB',
	5: 'RB',
	6: 'LT',
	7: 'RT',
	8: 'Back/−',
	9: 'Start/+',
	10: 'L3',
	11: 'R3',
	12: '↑',
	13: '↓',
	14: '←',
	15: '→',
	16: 'Home',
	17: 'Screenshot',
};

const SWITCH_BUTTON_NAMES: Record<number, string> = {
	[1 << 0]: 'Y',
	[1 << 1]: 'X',
	[1 << 2]: 'B',
	[1 << 3]: 'A',
	[1 << 4]: 'SR (右)',
	[1 << 5]: 'SL (右)',
	[1 << 6]: 'R',
	[1 << 7]: 'ZR',
	[1 << 8]: '−',
	[1 << 9]: '+',
	[1 << 10]: 'RS',
	[1 << 11]: 'LS',
	[1 << 12]: 'Home',
	[1 << 13]: 'SS',
	[1 << 16]: '↓',
	[1 << 17]: '↑',
	[1 << 18]: '→',
	[1 << 19]: '←',
	[1 << 20]: 'SR (左)',
	[1 << 21]: 'SL (左)',
	[1 << 22]: 'L',
	[1 << 23]: 'ZL',
};

type Props = {
	keymap: KeymapEntry[];
	onSave: (keymap: KeymapEntry[]) => void;
	onReset: () => void;
};

export default function KeymapEditor({ keymap, onSave, onReset }: Props) {
	const [editing, setEditing] = useState<KeymapEntry[]>(keymap.map((e) => ({ ...e })));
	const [saved, setSaved] = useState(false);

	const handleSwitch = (gpBtn: number, switchBtn: number) => {
		setEditing((prev) =>
			prev.map((e) => (e.gamepadButton === gpBtn ? { ...e, switchButton: switchBtn } : e)),
		);
	};

	const handleSave = async () => {
		await onSave(editing);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	return (
		<div className="keymap-editor">
			<p className="hint">Web Gamepad のボタンと Nintendo Switch ボタンの対応を設定します。</p>
			<table className="keymap-table">
				<thead>
					<tr>
						<th>ゲームパッド</th>
						<th>→</th>
						<th>Switch ボタン</th>
					</tr>
				</thead>
				<tbody>
					{editing.map((entry) => (
						<tr key={entry.gamepadButton}>
							<td>
								{GAMEPAD_BUTTON_NAMES[entry.gamepadButton] ?? `Button ${entry.gamepadButton}`}
							</td>
							<td>→</td>
							<td>
								<select
									value={entry.switchButton}
									onChange={(e) => handleSwitch(entry.gamepadButton, Number(e.target.value))}
								>
									{Object.entries(SWITCH_BUTTON_NAMES).map(([bit, name]) => (
										<option key={bit} value={Number(bit)}>
											{name}
										</option>
									))}
								</select>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<div className="keymap-actions">
				<button type="button" className="btn btn-primary" onClick={handleSave}>
					{saved ? '✓ 保存済み' : '保存'}
				</button>
				<button type="button" className="btn btn-secondary" onClick={onReset}>
					デフォルトに戻す
				</button>
			</div>
		</div>
	);
}
