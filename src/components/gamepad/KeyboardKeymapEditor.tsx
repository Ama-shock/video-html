/**
 * キーボードキーマップエディタ。
 *
 * キーボードのキー → Web Gamepad ボタンインデックスの対応を編集する。
 */

import { useCallback, useState } from 'react';
import type { KeyboardKeymapEntry } from '../../keyboard/index';
import { GAMEPAD_BUTTON_NAMES, KEY_CODE_LABELS } from '../../keyboard/keymap';

type Props = {
	keymap: KeyboardKeymapEntry[];
	onSave: (keymap: KeyboardKeymapEntry[]) => void;
	onReset: () => void;
};

export default function KeyboardKeymapEditor({ keymap, onSave, onReset }: Props) {
	const [editing, setEditing] = useState<KeyboardKeymapEntry[]>(keymap.map((e) => ({ ...e })));
	const [saved, setSaved] = useState(false);
	const [capturing, setCapturing] = useState<number | null>(null);

	const handleButtonChange = (idx: number, buttonIndex: number) => {
		setEditing((prev) => prev.map((e, i) => (i === idx ? { ...e, buttonIndex } : e)));
	};

	const startCapture = useCallback((idx: number) => {
		setCapturing(idx);
	}, []);

	const handleKeyCapture = useCallback(
		(e: React.KeyboardEvent) => {
			if (capturing == null) return;
			e.preventDefault();
			const code = e.nativeEvent.code;
			setEditing((prev) =>
				prev.map((entry, i) => (i === capturing ? { ...entry, key: code } : entry)),
			);
			setCapturing(null);
		},
		[capturing],
	);

	const addEntry = () => {
		setEditing((prev) => [...prev, { key: 'KeyZ', buttonIndex: 0 }]);
	};

	const removeEntry = (idx: number) => {
		setEditing((prev) => prev.filter((_, i) => i !== idx));
	};

	const handleSave = async () => {
		await onSave(editing);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	return (
		// biome-ignore lint: onKeyDown needed for key capture
		<div className="keymap-editor" onKeyDown={handleKeyCapture}>
			<p className="hint">キーボードのキーと Web Gamepad ボタンの対応を設定します。</p>
			<table className="keymap-table">
				<thead>
					<tr>
						<th>キー</th>
						<th>→</th>
						<th>ボタン</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{editing.map((entry, idx) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: entries can have duplicate keys
						<tr key={`${idx}-${entry.key}`}>
							<td>
								<button
									type="button"
									className={`btn btn-sm ${capturing === idx ? 'btn-primary' : 'btn-secondary'}`}
									onClick={() => startCapture(idx)}
								>
									{capturing === idx ? 'キーを押す...' : (KEY_CODE_LABELS[entry.key] ?? entry.key)}
								</button>
							</td>
							<td>→</td>
							<td>
								<select
									value={entry.buttonIndex}
									onChange={(e) => handleButtonChange(idx, Number(e.target.value))}
								>
									{Object.entries(GAMEPAD_BUTTON_NAMES).map(([btnIdx, name]) => (
										<option key={btnIdx} value={Number(btnIdx)}>
											{name}
										</option>
									))}
								</select>
							</td>
							<td>
								<button
									type="button"
									className="btn btn-danger btn-sm"
									onClick={() => removeEntry(idx)}
								>
									×
								</button>
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
				<button type="button" className="btn btn-secondary" onClick={addEntry}>
					+ 追加
				</button>
			</div>
		</div>
	);
}
