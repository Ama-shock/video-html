import { useEffect, useState } from 'react';
import { generateIdenticonDataUrl } from '../../identity/identicon';
import { VIDEO_QUALITY_LABELS, type GuestStatus, type VideoQuality } from '../../store/hostSlice';
import type { ConnectionStats } from '../../webrtc/stats';

type Props = {
	pending: GuestStatus[];
	guests: GuestStatus[];
	onAllow: (userId: string) => void;
	onReject: (userId: string) => void;
	onRemove: (userId: string) => void;
	onQualityChange: (userId: string, quality: VideoQuality) => void;
	getGuestStats?: (userId: string) => Promise<ConnectionStats | null>;
};

function GuestCard({
	guest,
	isPending,
	onAllow,
	onReject,
	onRemove,
	onQualityChange,
	getStats,
}: {
	guest: GuestStatus;
	isPending: boolean;
	onAllow?: () => void;
	onReject?: () => void;
	onRemove?: () => void;
	onQualityChange?: (quality: VideoQuality) => void;
	getStats?: () => Promise<ConnectionStats | null>;
}) {
	const [identiconUrl, setIdenticonUrl] = useState<string | null>(null);
	const [rttMs, setRttMs] = useState<number | null>(null);

	useEffect(() => {
		generateIdenticonDataUrl(guest.userId).then(setIdenticonUrl);
	}, [guest.userId]);

	// 接続済みゲストの RTT を定期取得
	useEffect(() => {
		if (isPending || guest.connectionState !== 'connected' || !getStats) {
			setRttMs(null);
			return;
		}
		const poll = async () => {
			const stats = await getStats();
			setRttMs(stats?.rttMs ?? null);
		};
		poll();
		const id = setInterval(poll, 2000);
		return () => clearInterval(id);
	}, [isPending, guest.connectionState, getStats]);

	const stateColor =
		{
			new: '#888',
			connecting: '#f90',
			connected: '#0a0',
			disconnected: '#666',
			failed: '#d00',
			closed: '#666',
		}[guest.connectionState] ?? '#888';

	return (
		<div className={`guest-card ${isPending ? 'pending' : ''}`}>
			{identiconUrl && <img src={identiconUrl} alt={guest.username} className="guest-avatar" />}
			<div className="guest-info">
				<span className="guest-name">{guest.username}</span>
				<span className="guest-id" title={guest.userId}>
					{guest.userId.slice(0, 12)}…
				</span>
				{!isPending && (
					<span className="guest-state" style={{ color: stateColor }}>
						● {guest.connectionState}
						{rttMs !== null && <span className="rtt-badge">{rttMs} ms</span>}
					</span>
				)}
			</div>

			<div className="guest-actions">
				{isPending ? (
					<>
						<button
							type="button"
							className="btn btn-primary btn-sm"
							onClick={onAllow}
						>
							許可
						</button>
						<button type="button" className="btn btn-danger btn-sm" onClick={onReject}>
							拒否
						</button>
					</>
				) : (
					<>
						<select
							className="quality-select"
							value={guest.videoQuality}
							onChange={(e) => onQualityChange?.(e.target.value as VideoQuality)}
						>
							{(Object.keys(VIDEO_QUALITY_LABELS) as VideoQuality[]).map((q) => (
								<option key={q} value={q}>{VIDEO_QUALITY_LABELS[q]}</option>
							))}
						</select>
						<button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
							切断
						</button>
					</>
				)}
			</div>
		</div>
	);
}

export default function GuestList({
	pending,
	guests,
	onAllow,
	onReject,
	onRemove,
	onQualityChange,
	getGuestStats,
}: Props) {
	return (
		<div className="guest-list">
			{pending.length > 0 && (
				<section>
					<h4>接続待ち ({pending.length})</h4>
					{pending.map((g) => (
						<GuestCard
							key={g.userId}
							guest={g}
							isPending
							onAllow={() => onAllow(g.userId)}
							onReject={() => onReject(g.userId)}
						/>
					))}
				</section>
			)}

			{guests.length > 0 && (
				<section>
					<h4>接続中 ({guests.length})</h4>
					{guests.map((g) => (
						<GuestCard
							key={g.userId}
							guest={g}
							isPending={false}
							onRemove={() => onRemove(g.userId)}
							onQualityChange={(q) => onQualityChange(g.userId, q)}
							getStats={getGuestStats ? () => getGuestStats(g.userId) : undefined}
						/>
					))}
				</section>
			)}

			{pending.length === 0 && guests.length === 0 && (
				<p className="empty-msg">ゲストはまだ接続していません</p>
			)}
		</div>
	);
}
