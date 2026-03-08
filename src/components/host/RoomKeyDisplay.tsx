import { useState } from 'react';

type ExpiryLevel = 'ok' | 'warn' | 'critical' | 'expired';

type Props = {
	roomKey: string;
	remaining: string;
	expiryLevel: ExpiryLevel;
	onRenew: () => void;
	renewing: boolean;
};

export default function RoomKeyDisplay({ roomKey, remaining, expiryLevel, onRenew, renewing }: Props) {
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
				<button type="button" className="btn btn-secondary btn-sm" onClick={copyKey}>
					{copied ? '✓ コピー済み' : '鍵をコピー'}
				</button>
				<button type="button" className="btn btn-secondary btn-sm" onClick={copyUrl}>
					URL をコピー
				</button>
			</div>
			<div className={`room-expiry expiry-${expiryLevel}`}>
				<span className="room-expiry-label">
					{expiryLevel === 'expired'
						? '期限切れ（新規入室不可）'
						: `入室受付: 残り ${remaining}`}
				</span>
				<button
					type="button"
					className="btn btn-secondary btn-sm"
					onClick={onRenew}
					disabled={renewing}
				>
					{renewing ? '更新中…' : '鍵を更新'}
				</button>
			</div>
		</div>
	);
}
