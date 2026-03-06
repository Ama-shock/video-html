import React, { useState } from 'react';

type Props = { roomKey: string };

export default function RoomKeyDisplay({ roomKey }: Props) {
    const [copied, setCopied] = useState(false);

    const url = `${window.location.origin}${window.location.pathname}#room=${encodeURIComponent(roomKey)}`;

    const copyKey = async () => {
        await navigator.clipboard.writeText(roomKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const copyUrl = async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="room-key-display">
            <h4>部屋鍵</h4>
            <div className="key-box">
                <textarea readOnly value={roomKey} rows={3} className="key-textarea" />
            </div>
            <div className="key-actions">
                <button className="btn btn-secondary btn-sm" onClick={copyKey}>
                    {copied ? '✓ コピー済み' : '鍵をコピー'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={copyUrl}>
                    URL をコピー
                </button>
            </div>
            <p className="hint">このURLをゲストに共有するか、部屋鍵を直接渡してください。</p>
        </div>
    );
}
