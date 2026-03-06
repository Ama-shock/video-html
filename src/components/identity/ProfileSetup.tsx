import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { generateIdenticonDataUrl } from '../../identity/identicon';

type Props = {
    onComplete: (username: string) => void;
};

export default function ProfileSetup({ onComplete }: Props) {
    const publicKeyB64 = useSelector((s: RootState) => s.identity.publicKeyB64);
    const [username, setUsername] = useState('');
    const [identiconUrl, setIdenticonUrl] = useState<string | null>(null);

    useEffect(() => {
        if (publicKeyB64) generateIdenticonDataUrl(publicKeyB64).then(setIdenticonUrl);
    }, [publicKeyB64]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (username.trim()) onComplete(username.trim());
    };

    return (
        <div className="setup-screen">
            <div className="setup-card">
                <h1>ようこそ</h1>
                <p>初回起動です。ユーザー名を設定してください。</p>

                {identiconUrl && (
                    <img src={identiconUrl} alt="あなたのアイデンティコン" className="identicon-large" />
                )}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="username">ユーザー名</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="名前を入力"
                            maxLength={32}
                            autoFocus
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary btn-large"
                        disabled={!username.trim()}
                    >
                        はじめる
                    </button>
                </form>
            </div>
        </div>
    );
}
