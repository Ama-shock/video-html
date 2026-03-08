import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { saveProfile } from '../../db/identity';
import { generateIdenticonDataUrl } from '../../identity/identicon';
import type { AppDispatch, RootState } from '../../store';
import { setUsername } from '../../store/identitySlice';

export default function IdentityMenu() {
	const dispatch = useDispatch<AppDispatch>();
	const publicKeyB64 = useSelector((s: RootState) => s.identity.publicKeyB64);
	const username = useSelector((s: RootState) => s.identity.username);

	const [name, setName] = useState(username);
	const [identiconUrl, setIdenticonUrl] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => setName(username), [username]);
	useEffect(() => {
		if (publicKeyB64) generateIdenticonDataUrl(publicKeyB64).then(setIdenticonUrl);
	}, [publicKeyB64]);

	const handleSave = async () => {
		await saveProfile({ username: name });
		dispatch(setUsername(name));
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	return (
		<div className="menu-section">
			<div className="identity-row">
				{identiconUrl && <img src={identiconUrl} alt="identicon" className="identicon-small" />}
				<div className="identity-fields">
					<div className="form-group">
						<label>
							ユーザー名
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={32}
								placeholder="名前を入力"
							/>
						</label>
					</div>
					<button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={!name.trim()}>
						{saved ? '保存しました' : '保存'}
					</button>
				</div>
			</div>

			<div className="key-display-small">
				<span className="hint">ユーザー ID</span>
				<div className="key-display">{publicKeyB64 ?? '—'}</div>
			</div>
		</div>
	);
}
