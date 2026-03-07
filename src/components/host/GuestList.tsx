import { useEffect, useState } from 'react';
import { generateIdenticonDataUrl } from '../../identity/identicon';
import type { GuestStatus } from '../../store/hostSlice';

type Props = {
	pending: GuestStatus[];
	guests: GuestStatus[];
	onAllow: (userId: string, controllerId: number | null) => void;
	onReject: (userId: string) => void;
	onRemove: (userId: string) => void;
	onSetController: (userId: string, controllerId: number | null) => void;
};

function GuestCard({
	guest,
	isPending,
	onAllow,
	onReject,
	onRemove,
	onSetController,
}: {
	guest: GuestStatus;
	isPending: boolean;
	onAllow?: (cid: number | null) => void;
	onReject?: () => void;
	onRemove?: () => void;
	onSetController?: (cid: number | null) => void;
}) {
	const [identiconUrl, setIdenticonUrl] = useState<string | null>(null);
	const [selectedCid, setSelectedCid] = useState<number | null>(guest.controllerId);

	useEffect(() => {
		generateIdenticonDataUrl(guest.userId).then(setIdenticonUrl);
	}, [guest.userId]);

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
					</span>
				)}
			</div>

			<div className="guest-controller">
				<label>
					コントローラー
					<select
						value={selectedCid ?? ''}
						onChange={(e) => {
							const v = e.target.value === '' ? null : Number(e.target.value);
							setSelectedCid(v);
							onSetController?.(v);
						}}
					>
						<option value="">なし</option>
						{[0, 1, 2, 3].map((i) => (
							<option key={i} value={i}>
								#{i}
							</option>
						))}
					</select>
				</label>
			</div>

			<div className="guest-actions">
				{isPending ? (
					<>
						<button
							type="button"
							className="btn btn-primary btn-sm"
							onClick={() => onAllow?.(selectedCid)}
						>
							許可
						</button>
						<button type="button" className="btn btn-danger btn-sm" onClick={onReject}>
							拒否
						</button>
					</>
				) : (
					<button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
						切断
					</button>
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
	onSetController,
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
							onAllow={(cid) => onAllow(g.userId, cid)}
							onReject={() => onReject(g.userId)}
							onSetController={(cid) => onSetController(g.userId, cid)}
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
							onSetController={(cid) => onSetController(g.userId, cid)}
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
