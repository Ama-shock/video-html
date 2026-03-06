import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { setUsername } from '../../store/identitySlice';
import { saveProfile } from '../../db/identity';
import { generateIdenticonDataUrl } from '../../identity/identicon';

export default function IdentityPanel() {
    const dispatch = useDispatch<AppDispatch>();
    const publicKeyB64 = useSelector((s: RootState) => s.identity.publicKeyB64);
    const username = useSelector((s: RootState) => s.identity.username);

    const [name, setName] = useState(username);
    const [identiconUrl, setIdenticonUrl] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => { setName(username); }, [username]);

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
        <div className="panel identity-panel">
            <h2>プロフィール</h2>

            <div className="identity-card">
                {identiconUrl && (
                    <img src={identiconUrl} alt="identicon" className="identicon-large" />
                )}
                <div className="identity-info">
                    <div className="form-group">
                        <label>ユーザー名</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            maxLength={32}
                            placeholder="名前を入力"
                        />
                    </div>
                    <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>
                        {saved ? '✓ 保存しました' : '保存'}
                    </button>
                </div>
            </div>

            <div className="identity-key">
                <label>ユーザー ID (Ed25519 公開鍵)</label>
                <div className="key-display">{publicKeyB64 ?? '—'}</div>
                <p className="hint">この ID はあなたを識別します。秘密鍵はブラウザ内に安全に保管され、外部に出力されることはありません。</p>
            </div>
        </div>
    );
}
