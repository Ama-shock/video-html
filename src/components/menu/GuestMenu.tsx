import { useSelector } from 'react-redux';
import type { RootState } from '../../store';

/**
 * Guest menu section in the overlay.
 * Shows connection status. The actual join form is on the main screen (GuestMainView).
 */
export default function GuestMenu() {
	const status = useSelector((s: RootState) => s.guest.status);
	const controllerId = useSelector((s: RootState) => s.guest.controllerId);

	return (
		<div className="menu-section">
			<h3>ゲスト接続状態</h3>
			<div className="menu-card">
				<div className="guest-connection-status">
					<span className={`status-dot ${status === 'connected' ? 'connected' : status === 'waiting' || status === 'joining' ? 'waiting' : ''}`} />
					<span>
						{status === 'idle' && '未接続 — 画面から部屋鍵を入力してください'}
						{status === 'joining' && '接続中...'}
						{status === 'waiting' && 'ホストの承認待ち'}
						{status === 'connected' && '接続中'}
						{status === 'rejected' && '拒否されました'}
						{status === 'error' && 'エラー'}
					</span>
				</div>
				{controllerId !== null && (
					<p className="hint">コントローラー #{controllerId} として接続中</p>
				)}
			</div>
		</div>
	);
}
